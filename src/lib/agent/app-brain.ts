import { chatText, extractJson } from '@/lib/agent/zai'
import { reflexCheck } from '@brain/index'
import { getActiveCompanyPromptContext } from '@/lib/agent/paperclip-company'

/**
 * THE SPINE BRAIN — the app's own, always-on intelligence.
 *
 * Every agent app has one of these: an LLM that routes messages, plans
 * missions, calls tools and writes answers. It is what keeps the app 100%
 * functional with the NEXUS overlay brain disconnected — you get a normal
 * "LLM + skills + plugins" agent app, exactly like any other.
 *
 * When the NEXUS brain is CONNECTED it takes over these duties and does
 * them better (reflex speed, memory recall with citations, tone
 * directives, follow-up chips). When it is DISCONNECTED, the spine runs
 * this file — simple, honest, no overlay features.
 */

export type SpineRouteDecision =
  | { kind: 'chat' }
  | { kind: 'task'; reason: string }

/** The spine's routing prompt — same contract as the brain's, minus the extras. */
function spineRouterPrompt(dateLine: string, history: string): string {
  return `You are the router of NEXUS, an autonomous AI agent. Decide how the user's latest message must be handled.

CURRENT DATE & TIME (authoritative): ${dateLine}
The app has NO other real-time knowledge — current events, prices, "latest X" need a web-search mission.

RECENT CONVERSATION:
${history || '(start of conversation)'}

CHOOSE:
- "chat" — you are confident the message can be answered RIGHT NOW in one short answer without any tool: greetings, small talk, thanks, questions about you or this app, simple factual/conceptual questions, definitions, explanations, date/time questions (use the date line above), mental arithmetic, casual follow-ups.
- "task" — needs real-time web info or research with sources, multi-step work, code execution, math with several digits, generating or finding images, text-to-speech, translation, reading/writing files, or any tool/plugin/MCP.

Reply ONLY with minified JSON: {"mode":"chat"} or {"mode":"task","reason":"<short why>"}`
}

/**
 * Spine front door: reflexes first (shared with the NEXUS brain — they are
 * pure functions), then one small LLM routing turn. Routing only — never
 * writes the answer, so the answer can always be streamed.
 */
export async function routeWithAppBrain(input: {
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
}): Promise<SpineRouteDecision> {
  const message = input.message.slice(0, 2000)

  // 1) deterministic reflexes — obvious tool work escalates instantly
  const reflex = reflexCheck(message)
  if (reflex) return { kind: 'task', reason: reflex.reason }

  // 2) one small language turn — chat or task
  const dateLine = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
  const history = input.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content.slice(0, 280)}`)
    .join('\n')

  const raw = await chatText(
    [
      { role: 'system', content: spineRouterPrompt(dateLine, history) },
      { role: 'user', content: message },
    ],
    { temperature: 0.2, maxTokens: 120 }
  )

  const parsed = extractJson<{ mode?: string; reason?: string }>(raw)
  if (!parsed || parsed.mode !== 'chat') return { kind: 'task', reason: parsed?.reason || 'router decision' }
  return { kind: 'chat' }
}

/** The spine's answer prompt — friendly, competent, no overlay features. */
export function appBrainAnswerMessages(input: {
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
}): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const message = input.message.slice(0, 2000)
  const dateLine = new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
  const history = input.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content.slice(0, 280)}`)
    .join('\n')

  const companyCtx = getActiveCompanyPromptContext()

  return [
    {
      role: 'system',
      content: `You are Eva, the AI CEO & Lead Assistant of NEXUS reporting directly to the Founder (Boss). You run real company operations across Sales, Marketing, Hiring/HR, Product & Development, Customer Support, and Finance/Ops — not just coding tasks. Answer cleanly, sharply, and directly.

CURRENT DATE & TIME (authoritative, use this for any date/time question): ${dateLine}
You have NO other real-time knowledge — if the user truly needs current events or prices, say so briefly and suggest running it as a mission.
${companyCtx ? `\n${companyCtx}\n` : ''}
Keep the answer a helpful medium length (~150-250 words). Plain markdown only, never JSON. When your answer contains CODE, ALWAYS wrap it in fenced code blocks with the correct language tag (e.g. \`\`\`ts, \`\`\`python). This answer is streamed to the user character by character as you think of it.

RECENT CONVERSATION:
${history || '(start of conversation)'}`,
    },
    { role: 'user', content: message },
  ]
}
