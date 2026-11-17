/**
 * PROMPT REFINEMENT — the brain's pre-frontal polish on every request.
 *
 * Three refinements from production RAG / prompting research:
 *
 * 1. DECONTEXTUALIZATION (query rewriting). Follow-ups like "and his sister?"
 *    carry zero retrievable signal. Before routing and recall, the message is
 *    rewritten into a STANDALONE query using recent history ("Age of John's
 *    sister") — one small LLM call, only when the heuristic below says the
 *    message is not self-contained. The rewrite feeds RECALL ONLY; the user's
 *    original words are what the answer addresses.
 *
 * 2. QUERY EXPANSION (deterministic, no LLM). A query is expanded into
 *    paraphrase variants (imperative form, key-entity form) and recall scores
 *    are max-fused across variants — the multi-query retrieval idea without
 *    paying for an LLM call.
 *
 * 3. SELF-REFINE (one round). Draft → rubric feedback → refined draft for
 *    the brain's own planning artifacts, capped at one iteration (research
 *    shows most of the gain is in round one; the brain must stay cheap).
 */

import type { BrainLlmComplete } from '../types'

export interface RefineStats {
  rewrites: number
  expansions: number
  selfRefinements: number
}

/** Pronouns / ellipsis / short follow-ups — messages that are not self-contained. */
const FOLLOWUP_SIGNALS: RegExp[] = [
  /\b(his|her|their|its|that|this|those|these|it|them)\b/i,
  /^(and|also|plus|then|but|or|so)(\s+(what|how|why|where|when|who|about|the))?[\s,.?!]/i,
  /^(what|how) about\b/i,
  /\b(he|she|they|it)\s+(is|was|does|did|can|should|will)\b/i,
  /\b(again|too|as well|instead|rather)\b\s*[.?!]?$/i,
]

/** Messages so self-contained that a rewrite would be a wasted call. */
const SELF_CONTAINED =
  /^(hi|hey|hello|thanks|thank you|ok|okay|cool|nice|great|good)\b/i

/** True when the message likely depends on earlier turns to be understood. */
export function needsRewrite(message: string, history: { role: 'user' | 'assistant'; content: string }[]): boolean {
  const m = message.trim()
  if (m.length === 0) return false
  if (history.length === 0) return false // nothing to resolve against
  if (SELF_CONTAINED.test(m)) return false
  if (m.length > 400) return false // long messages carry their own context
  // only the last few turns matter for pronoun resolution
  const recent = history.slice(-4)
  return FOLLOWUP_SIGNALS.some((r) => r.test(m)) || m.split(/\s+/).length <= 4
}

/**
 * Decontextualize a follow-up into a standalone query (one small LLM call).
 * Falls back to the original message on ANY failure — refinement is an
 * enhancement, never a dependency.
 */
export async function rewriteQuery(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  llm: BrainLlmComplete
): Promise<{ query: string; rewritten: boolean }> {
  const convo = history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'User' : 'Nexus'}: ${h.content.slice(0, 260)}`)
    .join('\n')
  try {
    const raw = await llm(
      [
        {
          role: 'system',
          content:
            "Rewrite the user's LATEST message as one standalone, self-contained request that keeps their intent and language. Resolve pronouns and ellipsis using the conversation (\"and his sister?\" + context about John → \"Age of John's sister\"). If the message is already self-contained, return it unchanged. Reply with the rewritten request ONLY — no quotes, no explanation.",
        },
        { role: 'user', content: `CONVERSATION:\n${convo}\n\nLATEST MESSAGE:\n${message.slice(0, 600)}` },
      ],
      { temperature: 0.1, maxTokens: 160 }
    )
    const rewritten = raw.trim().replace(/^["']|["']$/g, '')
    if (rewritten.length > 2 && rewritten.length < 600 && !/^(sure|here|the rewritten)/i.test(rewritten)) {
      return { query: rewritten, rewritten: true }
    }
  } catch {
    // LLM unavailable → original message is a fine query
  }
  return { query: message, rewritten: false }
}

const EXPANSION_NOISE = new Set([
  'what', 'whats', 'who', 'whos', 'when', 'where', 'why', 'how', 'is', 'are', 'was',
  'were', 'the', 'a', 'an', 'of', 'for', 'to', 'me', 'you', 'my', 'your', 'do',
  'does', 'did', 'can', 'could', 'tell', 'about', 'and', 'in', 'on', 'at',
])

/**
 * Deterministic query expansion (multi-query retrieval, zero LLM cost):
 * returns the original plus an entity-focused variant, de-duplicated.
 */
export function expandQuery(query: string): string[] {
  const variants = new Set<string>([query])
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !EXPANSION_NOISE.has(w))
  if (words.length >= 2) {
    variants.add(words.join(' '))
  }
  return [...variants]
}

/**
 * ONE round of self-refine on a draft artifact (e.g. a mission plan):
 * feedback first, then the refined draft. Returns the original on any
 * failure or when the refiner says it is already good.
 */
export async function selfRefine(
  draft: string,
  opts: { goal: string; rubric: string; llm: BrainLlmComplete }
): Promise<{ value: string; refined: boolean }> {
  try {
    const raw = await opts.llm(
      [
        {
          role: 'system',
          content: `You are a strict reviewer. Grade the DRAFT against the GOAL and RUBRIC. If it already passes, reply exactly: OK. Otherwise reply with the single most important fix in one sentence.`,
        },
        {
          role: 'user',
          content: `GOAL: ${opts.goal.slice(0, 400)}\nRUBRIC: ${opts.rubric}\n\nDRAFT:\n${draft.slice(0, 2000)}`,
        },
      ],
      { temperature: 0.2, maxTokens: 120 }
    )
    const feedback = raw.trim()
    if (!feedback || /^ok\b/i.test(feedback)) return { value: draft, refined: false }

    const fixed = await opts.llm(
      [
        {
          role: 'system',
          content: 'Apply the reviewer\'s fix to the draft. Keep everything that already worked. Reply with the full corrected draft only.',
        },
        { role: 'user', content: `DRAFT:\n${draft.slice(0, 2400)}\n\nREVIEWER FIX: ${feedback}` },
      ],
      { temperature: 0.3, maxTokens: 900 }
    )
    const value = fixed.trim()
    if (value.length > 20) return { value, refined: true }
  } catch {
    // refinement is best-effort
  }
  return { value: draft, refined: false }
}
