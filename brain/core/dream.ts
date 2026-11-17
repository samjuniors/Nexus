/**
 * DREAM CYCLE — gbrain-inspired memory consolidation.
 *
 * gbrain runs a 24/7 background "dream" that keeps the knowledge base sharp.
 * Our version is a dream you can trigger from the Brain tab: the brain
 * reviews its memories, merges near-duplicates, infers relationships
 * between related memories, and (optionally, through the host LLM)
 * compresses old clusters into distilled insights.
 *
 * This module is a PURE PLANNER: it never touches storage. It returns the
 * merge/insight plan; the host app applies it. That keeps the brain
 * portable across any storage backend.
 */

import type { BrainLlmComplete } from '../types'

export interface DreamMemory {
  id: string
  content: string
  type: string
  createdAt: string
}

export interface DreamMerge {
  keepId: string
  dropIds: string[]
  mergedContent: string
  reason: string
}

export interface DreamInsight {
  content: string
  fromIds: string[]
}

export interface DreamPlan {
  before: number
  after: number
  merges: DreamMerge[]
  insights: DreamInsight[]
  relationsFound: number
  summary: string
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * gbrain runs its dream cycle 24/7 in the background. A host app that cannot
 * host a cron copies that behaviour with this gate: dream automatically when
 * enough new memories have piled up since the last cycle, but never more
 * often than the cooldown. Pure function — the host decides when to call it.
 */
export function shouldAutoDream(input: {
  now: Date
  lastDreamAt: Date | null
  lastDreamMemoryCount: number | null
  memoryCount: number
}): boolean {
  const { now, lastDreamAt, lastDreamMemoryCount, memoryCount } = input
  // never dream over a tiny memory store
  if (memoryCount < 8) return false
  // first dream: wait until there is a meaningful amount to consolidate
  if (lastDreamAt === null || lastDreamMemoryCount === null) return memoryCount >= 12
  // cooldown: at most one auto-dream per 30 minutes
  if (now.getTime() - lastDreamAt.getTime() < 30 * 60 * 1000) return false
  // dream when ≥6 new memories accumulated, or the store grew ≥40%
  const delta = memoryCount - lastDreamMemoryCount
  if (delta >= 6) return true
  return delta > 0 && memoryCount >= lastDreamMemoryCount * 1.4
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((t) => t.length > 3))
}

/** A * b / min(|a|,|b|) keyword overlap between two memories. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * Plan one dream cycle.
 * Phase 1 (deterministic): cluster near-duplicate memories (merge plans),
 *   count inferred relations.
 * Phase 2 (optional, host LLM): distill the oldest memories into a few
 *   insight memories so old knowledge stays compact. Skipped when llm is
 *   null/undefined or on any LLM failure — the deterministic phase alone
 *   is still a complete, useful dream.
 */
export async function planDream(
  memories: DreamMemory[],
  opts: { llm?: BrainLlmComplete; now?: Date } = {}
): Promise<DreamPlan> {
  const now = opts.now ?? new Date()
  const merges: DreamMerge[] = []
  const mergedAway = new Set<string>()

  // ---- phase 1: near-duplicate clustering (deterministic) ----
  const withTokens = memories.map((m) => ({ m, tk: tokens(m.content) }))
  for (let i = 0; i < withTokens.length; i++) {
    if (mergedAway.has(withTokens[i].m.id)) continue
    const cluster = [withTokens[i]]
    for (let j = i + 1; j < withTokens.length; j++) {
      if (mergedAway.has(withTokens[j].m.id)) continue
      if (overlap(withTokens[i].tk, withTokens[j].tk) >= 0.72) {
        cluster.push(withTokens[j])
        mergedAway.add(withTokens[j].m.id)
      }
    }
    if (cluster.length > 1) {
      // keep the oldest as canonical, merge the rest into it
      const sorted = [...cluster].sort((a, b) => a.m.createdAt.localeCompare(b.m.createdAt))
      const keep = sorted[0].m
      const drops = sorted.slice(1).map((c) => c.m)
      const mergedContent =
        keep.content.length >= drops[0].content.length
          ? keep.content
          : drops.map((d) => d.content).reduce((long, c) => (c.length > long.length ? c : long), keep.content)
      merges.push({
        keepId: keep.id,
        dropIds: drops.map((d) => d.id),
        mergedContent: mergedContent.slice(0, 400),
        reason: `near-duplicates (${cluster.length} memories share ≥72% keywords)`,
      })
    }
  }

  // ---- inferred relation count (feeds the knowledge graph) ----
  let relationsFound = 0
  for (let i = 0; i < withTokens.length; i++) {
    for (let j = i + 1; j < withTokens.length; j++) {
      if (overlap(withTokens[i].tk, withTokens[j].tk) >= 0.3) relationsFound++
    }
  }

  // ---- phase 2: distill old memories into insights (host LLM, best-effort) ----
  const insights: DreamInsight[] = []
  if (opts.llm && memories.length >= 6) {
    const byOldest = [...memories].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const oldBatch = byOldest.slice(0, 10).map((m) => `- [${m.type}] ${m.content.slice(0, 160)}`)
    try {
      const raw = await opts.llm(
        [
          {
            role: 'system',
            content:
              'You are a memory consolidation engine. Given a list of long-term memories from an AI agent app, distill them into at most 2 short, information-dense INSIGHT memories that preserve the important durable knowledge (user preferences, project context, key facts). Drop trivia. Respond ONLY with minified JSON: {"insights":[{"content":"<short insight>"}]} — empty array if nothing worth distilling.',
          },
          { role: 'user', content: oldBatch.join('\n') },
        ],
        { temperature: 0.3, maxTokens: 400 }
      )
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0]) as { insights?: { content?: string }[] }
        for (const ins of (parsed.insights ?? []).slice(0, 2)) {
          if (ins?.content && ins.content.trim()) {
            insights.push({ content: ins.content.trim().slice(0, 400), fromIds: byOldest.slice(0, 10).map((m) => m.id) })
          }
        }
      }
    } catch {
      // LLM unavailable → deterministic dream only
    }
  }

  const after = memories.length - mergedAway.size + insights.length
  const parts = [
    `Dreamed over ${memories.length} memories at ${now.toISOString().slice(0, 16)}Z`,
    merges.length > 0 ? `merged ${merges.length} duplicate cluster${merges.length === 1 ? '' : 's'} (${mergedAway.size} memories folded away)` : 'no duplicates found',
    relationsFound > 0 ? `sensed ${relationsFound} latent relation${relationsFound === 1 ? '' : 's'} between memories` : '',
    insights.length > 0 ? `distilled ${insights.length} new insight${insights.length === 1 ? '' : 's'} from the oldest memories` : '',
  ].filter(Boolean)

  return {
    before: memories.length,
    after,
    merges,
    insights,
    relationsFound,
    summary: parts.join(' · '),
  }
}
