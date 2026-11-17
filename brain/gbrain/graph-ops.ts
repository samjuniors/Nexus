/**
 * GRAPH OPS — how a person (or the brain itself) interacts with the memory
 * graph. gbrain's stance carried over: near-duplicates are FLAGGED, never
 * silently merged; removal is precise about what it touches; the brain
 * auto-creates nodes from memory text and auto-prunes orphans, and a human
 * can create, rename, alias and remove nodes on top of that.
 */

import type { GBrainEdge, GBrainEntity, GBrainPage, GBrainStore } from './types'
import { matchNameVariant, normalizeName } from './entities'
import { compileTruth } from './facts'

/** Full graph payload for the interactive UI. */
export interface GraphView {
  nodes: {
    id: string
    name: string
    variants: string[]
    origin: 'auto' | 'manual'
    degree: number
    memoryCount: number
    createdAt: string
  }[]
  edges: { id: string; sourceId: string; targetId: string; relation: string; kind: string; weight: number }[]
  stats: {
    nodes: number
    edges: number
    extracted: number
    inferred: number
    manual: number
    auto: number
    orphaned: number
  }
}

/** Build the whole interactive view in one pass over the store. */
export async function buildGraphView(store: GBrainStore): Promise<GraphView> {
  const [entities, edges, allLinks] = await Promise.all([
    store.listEntities(),
    store.listEdges(),
    Promise.all(
      // links per entity — cheap at brain scale, and stays exact
      (await store.listEntities()).map(async (e) => ({
        id: e.id,
        links: await store.listLinksForEntity(e.id),
      }))
    ),
  ])
  const linksByEntity = new Map(allLinks.map((l) => [l.id, l.links]))
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1)
    degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1)
  }
  const nodes = entities.map((e) => {
    const links = linksByEntity.get(e.id) ?? []
    return {
      id: e.id,
      name: e.name,
      variants: e.variants,
      origin: e.origin,
      degree: (degree.get(e.id) ?? 0) + links.length,
      memoryCount: links.length,
      createdAt: e.createdAt,
    }
  })
  return {
    nodes: nodes.sort((a, b) => b.degree - a.degree),
    edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      extracted: edges.filter((e) => e.kind === 'EXTRACTED').length,
      inferred: edges.filter((e) => e.kind === 'INFERRED').length,
      manual: nodes.filter((n) => n.origin === 'manual').length,
      auto: nodes.filter((n) => n.origin === 'auto').length,
      orphaned: nodes.filter((n) => n.degree === 0).length,
    },
  }
}

/** One node, deeply inspected: neighbors, linked memories, retrieval trust. */
export async function inspectNode(store: GBrainStore, entityId: string) {
  const [entities, edges] = await Promise.all([store.listEntities(), store.listEdges()])
  const entity = entities.find((e) => e.id === entityId)
  if (!entity) return null
  const links = await store.listLinksForEntity(entityId)
  const memories: GBrainPage[] = []
  for (const l of links) {
    const m = await store.getMemory(l.memoryId)
    if (m) memories.push(m)
  }
  const neighborIds = new Set<string>()
  const myEdges: GBrainEdge[] = []
  for (const e of edges) {
    if (e.sourceId === entityId || e.targetId === entityId) {
      myEdges.push(e)
      neighborIds.add(e.sourceId === entityId ? e.targetId : e.sourceId)
    }
  }
  const neighbors = entities.filter((e) => neighborIds.has(e.id)).map((e) => ({ id: e.id, name: e.name }))
  return { entity, neighbors, edges: myEdges, memories }
}

export type CreateNodeResult =
  | { kind: 'created'; entity: GBrainEntity }
  | { kind: 'exists'; entity: GBrainEntity }
  | { kind: 'near_match'; entity: GBrainEntity; via: string; hint: string }

/**
 * Create a node by hand. gbrain discipline: a name that normalizes to an
 * existing entity does not create a duplicate (exists); a name that is a
 * weak near-match (typo/surname) is FLAGGED with a hint instead of
 * silently merging; everything else mints a manual node.
 */
export async function createNode(
  store: GBrainStore,
  name: string,
  opts?: { note?: string }
): Promise<CreateNodeResult> {
  const trimmed = name.trim().slice(0, 80)
  if (!trimmed) throw new Error('Name is required')
  const entities = await store.listEntities()
  const norm = normalizeName(trimmed)

  const exact = entities.find((e) => normalizeName(e.name) === norm)
  if (exact) return { kind: 'exists', entity: exact }

  for (const e of entities) {
    const kind = matchNameVariant(trimmed, e.name)
    if (kind === 'normalized' || kind === 'reordered' || kind === 'honorific') {
      return { kind: 'exists', entity: e }
    }
    if (kind) {
      return {
        kind: 'near_match',
        entity: e,
        via: kind,
        hint: `"${trimmed}" looks like a ${kind} of "${e.name}" — add it as an alias there instead, or pick a more distinct name`,
      }
    }
  }

  const entity = await store.upsertEntity(trimmed, { origin: 'manual' })
  if (opts?.note?.trim()) {
    const page = await store.createMemory({
      content: opts.note.trim().slice(0, 500),
      type: 'note',
      kind: 'semantic',
      importance: 5,
      truth: compileTruth(opts.note),
      meta: { manualNode: entity.id },
    })
    await store.linkMemory(entity.id, page.id)
  }
  return { kind: 'created', entity }
}

/** Remove a node: unlink its memories (they survive), drop its edges. */
export async function removeNode(store: GBrainStore, entityId: string): Promise<{ unlinked: number; edges: number }> {
  const links = await store.listLinksForEntity(entityId)
  const edges = await store.listEdges()
  const edgeCount = edges.filter((e) => e.sourceId === entityId || e.targetId === entityId).length
  for (const l of links) {
    await store.unlinkMemory(entityId, l.memoryId)
  }
  await store.removeEdgesTouching(entityId)
  await store.removeEntity(entityId)
  return { unlinked: links.length, edges: edgeCount }
}

/** Rename a node; the old name becomes an alias so old text still resolves. */
export async function renameNode(
  store: GBrainStore,
  entityId: string,
  newName: string
): Promise<GBrainEntity> {
  const trimmed = newName.trim().slice(0, 80)
  if (!trimmed) throw new Error('Name is required')
  return store.renameEntity(entityId, trimmed, true)
}

/** Add an alias to a node (gbrain entity alias lane). */
export async function addAlias(store: GBrainStore, entityId: string, alias: string): Promise<GBrainEntity> {
  const trimmed = alias.trim().slice(0, 80)
  if (!trimmed) throw new Error('Alias is required')
  const entities = await store.listEntities()
  const entity = entities.find((e) => e.id === entityId)
  if (!entity) throw new Error('Entity not found')
  return store.upsertEntity(entity.name, { addVariants: [trimmed] })
}

/**
 * Auto-prune — "remove according to brain": entities with zero memory
 * links and zero edges are dust; the dream cycle calls this after
 * consolidation, and the UI exposes it as a button.
 */
export async function pruneOrphans(store: GBrainStore): Promise<{ pruned: number }> {
  const entities = await store.listEntities()
  const edges = await store.listEdges()
  const touched = new Set<string>()
  for (const e of edges) {
    touched.add(e.sourceId)
    touched.add(e.targetId)
  }
  let pruned = 0
  for (const e of entities) {
    const links = await store.listLinksForEntity(e.id)
    if (links.length === 0 && !touched.has(e.id)) {
      await store.removeEntity(e.id)
      pruned++
    }
  }
  return { pruned }
}
