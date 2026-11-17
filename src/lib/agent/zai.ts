import ZAI from 'z-ai-web-dev-sdk'
import type { ChatMessage } from 'z-ai-web-dev-sdk'

/**
 * LLM LAYER — provider chain with the built-in GLM SDK as the always-fallback.
 *
 * Priority (set in .env, see .env.example):
 *   1. OPENAI_API_KEY    → any OpenAI-compatible endpoint (OpenAI,
 *                          OpenRouter, Groq, Together, LM Studio, Ollama…)
 *   2. ANTHROPIC_API_KEY → Claude
 *   3. built-in GLM SDK  (z-ai-web-dev-sdk) — zero config, always there
 *
 * Any failure of an external provider (network, 401, 429, 5xx) falls back
 * down the chain, so the app never goes dark. Streaming works on every
 * provider; on stream failure the answer degrades to one-shot, never to
 * broken.
 */

let zaiInstance: ZAI | null = null

export async function getZAI(): Promise<ZAI> {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create()
  }
  return zaiInstance
}

type Provider =
  | { kind: 'openai'; key: string; baseUrl: string; model: string }
  | { kind: 'anthropic'; key: string; model: string }
  | { kind: 'sdk' }

/** Resolve the preferred provider from env (cheap; read per call so .env changes apply on restart). */
export function resolveLLMProvider(): Provider {
  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    return {
      kind: 'openai',
      key: openaiKey,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    }
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (anthropicKey) {
    return {
      kind: 'anthropic',
      key: anthropicKey,
      model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
    }
  }
  return { kind: 'sdk' }
}

export interface LLMOptions {
  temperature?: number
  maxTokens?: number
}

// ---------------------------------------------------------------- SDK path

