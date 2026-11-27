import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import ZAI from 'z-ai-web-dev-sdk'
import type { ChatMessage } from 'z-ai-web-dev-sdk'

/**
 * LLM LAYER — provider chain supporting Gemini (@google/genai),
 * OpenAI-compatible endpoints, Anthropic, and the built-in GLM SDK.
 *
 * Priority (set in environment / Settings > Secrets, see .env.example):
 *   1. LLM_PROVIDER override ("gemini" | "openai" | "anthropic") if matching key is set
 *   2. GEMINI_API_KEY    → Google Gemini via @google/genai (gemini-4-hydrogen)
 *   3. OPENAI_API_KEY    → any OpenAI-compatible endpoint
 *   4. ANTHROPIC_API_KEY → Claude
 *   5. built-in GLM SDK  (z-ai-web-dev-sdk) when .z-ai-config is present
 */

let zaiInstance: ZAI | null = null
let zaiAttempted = false

export async function getZAI(): Promise<ZAI | null> {
  if (zaiInstance) return zaiInstance
  if (zaiAttempted) return null
  zaiAttempted = true
  try {
    zaiInstance = await ZAI.create()
    return zaiInstance
  } catch (e) {
    console.warn('[LLM] Built-in ZAI SDK unavailable:', e instanceof Error ? e.message : String(e))
    return null
  }
}

type Provider =
  | { kind: 'gemini'; key: string; model: string }
  | { kind: 'openai'; key: string; baseUrl: string; model: string }
  | { kind: 'anthropic'; key: string; model: string }
  | { kind: 'sdk' }

/** Resolve the preferred provider from env (cheap; read per call so env changes apply immediately). */
export function resolveLLMProvider(): Provider {
  const preferred = process.env.LLM_PROVIDER?.trim().toLowerCase()
  const geminiKey = process.env.GEMINI_API_KEY?.trim()
  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim()

  const asGemini = (): Provider | null =>
    geminiKey
      ? {
          kind: 'gemini',
          key: geminiKey,
          model: process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen',
        }
      : null

  const asOpenAI = (): Provider | null =>
    openaiKey
      ? {
          kind: 'openai',
          key: openaiKey,
          baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
          model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
        }
      : null

  const asAnthropic = (): Provider | null =>
    anthropicKey
      ? {
          kind: 'anthropic',
          key: anthropicKey,
          model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
        }
      : null

  if (preferred === 'openai') return asOpenAI() ?? asGemini() ?? asAnthropic() ?? { kind: 'sdk' }
  if (preferred === 'anthropic') return asAnthropic() ?? asGemini() ?? asOpenAI() ?? { kind: 'sdk' }
  if (preferred === 'gemini') return asGemini() ?? asOpenAI() ?? asAnthropic() ?? { kind: 'sdk' }

  return asGemini() ?? asOpenAI() ?? asAnthropic() ?? { kind: 'sdk' }
}

export interface LLMOptions {
  temperature?: number
  maxTokens?: number
  thinkingLevel?: 'low' | 'medium' | 'high'
  timeoutMs?: number
}

// ---------------------------------------------------------------- Gemini path (@google/genai)

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  })
}

function toGeminiPayload(messages: ChatMessage[]) {
  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .filter(Boolean)
  const systemInstruction = systemParts.length > 0 ? systemParts.join('\n\n') : undefined

  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }))

  const contents = turns.length > 0 ? turns : [{ role: 'user' as const, parts: [{ text: 'Hello' }] }]
  return { systemInstruction, contents }
}

function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  if (/PERMISSION_DENIED|API_KEY_INVALID|API key not valid|403|401/i.test(raw)) {
    return new Error('Gemini API key is invalid or missing permissions. Check GEMINI_API_KEY in Settings > Secrets.')
  }
  if (/RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return new Error('Gemini API rate limit or quota exceeded (429). Please retry shortly or check your quota in Settings > Secrets.')
  }
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(raw)) {
    return new Error('Gemini service is temporarily busy (503). Please retry in a few seconds.')
  }
  if (/NOT_FOUND|404/i.test(raw)) {
    return new Error(`Gemini model not found: ${raw}`)
  }
  return err instanceof Error ? err : new Error(raw)
}

