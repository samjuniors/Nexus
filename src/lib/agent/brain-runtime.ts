import { db } from '@/lib/db'
import { chatText } from '@/lib/agent/zai'
import { getBrainPrefs } from '@/lib/agent/brain-host'
import {
  ContextCache,
  reviewRun,
  lessonsFor,
  coachDirective,
  reinforce,
  penalize,
  isCredible,
  type CoachLesson,
} from '@brain/index'

/**
 * BRAIN RUNTIME — process-wide state for the connected NEXUS brain:
 *
 *   brainCache   the context cache (LLU + TTL, stats exposed in the Brain tab)
 *   coach        lesson storage + review + grading (Reflexion + use-attributed
 *                feedback) backed by the Memory table
 *   refineStats  how often prompt refinement kicked in
 *
 * Everything here is best-effort: the app must run identically (just less
 * smartly) when the brain is disconnected or any of this fails.
 */

export const brainCache = new ContextCache()

export const refineStats = { rewrites: 0, expansions: 0 }

// ---------------- the coach ----------------

interface LessonMeta {
  fromGoal?: string
  weight?: number
  timesUsed?: number
}

function parseMeta(raw: string): LessonMeta {
  try {
    return JSON.parse(raw) as LessonMeta
  } catch {
    return {}
  }
}

/** All coach lessons currently in long-term memory (memories of type 'lesson'). */
export async function loadCoachLessons(): Promise<CoachLesson[]> {
  const rows = await db.memory.findMany({
    where: { type: 'lesson' },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })
  return rows.map((r) => {
    const meta = parseMeta(r.metaJson)
    return {
      id: r.id,
      content: r.content,
      fromGoal: meta.fromGoal ?? '',
      weight: meta.weight ?? 0.5,
      timesUsed: meta.timesUsed ?? 0,
      createdAt: new Date(r.createdAt).toISOString(),
    }
  })
}

/** Lessons worth injecting for a new task (brain connected only). */
export async function coachLessonsFor(task: string): Promise<CoachLesson[]> {
  const { connected } = await getBrainPrefs()
  if (!connected) return []
  try {
    const all = await loadCoachLessons()
    return lessonsFor(task, all, { limit: 3 })
  } catch {
    return []
  }
}

/** Format the coach's advice for the planner prompt. */
export function coachBlock(lessons: CoachLesson[]): string {
  const directive = coachDirective(lessons)
  return directive
    ? `LESSONS FROM YOUR COACH (learned from past missions — apply where relevant):\n${directive}`
    : ''
}

/** Persist a new lesson learned from a finished mission. */
export async function saveCoachLesson(content: string, fromGoal: string, runId: string): Promise<void> {
  const existing = await db.memory.findFirst({ where: { type: 'lesson', content } })
  if (existing) {
    // same lesson learned again → reinforce it
    const meta = parseMeta(existing.metaJson)
    await db.memory.update({
      where: { id: existing.id },
      data: {
        metaJson: JSON.stringify({
          ...meta,
          weight: Math.min(1, (meta.weight ?? 0.5) + 0.25 * (1 - (meta.weight ?? 0.5))),
        }),
      },
    })
    return
  }
  const row = await db.memory.create({
    data: {
      content: content.slice(0, 300),
      type: 'lesson',
      kind: 'procedural',
      source: 'coach',
      runId,
      importance: 8,
      strength: 0.5,
      metaJson: JSON.stringify({ fromGoal: fromGoal.slice(0, 300), weight: 0.5, timesUsed: 0 }),
    },
  })
  try {
    const { indexMemory } = await import('@/lib/agent/memory-graph-store')
    await indexMemory(row.id, row.content)
  } catch {
    // graph indexing is best-effort
  }
}

/** Grade every lesson that was injected into a finished mission. */
export async function gradeLessons(lessonIds: string[], success: boolean): Promise<void> {
  if (lessonIds.length === 0) return
  const rows = await db.memory.findMany({ where: { id: { in: lessonIds }, type: 'lesson' } })
  await Promise.all(
    rows.map((r) => {
      const meta = parseMeta(r.metaJson)
      const lesson: CoachLesson = {
        id: r.id,
        content: r.content,
        fromGoal: meta.fromGoal ?? '',
        weight: meta.weight ?? 0.5,
        timesUsed: meta.timesUsed ?? 0,
        createdAt: new Date(r.createdAt).toISOString(),
      }
      const graded = success ? reinforce(lesson) : penalize(lesson)
      return db.memory
        .update({
          where: { id: r.id },
          data: {
            metaJson: JSON.stringify({
              fromGoal: graded.fromGoal,
              weight: Number(graded.weight.toFixed(3)),
              timesUsed: graded.timesUsed,
            }),
            // a lesson that keeps helping becomes durable procedural knowledge
            strength: success ? Math.min(1, r.strength + 0.1) : r.strength,
          },
        })
        .catch(() => undefined)
    })
  )
  // prune lessons that stopped being credible (gbrain's use-attributed decay)
  for (const r of rows) {
    const meta = parseMeta(r.metaJson)
    const lesson: CoachLesson = {
      id: r.id,
      content: r.content,
      fromGoal: meta.fromGoal ?? '',
      weight: meta.weight ?? 0.5,
      timesUsed: meta.timesUsed ?? 0,
      createdAt: new Date(r.createdAt).toISOString(),
    }
    if (!isCredible(lesson) && (meta.timesUsed ?? 0) >= 2) {
      await db.memory.delete({ where: { id: r.id } }).catch(() => undefined)
    }
  }
}

/** Full Reflexion review of a finished run → 0-2 new lessons (fire-and-forget). */
export async function coachReviewRun(run: {
  id: string
  userMessage: string
  status: string
  createdAt: Date
  answer?: string
  toolsUsed: string[]
  stepCount: number
}): Promise<{ lessons: number; summary: string } | null> {
  const { connected } = await getBrainPrefs()
  if (!connected) return null
  try {
    const review = await reviewRun(
      {
        goal: run.userMessage,
        outcome: run.answer ?? '(no answer recorded)',
        status: run.status === 'done' ? 'done' : run.status === 'stopped' ? 'stopped' : 'error',
        toolsUsed: run.toolsUsed,
        stepCount: run.stepCount,
        durationMs: Date.now() - new Date(run.createdAt).getTime(),
      },
      (messages, opts) => chatText(messages, { temperature: opts?.temperature, maxTokens: opts?.maxTokens })
    )
    for (const lesson of review.lessons) {
      await saveCoachLesson(lesson.content, run.userMessage, run.id)
    }
    return { lessons: review.lessons.length, summary: review.summary }
  } catch {
    return null
  }
}

/** Coach stats for the Brain tab. */
export async function coachStats(): Promise<{
  lessons: number
  avgWeight: number
  topLessons: { content: string; weight: number; timesUsed: number }[]
}> {
  const lessons = await loadCoachLessons()
  const avgWeight = lessons.length > 0 ? lessons.reduce((a, l) => a + l.weight, 0) / lessons.length : 0
  return {
    lessons: lessons.length,
    avgWeight: Number(avgWeight.toFixed(2)),
    topLessons: [...lessons]
      .sort((a, b) => b.weight * (1 + b.timesUsed) - a.weight * (1 + a.timesUsed))
      .slice(0, 3)
      .map((l) => ({ content: l.content.slice(0, 140), weight: Number(l.weight.toFixed(2)), timesUsed: l.timesUsed })),
  }
}
