import type { Brain, BrainHost, BrainSnapshot, BrainStatus, BrainThoughtInput, BrainRouteDecision, BrainRecalledRef, BrainAppPrefs } from './types'
import { connect, disconnect, gateStatus, setAppPrefs } from './core/gate'
import { think, answerMessages, ensureCodeFenced, toneDirective } from './core/cognition'
import { buildInventory, summarizeInventory } from './core/capabilities'
import { missionVerbosityDirective, describeAppControl } from './core/appcontrol'

export { buildInventory, summarizeInventory } from './core/capabilities'
export { reflexCheck, ensureCodeFenced, toneDirective } from './core/cognition'
export { missionVerbosityDirective, describeAppControl } from './core/appcontrol'
export {
  recallMemories,
  recallWithCompletion,
  formatRecallBlock,
  formatCitationFooter,
  strengthGain,
  updatePriming,
} from './core/recall'
export type { RecalledMemory, RecallableMemory } from './core/recall'
export { buildGraph, queryNeighbors, queryPath, renderQueryResult } from './core/graph'
export type { BrainGraph, GraphNode, GraphEdge, GraphStats, GraphSource, GraphNodeType } from './core/graph'
export { planDream, shouldAutoDream } from './core/dream'
export type { DreamPlan, DreamMemory } from './core/dream'
export { buildGraphReport } from './core/graph'
export type { GraphCommunity, GraphQuestion, SurprisingConnection, EdgeKind } from './core/graph'
export { parseAppPrefs, DEFAULT_APP_PREFS } from './types'
export type { BrainAppPrefs } from './types'

// ---- graph memory (HippoRAG + spreading activation + rabbit holes) ----
export {
  extractEntities,
  extractTriples,
  buildMemoryGraph,
  spreadingActivation,
  personalizedPageRank,
  seedEntities,
  graphRecall,
  formatGraphRecallBlock,
  rabbitHole,
  renderRabbitHole,
  memoryGraphStats,
} from './core/memory-graph'
export type {
  MemoryGraph,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphLink,
  GraphRecalledMemory,
  RabbitHole,
  RabbitHoleHop,
} from './core/memory-graph'

// ---- the coach (Reflexion self-teaching) ----
export {
  reviewRun,
  lessonsFor,
  coachDirective,
  reinforce,
  penalize,
  isCredible,
  teachFact,
} from './core/coach'
export type { CoachLesson, CoachReview, CoachReviewInput } from './core/coach'

// ---- context cache (token economy) ----
export { ContextCache, estimateTokens, hashKey, stablePromptLayout } from './core/cache'
export type { CacheStats } from './core/cache'

// ---- prompt refinement ----
export { needsRewrite, rewriteQuery, expandQuery, selfRefine } from './core/refine'

// ---- GBRAIN — the garrytan/gbrain memory model, ported (see gbrain/ATTRIBUTION.md) ----
export {
  resolveEntity,
  matchNameVariant,
  normalizeName,
  extractClaims,
  findConflicts,
  findDuplicate,
  compileTruth,
  renderCoreTier,
  canMarkCore,
  suggestCore,
  recordRetrieval,
  retrievalTrust,
  retrievalLog,
  buildGraphView,
  inspectNode,
  createNode,
  removeNode,
  renameNode,
  addAlias,
  pruneOrphans,
  gbrainRemember,
} from './gbrain'
export type { GBrainPage, GBrainEntity, GBrainEdge, GBrainStore, GraphView, RememberResult, EntityResolution } from './gbrain'

/**
 * NEXUS BRAIN — public entry point (the pluggable "spirit" overlay).
 *
 * Usage in any host app:
 *
 *   const brain = createBrain(host)   // host provides llm + state + capabilities + now
 *   if ((await brain.status()).connected) {
 *     const route = await brain.think({ message, history, memories })  // chat or task?
 *     if (route.kind === 'chat') {
 *       const msgs = await brain.answerMessages({ message, history, memories }, route.recalled)
 *       // host streams msgs through its own LLM → tokens appear as typed
 *     }
 *   }
 *
 * TWO-BRAIN CONTRACT: the host app keeps its own spine brain (standard LLM
 * routing, planning, tools) that works with or without this module. When the
 * NEXUS brain is connected it takes over routing, injects recall + graph
 * context, issues app directives (tone / verbosity / auto-dream), coaches
 * itself with lessons from finished missions, refines prompts and caches
 * context. When it is disconnected the host silently falls back to its
 * spine — the app never goes dumb, it just loses the overlay.
 */
export function createBrain(host: BrainHost): Brain {
  return {
    status: () => gateStatus(host),
    connect: () => connect(host),
    disconnect: () => disconnect(host),
    setAppPrefs: (prefs: Partial<BrainAppPrefs>) => setAppPrefs(host, prefs),
    async snapshot(): Promise<BrainSnapshot> {
      const status = await gateStatus(host)
      const capabilities = await host.capabilities()
      return { ...status, capabilities }
    },
    async think(input: BrainThoughtInput): Promise<BrainRouteDecision> {
      const status = await gateStatus(host)
      if (!status.connected) {
        // The host should never route through a disconnected brain — it uses
        // its spine instead. If someone calls anyway, escalate to the spine.
        return { kind: 'task', reason: 'brain disconnected — host spine will handle it' }
      }
      return think(host, input)
    },
    async answerMessages(
      input: BrainThoughtInput,
      recalled?: BrainRecalledRef[]
    ): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
      return answerMessages(host, input, recalled)
    },
  }
}
