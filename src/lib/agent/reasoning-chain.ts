export type ReasoningSource = 'browser_autopilot' | 'mobile_autopilot' | 'mission' | 'voice_live' | 'self_heal'

export type ReasoningNodeKind =
  | 'goal'
  | 'decision'
  | 'action'
  | 'observation'
  | 'self_correction'
  | 'verification'

export type ReasoningChainStatus = 'active' | 'completed' | 'failed' | 'corrected'

export interface ReasoningNode {
  id: string
  seq: number
  kind: ReasoningNodeKind
  title: string
  detail: string
  actor: string
  tool?: string
  url?: string
  /** Populated on self_correction nodes to explain the failure and recovery pivot */
  correction?: {
    whatFailed: string
    pivotStrategy: string
  }
  /** Populated on verification nodes to record pass/fail outcome */
  verified?: boolean
  createdAt: string
}

export interface ReasoningChain {
  id: string
  runId?: string
  source: ReasoningSource
  goal: string
  actor: string
  status: ReasoningChainStatus
  nodes: ReasoningNode[]
  decisionCount: number
  correctionCount: number
  verificationPassed: boolean | null
  startedAt: string
  updatedAt: string
  completedAt?: string
}

export interface ReasoningChainSummary {
  id: string
  goal: string
  status: ReasoningChainStatus
  decisionCount: number
  correctionCount: number
  verificationPassed: boolean | null
  latestNode: ReasoningNode | null
}

type ReasoningListener = (event: { type: 'update'; chain: ReasoningChain } | { type: 'clear' }) => void

const MAX_CHAINS = 40
const MAX_NODES_PER_CHAIN = 80

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function summarizeReasoningChain(chain: ReasoningChain): ReasoningChainSummary {
  return {
    id: chain.id,
    goal: chain.goal,
    status: chain.status,
    decisionCount: chain.decisionCount,
    correctionCount: chain.correctionCount,
    verificationPassed: chain.verificationPassed,
    latestNode: chain.nodes.length > 0 ? chain.nodes[chain.nodes.length - 1] : null,
  }
}

export class ReasoningChainManager {
  private chains = new Map<string, ReasoningChain>()
  private order: string[] = []
  private runIndex = new Map<string, string>()
  private listeners = new Set<ReasoningListener>()