/** Built-in GLM SDK completion with 429-aware retry + backoff. */
async function sdkComplete(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
  const zai = await getZAI()
  const body: Record<string, unknown> = {
    messages,
    thinking: { type: 'disabled' },
    temperature: opts.temperature ?? 0.6,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      // 429s need real patience — the rate-limit window has to cool down
      // before another call is worth making; other transient errors recover
      // quickly. Jitter avoids the thundering herd on parallel calls.
      const rateLimited = lastErr instanceof Error && /429|too many/i.test(lastErr.message)
      const base = rateLimited ? 4000 : 1200
      const waitMs = Math.min(20_000, base * attempt * attempt) + Math.floor(Math.random() * 900)
      await new Promise((r) => setTimeout(r, waitMs))
    }
    try {
      const res = await zai.chat.completions.create(body as never)
      const content = res?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim().length > 0) return content
      if (Array.isArray(content)) {
        // some backends return content parts
        const joined = content.map((p: { text?: string }) => p?.text ?? '').join('')
        if (joined.trim()) return joined
      }
      lastErr = new Error('Empty completion content')
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`LLM call failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/** Built-in GLM SDK streaming (SSE chunks, OpenAI shape). */
async function sdkStream(
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (t: string) => void } = {}
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const zai = await getZAI()
  const body: Record<string, unknown> = {
    messages,
    thinking: { type: 'disabled' },
    temperature: opts.temperature ?? 0.6,
    stream: true,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  let full = ''
  try {
    const res = (await zai.chat.completions.create(body as never)) as unknown
    const bodyStream =
      res && typeof (res as ReadableStream<Uint8Array>).getReader === 'function'
        ? (res as ReadableStream<Uint8Array>)
        : ((res as { body?: ReadableStream<Uint8Array> })?.body ?? null)
    if (bodyStream && typeof bodyStream.getReader === 'function') {
      const reader = (bodyStream as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const token = parseOpenAISSELine(line)
          if (token) {
            full += token
            onToken(token)
          }
        }
      }
      if (full.trim().length > 0) return full
    }
  } catch {
    // stream died mid-flight — keep whatever tokens already arrived
  }
  return full
}

/** One `data: {...}` SSE line → its delta token (OpenAI shape), or null. */
function parseOpenAISSELine(line: string): string | null {
  if (!line.startsWith('data: ')) return null
  const payload = line.slice(6).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
    const delta = json.choices?.[0]?.delta?.content
    return typeof delta === 'string' && delta.length > 0 ? delta : null
  } catch {
    return null // partial JSON line
  }
}

// --------------------------------------------------------- external providers

/** OpenAI-compatible completion. */
async function openaiComplete(p: Extract<Provider, { kind: 'openai' }>, messages: ChatMessage[], opts: LLMOptions): Promise<string> {
  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: opts.temperature ?? 0.6,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('Empty completion content')
  return content
}

/** OpenAI-compatible streaming (SSE, same delta shape as the SDK). */
async function openaiStream(
  p: Extract<Provider, { kind: 'openai' }>,
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (t: string) => void }
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: opts.temperature ?? 0.6,
      stream: true,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  if (!res.body) throw new Error('No stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const token = parseOpenAISSELine(line)
      if (token) {
        full += token
        onToken(token)
      }
    }
  }
  if (!full.trim()) throw new Error('Empty stream')
  return full
}

/** Anthropic Messages API completion. */
async function anthropicComplete(p: Extract<Provider, { kind: 'anthropic' }>, messages: ChatMessage[], opts: LLMOptions): Promise<string> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': p.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: opts.maxTokens ?? 1100,
      temperature: opts.temperature ?? 0.6,
      ...(system ? { system } : {}),
      messages: rest.length > 0 ? rest : [{ role: 'user', content: 'Hello' }],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
  if (!text.trim()) throw new Error('Empty completion content')
  return text
}

/** Anthropic Messages API streaming (content_block_delta events). */
async function anthropicStream(
  p: Extract<Provider, { kind: 'anthropic' }>,
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (t: string) => void }
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': p.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: opts.maxTokens ?? 1100,
      temperature: opts.temperature ?? 0.6,
      stream: true,
      ...(system ? { system } : {}),
      messages: rest.length > 0 ? rest : [{ role: 'user', content: 'Hello' }],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  if (!res.body) throw new Error('No stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } }
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
          full += json.delta.text
          onToken(json.delta.text)
        }
      } catch {
        // partial JSON line
      }
    }
  }
  if (!full.trim()) throw new Error('Empty stream')
  return full
}

// ------------------------------------------------------------- public surface

/** Which provider is active right now (for the Brain tab / diagnostics). */
export function llmProviderInfo(): { provider: string; model: string | null; fallback: 'GLM SDK' } {
  const p = resolveLLMProvider()
  if (p.kind === 'openai') return { provider: 'OpenAI-compatible', model: p.model, fallback: 'GLM SDK' }
  if (p.kind === 'anthropic') return { provider: 'Anthropic', model: p.model, fallback: 'GLM SDK' }
  return { provider: 'GLM SDK (built-in)', model: null, fallback: 'GLM SDK' }
}

/**
 * Chat completion with the full fallback chain: configured external
 * provider first (one retry), then the built-in GLM SDK (429-aware retry).
 */
export async function chatText(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
  const p = resolveLLMProvider()
  if (p.kind !== 'sdk') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 800))
        return p.kind === 'openai'
          ? await openaiComplete(p, messages, opts)
          : await anthropicComplete(p, messages, opts)
      } catch {
        // external provider failed — fall down the chain
      }
    }
  }
  return sdkComplete(messages, opts)
}

/**
 * STREAMING chat completion — the typing-feel primitive, on every provider.
 *
 * Robust by design: if the preferred provider's stream fails for any
 * reason, it falls back to the next provider (non-streaming if needed) and
 * emits the whole answer as one token — the UX degrades from "typing" to
 * "one shot", never to "broken".
 */
export async function chatTextStream(
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (token: string) => void } = {}
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const p = resolveLLMProvider()

  if (p.kind !== 'sdk') {
    try {
      return p.kind === 'openai'
        ? await openaiStream(p, messages, opts)
        : await anthropicStream(p, messages, opts)
    } catch {
      // external stream failed — try the external provider one-shot, then the SDK
      try {
        const text =
          p.kind === 'openai'
            ? await openaiComplete(p, messages, opts)
            : await anthropicComplete(p, messages, opts)
        onToken(text)
        return text
      } catch {
        // fall through to the SDK
      }
    }
  }

  // SDK streaming path
  const streamed = await sdkStream(messages, opts)
  if (streamed.trim().length > 0) return streamed

  // final fallback: one-shot completion delivered as a single token
  const text = await sdkComplete(messages, opts)
  onToken(text)
  return text
}

/** Extract the first balanced JSON object from LLM output. */
export function extractJson<T>(text: string): T | null {
  if (!text) return null
  // strip markdown code fences
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          return JSON.parse(candidate) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
