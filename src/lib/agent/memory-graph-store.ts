import { db } from '@/lib/db'
import {
  extractEntities,
  extractTriples,
  buildMemoryGraph,
  graphRecall,
  formatGraphRecallBlock,
  memoryGraphStats,
  rabbitHole as brainRabbitHole,
  renderRabbitHole,
  type MemoryGraph,
  type GraphRecalledMemory,
} from '@brain/index'

/**
 * GRAPH MEMORY STORE — the host-side persistence for the brain's graph memory.
 *
 * The brain's memory-graph core is pure computation; this file is where it
 * meets SQLite: every memory saved anywhere in the app is indexed into
 * entities + typed edges, and every recall walks that index instead of
 * scanning the memory table. This is the "all memory in graph form, answers
 * fast, fewer tokens" layer.
 */

/** gbrain: a page superseded by a newer fact — history, not truth. */
export function isSupersededMemory(row: { metaJson?: string | null }): boolean {
  try {
    return Boolean(JSON.parse(row.metaJson ?? '{}').supersededBy)
  } catch {
    return false
  }
}

/** Index one memory into the entity graph (deterministic, zero LLM calls). */
export async function indexMemory(memoryId: string, content: string): Promise<{ entities: number; edges: number }> {
  const entities = extractEntities(content)
  const triples = extractTriples(content)
  if (entities.length === 0) return { entities: 0, edges: 0 }

  const entityIds = new Map<string, string>()
  for (const name of entities) {
    const row = await db.memoryEntity.upsert({
      where: { name },
      create: { name },
      update: {},
    })
    entityIds.set(name, row.id)
    await db.memoryEntityLink.upsert({
      where: { entityId_memoryId: { entityId: row.id, memoryId } },
      create: { entityId: row.id, memoryId },
      update: {},
    })
  }

  let edges = 0
  for (const t of triples) {
    const srcId = entityIds.get(t.source)
    const tgtId = entityIds.get(t.target)
    if (!srcId || !tgtId || srcId === tgtId) continue
    const existing = await db.memoryEdge.findFirst({
      where: { sourceId: srcId, targetId: tgtId, relation: t.relation },
    })
    if (existing) {
      await db.memoryEdge.update({ where: { id: existing.id }, data: { weight: existing.weight + 0.5 } })
    } else {
      await db.memoryEdge.create({
        data: { sourceId: srcId, targetId: tgtId, relation: t.relation, kind: 'EXTRACTED', weight: 1 },
      })
      edges++
    }
  }
  return { entities: entityIds.size, edges }
}

/** Load the full memory graph from SQLite into the brain's graph shape. */
export async function loadMemoryGraph(): Promise<MemoryGraph> {
  const [entities, edges, links] = await Promise.all([
    db.memoryEntity.findMany(),
    db.memoryEdge.findMany(),
    db.memoryEntityLink.findMany(),
  ])
  return buildMemoryGraph({
    entities: entities.map((e) => ({ id: e.id, name: e.name })),
    edges: edges.map((e) => ({
      sourceId: e.sourceId,
      targetId: e.targetId,
      relation: e.relation,
      kind: e.kind,
      weight: e.weight,
    })),
    links: links.map((l) => ({ entityId: l.entityId, memoryId: l.memoryId })),
  })
}

/** Re-index every memory that has no entity links yet (backfill on demand). */
export async function backfillGraphIndex(): Promise<{ indexed: number }> {
  const linked = await db.memoryEntityLink.findMany({ select: { memoryId: true } })
  const linkedIds = new Set(linked.map((l) => l.memoryId))
  const all = await db.memory.findMany({ select: { id: true, content: true } })
  let indexed = 0
  for (const m of all) {
    if (linkedIds.has(m.id)) continue
    const r = await indexMemory(m.id, m.content)
    if (r.entities > 0) indexed++
  }
  return { indexed }
}

/**
 * GRAPH RECALL for the host: query → PPR over the entity graph → the few
 * hot memories under a token budget, with the entity trail explaining why.
 * Only the activated memories are ever read from the database — this is the
 * token saving, by construction.
 */