  subscribe(listener: ReasoningListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: { type: 'update'; chain: ReasoningChain } | { type: 'clear' }) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* isolate listener failures */
      }
    }
  }

  private clone(chain: ReasoningChain): ReasoningChain {
    return {
      ...chain,
      nodes: chain.nodes.map((n) => ({
        ...n,
        ...(n.correction ? { correction: { ...n.correction } } : {}),
      })),
    }
  }

  private pruneOverflow() {
    while (this.order.length > MAX_CHAINS) {
      const oldestId = this.order.pop()
      if (!oldestId) break
      const old = this.chains.get(oldestId)
      if (old?.runId && this.runIndex.get(old.runId) === oldestId) {
        this.runIndex.delete(old.runId)
      }
      this.chains.delete(oldestId)
    }
  }

  startChain(opts: {
    source: ReasoningSource
    goal: string
    actor?: string
    runId?: string
    goalDetail?: string
    url?: string
  }): ReasoningChain {
    const now = new Date().toISOString()
    const id = makeId('rc')
    const actor = (opts.actor || 'Eva').trim() || 'Eva'
    const goalText = opts.goal.trim().slice(0, 400) || 'Autonomous task'

    const rootNode: ReasoningNode = {
      id: makeId('rn'),
      seq: 1,
      kind: 'goal',
      title: 'Goal established',
      detail: (opts.goalDetail || goalText).trim().slice(0, 800),
      actor,
      ...(opts.url ? { url: opts.url } : {}),
      createdAt: now,
    }

    const chain: ReasoningChain = {
      id,
      ...(opts.runId ? { runId: opts.runId } : {}),
      source: opts.source,
      goal: goalText,
      actor,
      status: 'active',
      nodes: [rootNode],
      decisionCount: 0,
      correctionCount: 0,
      verificationPassed: null,
      startedAt: now,
      updatedAt: now,
    }

    this.chains.set(id, chain)
    this.order = [id, ...this.order.filter((x) => x !== id)]
    if (opts.runId) {
      this.runIndex.set(opts.runId, id)
    }
    this.pruneOverflow()

    const snapshot = this.clone(chain)
    this.emit({ type: 'update', chain: snapshot })
    return snapshot
  }

  addNode(
    chainId: string,
    input: {
      kind: ReasoningNodeKind
      title: string
      detail: string
      actor?: string
      tool?: string
      url?: string
      correction?: { whatFailed: string; pivotStrategy: string }
      verified?: boolean
    }
  ): ReasoningNode | null {
    const chain = this.chains.get(chainId)
    if (!chain) return null

    const now = new Date().toISOString()
    const node: ReasoningNode = {
      id: makeId('rn'),
      seq: chain.nodes.length + 1,
      kind: input.kind,
      title: input.title.trim().slice(0, 180) || input.kind,
      detail: input.detail.trim().slice(0, 1200),
      actor: (input.actor || chain.actor).trim() || 'Eva',
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.correction
        ? {
            correction: {
              whatFailed: input.correction.whatFailed.trim().slice(0, 400),
              pivotStrategy: input.correction.pivotStrategy.trim().slice(0, 400),
            },
          }
        : {}),
      ...(typeof input.verified === 'boolean' ? { verified: input.verified } : {}),
      createdAt: now,
    }

    chain.nodes.push(node)
    if (chain.nodes.length > MAX_NODES_PER_CHAIN) {
      // Preserve the root goal node and keep the most recent entries
      chain.nodes = [chain.nodes[0], ...chain.nodes.slice(-(MAX_NODES_PER_CHAIN - 1))]
    }

    if (input.kind === 'decision') chain.decisionCount += 1
    if (input.kind === 'self_correction') chain.correctionCount += 1
    if (input.kind === 'verification' && typeof input.verified === 'boolean') {
      chain.verificationPassed = input.verified
    }

    chain.updatedAt = now
    this.order = [chain.id, ...this.order.filter((x) => x !== chain.id)]

    const snapshot = this.clone(chain)
    this.emit({ type: 'update', chain: snapshot })
    return { ...node }
  }

  completeChain(
    chainId: string,
    opts: {
      ok: boolean
      verificationDetail?: string
      url?: string
      actor?: string
    }
  ): ReasoningChain | null {
    const chain = this.chains.get(chainId)
    if (!chain) return null

    const now = new Date().toISOString()
    if (opts.verificationDetail) {
      const hasSameVerification =
        chain.nodes.length > 0 &&
        chain.nodes[chain.nodes.length - 1].kind === 'verification' &&
        chain.nodes[chain.nodes.length - 1].detail === opts.verificationDetail.trim().slice(0, 1200)

      if (!hasSameVerification) {
        chain.nodes.push({
          id: makeId('rn'),
          seq: chain.nodes.length + 1,
          kind: 'verification',
          title: opts.ok ? 'Goal verified' : 'Verification incomplete',
          detail: opts.verificationDetail.trim().slice(0, 1200),
          actor: (opts.actor || chain.actor).trim() || 'Eva',
          ...(opts.url ? { url: opts.url } : {}),
          verified: opts.ok,
          createdAt: now,
        })
      }
      chain.verificationPassed = opts.ok
    }

    chain.status = !opts.ok
      ? 'failed'
      : chain.correctionCount > 0
        ? 'corrected'
        : 'completed'
    chain.updatedAt = now
    chain.completedAt = now

    const snapshot = this.clone(chain)
    this.emit({ type: 'update', chain: snapshot })
    return snapshot
  }

  getChain(chainId: string): ReasoningChain | null {
    const chain = this.chains.get(chainId)
    return chain ? this.clone(chain) : null
  }

  getChainByRunId(runId: string): ReasoningChain | null {
    const id = this.runIndex.get(runId)
    if (!id) return null
    return this.getChain(id)
  }

  listChains(limit = 20): ReasoningChain[] {
    const safeLimit = Math.max(1, Math.min(MAX_CHAINS, limit))
    const out: ReasoningChain[] = []
    for (const id of this.order) {
      if (out.length >= safeLimit) break
      const c = this.chains.get(id)
      if (c) out.push(this.clone(c))
    }
    return out
  }

  clearChains() {
    this.chains.clear()
    this.order = []
    this.runIndex.clear()
    this.emit({ type: 'clear' })
  }
}

const g = globalThis as unknown as { __nexusReasoningChain?: ReasoningChainManager }
export const reasoningChain = g.__nexusReasoningChain ?? new ReasoningChainManager()
g.__nexusReasoningChain = reasoningChain
