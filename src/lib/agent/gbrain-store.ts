import { db } from '@/lib/db'
import {
  gbrainRemember,
  renderCoreTier,
  recordRetrieval,
  type GBrainStore,
  type GBrainPage,
  type GBrainEntity,
  type GBrainEdge,
  type RememberResult,
} from '@brain/index'

/**
 * GBRAIN HOST STORE — SQLite/Prisma persistence for the brain's gbrain
 * memory model. The brain folder owns every rule (dedup, conflicts, entity
 * resolution, core tier); this file only stores and fetches rows.
 */

type MemoryRow = {
  id: string
  content: string
  type: string
  kind: string
  importance: number
  strength: number
  accessCount: number
  lastAccessedAt: Date | null
  createdAt: Date
  truth: string | null
  alwaysLoad: boolean
  corePriority: number | null
  metaJson: string
}

type EntityRow = { id: string; name: string; variants: string; origin: string; createdAt: Date }

function toPage(r: MemoryRow): GBrainPage {
  let meta: Record<string, unknown> = {}
  try {
    meta = JSON.parse(r.metaJson) as Record<string, unknown>
  } catch {
    meta = {}
  }
  return {
    id: r.id,
    content: r.content,
    truth: r.truth,
    type: r.type,
    kind: r.kind,
    importance: r.importance,
    strength: r.strength,
    accessCount: r.accessCount,
    lastAccessedAt: r.lastAccessedAt ? r.lastAccessedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    alwaysLoad: r.alwaysLoad,
    corePriority: r.corePriority,
    meta,
  }
}

function toEntity(r: EntityRow): GBrainEntity {
  let variants: string[] = []
  try {
    variants = JSON.parse(r.variants) as string[]
  } catch {
    variants = []
  }
  return { id: r.id, name: r.name, variants, origin: r.origin === 'manual' ? 'manual' : 'auto', createdAt: r.createdAt.toISOString() }
}

/** The GBrainStore implementation backed by Prisma/SQLite. */
export function gbrainStore(): GBrainStore {
  return {
    async listMemories(limit = 200): Promise<GBrainPage[]> {
      const rows = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
      return rows.map(toPage)
    },
    async getMemory(id: string): Promise<GBrainPage | null> {
      const r = await db.memory.findUnique({ where: { id } })
      return r ? toPage(r) : null
    },
    async createMemory(input): Promise<GBrainPage> {
      const r = await db.memory.create({
        data: {
          content: input.content,
          type: input.type,
          kind: input.kind ?? 'episodic',
          importance: input.importance ?? 3,
          truth: input.truth ?? null,
          alwaysLoad: input.alwaysLoad ?? false,
          corePriority: input.corePriority ?? null,
          metaJson: JSON.stringify(input.meta ?? {}),
          runId: input.runId ?? null,
        },
      })
      return toPage(r)
    },
    async updateMemory(id, patch): Promise<void> {
      const data: Record<string, unknown> = {}
      if (patch.truth !== undefined) data.truth = patch.truth
      if (patch.alwaysLoad !== undefined) data.alwaysLoad = patch.alwaysLoad
      if (patch.corePriority !== undefined) data.corePriority = patch.corePriority
      if (patch.importance !== undefined) data.importance = patch.importance
      if (patch.meta !== undefined) data.metaJson = JSON.stringify(patch.meta)
      if (Object.keys(data).length > 0) {
        await db.memory.update({ where: { id }, data })
      }
    },

    async listEntities(): Promise<GBrainEntity[]> {
      const rows = await db.memoryEntity.findMany({ orderBy: { name: 'asc' } })
      return rows.map(toEntity)
    },
    async getEntityByName(name: string): Promise<GBrainEntity | null> {
      const r = await db.memoryEntity.findUnique({ where: { name } })
      return r ? toEntity(r) : null
    },
    async upsertEntity(name, opts): Promise<GBrainEntity> {
      const existing = await db.memoryEntity.findUnique({ where: { name } })
      if (existing) {
        let variants: string[] = JSON.parse(existing.variants || '[]') as string[]
        for (const v of opts?.addVariants ?? []) {
          if (!variants.includes(v) && v !== existing.name) variants.push(v)
        }
        variants = variants.slice(0, 20)
        const r = await db.memoryEntity.update({ where: { id: existing.id }, data: { variants: JSON.stringify(variants) } })
        return toEntity(r)
      }
      const r = await db.memoryEntity.create({
        data: {
          name,
          origin: opts?.origin ?? 'auto',
          variants: JSON.stringify((opts?.addVariants ?? []).slice(0, 20)),
        },
      })
      return toEntity(r)
    },
    async removeEntity(id: string): Promise<void> {
      await db.memoryEntity.delete({ where: { id } }).catch(() => undefined)
    },
    async renameEntity(id, newName, keepOldAsVariant): Promise<GBrainEntity> {
      const cur = await db.memoryEntity.findUnique({ where: { id } })
      if (!cur) throw new Error('Entity not found')
      const taken = await db.memoryEntity.findUnique({ where: { name: newName } })
      if (taken && taken.id !== id) throw new Error(`An entity named "${newName}" already exists`)
      let variants: string[] = JSON.parse(cur.variants || '[]') as string[]
      if (keepOldAsVariant && cur.name !== newName && !variants.includes(cur.name)) variants.push(cur.name)
      const r = await db.memoryEntity.update({ where: { id }, data: { name: newName, variants: JSON.stringify(variants.slice(0, 20)) } })
      return toEntity(r)
    },

    async listLinksForEntity(entityId: string) {
      return db.memoryEntityLink.findMany({ where: { entityId }, select: { entityId: true, memoryId: true } })
    },
    async listLinksForMemory(memoryId: string) {
      return db.memoryEntityLink.findMany({ where: { memoryId }, select: { entityId: true, memoryId: true } })
    },
    async linkMemory(entityId: string, memoryId: string): Promise<void> {
      await db.memoryEntityLink
        .upsert({
          where: { entityId_memoryId: { entityId, memoryId } },
          create: { entityId, memoryId },
          update: {},
        })
        .catch(() => undefined)
    },
    async unlinkMemory(entityId: string, memoryId: string): Promise<void> {
      await db.memoryEntityLink
        .delete({ where: { entityId_memoryId: { entityId, memoryId } } })
        .catch(() => undefined)
    },

    async listEdges(): Promise<GBrainEdge[]> {
      const rows = await db.memoryEdge.findMany()
      return rows.map((e) => ({
        sourceId: e.sourceId,
        targetId: e.targetId,
        relation: e.relation,
        kind: e.kind === 'EXTRACTED' ? 'EXTRACTED' : 'INFERRED',
        weight: e.weight,
      }))
    },
    async saveEdge(edge: GBrainEdge): Promise<void> {
      await db.memoryEdge
        .create({
          data: { sourceId: edge.sourceId, targetId: edge.targetId, relation: edge.relation, kind: edge.kind, weight: edge.weight },
        })
        .catch(() => undefined)
    },
    async removeEdgesTouching(entityId: string): Promise<void> {
      await db.memoryEdge.deleteMany({ where: { OR: [{ sourceId: entityId }, { targetId: entityId }] } })
    },
  }
}

