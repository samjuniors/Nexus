/**
 * RECALL — brain-first memory recall, human-brain scoring.
 *
 * The scoring function is the Generative Agents formula (Stanford, 2023):
 *
 *   score = w_recency · recency + w_importance · importance + w_relevance · relevance
 *
 *   - recency    = 0.995^(Δhours since the memory was last touched)
 *   - importance = salience 1-10, scored at WRITE time (amygdala tagging) —
 *                  not at retrieval time, exactly like emotional memory
 *   - relevance  = max keyword-coverage across query VARIANTS (deterministic
 *                  multi-query fusion) + graph activation boost
 *
 * On top of that, Bjork's New Theory of Disuse: every memory carries
 * STORAGE STRENGTH (how well learned — grows on every successful recall,
 * never decays) separate from RETRIEVAL STRENGTH (how accessible now —
 * decays with disuse). We rank by the current score (RS-like) and expose
 * SS so the host can promote durable knowledge (dream cycle) and so a
 * recall with LOW current accessibility still yields a big learning gain
 * (desirable difficulty — the host bumps SS more when RS was low).
 *
 * PRIMING: recent activation lowers the threshold for associated items.
 * A session-scoped priming map carries activation across turns and decays
 * by half each turn — follow-up questions on the same topic recall faster.
 *
 * PATTERN COMPLETION (CA3): when a weak/partial query finds nothing, the
 * query is completed from the union of key entities in the few memories
 * that did match, then re-retrieved — degraded input still settles into
 * the full stored pattern.
 *
 * gbrain concepts kept from v1: typed-knowledge priority (facts/decisions
 * outrank notes), light stemming, numbered citations.
 */

export interface RecallableMemory {
  id: string
  content: string
  type: string
  createdAt?: string
  /** salience 1-10 scored at write time (defaults by type) */
  importance?: number
  /** storage strength SS 0..1 (durable knowledge) */
  strength?: number
  /** retrieval history (for recency + desirable difficulty) */
  lastAccessedAt?: string
  accessCount?: number
}

export interface RecalledMemory {
  id: string
  content: string
  type: string
  score: number
  matchedTerms: string[]
  /** citation number within the recall set ([1], [2] …) */
  cite: number
  /** how low retrieval strength was before this recall (0..1) — big SS gain when high */
  difficulty?: number
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'am', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'our', 'their', 'this', 'that', 'these', 'those', 'what', 'which', 'who',
  'how', 'when', 'where', 'why', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
  'should', 'have', 'has', 'had', 'not', 'no', 'yes', 'so', 'if', 'then', 'than', 'as',
  'by', 'from', 'up', 'down', 'about', 'into', 'over', 'under', 'again', 'just', 'me',
  'please', 'tell', 'give', 'show', 'make', 'want', 'need', 'know', 'like', 'get',
])

/** Typed-knowledge priority (gbrain's facts.md / decisions.md layers). */
const TYPE_WEIGHT: Record<string, number> = {
  fact: 1.3,
  decision: 1.25,
  lesson: 1.35, // the coach's lessons outrank everything — they encode experience
  insight: 1.15,
  preference: 1.1,
  note: 1.0,
}

/** Default salience by memory type when none was scored at write time. */
const TYPE_IMPORTANCE: Record<string, number> = {
  fact: 6,
  decision: 7,
  lesson: 8,
  insight: 6,
  preference: 5,
  note: 3,
}

/** Very light suffix stemmer — enough for "images"→"image", "generating"→"generat". */
function stem(t: string): string {
  if (t.length <= 4) return t
  for (const suf of ['ing', 'ies', 'ed', 'es', 'ly', 's']) {
    if (t.endsWith(suf) && t.length - suf.length >= 3) {
      return t.slice(0, -suf.length)
    }
  }
  return t
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stem)
}

/** 0.995^Δhours — the Generative Agents recency decay. */
function recencyScore(m: RecallableMemory, now: Date): number {
  const ref = m.lastAccessedAt ?? m.createdAt
  if (!ref) return 0.5 // unknown age → neutral
  const hours = Math.max(0, (now.getTime() - new Date(ref).getTime()) / 3600000)
  return Math.pow(0.995, hours)
}

