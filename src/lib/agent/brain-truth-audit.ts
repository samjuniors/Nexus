import { db } from '@/lib/db'
import { chatText, extractJson } from '@/lib/agent/zai'
import { visibleAliases } from '@/lib/agent/gbrain-categories'

export type TruthAuditKind = 'contradiction' | 'duplicate' | 'stale'
export type TruthAuditSeverity = 'high' | 'medium' | 'low'

export interface TruthAuditFinding {
  id: string
  kind: TruthAuditKind
  severity: TruthAuditSeverity
  title: string
  explanation: string
  memoryIds: string[]
  entityIds: string[]
  items: {
    id: string
    label: string
    detail: string
    timestamp?: string
  }[]
  suggestedAction: 'keep_newer' | 'merge_entities' | 'archive_stale'
}

export interface TruthAuditReport {
  scannedMemories: number
  scannedEntities: number
  findings: TruthAuditFinding[]
  counts: {
    total: number
    contradictions: number
    duplicates: number
    stale: number
  }
  deepAnalyzed: boolean
  scannedAt: string
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeName(s)
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  const union = a.size + b.size - inter
  return union > 0 ? inter / union : 0
}

function hasNegationCue(text: string): boolean {
  return /\b(never|don't|do not|avoid|disable|disabled|no longer|deprecated|removed|stop|off|false|deny|blocked)\b/i.test(
    text
  )
}

function hasAffirmationCue(text: string): boolean {
  return /\b(always|prefer|use|enable|enabled|active|allow|allowed|default|must|on|true|required)\b/i.test(
    text
  )
}

function extractKeyAssignment(text: string): { key: string; value: string } | null {
  const m = text.match(
    /\b(port|url|endpoint|model|theme|voice|email|database|region|branch|runtime|host)\s*(?:is|=|:|to)\s*([^\s,.;]+)/i
  )
  if (!m) return null
  return { key: m[1].toLowerCase(), value: m[2].toLowerCase() }
}

/**
 * Runs deterministic + optional AI semantic Truth Audit over GBrain entities and memories.
 * Detects conflicting facts/rules, near-duplicate entities, and stale/superseded records.
 */
