/**
 * REMEMBER — the gbrain write path. One function the host calls for every
 * memory that enters the brain; it runs the full gbrain discipline:
 *
 *   1. capture dedup    — a near-duplicate REFRESHES the original page
 *                         (importance bump) instead of adding noise
 *   2. truth compile    — the page's one-line truth
 *   3. facts conflicts  — an incoming claim that contradicts an active page
 *                         SUPERSEDES it: the old page is marked and its
 *                         truth rewritten; history is kept, stale values
 *                         stop being served
 *   4. entity resolve   — every entity name in the text runs the save-time
 *                         cascade (exact → alias → variant → new)
 */

import type { GBrainStore, GBrainPage, GBrainClaim, GBrainConflict } from './types'
import { compileTruth, extractClaims, findConflicts, findDuplicate } from './facts'
import { resolveEntity, normalizeName } from './entities'
import { extractEntities, extractTriples } from '../core/memory-graph'

export interface RememberResult {
  page: GBrainPage
  deduplicated: boolean
  conflicts: { claim: GBrainClaim; supersededPageId: string; supersededTruth: string }[]
  entities: { name: string; resolvedTo: string; via: string }[]
  newEntities: string[]
}

export async function gbrainRemember(
  store: GBrainStore,
  input: {
    content: string
    type: string
    kind?: string
    importance?: number
    runId?: string | null
    alwaysLoad?: boolean
  }
): Promise<RememberResult> {
  const content = input.content.trim().slice(0, 2000)
  const existing = await store.listMemories(200)

  // 1. capture dedup — refresh the original instead of duplicating
  const dup = findDuplicate(content, existing)
  if (dup) {
    const page = await store.getMemory(dup.page.id)
    if (page) {
      await store.updateMemory(page.id, {
        importance: Math.min(10, page.importance + (dup.exact ? 2 : 1)),
        meta: { ...page.meta, refreshedAt: new Date().toISOString() },
      })
      return {
        page: { ...page, importance: Math.min(10, page.importance + (dup.exact ? 2 : 1)) },
        deduplicated: true,
        conflicts: [],
        entities: [],
        newEntities: [],
      }
    }
  }

  // 2. truth compile
  const truth = compileTruth(content)

  // 3. facts conflicts — incoming claims supersede stale truths
  const claims = extractClaims(content)
  const conflicts: RememberResult['conflicts'] = []
  for (const claim of claims) {
    for (const c of findConflicts(claim, existing) as GBrainConflict[]) {
      const old = await store.getMemory(c.pageId)
      if (!old) continue
      await store.updateMemory(old.id, {
        truth: `superseded: ${truth}`.slice(0, 200),
        alwaysLoad: false, // a superseded truth leaves the always-loaded core tier
        meta: { ...old.meta, supersededBy: content.slice(0, 200), supersededAt: new Date().toISOString() },
      })
      conflicts.push({
        claim,
        supersededPageId: old.id,
        supersededTruth: c.supersededTruth,
      })
    }
  }

  // 4. create the page
  const page = await store.createMemory({
    content,
    type: input.type,
    kind: input.kind,
    importance: input.importance,
    truth,
    alwaysLoad: input.alwaysLoad ?? false,
    runId: input.runId ?? null,
    meta: { claims: claims.length },
  })

  // 5. entity resolution + graph indexing (deterministic extraction with
  //    gbrain's name cascade on top)
  const names = extractEntities(content)
  const seen = new Set<string>()
  const resolved: RememberResult['entities'] = []
  const newEntities: string[] = []
  for (const rawName of names.slice(0, 12)) {
    const key = normalizeName(rawName)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const entities = await store.listEntities()
    const res = await resolveEntity(rawName, entities)
    if (res.kind === 'new') {
      const e = await store.upsertEntity(rawName, { origin: 'auto' })
      await store.linkMemory(e.id, page.id)
      newEntities.push(e.name)
    } else {
      await store.linkMemory(res.entity.id, page.id)
      if (res.kind === 'variant' || res.kind === 'alias') {
        // a variant match teaches the entity a new alias (gbrain: offered as alias)
        await store.upsertEntity(res.entity.name, { addVariants: [rawName] })
      }
      resolved.push({ name: rawName, resolvedTo: res.entity.name, via: res.via })
    }
  }

  // typed triples between resolved entities
  const byName = new Map<string, string>()
  for (const n of names) byName.set(normalizeName(n), n)
  for (const t of extractTriples(content)) {
    const src = await resolveEntity(t.source, await store.listEntities())
    const dst = await resolveEntity(t.target, await store.listEntities())
    if (src.kind !== 'new' && dst.kind !== 'new' && src.entity.id !== dst.entity.id) {
      const edges = await store.listEdges()
      const exists = edges.some(
        (e) =>
          e.sourceId === src.entity.id &&
          e.targetId === dst.entity.id &&
          e.relation === t.relation
      )
      if (!exists) {
        await store.saveEdge({
          sourceId: src.entity.id,
          targetId: dst.entity.id,
          relation: t.relation,
          kind: 'EXTRACTED',
          weight: 1,
        })
      }
    }
  }

  return { page, deduplicated: false, conflicts, entities: resolved, newEntities }
}
