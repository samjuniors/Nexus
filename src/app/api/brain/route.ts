import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getBrain, getBrainPrefs } from '@/lib/agent/brain-host'
import { buildInventory, summarizeInventory, planDream, shouldAutoDream, buildGraphReport, describeAppControl, teachFact } from '@brain/index'
import { buildAppGraph } from '@/lib/agent/graph-source'
import { chatText, llmProviderInfo } from '@/lib/agent/zai'
import { ensureSeeded } from '@/lib/agent/seed'
import { brainCache, coachStats, coachReviewRun, refineStats } from '@/lib/agent/brain-runtime'
import { graphMemoryStats, backfillGraphIndex, teachMemory } from '@/lib/agent/memory-graph-store'

export const runtime = 'nodejs'

/** Run one gbrain-style dream cycle and persist the plan. Shared by the manual button and auto-dream. */
async function runDreamCycle(): Promise<{
  before: number
  after: number
  mergedCount: number
  relationsFound: number
  summary: string
}> {
  const memories = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 150 })
  const plan = await planDream(
    memories.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      createdAt: new Date(m.createdAt).toISOString(),
    })),
    {
      llm: (messages, opts) =>
        chatText(messages, { temperature: opts?.temperature, maxTokens: opts?.maxTokens }),
      now: new Date(),
    }
  )

  // apply merges: fold duplicates into the canonical memory
  for (const merge of plan.merges) {
    try {
      await db.memory.update({ where: { id: merge.keepId }, data: { content: merge.mergedContent } })
      await db.memory.deleteMany({ where: { id: { in: merge.dropIds } } })
    } catch {
      // merge is best-effort
    }
  }
  // apply insights: create distilled memories
  for (const insight of plan.insights) {
    await db.memory.create({
      data: { content: insight.content, type: 'insight', source: 'agent' },
    })
  }
  await db.dreamCycle.create({
    data: {
      summary: plan.summary,
      mergedCount: plan.merges.reduce((acc, m) => acc + m.dropIds.length, 0),
      relationsFound: plan.relationsFound,
      totalMemories: plan.before,
    },
  })

  return {
    before: plan.before,
    after: plan.after,
    mergedCount: plan.merges.reduce((acc, m) => acc + m.dropIds.length, 0),
    relationsFound: plan.relationsFound,
    summary: plan.summary,
  }
}

/** gbrain's 24/7 dream: consolidate automatically once enough new memories piled up. */
async function autoDreamIfDue(): Promise<boolean> {
  try {
    // the brain's autoDream directive gates the whole cycle
    const { connected, prefs } = await getBrainPrefs()
    if (!connected || !prefs.autoDream) return false
    const [lastDream, memoryCount] = await Promise.all([
      db.dreamCycle.findFirst({ orderBy: { createdAt: 'desc' } }),
      db.memory.count(),
    ])
    const due = shouldAutoDream({
      now: new Date(),
      lastDreamAt: lastDream ? new Date(lastDream.createdAt) : null,
      lastDreamMemoryCount: lastDream ? lastDream.totalMemories : null,
      memoryCount,
    })
    if (!due) return false
    await runDreamCycle()
    return true
  } catch {
    return false // auto-dream is always best-effort
  }
}