export async function runBrainTruthAudit(opts?: { deep?: boolean }): Promise<TruthAuditReport> {
  const [memories, entities, links] = await Promise.all([
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 250 }),
    db.memoryEntity.findMany({ orderBy: { name: 'asc' } }),
    db.memoryEntityLink.findMany({ select: { entityId: true, memoryId: true } }),
  ])

  const findings: TruthAuditFinding[] = []
  const nowMs = Date.now()

  // 1. Near-duplicate GBrain entities
  const seenPair = new Set<string>()
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i]
    const normA = normalizeName(a.name)
    const tokA = tokenSet(a.name)
    let aliasesA: string[] = []
    try {
      aliasesA = visibleAliases(JSON.parse(a.variants || '[]') as string[]).map(normalizeName)
    } catch {
      aliasesA = []
    }

    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j]
      const normB = normalizeName(b.name)
      const tokB = tokenSet(b.name)
      let aliasesB: string[] = []
      try {
        aliasesB = visibleAliases(JSON.parse(b.variants || '[]') as string[]).map(normalizeName)
      } catch {
        aliasesB = []
      }

      const aliasOverlap =
        aliasesA.includes(normB) ||
        aliasesB.includes(normA) ||
        normA === normB ||
        (normA.length >= 5 && normB.length >= 5 && jaccard(tokA, tokB) >= 0.67)

      if (aliasOverlap) {
        const pairKey = [a.id, b.id].sort().join(':')
        if (seenPair.has(pairKey)) continue
        seenPair.add(pairKey)
        findings.push({
          id: `dup_${pairKey}`,
          kind: 'duplicate',
          severity: 'medium',
          title: `Near-duplicate entities: "${a.name}" & "${b.name}"`,
          explanation:
            'These two GBrain nodes share overlapping names or aliases, which can split recall links across separate nodes.',
          memoryIds: [],
          entityIds: [a.id, b.id],
          items: [
            {
              id: a.id,
              label: a.name,
              detail: `Primary candidate (${a.origin})`,
              timestamp: new Date(a.createdAt).toISOString(),
            },
            {
              id: b.id,
              label: b.name,
              detail: `Secondary candidate (${b.origin})`,
              timestamp: new Date(b.createdAt).toISOString(),
            },
          ],
          suggestedAction: 'merge_entities',
        })
      }
    }
  }

  // Build memory map by entity for entity-scoped contradiction detection
  const memById = new Map(memories.map((m) => [m.id, m]))
  const memsByEntity = new Map<string, typeof memories>()
  for (const l of links) {
    const m = memById.get(l.memoryId)
    if (!m) continue
    if (!memsByEntity.has(l.entityId)) memsByEntity.set(l.entityId, [])
    memsByEntity.get(l.entityId)!.push(m)
  }

  // 2. Deterministic contradiction detection (polarity flips, conflicting key=value assignments, or recorded conflicts)
  const conflictPairs = new Set<string>()
  const checkMemoryPair = (
    m1: (typeof memories)[number],
    m2: (typeof memories)[number],
    entity?: (typeof entities)[number]
  ) => {
    const pairKey = [m1.id, m2.id].sort().join(':')
    if (conflictPairs.has(pairKey)) return

    const t1 = m1.truth || m1.content
    const t2 = m2.truth || m2.content
    const kv1 = extractKeyAssignment(t1)
    const kv2 = extractKeyAssignment(t2)

    let reason: string | null = null
    if (kv1 && kv2 && kv1.key === kv2.key && kv1.value !== kv2.value) {
      reason = `Conflicting "${kv1.key}" values: "${kv1.value}" vs "${kv2.value}".`
    } else {
      const sim = jaccard(tokenSet(t1), tokenSet(t2))
      const polarityClash =
        (hasNegationCue(t1) && hasAffirmationCue(t2) && !hasNegationCue(t2)) ||
        (hasNegationCue(t2) && hasAffirmationCue(t1) && !hasNegationCue(t1))
      if (sim >= 0.34 && polarityClash) {
        reason = 'Opposing directive or preference polarity detected across related memories.'
      }
    }

    if (!reason) return
    conflictPairs.add(pairKey)
    const [newer, older] =
      new Date(m1.createdAt).getTime() >= new Date(m2.createdAt).getTime() ? [m1, m2] : [m2, m1]

    findings.push({
      id: `conf_${pairKey}`,
      kind: 'contradiction',
      severity: 'high',
      title: entity
        ? `Contradiction on "${entity.name}"`
        : 'Conflicting rule or fact in long-term memory',
      explanation: reason,
      memoryIds: [newer.id, older.id],
      entityIds: entity ? [entity.id] : [],
      items: [
        {
          id: newer.id,
          label: `Newer (${newer.type})`,
          detail: (newer.truth || newer.content).slice(0, 200),
          timestamp: new Date(newer.createdAt).toISOString(),
        },
        {
          id: older.id,
          label: `Older (${older.type})`,
          detail: (older.truth || older.content).slice(0, 200),
          timestamp: new Date(older.createdAt).toISOString(),
        },
      ],
      suggestedAction: 'keep_newer',
    })
  }

  for (const entity of entities) {
    const list = memsByEntity.get(entity.id) ?? []
    for (let i = 0; i < Math.min(list.length, 16); i++) {
      for (let j = i + 1; j < Math.min(list.length, 16); j++) {
        checkMemoryPair(list[i], list[j], entity)
      }
    }
  }

  // Also check top 40 recent active memories globally for key=value / rule conflicts
  const activeMems = memories.filter((m) => {
    try {
      const meta = JSON.parse(m.metaJson || '{}') as Record<string, unknown>
      return !meta.supersededBy
    } catch {
      return true
    }
  })
  for (let i = 0; i < Math.min(activeMems.length, 40); i++) {
    for (let j = i + 1; j < Math.min(activeMems.length, 40); j++) {
      checkMemoryPair(activeMems[i], activeMems[j])
    }
  }

  // 3. Stale, decaying, or already-superseded memories
  for (const m of memories) {
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(m.metaJson || '{}') as Record<string, unknown>
    } catch {
      meta = {}
    }
    const ageDays = (nowMs - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    const isSuperseded = Boolean(meta.supersededBy)
    const isDecayed = m.strength < 0.3 && m.importance <= 5
    const isOldUnaccessed = ageDays > 21 && m.accessCount === 0 && !m.alwaysLoad

    if (isSuperseded || isDecayed || isOldUnaccessed) {
      findings.push({
        id: `stale_${m.id}`,
        kind: 'stale',
        severity: isSuperseded ? 'medium' : 'low',
        title: isSuperseded
          ? 'Superseded memory still stored in graph'
          : isDecayed
            ? `Low-strength decaying memory (${Math.round(m.strength * 100)}%)`
            : `Unaccessed memory (${Math.floor(ageDays)}d old)`,
        explanation: isSuperseded
          ? 'This fact was replaced by a newer truth and can be archived to keep recall crisp.'
          : 'This memory has low recall strength and has not been reinforced recently.',
        memoryIds: [m.id],
        entityIds: [],
        items: [
          {
            id: m.id,
            label: `${m.type} · strength ${Math.round(m.strength * 100)}%`,
            detail: (m.truth || m.content).slice(0, 200),
            timestamp: new Date(m.createdAt).toISOString(),
          },
        ],
        suggestedAction: 'archive_stale',
      })
    }
  }

  // 4. Optional semantic deep audit using server-side LLM
  let deepAnalyzed = false
  if (opts?.deep && activeMems.length >= 2) {
    try {
      const sample = activeMems.slice(0, 24).map((m) => ({
        id: m.id,
        type: m.type,
        text: (m.truth || m.content).slice(0, 180),
        createdAt: new Date(m.createdAt).toISOString(),
      }))
      const raw = await chatText(
        [
          {
            role: 'system',
            content:
              'You audit an AI engineering memory graph for genuine semantic contradictions (e.g. two facts or rules that cannot both be true). Return ONLY JSON: {"contradictions":[{"newerId":"...","olderId":"...","title":"...","explanation":"..."}]}. Return an empty array if no real contradiction exists. Do not invent conflicts.',
          },
          { role: 'user', content: JSON.stringify(sample) },
        ],
        { temperature: 0.1, maxTokens: 500 }
      )
      const parsed = extractJson<{
        contradictions?: { newerId: string; olderId: string; title: string; explanation: string }[]
      }>(raw)
      deepAnalyzed = true
      for (const c of parsed?.contradictions ?? []) {
        const mNew = memById.get(c.newerId)
        const mOld = memById.get(c.olderId)
        if (!mNew || !mOld || mNew.id === mOld.id) continue
        const pairKey = [mNew.id, mOld.id].sort().join(':')
        if (conflictPairs.has(pairKey)) continue
        conflictPairs.add(pairKey)
        findings.unshift({
          id: `conf_ai_${pairKey}`,
          kind: 'contradiction',
          severity: 'high',
          title: c.title?.slice(0, 90) || 'Semantic contradiction detected',
          explanation: c.explanation?.slice(0, 220) || 'Two stored truths conflict semantically.',
          memoryIds: [mNew.id, mOld.id],
          entityIds: [],
          items: [
            {
              id: mNew.id,
              label: `Newer (${mNew.type})`,
              detail: (mNew.truth || mNew.content).slice(0, 200),
              timestamp: new Date(mNew.createdAt).toISOString(),
            },
            {
              id: mOld.id,
              label: `Older (${mOld.type})`,
              detail: (mOld.truth || mOld.content).slice(0, 200),
              timestamp: new Date(mOld.createdAt).toISOString(),
            },
          ],
          suggestedAction: 'keep_newer',
        })
      }
    } catch {
      /* deterministic audit still succeeds cleanly */
    }
  }

  const order: Record<TruthAuditSeverity, number> = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    scannedMemories: memories.length,
    scannedEntities: entities.length,
    findings: findings.slice(0, 40),
    counts: {
      total: findings.length,
      contradictions: findings.filter((f) => f.kind === 'contradiction').length,
      duplicates: findings.filter((f) => f.kind === 'duplicate').length,
      stale: findings.filter((f) => f.kind === 'stale').length,
    },
    deepAnalyzed,
    scannedAt: new Date().toISOString(),
  }
}