/** Salience 1-10 normalized to 0..1. */
function importanceScore(m: RecallableMemory): number {
  const imp = m.importance ?? TYPE_IMPORTANCE[m.type] ?? 3
  return Math.min(10, Math.max(1, imp)) / 10
}

/** Deterministic query variants for multi-query fusion (max of scores). */
function queryVariants(query: string): string[] {
  const variants = [query]
  const stripped = query
    .replace(/^(please\s+)?(can|could|would|will)\s+you\s+/i, '')
    .replace(/^(what|who|how|why|when|where)\s+(is|are|was|were|do|does|did)\s+/i, '')
    .trim()
  if (stripped.length > 3 && stripped !== query) variants.push(stripped)
  return variants
}

/** Keyword relevance of a memory against the best query variant. 0..1 */
function relevanceScore(terms: string[], termSet: Set<string>, variants: Set<string>[]): number {
  const uniqueTerms = new Set(terms)
  let best = 0
  for (const v of variants) {
    const matched = terms.filter((t) => v.has(t))
    if (matched.length === 0) continue
    const unique = new Set(matched)
    const coverage = unique.size / Math.max(1, v.size)
    const density = unique.size / uniqueTerms.size
    best = Math.max(best, coverage * 0.7 + density * 0.3)
  }
  return Math.min(1, best)
}

/**
 * Min-max normalize a list of values to 0..1 (Generative Agents normalizes
 * each scoring factor over the candidate set before summing).
 */
function normalize(values: number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max - min < 1e-9) return values.map(() => 0.5)
  return values.map((v) => (v - min) / (max - min))
}

/**
 * Score and rank memories against a query with the full human-brain formula.
 * Optional `graphBoost` adds activation from the entity graph (HippoRAG):
 * memories whose entities are currently hot score higher without ever
 * reading the whole store into a prompt.
 */
export function recallMemories(
  memories: RecallableMemory[],
  query: string,
  opts: {
    limit?: number
    minScore?: number
    now?: Date
    /** memoryId → entity-graph activation 0..1 */
    graphBoost?: Map<string, number>
    /** priming map carried across turns (memoryId → primed activation) */
    primed?: Map<string, number>
    weights?: { recency?: number; importance?: number; relevance?: number }
  } = {}
): RecalledMemory[] {
  const limit = opts.limit ?? 3
  const minScore = opts.minScore ?? 0.18
  const now = opts.now ?? new Date()
  const w = { recency: 0.25, importance: 0.25, relevance: 0.5, ...(opts.weights ?? {}) }
  const variants = [new Set(tokenize(query)), ...queryVariants(query).slice(1).map((v) => new Set(tokenize(v)))]
  if (variants[0].size === 0 && !opts.graphBoost) return []
  if (memories.length === 0) return []

  const pre = memories.map((m) => {
    const terms = tokenize(m.content)
    const relevance = relevanceScore(terms, new Set(terms), variants)
    const graph = opts.graphBoost?.get(m.id) ?? 0
    return {
      m,
      terms,
      relevance: Math.min(1, relevance + graph * 0.6),
      recency: recencyScore(m, now),
      importance: importanceScore(m),
      primed: opts.primed?.get(m.id) ?? 0,
    }
  })

  // candidates: anything with relevance signal OR graph activation OR priming
  const candidates = pre.filter((c) => c.relevance > 0.02 || c.primed > 0.05)
  if (candidates.length === 0) return []

  // Generative Agents: normalize each factor over the candidate set
  const recNorm = normalize(candidates.map((c) => c.recency))
  const impNorm = normalize(candidates.map((c) => c.importance))
  const relNorm = normalize(candidates.map((c) => c.relevance))

  const scored: RecalledMemory[] = candidates.map((c, i) => {
    const typeBoost = TYPE_WEIGHT[c.m.type] ?? 1
    // retrieval strength proxy: how accessible was this memory RIGHT NOW
    // (recency + priming) — low RS before a successful recall = desirable
    // difficulty = the host should reward storage strength more
    const rsBefore = Math.min(1, c.recency * 0.6 + c.primed + 0.1)
    const score =
      (w.recency * recNorm[i] + w.importance * impNorm[i] + w.relevance * relNorm[i]) * typeBoost +
      c.primed * 0.15
    const matchedTerms = c.terms.filter((t) => variants.some((v) => v.has(t)))
    return {
      id: c.m.id,
      content: c.m.content,
      type: c.m.type,
      score,
      matchedTerms: [...new Set(matchedTerms)].slice(0, 6),
      cite: 0,
      difficulty: 1 - rsBefore,
    }
  })

  const top = scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  top.forEach((r, i) => (r.cite = i + 1))
  return top
}