/** GET — brain status + capability inventory (+ last dream), or ?graph=1 for the knowledge graph + report. */
export async function GET(request: Request) {
  try {
    await ensureSeeded()
    const { searchParams } = new URL(request.url)
    const brain = getBrain()

    if (searchParams.get('graph')) {
      const graph = await buildAppGraph()
      return NextResponse.json({ ok: true, graph, report: buildGraphReport(graph) })
    }

    const [snapshot, lastDream] = await Promise.all([
      brain.snapshot(),
      db.dreamCycle.findFirst({ orderBy: { createdAt: 'desc' } }),
    ])

    // fire-and-forget auto-dream (gbrain's continuous consolidation)
    let autoDreamed = false
    if (snapshot.connected) {
      autoDreamed = await autoDreamIfDue()
    }

    const refreshedDream = autoDreamed
      ? await db.dreamCycle.findFirst({ orderBy: { createdAt: 'desc' } })
      : lastDream

    // ---- brain intelligence vitals: cache, coach, graph memory ----
    const [coach, graphMem] = await Promise.all([
      coachStats().catch(() => ({ lessons: 0, avgWeight: 0, topLessons: [] })),
      graphMemoryStats().catch(() => ({ entities: 0, edges: 0, extracted: 0, inferred: 0, indexedMemories: 0, hubEntities: [] })),
    ])

    return NextResponse.json({
      ok: true,
      status: {
        connected: snapshot.connected,
        personality: snapshot.personality,
        since: snapshot.since,
        appPrefs: snapshot.appPrefs,
      },
      summary: summarizeInventory(snapshot.capabilities),
      inventory: buildInventory(snapshot.capabilities),
      appControl: describeAppControl(snapshot.appPrefs),
      lastDream: refreshedDream
        ? {
            summary: refreshedDream.summary,
            mergedCount: refreshedDream.mergedCount,
            totalMemories: refreshedDream.totalMemories,
            createdAt: new Date(refreshedDream.createdAt).toISOString(),
          }
        : null,
      autoDreamed,
      coach,
      graphMemory: graphMem,
      cache: brainCache.stats_(),
      refine: { rewrites: refineStats.rewrites },
      llm: llmProviderInfo(),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

/** POST — { action: "connect" | "disconnect" | "dream" | "prefs" }. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string
      fact?: string
      prefs?: { tone?: string; missionVerbosity?: string; autoDream?: boolean }
    }
    const brain = getBrain()

    if (body.action === 'connect') {
      const status = await brain.connect()
      return NextResponse.json({ ok: true, status })
    }
    if (body.action === 'disconnect') {
      const status = await brain.disconnect()
      return NextResponse.json({ ok: true, status })
    }

    // the brain issues new app directives (its whole-app control surface)
    if (body.action === 'prefs') {
      const p = body.prefs ?? {}
      const patch: { tone?: 'concise' | 'balanced' | 'thorough'; missionVerbosity?: 'brief' | 'balanced' | 'detailed'; autoDream?: boolean } = {}
      if (p.tone === 'concise' || p.tone === 'balanced' || p.tone === 'thorough') patch.tone = p.tone
      if (p.missionVerbosity === 'brief' || p.missionVerbosity === 'balanced' || p.missionVerbosity === 'detailed')
        patch.missionVerbosity = p.missionVerbosity
      if (typeof p.autoDream === 'boolean') patch.autoDream = p.autoDream
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ ok: false, error: 'No valid prefs supplied' }, { status: 400 })
      }
      const status = await brain.setAppPrefs(patch)
      return NextResponse.json({ ok: true, status, appControl: describeAppControl(status.appPrefs) })
    }

    if (body.action === 'dream') {
      const dream = await runDreamCycle()
      return NextResponse.json({ ok: true, status: await brain.status(), dream })
    }

    // the coach reviews the most recent finished run on demand
    if (body.action === 'coach') {
      const run = await db.run.findFirst({
        where: { status: 'done' },
        orderBy: { createdAt: 'desc' },
      })
      if (!run) return NextResponse.json({ ok: true, review: { lessons: 0, summary: 'no finished mission to review yet' } })
      let toolsUsed: string[] = []
      let stepCount = 0
      let answer = ''
      try {
        const toolEvents = await db.runEvent.findMany({ where: { runId: run.id, type: 'tool_call' }, orderBy: { seq: 'asc' } })
        toolsUsed = toolEvents
          .map((e) => {
            try {
              return (JSON.parse(e.data) as { tool?: string }).tool ?? ''
            } catch {
              return ''
            }
          })
          .filter(Boolean)
        const plan = JSON.parse(run.planJson) as { steps?: unknown[] }
        stepCount = Array.isArray(plan.steps) ? plan.steps.length : 0
        const finalEvent = await db.runEvent.findFirst({ where: { runId: run.id, type: 'final' }, orderBy: { seq: 'desc' } })
        if (finalEvent) answer = String((JSON.parse(finalEvent.data) as { answer?: string }).answer ?? '')
      } catch {
        // trajectory mining is best-effort
      }
      const review = await coachReviewRun({
        id: run.id,
        userMessage: run.userMessage,
        status: run.status,
        createdAt: run.createdAt,
        answer,
        toolsUsed,
        stepCount,
      })
      return NextResponse.json({ ok: true, review: review ?? { lessons: 0, summary: 'review skipped' } })
    }

    // teach the brain a fact (stored high-salience + graph-indexed)
    if (body.action === 'teach') {
      const fact = typeof body.fact === 'string' ? body.fact : ''
      const normalized = teachFact(fact)
      if (!normalized.ok) {
        return NextResponse.json({ ok: false, error: 'Provide something to teach (min 4 chars)' }, { status: 400 })
      }
      const taught = await teachMemory(normalized.content, 'user')
      return NextResponse.json({ ok: true, taught: { content: taught.content, entities: taught.entities } })
    }

    // (re)index every unindexed memory into the entity graph
    if (body.action === 'backfill') {
      const result = await backfillGraphIndex()
      return NextResponse.json({ ok: true, backfill: result })
    }

    return NextResponse.json(
      { ok: false, error: 'action must be "connect", "disconnect", "dream", "prefs", "coach", "teach" or "backfill"' },
      { status: 400 }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
