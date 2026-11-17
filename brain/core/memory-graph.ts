/**
 * GRAPH MEMORY — all memory as a traversable entity graph.
 *
 * HippoRAG (NeurIPS'24) mapped the hippocampus onto retrieval: the neocortex
 * stores content (our memories), the hippocampal formation stores an INDEX
 * that links experiences together (our entity graph). Recall then becomes
 * SPREADING ACTIVATION through the index — Collins & Loftus's 1975 theory of
 * semantic memory, implemented as Personalized PageRank.
 *
 * Why this saves tokens: a keyword scan must read every memory into a
 * scoring pass and often stuffs many near-misses into the prompt. Graph
 * recall only ever touches the ACTIVATED SUBGRAPH: query → seed entities →
 * activation spreads along typed edges → the few memories linked to hot
 * entities enter the prompt, under an explicit TOKEN BUDGET (graphify
 * measured 71.5× fewer tokens per query than reading raw files). Nothing
 * else is ever read, scored or paid for.
 *
 * Deterministic by design: entity + triple extraction is pure parsing
 * (capitalized phrases, "X uses Y" patterns) — zero LLM calls at index time,
 * graphify-style provenance on every edge (EXTRACTED vs INFERRED).
 */

// ---------- types ----------

export interface MemoryGraphNode {
  id: string
  name: string
  /** number of memories mentioning this entity */
  degree: number
}

export interface MemoryGraphEdge {
  sourceId: string
  targetId: string
  relation: string
  kind: 'EXTRACTED' | 'INFERRED'
  weight: number
}

/** Memory ↔ entity incidence (which memory mentions which entity). */
export interface MemoryGraphLink {
  memoryId: string
  entityId: string
}

export interface MemoryGraph {
  nodes: Map<string, MemoryGraphNode>
  edges: MemoryGraphEdge[]
  /** entityId → linked memory ids */
  linksByEntity: Map<string, string[]>
  /** memoryId → linked entity ids */
  linksByMemory: Map<string, string[]>
}

export interface GraphRecalledMemory {
  id: string
  content: string
  type: string
  /** composite graph activation score */
  score: number
  /** the entity trail that activated this memory (explainability) */
  trail: string[]
  cite: number
}

// ---------- deterministic entity + triple extraction ----------

const RELATION_VERBS = [
  'uses', 'used', 'prefers', 'preferred', 'likes', 'liked', 'loves', 'hates', 'avoids',
  'knows', 'chose', 'chooses', 'choosen', 'created', 'built', 'wrote', 'made', 'runs',
  'owns', 'wants', 'needs', 'has', 'speaks', 'lives in', 'works at', 'works on',
  'learned', 'completed', 'started', 'finished', 'generated', 'asked about', 'cares about',
]

/**
 * Extract entities from text: capitalized multi-word phrases and single
 * proper names (excluding bare sentence-initial capitals unless they recur).
 * "User" is always an entity when the memory is about the user.
 */
/** capitalized words that are almost never entities, even mid-sentence */
const NON_ENTITY_CAPS = new Set([
  'The', 'This', 'That', 'Then', 'These', 'Those', 'And', 'But', 'Also', 'However', 'It',
  'He', 'She', 'They', 'We', 'You', 'I', 'What', 'When', 'Where', 'Why', 'How', 'Who',
  'There', 'Here', 'Now', 'Next', 'First', 'Second', 'Finally', 'User', 'Monday', 'Tuesday',
  'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
])

