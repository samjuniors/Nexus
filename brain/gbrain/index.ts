/**
 * GBRAIN — the memory model of garrytan/gbrain, ported into the NEXUS brain.
 * Everything memory lives in this folder; the host only implements
 * `GBrainStore` (persistence). See ATTRIBUTION.md for what came from where.
 */
export type {
  GBrainPage,
  GBrainEntity,
  GBrainEdge,
  GBrainMemoryLink,
  GBrainStore,
  EntityResolution,
  GBrainClaim,
  GBrainConflict,
} from './types'
export { resolveEntity, matchNameVariant, normalizeName, editDistance, NAME_MATCH_RANK } from './entities'
export type { NameMatchKind } from './entities'
export {
  extractClaims,
  claimKey,
  findConflicts,
  findDuplicate,
  compileTruth,
} from './facts'
export {
  renderCoreTier,
  canMarkCore,
  suggestCore,
  CORE_DEFAULT_MAX_CHARS,
  CORE_MAX_PAGES,
  CORE_DEFAULT_PRIORITY,
} from './core-memory'
export { recordRetrieval, retrievalTrust, retrievalLog } from './retrievals'
export type { RetrievalEntry } from './retrievals'
export { buildGraphView, inspectNode, createNode, removeNode, renameNode, addAlias, pruneOrphans } from './graph-ops'
export type { GraphView, CreateNodeResult } from './graph-ops'
export { gbrainRemember } from './remember'
export type { RememberResult } from './remember'