/**
 * THE memory write path for the whole app — every memory anywhere routes
 * through gbrainRemember (dedup → truth → conflicts → entity resolution).
 */
export async function saveMemoryGbrain(input: {
  content: string
  type: string
  kind?: string
  importance?: number
  runId?: string | null
}): Promise<RememberResult> {
  const res = await gbrainRemember(gbrainStore(), input)
  try {
    const { recordWorkingMemoryTrace } = await import('@/lib/agent/brain-trace')
    const memId = res.page?.id
    const entityNames = (res.entities ?? []).map((e) => e.resolvedTo).filter(Boolean)
    await recordWorkingMemoryTrace({
      runId: input.runId ?? undefined,
      operation: 'write',
      memoryIds: memId ? [memId] : [],
      entityNames,
      summary: `Stored ${input.type} memory: ${input.content.slice(0, 90)}`,
    })
  } catch {
    /* trace is best-effort */
  }
  return res
}

/**
 * The CORE MEMORY block (gbrain always-load tier) — injected into every
 * chat answer and every mission plan while the brain is connected.
 */
export async function coreMemoryBlock(): Promise<string> {
  try {
    const pages = await gbrainStore().listMemories(300)
    return renderCoreTier(pages)
  } catch {
    return ''
  }
}

/** Record a retrieval into a page's ledger (use-attribution) + Bjork touch. */
export async function recordRetrievalFor(memoryId: string, query: string): Promise<void> {
  try {
    const row = await db.memory.findUnique({ where: { id: memoryId } })
    if (!row) return
    const page = toPage(row)
    const { meta, accessCount } = recordRetrieval(page, query)
    await db.memory.update({
      where: { id: memoryId },
      data: {
        metaJson: JSON.stringify(meta),
        accessCount,
        lastAccessedAt: new Date(),
        strength: Math.min(1, row.strength + 0.15 * (1 / (1 + row.accessCount))),
      },
    })
    const { recordWorkingMemoryTrace } = await import('@/lib/agent/brain-trace')
    await recordWorkingMemoryTrace({
      operation: 'recall',
      memoryIds: [memoryId],
      summary: `Recalled for "${query.slice(0, 72)}"`,
    })
  } catch {
    // ledger is best-effort
  }
}
