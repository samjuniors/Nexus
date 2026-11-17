/**
 * THE COACH — the brain's inner teacher (Reflexion + gbrain's use-attributed
 * feedback + Voyager's skill conditioning, distilled into one small core).
 *
 * The coach is a second voice INSIDE the brain whose only job is to make the
 * rest of the brain better over time:
 *
 *   1. REVIEW after every mission (Reflexion / verbal reinforcement
 *      learning): what went well, what wasted steps, what should be done
 *      differently → zero to two concrete LESSONS.
 *   2. INJECT before every mission: the top-k lessons whose goal resembles
 *      the new task are loaded into the planner prompt — the brain literally
 *      "learned" from last time.
 *   3. GRADE lessons by outcome (gbrain's use-attributed feedback): a lesson
 *      that helped a successful mission gains weight `w ← w + α(1 − w)`;
 *      one that rode a failure loses weight `w ← w(1 − α)`. Low-weight
 *      lessons stop being injected — the coach prunes bad advice.
 *   4. TEACH on demand: the user (or the host app) can hand the coach a fact
 *      or correction; it is normalized into a high-salience memory the whole
 *      brain will honor.
 *
 * The coach NEVER blocks a mission: every failure path degrades to "no
 * lessons", and lessons are advisory context, not commands.
 */

import type { BrainLlmComplete } from '../types'

export interface CoachLesson {
  id: string
  /** the distilled, actionable advice ("prefer web_search over wikipedia for prices") */
  content: string
  /** the mission goal it was learned from (for similarity matching) */
  fromGoal: string
  /** use-attributed weight 0..1 — grows when it helps, decays when it hurts */
  weight: number
  timesUsed: number
  createdAt: string
}

export interface CoachReviewInput {
  goal: string
  /** final answer / outcome of the mission */
  outcome: string
  status: 'done' | 'error' | 'stopped'
  /** tool slugs used in order, e.g. ["web_search","run_code"] */
  toolsUsed: string[]
  stepCount: number
  durationMs: number
  /** notes on failures/waste the host observed (optional) */
  notes?: string
}

export interface CoachReview {
  lessons: { content: string }[]
  summary: string
}

/** α for use-attributed feedback — how fast lesson weights move. */
const LEARNING_RATE = 0.25

const MIN_WEIGHT = 0.15

// ---------- 1. REVIEW (after a mission) ----------

/**
 * Reflexion turn: the coach reads the mission trajectory and writes at most
 * two specific, strategic lessons. Deterministic guardrails: only genuinely
 * new, actionable advice survives; "do better" fluff is dropped.
 */
export async function reviewRun(
  input: CoachReviewInput,
  llm: BrainLlmComplete
): Promise<CoachReview> {
  const toolLine = input.toolsUsed.length > 0 ? [...new Set(input.toolsUsed)].join(', ') : 'none'
  const minutes = (input.durationMs / 60000).toFixed(1)
  try {
    const raw = await llm(
      [
        {
          role: 'system',
          content: `You are the COACH of an AI agent brain. Review the finished mission below and teach the brain at most 2 concrete lessons for future missions. A lesson must be: (a) specific to a tool, step or prompt pattern, (b) actionable next time, (c) NOT generic advice. Skip lessons the mission already handled well. If the mission was clean and offers nothing to learn, return an empty list.
Examples of good lessons: "For price lookups, web_search beats wikipedia_search — go straight to web_search"; "Chart missions run faster when create_chart gets fully-formed data JSON instead of raw prose".
Reply ONLY with minified JSON: {"lessons":[{"content":"<lesson>"}],"summary":"<one line about how the mission went>"}`,
        },
        {
          role: 'user',
          content: [
            `GOAL: ${input.goal.slice(0, 400)}`,
            `STATUS: ${input.status}`,
            `OUTCOME: ${input.outcome.slice(0, 600)}`,
            `TOOLS USED: ${toolLine}`,
            `STEPS: ${input.stepCount}`,
            `DURATION: ${minutes} min`,
            input.notes ? `HOST NOTES: ${input.notes.slice(0, 300)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { temperature: 0.3, maxTokens: 300 }
    )
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { lessons?: { content?: string }[]; summary?: string }
      const lessons = (parsed.lessons ?? [])
        .map((l) => (l?.content ?? '').trim())
        .filter((c) => c.length > 15 && c.length < 300)
        .slice(0, 2)
        .map((content) => ({ content }))
      return { lessons, summary: (parsed.summary ?? '').slice(0, 160) || 'review complete' }
    }
  } catch {
    // the coach never blocks anything
  }
  return { lessons: [], summary: 'review skipped' }
}

// ---------- 2. INJECT (before a mission) ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

function terms(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((t) => t.length > 3))
}

/** Goal similarity: keyword overlap between a lesson's origin goal and a new task. */
function goalSimilarity(a: string, b: string): number {
  const ta = terms(a)
  const tb = terms(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size)
}

/**
 * Retrieve the lessons worth injecting for a new task: relevant (goal
 * similarity) AND credible (weight). At most `limit`, never unproven bulk.
 */
export function lessonsFor(
  task: string,
  lessons: CoachLesson[],
  opts: { limit?: number } = {}
): CoachLesson[] {
  const limit = opts.limit ?? 3
  return lessons
    .map((l) => ({ l, sim: goalSimilarity(l.fromGoal, task) }))
    .filter((r) => r.sim >= 0.15 && r.l.weight >= MIN_WEIGHT)
    .sort((a, b) => b.l.weight * b.sim - a.l.weight * a.sim)
    .slice(0, limit)
    .map((r) => r.l)
}

/** Format chosen lessons as the planner-prompt block. */
export function coachDirective(lessons: CoachLesson[]): string {
  if (lessons.length === 0) return ''
  return lessons
    .map((l) => `- ${l.content}${l.timesUsed > 0 ? ` (helped before: ${l.timesUsed}×)` : ''}`)
    .join('\n')
}

// ---------- 3. GRADE (use-attributed feedback, gbrain) ----------

/** Reinforce a lesson after its advice rode a successful mission. */
export function reinforce(lesson: CoachLesson): CoachLesson {
  return {
    ...lesson,
    weight: lesson.weight + LEARNING_RATE * (1 - lesson.weight),
    timesUsed: lesson.timesUsed + 1,
  }
}

/** Penalize a lesson whose advice rode a failure — bad advice decays away. */
export function penalize(lesson: CoachLesson): CoachLesson {
  return { ...lesson, weight: lesson.weight * (1 - LEARNING_RATE) }
}

/** Lessons below the credibility floor are pruned by the host. */
export function isCredible(lesson: CoachLesson): boolean {
  return lesson.weight >= MIN_WEIGHT
}

// ---------- 4. TEACH (on demand) ----------

/**
 * Normalize something the user taught the brain into a memory-worthy fact.
 * Deterministic (no LLM): trims filler, keeps intent, caps length. The host
 * stores the result as a high-importance memory and indexes it in the graph.
 */
export function teachFact(raw: string): { content: string; ok: boolean } {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (t.length < 4) return { content: '', ok: false }
  // strip conversational wrappers the user may add
  const cleaned = t
    .replace(/^(please\s+)?(remember|note|learn|know)(\s+that)?[:\s]+/i, '')
    .replace(/^(hey|ok|okay),?\s+/i, '')
    .replace(/^i\s+(want|need)\s+you\s+to\s+/i, '')
  return { content: cleaned.slice(0, 320), ok: cleaned.length >= 4 }
}