function isTransientGeminiError(msg: string): boolean {
  return /503|timed out|busy|unavailable|overloaded|high demand|429|quota|rate limit|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    msg
  )
}

function isModelNotFoundError(msg: string): boolean {
  return /not found|404/i.test(msg)
}

function isFatalGeminiError(msg: string): boolean {
  return /invalid|missing permissions|401|403/i.test(msg)
}

function handleGeminiAttemptError(model: string, configuredModel: string, msg: string): { stop: boolean; transient: boolean } {
  if (isFatalGeminiError(msg)) return { stop: true, transient: false }
  if (isModelNotFoundError(msg)) {
    if (model === configuredModel && configuredModel !== GEMINI_FALLBACK_MODEL) {
      geminiPrimaryCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS
      return { stop: false, transient: false }
    }
    return { stop: true, transient: false }
  }
  const transient = isTransientGeminiError(msg)
  if (transient && model === configuredModel && configuredModel !== GEMINI_FALLBACK_MODEL) {
    geminiPrimaryCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS
  }
  return { stop: false, transient }
}

function geminiThinkingConfig(model: string, level: ThinkingLevel) {
  if (/^gemini-[34]/i.test(model) && !/image|tts|live|transcribe|embedding|omni/i.test(model)) {
    return { thinkingConfig: { thinkingLevel: level } }
  }
  return {}
}

function geminiTemperatureConfig(model: string, temperature?: number) {
  // Gemini 4 models prohibit deprecated sampling parameters (temperature, topP, topK)
  if (/^gemini-4-/i.test(model) || typeof temperature !== 'number') {
    return {}
  }
  return { temperature }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ])
}

let geminiPrimaryCooldownUntil = 0
const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite'
const GEMINI_COOLDOWN_MS = 90_000

function activeGeminiModel(configuredModel: string, forceFallback = false): string {
  if (configuredModel === GEMINI_FALLBACK_MODEL) return configuredModel
  if (forceFallback || Date.now() < geminiPrimaryCooldownUntil) {
    return GEMINI_FALLBACK_MODEL
  }
  return configuredModel
}

/**
 * Shared server-side Gemini generateContent wrapper with automatic 503/busy/timeout
 * failover from `gemini-4-hydrogen` to `gemini-3.1-flash-lite` plus exponential backoff.
 */
export async function generateGeminiWithFallback(
  params: {
    apiKey: string
    model?: string
    contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents']
    config?: Parameters<GoogleGenAI['models']['generateContent']>[0]['config']
    timeoutMs?: number
  }
) {
  const ai = createGeminiClient(params.apiKey)
  const configured = params.model || process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen'
  const timeoutMs = params.timeoutMs ?? 32_000
  const candidates =
    configured === GEMINI_FALLBACK_MODEL
      ? [GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL]
      : Date.now() < geminiPrimaryCooldownUntil
        ? [GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL, configured]
        : [configured, GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL]

  let lastErr: Error | null = null
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]
    if (i > 0) {
      const delayMs = (i === 1 ? 350 : 1200) + Math.floor(Math.random() * 250)
      await new Promise((r) => setTimeout(r, delayMs))
    }
    try {
      const sanitizedConfig = params.config ? { ...params.config } : undefined
      if (sanitizedConfig && /^gemini-4-/i.test(model)) {
        delete sanitizedConfig.temperature
        delete sanitizedConfig.topP
        delete sanitizedConfig.topK
      }
      return await withTimeout(
        ai.models.generateContent({
          model,
          contents: params.contents,
          ...(sanitizedConfig ? { config: sanitizedConfig } : {}),
        }),
        timeoutMs,
        `Gemini (${model})`
      )
    } catch (rawErr) {
      const formatted = formatGeminiError(rawErr)
      lastErr = formatted
      const { stop } = handleGeminiAttemptError(model, configured, formatted.message)
      if (stop) {
        throw formatted
      }
    }
  }
  throw lastErr ?? new Error('Gemini request failed')
}