export function extractEntities(text: string): string[] {
  const found = new Set<string>()
  // multi-word capitalized runs: "John Smith", "New York", "NEXUS Brain"
  const runs = text.match(/\b([A-Z][a-zA-Z0-9&'+-]+)(\s+[A-Z][a-zA-Z0-9&'+-]+)*/g) ?? []
  const counts = new Map<string, number>()
  for (const r of runs) {
    const clean = r.replace(/[^\w\s&'+-]/g, '').trim()
    if (clean.length < 2) continue
    counts.set(clean, (counts.get(clean) ?? 0) + 1)
  }
  // position map: is this word the FIRST word of a sentence? (false-positive risk)
  const sentenceStarts = new Set<string>()
  for (const m of text.matchAll(/(^|[.!?]\s+|\n)([A-Z][a-z]+)/g)) {
    sentenceStarts.add(m[2])
  }
  for (const [name, count] of counts) {
    const words = name.split(/\s+/)
    if (words.length >= 2) {
      found.add(name) // multi-word runs are almost always real entities
    } else if (count >= 2) {
      found.add(name) // recurring capitalized word
    } else if (!sentenceStarts.has(name) && !NON_ENTITY_CAPS.has(name)) {
      found.add(name) // single mid-sentence capitalized word: "works at Zalando"
    }
  }
  // tech/product names that arrive lowercase in memories
  for (const kw of ['python', 'typescript', 'javascript', 'react', 'next.js', 'prisma', 'sqlite', 'docker', 'git', 'linux', 'windows', 'mac', 'excel', 'figma', 'notion']) {
    if (new RegExp(`\\b${kw.replace('.', '\\.')}\\b`, 'i').test(text)) found.add(kw)
  }
  if (/\b(user|i|my|me)\b/i.test(text.split(/\s+/).slice(0, 6).join(' '))) found.add('User')
  return [...found].slice(0, 12)
}

/**
 * Extract typed triples from one sentence (EXTRACTED provenance):
 * "User prefers dark themes" → (User, prefers, Dark Themes).
 */
export function extractTriples(text: string): { source: string; relation: string; target: string }[] {
  const entities = extractEntities(text)
  const lookup = new Map(entities.map((e) => [e.toLowerCase(), e]))
  const out: { source: string; relation: string; target: string }[] = []
  for (const sentence of text.split(/[.;\n]+/)) {
    const lower = sentence.toLowerCase()
    for (const verb of RELATION_VERBS) {
      const idx = lower.indexOf(` ${verb} `)
      if (idx === -1) continue
      const left = sentence.slice(0, idx).trim()
      const right = sentence.slice(idx + verb.length + 2).trim()
      // resolve each side to the longest entity it contains
      const src = longestEntityIn(left, lookup) ?? (/^(user|i|my)/i.test(left) ? 'User' : null)
      const tgt = longestEntityIn(right, lookup)
      if (src && tgt && src !== tgt) {
        out.push({ source: src, relation: verb, target: tgt })
      }
    }
  }
  return out.slice(0, 6)
}

function longestEntityIn(phrase: string, lookup: Map<string, string>): string | null {
  const lower = phrase.toLowerCase()
  let best: string | null = null
  for (const [l, original] of lookup) {
    if (lower.includes(l) && (best === null || l.length > best.length)) best = original
  }
  return best
}

// ---------- graph assembly ----------

export function buildMemoryGraph(input: {
  entities: { id: string; name: string }[]
  edges: { sourceId: string; targetId: string; relation: string; kind: string; weight: number }[]
  links: { entityId: string; memoryId: string }[]
}): MemoryGraph {
  const nodes = new Map<string, MemoryGraphNode>()
  for (const e of input.entities) {
    nodes.set(e.id, { id: e.id, name: e.name, degree: 0 })
  }
  const linksByEntity = new Map<string, string[]>()
  const linksByMemory = new Map<string, string[]>()
  for (const l of input.links) {
    if (!nodes.has(l.entityId)) continue
    if (!linksByEntity.has(l.entityId)) linksByEntity.set(l.entityId, [])
    linksByEntity.get(l.entityId)!.push(l.memoryId)
    if (!linksByMemory.has(l.memoryId)) linksByMemory.set(l.memoryId, [])
    linksByMemory.get(l.memoryId)!.push(l.entityId)
    nodes.get(l.entityId)!.degree++
  }
  const edges: MemoryGraphEdge[] = []
  const seen = new Set<string>()
  for (const e of input.edges) {
    if (!nodes.has(e.sourceId) || !nodes.has(e.targetId)) continue
    const key = `${e.sourceId}|${e.targetId}|${e.relation}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      sourceId: e.sourceId,
      targetId: e.targetId,
      relation: e.relation,
      kind: e.kind === 'EXTRACTED' ? 'EXTRACTED' : 'INFERRED',
      weight: Math.max(0.1, e.weight),
    })
  }
  return { nodes, edges, linksByEntity, linksByMemory }
}

/** Undirected weighted adjacency (used by both activation algorithms). */
function adjacency(graph: MemoryGraph): Map<string, { id: string; w: number }[]> {
  const adj = new Map<string, { id: string; w: number }[]>()
  for (const n of graph.nodes.keys()) adj.set(n, [])
  for (const e of graph.edges) {
    adj.get(e.sourceId)?.push({ id: e.targetId, w: e.weight })
    adj.get(e.targetId)?.push({ id: e.sourceId, w: e.weight })
  }
  return adj
}

// ---------- activation algorithms ----------

export interface ActivationResult {
  /** entityId → activation score */
  activation: Map<string, number>
  /** the entities that seeded the spread (query-matched) */
  seeds: string[]
}

/**
 * SPREADING ACTIVATION (Collins & Loftus 1975): cue nodes fire at strength 1,
 * activation decays by `decay` per hop and is divided across a node's links
 * (the fan effect). Biologically-faithful, deterministic, cheap.
 */
export function spreadingActivation(
  graph: MemoryGraph,
  seedIds: string[],
  opts: { decay?: number; hops?: number; theta?: number } = {}
): ActivationResult {
  const decay = opts.decay ?? 0.5
  const hops = opts.hops ?? 2
  const theta = opts.theta ?? 0.08
  const adj = adjacency(graph)
  const activation = new Map<string, number>()
  for (const s of seedIds) activation.set(s, 1)

  let frontier = [...seedIds]
  let strength = 1
  for (let hop = 0; hop < hops; hop++) {
    strength *= decay
    const next: string[] = []
    for (const v of frontier) {
      const neighbors = adj.get(v) ?? []
      if (neighbors.length === 0) continue
      const share = strength / neighbors.length // fan effect
      for (const u of neighbors) {
        const cur = activation.get(u.id) ?? 0
        activation.set(u.id, cur + share)
        if (cur + share > theta && !frontier.includes(u.id)) next.push(u.id)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  for (const [id, a] of [...activation]) if (a < theta && !seedIds.includes(id)) activation.delete(id)
  return { activation, seeds: [...seedIds] }
}

/**
 * PERSONALIZED PAGERANK (HippoRAG's retrieval step): seeds inject mass every
 * iteration; mass diffuses along weighted undirected edges; the stationary
 * distribution ranks entities by how strongly the query connects to them.
 * One computation replaces iterative multi-hop LLM retrieval — 10-30×
 * cheaper than chain-of-thought retrieval in the original paper.
 */
export function personalizedPageRank(
  graph: MemoryGraph,
  seedWeights: Map<string, number>,
  opts: { damping?: number; iterations?: number } = {}
): ActivationResult {
  const damping = opts.damping ?? 0.85
  const iterations = opts.iterations ?? 20
  const adj = adjacency(graph)

  // normalize seeds to a distribution
  const seedTotal = [...seedWeights.values()].reduce((a, b) => a + b, 0)
  if (seedTotal <= 0) return { activation: new Map(), seeds: [...seedWeights.keys()] }
  const seeds: string[] = []
  const restart = new Map<string, number>()
  for (const [id, w] of seedWeights) {
    if (!graph.nodes.has(id)) continue
    seeds.push(id)
    restart.set(id, w / seedTotal)
  }
  if (seeds.length === 0) return { activation: new Map(), seeds: [] }

  let p = new Map<string, number>(restart)
  for (let it = 0; it < iterations; it++) {
    const next = new Map<string, number>()
    for (const id of restart.keys()) next.set(id, (1 - damping) * (restart.get(id) ?? 0))
    for (const [id, mass] of p) {
      const neighbors = adj.get(id) ?? []
      if (neighbors.length === 0) {
        // dangling node: mass returns to the restart distribution
        for (const [sid, r] of restart) next.set(sid, (next.get(sid) ?? 0) + damping * mass * r)
        continue
      }
      const totalW = neighbors.reduce((a, n) => a + n.w, 0)
      for (const n of neighbors) {
        next.set(n.id, (next.get(n.id) ?? 0) + damping * mass * (n.w / totalW))
      }
    }
    p = next
  }
  return { activation: p, seeds }
}

// ---------- graph recall (token-budgeted) ----------

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'is', 'are', 'was', 'in', 'on', 'what', 'who', 'how', 'why', 'when', 'where', 'me', 'my', 'you', 'your', 'about', 'tell', 'give', 'show'])

function queryTokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

/**
 * Map a query to seed entities (name-token match, case-insensitive, gbrain's
 * alias-hop idea without an alias table: partial name matches count too).
 */
export function seedEntities(graph: MemoryGraph, query: string): Map<string, number> {
  const tokens = queryTokens(query)
  const weights = new Map<string, number>()
  if (tokens.length === 0) return weights
  // first-person pronouns seed the User entity (memories are user-centric)
  if (/\b(i|my|me|mine|myself|user)\b/i.test(query)) {
    for (const node of graph.nodes.values()) {
      if (node.name === 'User') {
        weights.set(node.id, 1)
        break
      }
    }
  }
  for (const node of graph.nodes.values()) {
    const name = node.name.toLowerCase()
    const nameTokens = name.split(/[\s.]+/).filter((t) => t.length > 1)
    let hits = 0
    for (const t of tokens) {
      if (name === t) hits += 2
      else if (nameTokens.includes(t)) hits += 1
      else if (t.length >= 4 && name.includes(t)) hits += 0.5
    }
    if (hits > 0) {
      // longer names matching are stronger seeds; hub entities are dampened
      // a little (HippoRAG divides seed weight by passage-degree)
      const damp = 1 / (1 + Math.log2(1 + node.degree))
      const w = hits * damp
      weights.set(node.id, Math.max(w, weights.get(node.id) ?? 0))
    }
  }
  return weights
}

/**
 * GRAPH-FIRST RECALL under a token budget.
 * Query → seed entities → PPR → activated memories (ids + scores + trails),
 * ranked and capped. Content resolution and the token-budget check happen in
 * the HOST (only it knows how long its memories are) — this function is pure
 * graph computation over ids.
 */
export function graphRecall(
  graph: MemoryGraph,
  query: string,
  opts: { limit?: number } = {}
): GraphRecalledMemory[] {
  const limit = opts.limit ?? 4
  const seeds = seedEntities(graph, query)
  if (seeds.size === 0) return []

  const { activation } = personalizedPageRank(graph, seeds)
  if (activation.size === 0) return []

  const scored = new Map<string, GraphRecalledMemory>()
  for (const [entityId, act] of activation) {
    const node = graph.nodes.get(entityId)
    if (!node) continue
    for (const memoryId of graph.linksByEntity.get(entityId) ?? []) {
      const existing = scored.get(memoryId)
      if (existing) {
        existing.score += act
        if (act > 0.02) existing.trail.push(node.name)
      } else {
        scored.set(memoryId, {
          id: memoryId,
          content: '',
          type: '',
          score: act,
          trail: act > 0.02 ? [node.name] : [],
          cite: 0,
        })
      }
    }
  }

  const out = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ ...r, trail: [...new Set(r.trail)].slice(0, 3) }))
  out.forEach((r, i) => (r.cite = i + 1))
  return out
}

/** Render a graph-recall block for prompt injection (compact, budgeted). */
export function formatGraphRecallBlock(recalled: GraphRecalledMemory[]): string {
  if (recalled.length === 0) return ''
  return recalled
    .map((r) => `- [${r.cite}] (${r.type}) ${r.content}${r.trail.length ? `  ⟨via ${r.trail.join(' → ')}⟩` : ''}`)
    .join('\n')
}

// ---------- rabbit hole (associative deep-dive) ----------

export interface RabbitHoleHop {
  from: string
  relation: string
  to: string
  kind: 'EXTRACTED' | 'INFERRED'
  /** memories that mention the destination entity */
  evidenceMemoryIds: string[]
}

export interface RabbitHole {
  entry: string
  hops: RabbitHoleHop[]
  /** entities visited, in visit order */
  trail: string[]
}

/**
 * Follow the brain's curiosity: from a topic entity, hop outward preferring
 * the SURPRISING edges — INFERRED relations and low-degree destinations
 * (graphify's "surprising connections" made traversable). This is the
 * brain going down a rabbit hole ON PURPOSE, but with a map.
 */
export function rabbitHole(graph: MemoryGraph, topic: string, opts: { maxHops?: number } = {}): RabbitHole | null {
  const maxHops = opts.maxHops ?? 5
  const tokens = new Set(queryTokens(topic))
  if (tokens.size === 0) return null

  // find the best-matching entry entity
  let entry: MemoryGraphNode | null = null
  let bestHits = 0
  for (const node of graph.nodes.values()) {
    const name = node.name.toLowerCase()
    let hits = 0
    for (const t of tokens) if (name.includes(t)) hits++
    if (hits > bestHits) {
      bestHits = hits
      entry = node
    }
  }
  if (!entry) return null

  const hops: RabbitHoleHop[] = []
  const visited = new Set<string>([entry.id])
  let current = entry
  for (let i = 0; i < maxHops; i++) {
    // candidate outgoing edges, scored by surprise
    const candidates = graph.edges
      .filter((e) => (e.sourceId === current.id && !visited.has(e.targetId)) || (e.targetId === current.id && !visited.has(e.sourceId)))
      .map((e) => {
        const nextId = e.sourceId === current.id ? e.targetId : e.sourceId
        const next = graph.nodes.get(nextId)!
        // surprise = inferred edges + rare destinations + typed relations
        const surprise =
          (e.kind === 'INFERRED' ? 1.4 : 0.6) +
          (next.degree <= 1 ? 0.8 : next.degree <= 3 ? 0.3 : 0) +
          (e.relation !== 'relates-to' ? 0.5 : 0)
        return { e, nextId, next, surprise }
      })
    if (candidates.length === 0) break
    candidates.sort((a, b) => b.surprise - a.surprise)
    const pick = candidates[0]
    hops.push({
      from: current.name,
      relation: pick.e.relation,
      to: pick.next.name,
      kind: pick.e.kind,
      evidenceMemoryIds: graph.linksByEntity.get(pick.nextId) ?? [],
    })
    visited.add(pick.nextId)
    current = pick.next
  }
  return { entry: entry.name, hops, trail: [entry.name, ...hops.map((h) => h.to)] }
}

/** Render a rabbit-hole exploration for the LLM / UI. */
export function renderRabbitHole(hole: RabbitHole | null, evidenceById: Map<string, string>): string {
  if (!hole) return 'No entity in memory matches that topic yet — teach the brain something about it first.'
  const lines = [`RABBIT HOLE from "${hole.entry}":`]
  for (const h of hole.hops) {
    lines.push(`  ${h.from} --${h.relation} [${h.kind}]--> ${h.to}`)
    for (const mid of h.evidenceMemoryIds.slice(0, 2)) {
      const ev = evidenceById.get(mid)
      if (ev) lines.push(`      ⌐ ${ev.slice(0, 120)}`)
    }
  }
  if (hole.hops.length === 0) lines.push('  (no connections from this entity yet)')
  return lines.join('\n')
}

// ---------- stats ----------

export function memoryGraphStats(graph: MemoryGraph): {
  entities: number
  edges: number
  extracted: number
  inferred: number
  indexedMemories: number
  hubEntities: { name: string; degree: number }[]
} {
  const hubs = [...graph.nodes.values()]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
    .map((n) => ({ name: n.name, degree: n.degree }))
  return {
    entities: graph.nodes.size,
    edges: graph.edges.length,
    extracted: graph.edges.filter((e) => e.kind === 'EXTRACTED').length,
    inferred: graph.edges.filter((e) => e.kind === 'INFERRED').length,
    indexedMemories: graph.linksByMemory.size,
    hubEntities: hubs,
  }
}
