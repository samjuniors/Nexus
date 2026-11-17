/**
 * GBRAIN MEMORY MODEL — portable port of garrytan/gbrain (MIT).
 *
 * Everything memory lives HERE, inside the pluggable brain folder. The host
 * app only implements `GBrainStore` (persistence) — every rule, algorithm
 * and decision is made by this module with zero host imports.
 *
 * Ported concepts (see vendor/gbrain/ for the canonical sources):
 *   - pages        memories are pages: content + a compiled one-line TRUTH
 *                  + a timeline of what happened to them (core-memory.ts)
 *   - facts        typed claims (entity + metric + value) with conflict
 *                  detection — a newer fact SUPERSEDES an older one instead
 *                  of silently contradicting it (facts.ts)
 *   - entities     name-variant resolution: normalized / honorific /
 *                  reordered / diminutive / initial / typo / surname —
 *                  "ACMX" flags next to "ACME", "Dr. Alice Example" matches
 *                  "Alice Example" (entities.ts)
 *   - core memory  a few pages marked always_load render into EVERY prompt
 *                  under one character budget (core-memory.ts)
 *   - retrievals   a use-attribution ledger: recalls are recorded, memories
 *                  that keep being used earn trust (retrievals.ts)
 *   - graph ops    node inspect / create / remove / rename / prune — how a
 *                  person (or the brain itself) interacts with the graph
 *                  (graph-ops.ts)
 */

/** A memory page (the unit of long-term memory). */
export interface GBrainPage {
  id: string
  content: string
  /** one-line compiled truth — what this page boils down to */
  truth?: string | null
  type: string // fact | preference | insight | decision | note | lesson
  kind: string // episodic | semantic | procedural
  importance: number // 1-10 salience, tagged at write
  strength: number // storage strength (Bjork) — grows on use, never decays
  accessCount: number
  lastAccessedAt?: string | null
  createdAt: string
  /** core-memory tier (gbrain `always_load`) */
  alwaysLoad: boolean
  corePriority: number | null
  /** free-form metadata: { fromGoal, weight, retrievals[], supersededBy, ... } */
  meta: Record<string, unknown>
}

/** A node in the memory entity graph. */
export interface GBrainEntity {
  id: string
  name: string
  /** known aliases / name variants (normalized) */
  variants: string[]
  /** auto = the brain created it from memory text; manual = a person did */
  origin: 'auto' | 'manual'
  createdAt: string
}

/** A typed triple between two entities with provenance. */
export interface GBrainEdge {
  sourceId: string
  targetId: string
  relation: string
  kind: 'EXTRACTED' | 'INFERRED'
  weight: number
}

export interface GBrainMemoryLink {
  entityId: string
  memoryId: string
}

/**
 * The persistence contract. The host implements this against its own
 * database; the gbrain module owns every decision above it.
 */
export interface GBrainStore {
  // ---- pages (memories) ----
  listMemories(limit?: number): Promise<GBrainPage[]>
  getMemory(id: string): Promise<GBrainPage | null>
  createMemory(input: {
    content: string
    type: string
    kind?: string
    importance?: number
    truth?: string | null
    alwaysLoad?: boolean
    corePriority?: number | null
    meta?: Record<string, unknown>
    runId?: string | null
  }): Promise<GBrainPage>
  updateMemory(
    id: string,
    patch: Partial<Pick<GBrainPage, 'truth' | 'alwaysLoad' | 'corePriority' | 'importance'>> & {
      meta?: Record<string, unknown>
    }
  ): Promise<void>

  // ---- entities ----
  listEntities(): Promise<GBrainEntity[]>
  getEntityByName(name: string): Promise<GBrainEntity | null>
  upsertEntity(name: string, opts?: { origin?: 'auto' | 'manual'; addVariants?: string[] }): Promise<GBrainEntity>
  removeEntity(id: string): Promise<void>
  renameEntity(id: string, newName: string, keepOldAsVariant: boolean): Promise<GBrainEntity>

  // ---- incidence (which memory mentions which entity) ----
  listLinksForEntity(entityId: string): Promise<GBrainMemoryLink[]>
  listLinksForMemory(memoryId: string): Promise<GBrainMemoryLink[]>
  linkMemory(entityId: string, memoryId: string): Promise<void>
  unlinkMemory(entityId: string, memoryId: string): Promise<void>

  // ---- typed edges ----
  listEdges(): Promise<GBrainEdge[]>
  saveEdge(edge: GBrainEdge): Promise<void>
  removeEdgesTouching(entityId: string): Promise<void>
}

/** What entity resolution decided for a name (gbrain's save-time cascade). */
export type EntityResolution =
  | { kind: 'exact'; entity: GBrainEntity; via: 'normalized' }
  | { kind: 'variant'; entity: GBrainEntity; via: string } // honorific/reordered/diminutive/initial/typo/surname
  | { kind: 'alias'; entity: GBrainEntity; via: 'alias' }
  | { kind: 'new'; name: string }

/** A typed claim mined from memory text (gbrain facts). */
export interface GBrainClaim {
  entity: string
  metric: string // prefers | uses | works at | lives in | likes | ...
  value: string
  raw: string
}

/** A conflict between an incoming claim and a stored page (gbrain supersede). */
export interface GBrainConflict {
  claim: GBrainClaim
  pageId: string
  pageContent: string
  supersededTruth: string
}