async function geminiComplete(
  p: Extract<Provider, { kind: 'gemini' }>,
  messages: ChatMessage[],
  opts: LLMOptions,
  overrideModel?: string
): Promise<string> {
  const ai = createGeminiClient(p.key)
  const model = overrideModel ?? p.model
  const { systemInstruction, contents } = toGeminiPayload(messages)
  const level =
    opts.thinkingLevel === 'low'
      ? ThinkingLevel.LOW
      : opts.thinkingLevel === 'high'
        ? ThinkingLevel.HIGH
        : opts.maxTokens && opts.maxTokens <= 300
          ? ThinkingLevel.LOW
          : ThinkingLevel.MEDIUM
  const timeoutMs = opts.timeoutMs ?? (level === ThinkingLevel.LOW ? 30_000 : 42_000)
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...geminiTemperatureConfig(model, opts.temperature),
          ...geminiThinkingConfig(model, level),
        },
      }),
      timeoutMs,
      `Gemini (${model})`
    )
    const text = response.text
    if (typeof text === 'string' && text.trim().length > 0) return text
    throw new Error('Empty completion content from Gemini')
  } catch (err) {
    throw formatGeminiError(err)
  }
}

async function geminiStream(
  p: Extract<Provider, { kind: 'gemini' }>,
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (t: string) => void }
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const ai = createGeminiClient(p.key)
  const primary = activeGeminiModel(p.model)
  const modelsToTry =
    primary === GEMINI_FALLBACK_MODEL ? [GEMINI_FALLBACK_MODEL] : [primary, GEMINI_FALLBACK_MODEL]
  const { systemInstruction, contents } = toGeminiPayload(messages)

  let lastErr: Error | null = null
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i]
    let full = ''
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 200)))
    }
    try {
      const stream = await withTimeout(
        ai.models.generateContentStream({
          model,
          contents,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            ...geminiThinkingConfig(model, ThinkingLevel.LOW),
          },
        }),
        35_000,
        `Gemini stream (${model})`
      )
      for await (const chunk of stream) {
        const piece = chunk.text
        if (typeof piece === 'string' && piece.length > 0) {
          full += piece
          onToken(piece)
        }
      }
      if (full.trim().length > 0) return full
      throw new Error('Empty stream from Gemini')
    } catch (err) {
      if (full.trim().length > 0) return full
      const formatted = formatGeminiError(err)
      lastErr = formatted
      const { stop } = handleGeminiAttemptError(model, p.model, formatted.message)
      if (stop) {
        throw formatted
      }
    }
  }
  throw lastErr ?? new Error('Gemini stream failed')
}

// ---------------------------------------------------------------- SDK path

/** Built-in GLM SDK completion with 429-aware retry + backoff. */
async function sdkComplete(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
  const zai = await getZAI()
  if (!zai) {
    throw new Error(
      'No LLM API key configured. Add GEMINI_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) in Settings > Secrets.'
    )
  }
  const body: Record<string, unknown> = {
    messages,
    thinking: { type: 'disabled' },
    temperature: opts.temperature ?? 0.6,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
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
  if (!zai) return ''
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
    return null
  }
}

// --------------------------------------------------------- external providers

