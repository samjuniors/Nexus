import { db } from '@/lib/db'
import {
  classifyGBrainEntity,
  GBRAIN_CATEGORY_MAP,
  isValidCategory,
  type GBrainCategoryId,
} from '@/lib/agent/gbrain-categories'

export interface BrainContextPack {
  id: string
  name: string
  description: string
  categories: GBrainCategoryId[]
  entityIds: string[]
  active: boolean
  builtIn?: boolean
  updatedAt: string
}

const BRAIN_ROW_ID = 'brain'

const DEFAULT_CONTEXT_PACKS: BrainContextPack[] = [
  {
    id: 'pack_core_architecture',
    name: 'Core Architecture',
    description: 'Prioritize Projects, Systems, and verified Facts & Decisions during recall',
    categories: ['projects', 'facts'],
    entityIds: [],
    active: false,
    builtIn: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pack_agents_tools',
    name: 'Agents & Capabilities',
    description: 'Focus recall on Eva, subagents, skills, tools, and autonomous workflows',
    categories: ['agents', 'tools'],
    entityIds: [],
    active: false,
    builtIn: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pack_truth_rules',
    name: 'Facts & Decisions',
    description: 'Pin verified rules, preferences, and operational lessons for strict adherence',
    categories: ['facts'],
    entityIds: [],
    active: false,
    builtIn: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function parsePrefsObj(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function ensureBrainRow() {
  let row = await db.brainState.findUnique({ where: { id: BRAIN_ROW_ID } })
  if (!row) {
    try {
      row = await db.brainState.create({
        data: {
          id: BRAIN_ROW_ID,
          connected: true,
          personality: 'NEXUS',
          connectedAt: new Date(),
        },
      })
    } catch {
      row = await db.brainState.findUnique({ where: { id: BRAIN_ROW_ID } })
    }
  }
  return row
}

function sanitizePack(raw: unknown): BrainContextPack | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null
  if (!id || !name) return null
  const categories = Array.isArray(r.categories)
    ? r.categories.filter((c): c is GBrainCategoryId => isValidCategory(c))
    : []
  const entityIds = Array.isArray(r.entityIds)
    ? r.entityIds.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : []
  return {
    id,
    name: name.slice(0, 64),
    description: typeof r.description === 'string' ? r.description.slice(0, 180) : '',
    categories,
    entityIds,
    active: Boolean(r.active),
    builtIn: Boolean(r.builtIn),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  }
}

export async function listContextPacks(): Promise<BrainContextPack[]> {
  const row = await ensureBrainRow()
  const prefs = parsePrefsObj(row?.appPrefsJson)
  const stored = Array.isArray(prefs.contextPacks)
    ? prefs.contextPacks.map(sanitizePack).filter((p): p is BrainContextPack => Boolean(p))
    : []

  if (stored.length === 0) {
    return DEFAULT_CONTEXT_PACKS.map((p) => ({ ...p }))
  }

  // Merge any missing built-in defaults without clobbering user active flags
  const byId = new Map(stored.map((p) => [p.id, p]))
  for (const def of DEFAULT_CONTEXT_PACKS) {
    if (!byId.has(def.id)) stored.push({ ...def })
  }
  return stored
}

async function saveContextPacks(packs: BrainContextPack[]): Promise<BrainContextPack[]> {
  const row = await ensureBrainRow()
  const prefs = parsePrefsObj(row?.appPrefsJson)
  prefs.contextPacks = packs
  await db.brainState.update({
    where: { id: BRAIN_ROW_ID },
    data: { appPrefsJson: JSON.stringify(prefs) },
  })
  return packs
}

export async function createContextPack(input: {
  name: string
  description?: string
  categories?: GBrainCategoryId[]
  entityIds?: string[]
  active?: boolean
}): Promise<{ pack: BrainContextPack; packs: BrainContextPack[] }> {
  const packs = await listContextPacks()
  const cleanName = input.name.trim().slice(0, 64)
  if (cleanName.length < 2) throw new Error('Context pack name must be at least 2 characters')

  const categories = (input.categories ?? []).filter((c) => isValidCategory(c))
  const entityIds = Array.from(new Set((input.entityIds ?? []).filter(Boolean)))
  if (categories.length === 0 && entityIds.length === 0) {
    throw new Error('Select at least one category or node for the context pack')
  }

  const pack: BrainContextPack = {
    id: `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    description: (input.description ?? '').trim().slice(0, 180) || 'Custom scoped GBrain recall pack',
    categories,
    entityIds,
    active: input.active ?? true,
    builtIn: false,
    updatedAt: new Date().toISOString(),
  }

  const next = [pack, ...packs]
  await saveContextPacks(next)
  return { pack, packs: next }
}

export async function toggleContextPack(
  packId: string,
  active?: boolean
): Promise<{ pack: BrainContextPack; packs: BrainContextPack[] }> {
  const packs = await listContextPacks()
  const idx = packs.findIndex((p) => p.id === packId)
  if (idx < 0) throw new Error('Context pack not found')

  const updated: BrainContextPack = {
    ...packs[idx],
    active: active !== undefined ? active : !packs[idx].active,
    updatedAt: new Date().toISOString(),
  }
  const next = packs.map((p, i) => (i === idx ? updated : p))
  await saveContextPacks(next)
  return { pack: updated, packs: next }
}

export async function deleteContextPack(packId: string): Promise<BrainContextPack[]> {
  const packs = await listContextPacks()
  const target = packs.find((p) => p.id === packId)
  if (!target) return packs
  if (target.builtIn) {
    // Built-in packs deactivate instead of hard-deleting
    const next = packs.map((p) => (p.id === packId ? { ...p, active: false } : p))
    await saveContextPacks(next)
    return next
  }
  const next = packs.filter((p) => p.id !== packId)
  await saveContextPacks(next)
  return next
}

export interface ActiveContextPackScope {
  packs: BrainContextPack[]
  entityIds: Set<string>
  entityNames: string[]
  memoryIds: Set<string>
  memories: { id: string; content: string; type: string; truth: string | null }[]
}

/**
 * Resolves all entities and linked memories covered by currently active Scoped Brain Context Packs.
 * Used to boost GBrain recall and inject focused context into Eva's chat, mission, and voice prompts.
 */
export async function getActiveContextPackScope(): Promise<ActiveContextPackScope> {
  const allPacks = await listContextPacks()
  const activePacks = allPacks.filter((p) => p.active)
  if (activePacks.length === 0) {
    return {
      packs: [],
      entityIds: new Set(),
      entityNames: [],
      memoryIds: new Set(),
      memories: [],
    }
  }

  const catSet = new Set<GBrainCategoryId>()
  const explicitIds = new Set<string>()
  for (const p of activePacks) {
    for (const c of p.categories) catSet.add(c)
    for (const eid of p.entityIds) explicitIds.add(eid)
  }

  const allEntities = await db.memoryEntity.findMany({ orderBy: { name: 'asc' } })
  const matchedEntities: { id: string; name: string }[] = []
  for (const e of allEntities) {
    let variants: string[] = []
    try {
      variants = JSON.parse(e.variants || '[]') as string[]
    } catch {
      variants = []
    }
    const cat = classifyGBrainEntity(e.name, variants)
    if (explicitIds.has(e.id) || catSet.has(cat)) {
      matchedEntities.push({ id: e.id, name: e.name })
    }
  }

  const entityIds = new Set(matchedEntities.map((e) => e.id))
  const links =
    entityIds.size > 0
      ? await db.memoryEntityLink.findMany({
          where: { entityId: { in: Array.from(entityIds) } },
          select: { memoryId: true },
        })
      : []

  const memoryIds = new Set(links.map((l) => l.memoryId))
  const memories =
    memoryIds.size > 0
      ? await db.memory.findMany({
          where: { id: { in: Array.from(memoryIds) } },
          orderBy: [{ importance: 'desc' }, { createdAt: 'desc' }],
          take: 14,
          select: { id: true, content: true, type: true, truth: true },
        })
      : []

  return {
    packs: activePacks,
    entityIds,
    entityNames: matchedEntities.map((e) => e.name),
    memoryIds,
    memories,
  }
}

/** Formats active Scoped Brain Context Packs as a concise prompt directive for Eva. */
export async function buildActiveContextPackPromptBlock(): Promise<{
  block: string
  activePackNames: string[]
  entityIds: string[]
  entityNames: string[]
}> {
  try {
    const scope = await getActiveContextPackScope()
    if (scope.packs.length === 0) {
      return { block: '', activePackNames: [], entityIds: [], entityNames: [] }
    }

    const packHeader = scope.packs
      .map((p) => {
        const cats = p.categories.map((c) => GBRAIN_CATEGORY_MAP[c]?.shortLabel ?? c).join(', ')
        return `${p.name}${cats ? ` [${cats}]` : ''}`
      })
      .join(' + ')

    const entityLine =
      scope.entityNames.length > 0
        ? `Pinned entities (${scope.entityNames.length}): ${scope.entityNames.slice(0, 18).join(', ')}`
        : ''

    const memoryLines = scope.memories
      .slice(0, 8)
      .map((m) => `- [${m.type}] ${(m.truth || m.content).slice(0, 180)}`)
      .join('\n')

    const block = [
      `ACTIVE SCOPED BRAIN CONTEXT PACKS (${packHeader}) — prioritize these entities and truths when answering or planning:`,
      entityLine,
      memoryLines ? `Scoped truths:\n${memoryLines}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      block,
      activePackNames: scope.packs.map((p) => p.name),
      entityIds: Array.from(scope.entityIds),
      entityNames: scope.entityNames,
    }
  } catch {
    return { block: '', activePackNames: [], entityIds: [], entityNames: [] }
  }
}
