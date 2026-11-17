import { PrismaClient } from '@prisma/client'

type Row = Record<string, unknown>

interface MemoryStore {
  conversation: Row[]
  message: Row[]
  run: Row[]
  runEvent: Row[]
  plugin: Row[]
  skill: Row[]
  tool: Row[]
  mcpServer: Row[]
  memory: Row[]
  memoryEntity: Row[]
  memoryEntityLink: Row[]
  memoryEdge: Row[]
  brainState: Row[]
  suggestion: Row[]
  dreamCycle: Row[]
}

const DEFAULTS: Record<keyof MemoryStore, () => Row> = {
  conversation: () => ({ title: 'New Mission', createdAt: new Date(), updatedAt: new Date() }),
  message: () => ({ runId: null, createdAt: new Date() }),
  run: () => ({
    status: 'planning',
    phase: 'plan',
    planJson: '{}',
    convoJson: '[]',
    stepIndex: -1,
    stepStateJson: '{}',
    toolCallCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  runEvent: () => ({ seq: 0, data: '{}', createdAt: new Date() }),
  plugin: () => ({
    category: 'general',
    icon: 'puzzle',
    source: 'builtin',
    installed: false,
    enabled: true,
    configJson: '{}',
    toolSlug: null,
    usageCount: 0,
    createdAt: new Date(),
  }),
  skill: () => ({
    category: 'general',
    icon: 'sparkles',
    prompt: '',
    enabled: true,
    usageCount: 0,
    createdAt: new Date(),
  }),
  tool: () => ({ source: 'builtin', enabled: true, usageCount: 0, createdAt: new Date() }),
  mcpServer: () => ({
    status: 'connected',
    mode: 'builtin',
    toolsJson: '[]',
    configJson: '{}',
    enabled: true,
    usageCount: 0,
    createdAt: new Date(),
  }),
  memory: () => ({
    type: 'note',
    kind: 'episodic',
    source: 'agent',
    runId: null,
    conversationId: null,
    importance: 3,
    strength: 0.1,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: new Date(),
    metaJson: '{}',
    truth: null,
    alwaysLoad: false,
    corePriority: null,
  }),
  memoryEntity: () => ({ variants: '[]', origin: 'auto', createdAt: new Date() }),
  memoryEntityLink: () => ({}),
  memoryEdge: () => ({ kind: 'INFERRED', weight: 1, createdAt: new Date() }),
  brainState: () => ({
    connected: true,
    personality: 'NEXUS',
    appPrefsJson: '{}',
    connectedAt: null,
    disconnectedAt: null,
    updatedAt: new Date(),
  }),
  suggestion: () => ({ runId: null, kind: 'next', createdAt: new Date() }),
  dreamCycle: () => ({ mergedCount: 0, relationsFound: 0, totalMemories: 0, createdAt: new Date() }),
}

let seqCounter = 1
function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(seqCounter++).toString(36)}`
}

function matchesWhere(row: Row, where?: Row): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (key === 'OR' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesWhere(row, sub as Row))) return false
      continue
    }
    if (key === 'AND' && Array.isArray(cond)) {
      if (!cond.every((sub) => matchesWhere(row, sub as Row))) return false
      continue
    }
    if (key === 'entityId_memoryId' && cond && typeof cond === 'object') {
      const c = cond as { entityId: unknown; memoryId: unknown }
      if (row.entityId !== c.entityId || row.memoryId !== c.memoryId) return false
      continue
    }
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ('in' in c && Array.isArray(c.in)) {
        if (!c.in.includes(row[key])) return false
        continue
      }
      if ('equals' in c) {
        if (row[key] !== c.equals) return false
        continue
      }
    }
    if (row[key] !== cond) return false
  }
  return true
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}

function sortRows(rows: Row[], orderBy?: Row | Row[]): Row[] {
  if (!orderBy) return rows
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy]
  return [...rows].sort((a, b) => {
    for (const ord of orders) {
      for (const [k, dir] of Object.entries(ord)) {
        const cmp = compareValues(a[k], b[k])
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })
}

function applySelect(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row }
  const out: Row = {}
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = row[k]
  }
  return out
}

function applyPatch(row: Row, data: Row): Row {
  const next = { ...row }
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'increment' in v) {
      const inc = Number((v as { increment: number }).increment || 0)
      next[k] = Number(next[k] ?? 0) + inc
    } else if (v !== undefined) {
      next[k] = v
    }
  }
  if ('updatedAt' in next) next.updatedAt = new Date()
  return next
}

function createInMemoryPrisma(): PrismaClient {
  const globalStore = globalThis as unknown as { __nexusMemDb?: MemoryStore }
  if (!globalStore.__nexusMemDb) {
    globalStore.__nexusMemDb = {
      conversation: [],
      message: [],
      run: [],
      runEvent: [],
      plugin: [],
      skill: [],
      tool: [],
      mcpServer: [],
      memory: [],
      memoryEntity: [],
      memoryEntityLink: [],
      memoryEdge: [],
      brainState: [],
      suggestion: [],
      dreamCycle: [],
    }
  }
  const store = globalStore.__nexusMemDb

  function attachIncludes(model: keyof MemoryStore, row: Row, include?: Record<string, unknown>): Row {
    const out = { ...row }
    if (!include) return out
    if (model === 'conversation') {
      if (include.messages) {
        const inc = include.messages as { orderBy?: Row }
        const msgs = store.message.filter((m) => m.conversationId === row.id)
        out.messages = sortRows(msgs, inc?.orderBy).map((m) => ({ ...m }))
      }
      if (include.runs) {
        const inc = include.runs as { orderBy?: Row; include?: Record<string, unknown> }
        const runs = sortRows(
          store.run.filter((r) => r.conversationId === row.id),
          inc?.orderBy
        )
        out.runs = runs.map((r) => attachIncludes('run', r, inc?.include))
      }
      if (include.suggestions) {
        const inc = include.suggestions as { orderBy?: Row }
        const sugs = store.suggestion.filter((s) => s.conversationId === row.id)
        out.suggestions = sortRows(sugs, inc?.orderBy).map((s) => ({ ...s }))
      }
    } else if (model === 'run' && include.events) {
      const inc = include.events as { orderBy?: Row }
      const evs = store.runEvent.filter((e) => e.runId === row.id)
      out.events = sortRows(evs, inc?.orderBy).map((e) => ({ ...e }))
    }
    return out
  }

  function cascadeDelete(model: keyof MemoryStore, ids: Set<unknown>) {
    if (ids.size === 0) return
    if (model === 'conversation') {
      store.message = store.message.filter((m) => !ids.has(m.conversationId))
      store.suggestion = store.suggestion.filter((s) => !ids.has(s.conversationId))
      const runIds = new Set(store.run.filter((r) => ids.has(r.conversationId)).map((r) => r.id))
      store.run = store.run.filter((r) => !ids.has(r.conversationId))
      cascadeDelete('run', runIds)
    } else if (model === 'run') {
      store.runEvent = store.runEvent.filter((e) => !ids.has(e.runId))
    } else if (model === 'memory') {
      store.memoryEntityLink = store.memoryEntityLink.filter((l) => !ids.has(l.memoryId))
    } else if (model === 'memoryEntity') {
      store.memoryEntityLink = store.memoryEntityLink.filter((l) => !ids.has(l.entityId))
      store.memoryEdge = store.memoryEdge.filter((e) => !ids.has(e.sourceId) && !ids.has(e.targetId))
    }
  }

  function makeDelegate(model: keyof MemoryStore) {
    const hasId = model !== 'memoryEntityLink'
    return {
      async findMany(args: { where?: Row; orderBy?: Row | Row[]; take?: number; select?: Record<string, boolean>; include?: Record<string, unknown> } = {}) {
        let rows = store[model].filter((r) => matchesWhere(r, args.where))
        rows = sortRows(rows, args.orderBy)
        if (typeof args.take === 'number') rows = rows.slice(0, args.take)
        return rows.map((r) => {
          const withInc = attachIncludes(model, r, args.include)
          return args.select ? applySelect(withInc, args.select) : withInc
        })
      },
      async findUnique(args: { where: Row; include?: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row = store[model].find((r) => matchesWhere(r, args.where))
        if (!row) return null
        const withInc = attachIncludes(model, row, args.include)
        return args.select ? applySelect(withInc, args.select) : withInc
      },
      async findFirst(args: { where?: Row; orderBy?: Row | Row[]; include?: Record<string, unknown>; select?: Record<string, boolean> } = {}) {
        let rows = store[model].filter((r) => matchesWhere(r, args.where))
        rows = sortRows(rows, args.orderBy)
        const row = rows[0]
        if (!row) return null
        const withInc = attachIncludes(model, row, args.include)
        return args.select ? applySelect(withInc, args.select) : withInc
      },
      async create(args: { data: Row }) {
        const base = DEFAULTS[model]()
        const row: Row = {
          ...(hasId ? { id: nextId(String(model)) } : {}),
          ...base,
          ...args.data,
        }
        store[model].push(row)
        return { ...row }
      },
      async update(args: { where: Row; data: Row }) {
        const idx = store[model].findIndex((r) => matchesWhere(r, args.where))
        if (idx === -1) throw new Error(`${String(model)} record not found`)
        const updated = applyPatch(store[model][idx], args.data)
        store[model][idx] = updated
        return { ...updated }
      },
      async upsert(args: { where: Row; create: Row; update: Row }) {
        const idx = store[model].findIndex((r) => matchesWhere(r, args.where))
        if (idx !== -1) {
          const updated = applyPatch(store[model][idx], args.update)
          store[model][idx] = updated
          return { ...updated }
        }
        const base = DEFAULTS[model]()
        const row: Row = {
          ...(hasId ? { id: nextId(String(model)) } : {}),
          ...base,
          ...args.create,
        }
        store[model].push(row)
        return { ...row }
      },
      async delete(args: { where: Row }) {
        const idx = store[model].findIndex((r) => matchesWhere(r, args.where))
        if (idx === -1) throw new Error(`${String(model)} record not found`)
        const [removed] = store[model].splice(idx, 1)
        if (hasId) cascadeDelete(model, new Set([removed.id]))
        return { ...removed }
      },
      async deleteMany(args: { where?: Row } = {}) {
        const removedIds = new Set<unknown>()
        const kept: Row[] = []
        for (const r of store[model]) {
          if (matchesWhere(r, args.where)) {
            if (hasId) removedIds.add(r.id)
          } else {
            kept.push(r)
          }
        }
        const count = store[model].length - kept.length
        store[model] = kept
        if (hasId) cascadeDelete(model, removedIds)
        return { count }
      },
      async count(args: { where?: Row } = {}) {
        return store[model].filter((r) => matchesWhere(r, args.where)).length
      },
      async aggregate(args: { where?: Row; _max?: Record<string, boolean> } = {}) {
        const rows = store[model].filter((r) => matchesWhere(r, args.where))
        const _max: Record<string, unknown> = {}
        if (args._max) {
          for (const k of Object.keys(args._max)) {
            let maxVal: number | null = null
            for (const r of rows) {
              const v = r[k]
              if (typeof v === 'number' && (maxVal === null || v > maxVal)) maxVal = v
            }
            _max[k] = maxVal
          }
        }
        return { _max }
      },
    }
  }

  return new Proxy(
    {
      $connect: async () => undefined,
      $disconnect: async () => undefined,
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        if (prop in store) return makeDelegate(prop as keyof MemoryStore)
        return undefined
      },
    }
  ) as unknown as PrismaClient
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createDbClient(): PrismaClient {
  const url = process.env.DATABASE_URL?.trim()
  if (url && !url.startsWith('file:')) {
    try {
      const real = new PrismaClient({ log: ['error'] })
      const mem = createInMemoryPrisma()
      let useMem = false
      return new Proxy(real as unknown as Record<string, unknown>, {
        get(target, prop: string) {
          if (useMem) return (mem as unknown as Record<string, unknown>)[prop]
          const val = target[prop]
          if (val && typeof val === 'object') {
            return new Proxy(val as Record<string, unknown>, {
              get(mTarget, mProp: string) {
                const fn = mTarget[mProp]
                if (typeof fn !== 'function') return fn
                return async (...args: unknown[]) => {
                  if (useMem) {
                    return ((mem as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[prop][mProp])(...args)
                  }
                  try {
                    return await (fn as (...a: unknown[]) => Promise<unknown>).apply(mTarget, args)
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err)
                    if (/Can't reach database|Unable to open|InitializationError|P1001|P1003|P2021/i.test(msg)) {
                      useMem = true
                      return ((mem as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[prop][mProp])(...args)
                    }
                    throw err
                  }
                }
              },
            })
          }
          return val
        },
      }) as unknown as PrismaClient
    } catch {
      console.warn('[AI Studio] Database initialization failed — using in-memory store')
    }
  } else {
    console.warn('[AI Studio] Using in-memory store (no live external DATABASE_URL)')
  }
  return createInMemoryPrisma()
}

export const db = globalForPrisma.prisma ?? createDbClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db