/** OpenAI-compatible completion. */
async function openaiComplete(
  p: Extract<Provider, { kind: 'openai' }>,
  messages: ChatMessage[],
  opts: LLMOptions
): Promise<string> {
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
async function anthropicComplete(
  p: Extract<Provider, { kind: 'anthropic' }>,
  messages: ChatMessage[],
  opts: LLMOptions
): Promise<string> {
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
export function llmProviderInfo(): {
  provider: string
  model: string | null
  configured: boolean
  fallback: 'GLM SDK'
} {
  const p = resolveLLMProvider()
  if (p.kind === 'gemini') return { provider: 'Gemini', model: p.model, configured: true, fallback: 'GLM SDK' }
  if (p.kind === 'openai') return { provider: 'OpenAI-compatible', model: p.model, configured: true, fallback: 'GLM SDK' }
  if (p.kind === 'anthropic') return { provider: 'Anthropic', model: p.model, configured: true, fallback: 'GLM SDK' }
  return { provider: 'GLM SDK (built-in)', model: null, configured: false, fallback: 'GLM SDK' }
}

async function runExternalComplete(
  p: Exclude<Provider, { kind: 'sdk' }>,
  messages: ChatMessage[],
  opts: LLMOptions
): Promise<string> {
  if (p.kind === 'gemini') return geminiComplete(p, messages, opts)
  if (p.kind === 'openai') return openaiComplete(p, messages, opts)
  return anthropicComplete(p, messages, opts)
}

async function runExternalStream(
  p: Exclude<Provider, { kind: 'sdk' }>,
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (token: string) => void }
): Promise<string> {
  if (p.kind === 'gemini') return geminiStream(p, messages, opts)
  if (p.kind === 'openai') return openaiStream(p, messages, opts)
  return anthropicStream(p, messages, opts)
}

/**
 * Chat completion with retry and optional GLM SDK fallback.
 */
export async function chatText(messages: ChatMessage[], opts: LLMOptions = {}): Promise<string> {
  const p = resolveLLMProvider()
  if (p.kind !== 'sdk') {
    let lastErr: unknown = null
    const geminiPlan =
      p.kind === 'gemini'
        ? p.model === GEMINI_FALLBACK_MODEL
          ? [GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL]
          : Date.now() < geminiPrimaryCooldownUntil
            ? [GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL, p.model]
            : [p.model, GEMINI_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL]
        : [p.model, p.model, p.model]

    for (let attempt = 0; attempt < geminiPlan.length; attempt++) {
      const activeModel = geminiPlan[attempt]
      try {
        if (attempt > 0) {
          const backoffMs = (attempt === 1 ? 350 : 1200) + Math.floor(Math.random() * 250)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
        if (p.kind === 'gemini') {
          return await geminiComplete(p, messages, opts, activeModel)
        }
        return await runExternalComplete(p, messages, opts)
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (p.kind === 'gemini') {
          const { stop, transient } = handleGeminiAttemptError(activeModel, p.model, msg)
          if (stop) break
          if (!transient && attempt >= 1) break
        } else {
          if (isFatalGeminiError(msg)) break
          if (!isTransientGeminiError(msg) && attempt >= 1) break
        }
      }
    }
    const zai = await getZAI()
    if (zai) {
      return sdkComplete(messages, opts)
    }
    const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    console.warn(`[LLM] All attempts failed for ${p.kind} (${p.model}): ${finalMsg}`)
    throw lastErr instanceof Error ? lastErr : new Error(finalMsg)
  }
  return sdkComplete(messages, opts)
}

/**
 * STREAMING chat completion — the typing-feel primitive, on every provider.
 */
export async function chatTextStream(
  messages: ChatMessage[],
  opts: LLMOptions & { onToken?: (token: string) => void } = {}
): Promise<string> {
  const onToken = opts.onToken ?? (() => {})
  const p = resolveLLMProvider()

  if (p.kind !== 'sdk') {
    try {
      return await runExternalStream(p, messages, opts)
    } catch {
      // Streaming failed before tokens arrived — fall back through resilient chatText (retry + failover)
      const text = await chatText(messages, opts)
      onToken(text)
      return text
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
