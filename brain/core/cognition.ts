import type { BrainAppPrefs, BrainHost, BrainRecalledRef, BrainRouteDecision, BrainThoughtInput } from '../types'
import { recallMemories, formatRecallBlock, type RecalledMemory } from './recall'

/**
 * COGNITION — the thinking core of the NEXUS overlay brain.
 *
 * Two separate acts, deliberately split so chat answers can STREAM:
 *
 *   1. ROUTE (`think`) — reflex layer first (deterministic, instant):
 *      requests that obviously need real tools escalate straight to agent
 *      mode, no LLM round-trip spent on routing. Otherwise one SMALL LLM
 *      turn decides chat vs task. Routing is cheap and fast because it
 *      never writes the answer itself.
 *
 *   2. COMPOSE (`answerMessages`) — builds the full prompt for the chat
 *      answer (persona, memories, recall citations, tone directive). The
 *      HOST streams this prompt token-by-token, so the answer appears as
 *      if it is being typed — long answers take longer, short ones are
 *      instant, exactly like a human typing.
 *
 * The result: quick questions get clean instant answers, real missions get
 * the full agent treatment, and the chat panel stays uncluttered.
 */

/**
 * Requests that clearly need tool execution — always escalate, never gamble
 * on the router LLM.
 */
const TOOL_REFLEXES: { test: RegExp; reason: string }[] = [
  {
    test: /\b(generate|create|make|draw|paint|design|render|produce|sketch|illustrate|come up with)\b[^.?!]{0,60}\b(image|picture|photo|art(work)?|logo|icon|illustration|poster|wallpaper|banner|thumbnail|avatar|graphic)s?\b/i,
    reason: 'image generation',
  },
  {
    test: /\b(image|picture|photo|art(work)?|logo|icon|illustration|poster|wallpaper)s?\b[^.?!]{0,40}\b(of|for|about|showing)\b/i,
    reason: 'image generation',
  },
  {
    test: /\b(draw|paint|sketch|illustrate|render)\b\s+(me\s+)?(a|an|the|some)?/i,
    reason: 'image generation',
  },
  // TTS needs an audio signal in the message itself — bare "say"/"speak"
  // appear in far too much normal chat ("say the word banana", "do you speak
  // French?"). Escalate only on explicit synthesis language.
  {
    test: /\b(tts|text[- ]to[- ]speech|narrat(?:e|ing|ion)|voice\s?over)\b|\b(say|speak|read)\b[^.?!]{0,30}\b(out loud|aloud)\b|\bspeak\s+(this|that|it|these)\b|\b(convert|turn)\b[^.?!]{0,30}\b(into|to)\b[^.?!]{0,15}\b(speech|audio|a voice)\b/i,
    reason: 'text-to-speech',
  },
  { test: /\btranslate\b/i, reason: 'translation' },
  { test: /\b(run|execute|sandbox)\b[^.?!]{0,30}\b(code|script|javascript|js|python snippet)\b/i, reason: 'code execution' },
  { test: /\b(save|write|create|open)\b[^.?!]{0,30}\bfile\b/i, reason: 'file system' },
  { test: /\b(find|search|show)\s+(me\s+)?(real\s+)?(photos|images|pictures|pics)\b/i, reason: 'image search' },
  // Real-time asks need an INFORMATION NOUN near the time word — bare
  // "today" appears in greetings ("how are you today?") and bare "live" in
  // ordinary verbs ("we live in Paris"). Only news/weather/price/score-style
  // contexts are unambiguous.
  {
    test:
      /\b(latest|newest|current|breaking|price of|stock price|news about|upcoming|2025|2026)\b|\blive\b[^.?!]{0,15}\b(score|scores|news|stream|coverage|update|updates|match|game)\b|\b(score|scores|news|stream|coverage|update|updates|match|game)\b[^.?!]{0,15}\blive\b|\b(today'?s?|tonight'?s?|this (?:week|month|year)'?s?)\b[^.?!]{0,25}\b(news|weather|price|prices|stock|stocks|score|scores|headline|headlines|events?|happened|happening|forecast|deals?)\b|\b(news|weather|price|prices|stock|stocks|score|scores|headline|headlines|events?|happened|happening|forecast|deals?)\b[^.?!]{0,25}\b(today|tonight|this (?:week|month|year)|now|right now|currently)\b/i,
    reason: 'real-time information',
  },
  { test: /\b(research|browse|look up|investigate|deep dive|report on|gather information)\b/i, reason: 'research mission' },
  // computer use — controlling the machine is always a mission, never chat
  {
    test: /\b(run|execute|open|use)\b[^.?!]{0,30}\b(terminal|shell|command line|bash|command|cmd)\b/i,
    reason: 'computer use',
  },
  { test: /\b(computer use|use (my|the) computer|control (my|the) (computer|machine))\b/i, reason: 'computer use' },
  // rabbit holes — associative deep-dives walk the memory graph
  { test: /\b(rabbit hole|down the hole|follow the thread|what connects|how does .+ relate)\b/i, reason: 'graph exploration' },
]

/**
 * Questions about the current date/time/day itself. These are answerable in
 * chat mode from the authoritative clock baked into the persona prompt — they
 * must NOT trip the real-time-information reflex ("today" is a common word in
 * "what's the date today?"). Genuine real-time asks ("news today", "price
 * today") fail this pattern and keep escalating as before.
 */
const DATE_TIME_QUESTION =
  /\b(what|whats|what's|which|tell me|do you know|current)\b[^.?!]{0,40}\b(date|day is it|time is it|time|year is it|month is it|year|month)\b/i

export function reflexCheck(message: string): { reason: string } | null {
  const m = message.trim()
  if (m.length > 600) return { reason: 'long multi-part request' }
  const clockQuestion = DATE_TIME_QUESTION.test(m)
  for (const r of TOOL_REFLEXES) {
    // a clock question is answerable from the prompt's own date line — let the
    // router LLM answer it directly instead of forcing a web-search mission
    if (r.reason === 'real-time information' && clockQuestion) continue
    if (r.test.test(m)) return { reason: r.reason }
  }
  return null
}

/** The routing prompt — small and fast, decides ONLY how to handle the message. */
function routerPrompt(dateLine: string, memoryLine: string, history: string, bodyLine: string): string {
  return `You are the router of ${bodyLine}. Decide how the user's latest message must be handled.

CURRENT DATE & TIME (authoritative): ${dateLine}
The app has NO other real-time knowledge — current events, prices, "latest X" need a web-search mission.

BRAIN MEMORY:
${memoryLine}

RECENT CONVERSATION:
${history || '(start of conversation)'}

CHOOSE:
- "chat" — you are confident the message can be answered RIGHT NOW in one short answer without any tool: greetings, small talk, thanks, questions about you or this app, simple factual/conceptual questions, definitions, explanations, date/time questions (use the date line above), mental arithmetic, casual follow-ups.
- "task" — needs real-time web info or research with sources, multi-step work, code execution, math with several digits, generating or finding images, text-to-speech, translation, reading/writing files, or any tool/plugin/MCP.

Reply ONLY with minified JSON: {"mode":"chat"} or {"mode":"task","reason":"<short why>"}`
}

/** The tone directive the brain issues to its own answers (app prefs → prompt). */
export function toneDirective(tone: BrainAppPrefs['tone']): string {
  if (tone === 'concise') return 'TONE: keep it tight — under ~120 words, no filler, no preamble.'
  if (tone === 'thorough')
    return 'TONE: go deep — a complete, well-structured answer (~250-450 words) with markdown headings or lists where they help.'
  return 'TONE: a helpful medium-length answer (~150-250 words).'
}

/** Build the recalled-memory refs for a message (shared by route + compose). */
export function recallFor(
  input: BrainThoughtInput,
  limit = 3
): { recalled: RecalledMemory[]; refs: BrainRecalledRef[] | undefined } {
  const recalled = recallMemories(
    input.memories.map((m) => ({
      id: m.type + '-' + m.content.slice(0, 24),
      content: m.content,
      type: m.type,
    })),
    input.message,
    { limit }
  )
  const refs =
    recalled.length > 0
      ? recalled.map((r) => ({ id: r.id, content: r.content, type: r.type, cite: r.cite }))
      : undefined
  return { recalled, refs }
}

/**
 * ACT 1 — Front door of the brain: the ROUTE decision. Assumes the caller
 * already checked that the brain is connected (a disconnected brain is
 * never consulted — the host's spine brain takes over instead).
 */
export async function think(host: BrainHost, input: BrainThoughtInput): Promise<BrainRouteDecision> {
  const message = input.message.slice(0, 2000)

  // 1) deterministic reflexes — obvious tool work escalates instantly
  const reflex = reflexCheck(message)
  if (reflex) return { kind: 'task', reason: reflex.reason }

  // 2) one small language turn — chat or task (never writes the answer)
  const now = host.now()
  const dateLine = formatDate(host)

  const memoryLine =
    input.memories.length > 0
      ? input.memories.slice(0, 5).map((m) => `- ${m.content.slice(0, 120)}`).join('\n')
      : '(empty)'

  const history = input.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content.slice(0, 280)}`)
    .join('\n')

  const caps = await host.capabilities()
  const bodyLine = `NEXUS, the agent inside an app whose brain currently reaches ${caps.tools.length} tools, ${caps.skills.length} skills, ${caps.plugins.length} plugins and ${caps.mcps.length} MCP servers`

  const raw = await host.llm.complete(
    [
      { role: 'system', content: routerPrompt(dateLine, memoryLine, history, bodyLine) },
      { role: 'user', content: message },
    ],
    { temperature: 0.2, maxTokens: 120 }
  )

  const parsed = extractJson<{ mode?: string; reason?: string }>(raw)
  if (!parsed || parsed.mode !== 'chat') return { kind: 'task', reason: parsed?.reason || 'router decision' }

  // brain-first recall (gbrain): memories that should inform this answer
  const { refs } = recallFor(input)
  return { kind: 'chat', recalled: refs }
}

/** The persona prompt for the STREAMED chat answer (no JSON — pure markdown). */
function answerPrompt(opts: {
  dateLine: string
  memoryLine: string
  recallBlock: string
  history: string
  bodyLine: string
  tone: string
}): string {
  return `You are ${opts.bodyLine}. You are answering the user directly in chat — friendly, sharp, and to the point. Complex missions are handled elsewhere; right now, just answer.

CURRENT DATE & TIME (authoritative, use this for any date/time question): ${opts.dateLine}
You have NO other real-time knowledge — if the user truly needs current events or prices, say so briefly and suggest running it as a mission.

${opts.tone}

BRAIN MEMORY:
${opts.memoryLine}
${opts.recallBlock ? `\nRECALLED FOR THIS MESSAGE (prefer these facts when answering, cite them inline as [1], [2] …):\n${opts.recallBlock}\n` : ''}
RECENT CONVERSATION:
${opts.history || '(start of conversation)'}

FORMATTING RULES:
- Plain markdown only. NEVER wrap the whole answer in JSON.
- When your answer contains CODE, ALWAYS wrap it in fenced code blocks with the correct language tag (e.g. \`\`\`ts, \`\`\`python, \`\`\`bash). Never paste code as plain text.
- Keep it natural — this answer is streamed to the user character by character as you think of it.`
}

/** Shared date-line formatter (authoritative clock). */
export function formatDate(host: BrainHost): string {
  return host.now().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/**
 * ACT 2 — build the message list the HOST streams for a chat answer.
 * The host owns the streaming call (it can emit tokens as they arrive);
 * the brain owns the prompt. This split keeps the brain portable while
 * making real-time typing possible.
 */
export async function answerMessages(
  host: BrainHost,
  input: BrainThoughtInput,
  recalled?: BrainRecalledRef[]
): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
  const message = input.message.slice(0, 2000)
  const dateLine = formatDate(host)

  // recall again if the router did not pass refs (defensive — same scoring)
  const refs =
    recalled && recalled.length > 0
      ? recalled
      : recallFor(input).refs ?? []
  const recallBlock = formatRecallBlock(
    refs.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type,
      score: 1,
      matchedTerms: [],
      cite: r.cite,
    }))
  )

  const memoryLine =
    input.memories.length > 0
      ? input.memories.slice(0, 5).map((m) => `- ${m.content.slice(0, 120)}`).join('\n')
      : '(empty)'

  const history = input.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content.slice(0, 280)}`)
    .join('\n')

  const caps = await host.capabilities()
  const bodyLine = `NEXUS, the personality of an autonomous AI agent whose brain currently reaches ${caps.tools.length} tools, ${caps.skills.length} skills, ${caps.plugins.length} plugins and ${caps.mcps.length} MCP servers`

  const status = await host.state.get()
  const tone = toneDirective(status?.appPrefs?.tone ?? 'balanced')

  return [
    {
      role: 'system',
      content: answerPrompt({ dateLine, memoryLine, recallBlock, history, bodyLine, tone }),
    },
    { role: 'user', content: message },
  ]
}

const KNOWN_LANGS = new Set([
  'typescript', 'ts', 'javascript', 'js', 'tsx', 'jsx', 'python', 'py', 'java', 'c', 'cpp',
  'c++', 'c#', 'go', 'golang', 'rust', 'bash', 'sh', 'shell', 'zsh', 'sql', 'json', 'yaml',
  'yml', 'html', 'css', 'scss', 'php', 'ruby', 'kotlin', 'swift', 'r', 'dockerfile', 'markdown', 'md',
])

/** True when the text as a whole reads like code rather than prose. */
function looksLikeCode(s: string): boolean {
  if (!s) return false
  const lines = s.split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  if (nonEmpty.length < 2) return false
  const codeHits = nonEmpty.filter((l) => codeSignal(l)).length
  const proseHits = nonEmpty.filter((l) => isProseLine(l)).length
  return codeHits / nonEmpty.length >= 0.6 && proseHits === 0
}

/** True when a single line reads like a line of code. */
function codeSignal(l: string): boolean {
  const t = l.trim()
  if (!t) return false
  return (
    /^(\s*)(function|const|let|var|def|class|import|from|export|return|if|for|while|try|catch|async|await|pub|fn|struct|interface|type|enum|switch|case|package|using|namespace)\b/.test(l) ||
    /^[{}()\[\];]/.test(t) ||
    /[{};]\s*$/.test(t) ||
    /=>/.test(t) ||
    /^\s*#/.test(t) ||
    /^\s*\/\//.test(t) ||
    /^\s/.test(l) // indented continuation
  )
}

/** True when a line is clearly prose (ends a code run). */
function isProseLine(l: string): boolean {
  if (/^\s/.test(l)) return false // indented → code continuation
  const t = l.trim()
  if (!t) return false
  const words = t.split(/\s+/).length
  return words >= 4 && /^[A-Z"'(]/.test(t) && /[.!?]$/.test(t)
}

/**
 * Safety net for bare code: if the model returned code without markdown
 * fences (a known quirk — e.g. "python\ndef is_palindrome(s): ..."), wrap
 * the code run in a proper fence so the chat UI renders an IDE-style code
 * block instead of raw text. Applied by the host AFTER the stream ends.
 */
export function ensureCodeFenced(reply: string): string {
  if (reply.includes('```')) return reply
  const lines = reply.split('\n')

  // pattern 1: the whole reply is raw code, no prose wrapper at all
  if (lines.length >= 3 && looksLikeCode(reply)) {
    // if the first line is a bare language tag, use it as the fence language
    const first = lines[0].trim()
    const tag = first.toLowerCase().replace(/[:.]$/, '')
    if (first.split(/\s+/).length === 1 && KNOWN_LANGS.has(tag)) {
      const rest = lines.slice(1).join('\n').replace(/(^\n+|\s+$)/, '')
      return `\`\`\`${tag}\n${rest}\n\`\`\``
    }
    return `\`\`\`\n${reply.replace(/\s+$/, '')}\n\`\`\``
  }

  // pattern 2: a bare language-tag line ("python", "ts"...) followed by a
  // code run anywhere inside the reply — fence that run
  const out: string[] = []
  let inCode = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    const tag = trimmed.toLowerCase().replace(/[:.]$/, '')

    if (!inCode) {
      if (
        trimmed !== '' &&
        trimmed.split(/\s+/).length === 1 &&
        KNOWN_LANGS.has(tag)
      ) {
        const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== '')
        if (nextNonEmpty && codeSignal(nextNonEmpty) && !isProseLine(nextNonEmpty)) {
          out.push('```' + tag)
          inCode = true
          continue
        }
      }
      out.push(raw)
      continue
    }

    // inside a code run — close on prose or trailing prose after a blank line
    if (trimmed === '') {
      const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== '')
      if (!nextNonEmpty || isProseLine(nextNonEmpty)) {
        out.push('```')
        out.push(raw)
        inCode = false
        continue
      }
      out.push(raw)
      continue
    }
    if (isProseLine(raw) && !codeSignal(raw)) {
      out.push('```')
      out.push(raw)
      inCode = false
      continue
    }
    out.push(raw)
  }
  if (inCode) out.push('```')
  return out.join('\n')
}

/** Extract the first balanced JSON object from LLM output. */
function extractJson<T>(text: string): T | null {
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