export async function graphRecallMemories(
  query: string,
  opts: { tokenBudget?: number; limit?: number } = {}
): Promise<{ recalled: GraphRecalledMemory[]; block: string }> {
  const graph = await loadMemoryGraph()
  const activated = graphRecall(graph, query, { limit: (opts.limit ?? 4) + 2 })
  if (activated.length === 0) return { recalled: [], block: '' }

  // resolve contents ONLY for the activated ids — and never a superseded
  // page: a stale fact is history, recall must not serve it (gbrain)
  const ids = activated.map((r) => r.id)
  const rows = (await db.memory.findMany({ where: { id: { in: ids } } })).filter((r) => !isSupersededMemory(r))
  const byId = new Map(rows.map((r) => [r.id, r]))

  // token-budget guard with real contents
  let spent = 0
  const kept: GraphRecalledMemory[] = []
  for (const r of activated) {
    const row = byId.get(r.id)
    if (!row) continue
    const cost = Math.ceil(row.content.length / 4)
    if (spent + cost > (opts.tokenBudget ?? 500) && kept.length > 0) break
    if (kept.length >= (opts.limit ?? 4)) break
    kept.push({ ...r, content: row.content, type: row.type })
    spent += cost
  }
  kept.forEach((r, i) => (r.cite = i + 1))
  return { recalled: kept, block: formatGraphRecallBlock(kept) }
}

/** Apply Bjork learning: a successful recall strengthens + timestamps the memory. */
export async function touchRecalledMemories(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    const rows = await db.memory.findMany({ where: { id: { in: ids } } })
    await Promise.all(
      rows.map((m) =>
        db.memory.update({
          where: { id: m.id },
          data: {
            accessCount: m.accessCount + 1,
            lastAccessedAt: new Date(),
            // storage strength grows most when it was hard to reach (low prior access)
            strength: Math.min(1, m.strength + 0.15 * (1 / (1 + m.accessCount))),
          },
        })
      )
    )
  } catch {
    // strengthening is best-effort
  }
}

/** Rabbit-hole exploration over the persisted entity graph. */
export async function exploreRabbitHole(topic: string): Promise<string> {
  const graph = await loadMemoryGraph()
  const hole = brainRabbitHole(graph, topic)
  const evidenceIds = [...new Set((hole?.hops ?? []).flatMap((h) => h.evidenceMemoryIds))].slice(0, 12)
  const rows = evidenceIds.length > 0 ? await db.memory.findMany({ where: { id: { in: evidenceIds } } }) : []
  return renderRabbitHole(hole, new Map(rows.map((r) => [r.id, r.content])))
}

/** Stats for the Brain tab. */
export async function graphMemoryStats(): Promise<{
  entities: number
  edges: number
  extracted: number
  inferred: number
  indexedMemories: number
  hubEntities: { name: string; degree: number }[]
}> {
  const graph = await loadMemoryGraph()
  return memoryGraphStats(graph)
}

/** Teach the brain a fact from the user (coach.teachFact normalizes it) — gbrain write path. */
export async function teachMemory(content: string, source: 'user' | 'coach' = 'user'): Promise<{ id: string; content: string; entities: number }> {
  // GBRAIN: dedup → truth → conflicts → entity resolution, then mark
  // user-taught facts as CORE memory candidates (gbrain always-load).
  try {
    const { gbrainRemember, canMarkCore } = await import('@brain/index')
    const { gbrainStore } = await import('@/lib/agent/gbrain-store')
    const store = gbrainStore()
    const res = await gbrainRemember(store, {
      content,
      type: 'fact',
      kind: 'semantic',
      importance: 8, // user-taught facts are high-salience (amygdala: you said it, it matters)
    })
    if (source === 'user') {
      // a standing user truth → core tier when the budget allows
      const pages = await store.listMemories(300)
      const page = pages.find((p) => p.id === res.page.id)
      if (page && canMarkCore(page, pages).ok) {
        await store.updateMemory(page.id, { alwaysLoad: true, corePriority: 5 })
      }
    }
    const links = await store.listLinksForMemory(res.page.id)
    return { id: res.page.id, content, entities: links.length }
  } catch {
    // gbrain path is best-effort — plain save fallback
    const row = await db.memory.create({
      data: {
        content,
        type: 'fact',
        kind: 'semantic',
        source,
        importance: 8,
        strength: 0.4,
      },
    })
    const indexed = await indexMemory(row.id, content)
    return { id: row.id, content, entities: indexed.entities }
  }
}
