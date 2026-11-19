import { db } from '@/lib/db'

export type BrainTraceOperation = 'recall' | 'reason' | 'write'

export interface BrainTraceEvent {
  id: string
  runId?: string
  operation: BrainTraceOperation
  nodeIds: string[]
  nodeNames: string[]
  summary: string
  timestamp: string
}

type TraceListener = (event: { type: 'trace'; item: BrainTraceEvent } | { type: 'clear' }) => void

const MAX_TRACES = 50

class BrainTraceManager {
  private traces: BrainTraceEvent[] = []
  private listeners = new Set<TraceListener>()

  subscribe(listener: TraceListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: { type: 'trace'; item: BrainTraceEvent } | { type: 'clear' }) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  push(input: {
    runId?: string
    operation: BrainTraceOperation
    nodeIds: string[]
    nodeNames: string[]
    summary: string
  }): BrainTraceEvent {
    const uniqueIds = Array.from(new Set(input.nodeIds.filter(Boolean)))
    const uniqueNames = Array.from(new Set(input.nodeNames.filter(Boolean)))
    const item: BrainTraceEvent = {
      id: `btr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      runId: input.runId,
      operation: input.operation,
      nodeIds: uniqueIds,
      nodeNames: uniqueNames,
      summary: input.summary.slice(0, 220),
      timestamp: new Date().toISOString(),
    }
    this.traces = [item, ...this.traces].slice(0, MAX_TRACES)
    this.emit({ type: 'trace', item })
    return item
  }

  list(limit = 20): BrainTraceEvent[] {
    return this.traces.slice(0, limit).map((t) => ({
      ...t,
      nodeIds: [...t.nodeIds],
      nodeNames: [...t.nodeNames],
    }))
  }

  clear() {
    this.traces = []
    this.emit({ type: 'clear' })
  }
}

const g = globalThis as unknown as { __nexusBrainTrace?: BrainTraceManager }
export const brainTrace = g.__nexusBrainTrace ?? new BrainTraceManager()
g.__nexusBrainTrace = brainTrace

/**
 * Resolves GBrain entity IDs from recalled memory IDs and/or explicit entity names,
 * then emits a real-time Working Memory Trace event to GBrain & the Control Bus.
 */
export async function recordWorkingMemoryTrace(opts: {
  runId?: string
  operation: BrainTraceOperation
  memoryIds?: string[]
  entityNames?: string[]
  entityIds?: string[]
  summary: string
}): Promise<BrainTraceEvent | null> {
  try {
    const idSet = new Set<string>(opts.entityIds ?? [])
    const nameSet = new Set<string>(opts.entityNames ?? [])

    if (opts.memoryIds && opts.memoryIds.length > 0) {
      const links = await db.memoryEntityLink.findMany({
        where: { memoryId: { in: opts.memoryIds } },
        select: { entityId: true },
      })
      for (const link of links) idSet.add(link.entityId)
    }

    if (idSet.size > 0 || nameSet.size > 0) {
      const entities = await db.memoryEntity.findMany({
        select: { id: true, name: true },
      })
      const byId = new Map(entities.map((e) => [e.id, e.name]))
      const byLower = new Map(entities.map((e) => [e.name.toLowerCase(), e]))

      for (const id of Array.from(idSet)) {
        const name = byId.get(id)
        if (name) nameSet.add(name)
      }
      for (const name of Array.from(nameSet)) {
        const match = byLower.get(name.toLowerCase())
        if (match) idSet.add(match.id)
      }
    }

    // Even if a query touched memories not yet linked to named entities, emit against Eva Lead Agent if present
    if (idSet.size === 0 && opts.summary.trim()) {
      const eva = await db.memoryEntity.findFirst({
        where: { name: 'Eva Lead Agent' },
        select: { id: true, name: true },
      })
      if (eva) {
        idSet.add(eva.id)
        nameSet.add(eva.name)
      }
    }

    if (idSet.size === 0 && nameSet.size === 0) return null

    return brainTrace.push({
      runId: opts.runId,
      operation: opts.operation,
      nodeIds: Array.from(idSet),
      nodeNames: Array.from(nameSet),
      summary: opts.summary,
    })
  } catch {
    return null
  }
}