/** Applies a structured resolution to a Truth Audit finding. */
export async function resolveTruthAuditFinding(input: {
  action: 'keep_newer' | 'merge_entities' | 'archive_stale'
  memoryIds?: string[]
  entityIds?: string[]
}): Promise<{ ok: boolean; message: string }> {
  if (input.action === 'keep_newer') {
    const [newerId, olderId] = input.memoryIds ?? []
    if (!newerId || !olderId) {
      throw new Error('keep_newer requires [newerId, olderId]')
    }
    const older = await db.memory.findUnique({ where: { id: olderId } })
    if (older) {
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(older.metaJson || '{}') as Record<string, unknown>
      } catch {
        meta = {}
      }
      meta.supersededBy = newerId
      meta.resolvedAt = new Date().toISOString()
      await db.memory.update({
        where: { id: olderId },
        data: { strength: 0.05, metaJson: JSON.stringify(meta) },
      })
    }
    await db.memory
      .update({
        where: { id: newerId },
        data: { strength: 1.0 },
      })
      .catch(() => undefined)
    return { ok: true, message: 'Kept newer truth and marked older conflicting fact as superseded.' }
  }

  if (input.action === 'merge_entities') {
    const [primaryId, secondaryId] = input.entityIds ?? []
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      throw new Error('merge_entities requires two distinct entityIds')
    }
    const [primary, secondary] = await Promise.all([
      db.memoryEntity.findUnique({ where: { id: primaryId } }),
      db.memoryEntity.findUnique({ where: { id: secondaryId } }),
    ])
    if (!primary || !secondary) throw new Error('One of the entities no longer exists')

    const v1 = (JSON.parse(primary.variants || '[]') as string[]) || []
    const v2 = (JSON.parse(secondary.variants || '[]') as string[]) || []
    const mergedVariants = Array.from(new Set([...v1, ...v2, secondary.name])).filter(
      (v) => v !== primary.name
    )

    await db.memoryEntity.update({
      where: { id: primary.id },
      data: { variants: JSON.stringify(mergedVariants.slice(0, 24)) },
    })

    // Migrate memory links
    const secLinks = await db.memoryEntityLink.findMany({ where: { entityId: secondary.id } })
    for (const l of secLinks) {
      await db.memoryEntityLink
        .upsert({
          where: { entityId_memoryId: { entityId: primary.id, memoryId: l.memoryId } },
          create: { entityId: primary.id, memoryId: l.memoryId },
          update: {},
        })
        .catch(() => undefined)
    }

    // Migrate graph edges
    const secEdges = await db.memoryEdge.findMany({
      where: { OR: [{ sourceId: secondary.id }, { targetId: secondary.id }] },
    })
    for (const e of secEdges) {
      const sourceId = e.sourceId === secondary.id ? primary.id : e.sourceId
      const targetId = e.targetId === secondary.id ? primary.id : e.targetId
      if (sourceId !== targetId) {
        await db.memoryEdge
          .create({
            data: {
              sourceId,
              targetId,
              relation: e.relation,
              kind: e.kind,
              weight: e.weight,
            },
          })
          .catch(() => undefined)
      }
    }

    await db.memoryEdge.deleteMany({
      where: { OR: [{ sourceId: secondary.id }, { targetId: secondary.id }] },
    })
    await db.memoryEntityLink.deleteMany({ where: { entityId: secondary.id } })
    await db.memoryEntity.delete({ where: { id: secondary.id } }).catch(() => undefined)

    return { ok: true, message: `Merged "${secondary.name}" into "${primary.name}" and preserved all links.` }
  }

  if (input.action === 'archive_stale') {
    const ids = (input.memoryIds ?? []).filter(Boolean)
    if (ids.length === 0) throw new Error('archive_stale requires at least one memoryId')
    await db.memoryEntityLink.deleteMany({ where: { memoryId: { in: ids } } })
    await db.memory.deleteMany({ where: { id: { in: ids } } })
    return {
      ok: true,
      message: `Archived ${ids.length} stale memor${ids.length === 1 ? 'y' : 'ies'} from GBrain.`,
    }
  }

  throw new Error(`Unsupported truth audit action: ${String(input.action)}`)
}