/**
 * PATTERN COMPLETION (CA3 auto-association): when a partial cue found too
 * little, complete the query from the union of key terms in what DID match,
 * then re-run recall — the degraded input settles into the stored pattern.
 */
export function recallWithCompletion(
  memories: RecallableMemory[],
  query: string,
  opts: { limit?: number; minScore?: number; now?: Date; graphBoost?: Map<string, number>; primed?: Map<string, number> } = {}
): { recalled: RecalledMemory[]; completedQuery: string | null } {
  const direct = recallMemories(memories, query, opts)
  if (direct.length >= 2 || query.split(/\s+/).length > 8) {
    return { recalled: direct, completedQuery: null }
  }
  // complete the cue from whatever weakly matched + graph-hot memories
  const weak = recallMemories(memories, query, { ...opts, limit: 5, minScore: 0.05 })
  const completionTerms = new Set<string>()
  for (const r of weak.slice(0, 3)) {
    for (const t of r.matchedTerms) completionTerms.add(t)
  }
  if (completionTerms.size < 2) return { recalled: direct, completedQuery: null }
  const completedQuery = `${query} ${[...completionTerms].slice(0, 6).join(' ')}`
  const completed = recallMemories(memories, completedQuery, opts)
  return { recalled: completed.length > direct.length ? completed : direct, completedQuery }
}

/**
 * Storage-strength gain for a successful recall (Bjork): the gain is largest
 * when the memory was HARD to retrieve (low RS — desirable difficulty) and
 * when it was already strong (interconnected). The host applies this.
 */
export function strengthGain(recalled: RecalledMemory, currentStrength: number): number {
  const g0 = 0.2
  return g0 * (recalled.difficulty ?? 0.5) * (1 - currentStrength)
}

/** New priming map after a recall: winners get primed, everything halves. */
export function updatePriming(
  primed: Map<string, number>,
  recalled: RecalledMemory[]
): Map<string, number> {
  const next = new Map<string, number>()
  for (const [id, a] of primed) {
    next.set(id, a * 0.5) // decay
  }
  for (const r of recalled) {
    next.set(r.id, Math.min(1, (next.get(r.id) ?? 0) + 0.7))
  }
  // drop traces that faded to noise
  for (const [id, a] of [...next]) if (a < 0.05) next.delete(id)
  return next
}

/** Render recalled memories as a numbered citation block for LLM context injection. */
export function formatRecallBlock(recalled: RecalledMemory[]): string {
  if (recalled.length === 0) return ''
  return recalled
    .map((r) => `- [${r.cite}] (${r.type}) ${r.content} (matched: ${r.matchedTerms.slice(0, 4).join(', ')})`)
    .join('\n')
}

/** Compact citation footer for the chat answer — gbrain's cited synthesis. */
export function formatCitationFooter(recalled: RecalledMemory[]): string {
  if (recalled.length === 0) return ''
  const parts = recalled.map((r) => `[${r.cite}] ${r.type}: ${r.content.slice(0, 90)}${r.content.length > 90 ? '…' : ''}`)
  return `Recalled from memory — ${parts.join(' · ')}`
}
