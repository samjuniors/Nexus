/**
 * KNOWLEDGE GRAPH — graphify-inspired.
 *
 * Turns everything the app knows into a traversable graph — deterministically,
 * with zero LLM calls (graphify's core insight: parse structure locally,
 * explain every edge). Nodes are capabilities, memories, conversations, runs
 * and artifacts.
 *
 * Graphify concepts implemented here:
 * - edge provenance: every edge is tagged EXTRACTED (came straight from app
 *   data), INFERRED (resolved from strong co-occurrence) or AMBIGUOUS (weak
 *   overlap — plausible but unverified)
 * - heterogeneous node types (tools, skills, memories, runs, artifacts…)
 * - god nodes: hub detection via degree centrality
 * - community detection: label propagation clusters related memories
 * - surprising connections: edges that bridge otherwise separate communities
 * - suggested questions: what to ask next, derived from graph structure
 */

export type GraphNodeType =
  | 'brain'
  | 'tool'
  | 'skill'
  | 'plugin'
  | 'mcp'
  | 'memory'
  | 'conversation'
  | 'run'
  | 'artifact'

export interface GraphNode {
  id: string
  label: string
  type: GraphNodeType
  meta?: Record<string, string | number>
}

/** graphify's transparency model: how do we know this edge exists? */
export type EdgeKind = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'

export interface GraphEdge {
  source: string
  target: string
  relation: string
  kind: EdgeKind
}

export interface GraphCommunity {
  id: number
  label: string
  members: { id: string; label: string; type: GraphNodeType }[]
}

export interface SurprisingConnection {
  edge: GraphEdge
  reason: string
}

export interface GraphQuestion {
  question: string
  why: string
}

export interface BrainGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphStats
}

export interface GraphStats {
  nodes: number
  edges: number
  byType: Record<string, number>
  extracted: number
  inferred: number
  ambiguous: number
  hubs: { id: string; label: string; type: GraphNodeType; degree: number }[]
  communities: GraphCommunity[]
  surprising: SurprisingConnection[]
}

/** Raw records the host app supplies — the graph is built from these, deterministically. */
export interface GraphSource {
  tools: { slug: string; name: string; source: string }[]
  skills: { slug: string; name: string }[]
  plugins: { slug: string; name: string; installed: boolean; toolSlug: string | null }[]
  mcps: { slug: string; name: string; tools: { slug: string }[] }[]
  memories: { id: string; content: string; type: string; runId: string | null }[]
  conversations: { id: string; title: string }[]
  runs: {
    id: string
    conversationId: string
    usedTools: string[]
    producedFiles: string[]
  }[]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3)
  )
}

/** Keyword overlap between two token sets — used for INFERRED vs AMBIGUOUS. */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * Community detection — deterministic label propagation.
 * Each node starts in its own community; nodes adopt the community most
 * common among their neighbors, iterated to convergence (bounded passes).
 * Nodes are processed in stable id order so results are reproducible.
 */
function detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): GraphCommunity[] {
  const adjacency = new Map<string, Set<string>>()
  for (const e of edges) {
    if (e.kind === 'EXTRACTED') continue // structural edges don't cluster memories; inferred/ambiguous do
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set())
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set())
    adjacency.get(e.source)!.add(e.target)
    adjacency.get(e.target)!.add(e.source)
  }

  const ids = [...adjacency.keys()].sort()
  if (ids.length === 0) return []
  const label = new Map<string, number>()
  ids.forEach((id, i) => label.set(id, i))

  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (const id of ids) {
      const counts = new Map<number, number>()
      for (const nb of adjacency.get(id) ?? []) {
        const l = label.get(nb)
        if (l !== undefined) counts.set(l, (counts.get(l) ?? 0) + 1)
      }
      if (counts.size === 0) continue
      let best = label.get(id)!
      let bestCount = -1
      for (const [l, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
        if (c > bestCount) {
          best = l
          bestCount = c
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best)
        changed = true
      }
    }
    if (!changed) break
  }

  const byLabel = new Map<number, GraphCommunity>()
  for (const id of ids) {
    const l = label.get(id)!
    if (!byLabel.has(l)) byLabel.set(l, { id: l, label: '', members: [] })
    const node = nodes.find((n) => n.id === id)
    if (node) byLabel.get(l)!.members.push({ id, label: node.label, type: node.type })
  }

  const communities = [...byLabel.values()].filter((c) => c.members.length >= 2)
  for (const c of communities) {
    // name the community after its most connected member (the local hub)
    c.label = c.members[0].label.slice(0, 32)
  }
  return communities.sort((a, b) => b.members.length - a.members.length).slice(0, 6)
}

/** Edges that bridge two different communities — graphify's "surprising connections". */
function findSurprisingConnections(
  nodes: GraphNode[],
  edges: GraphEdge[],
  communities: GraphCommunity[]
): SurprisingConnection[] {
  if (communities.length < 2) return []
  const communityOf = new Map<string, number>()
  for (const c of communities) for (const m of c.members) communityOf.set(m.id, c.id)

  const out: SurprisingConnection[] = []
  for (const e of edges) {
    const ca = communityOf.get(e.source)
    const cb = communityOf.get(e.target)
    if (ca === undefined || cb === undefined || ca === cb) continue
    const na = nodes.find((n) => n.id === e.source)
    const nb = nodes.find((n) => n.id === e.target)
    if (!na || !nb) continue
    out.push({
      edge: e,
      reason: `"${na.label}" and "${nb.label}" live in different knowledge clusters but share ${e.relation}`,
    })
  }
  return out.slice(0, 5)
}

/** Suggested questions derived from graph structure (graphify's report questions). */
function suggestQuestions(graph: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphStats
}): GraphQuestion[] {
  const out: GraphQuestion[] = []

  // from god nodes: what is the hub connected to?
  for (const hub of graph.stats.hubs.slice(0, 2)) {
    if (hub.type === 'memory' || hub.type === 'tool' || hub.type === 'skill') {
      out.push({
        question: `What is connected to "${hub.label}" in my knowledge graph?`,
        why: `"${hub.label}" is a god node — ${hub.degree} links, the most connected ${hub.type}`,
      })
    }
  }

  // from surprising connections: how do these relate?
  for (const s of graph.stats.surprising.slice(0, 2)) {
    const na = graph.nodes.find((n) => n.id === s.edge.source)
    const nb = graph.nodes.find((n) => n.id === s.edge.target)
    if (na && nb) {
      out.push({
        question: `How does "${na.label}" relate to "${nb.label}"?`,
        why: 'surprising connection between different knowledge clusters',
      })
    }
  }

  // from communities: what does this cluster know?
  for (const c of graph.stats.communities.slice(0, 1)) {
    if (c.members.length >= 3) {
      out.push({
        question: `What do you remember about ${c.label}?`,
        why: `largest memory cluster — ${c.members.length} related memories`,
      })
    }
  }

  return out.slice(0, 4)
}

/** Build the full knowledge graph from raw app data. Deterministic, no LLM. */
export function buildGraph(src: GraphSource): BrainGraph {
  const nodes: GraphNode[] = [{ id: 'brain', label: 'NEXUS Brain', type: 'brain' }]
  const edges: GraphEdge[] = []

  const addNode = (n: GraphNode) => {
    if (!nodes.some((x) => x.id === n.id)) nodes.push(n)
  }
  const addEdge = (source: string, target: string, relation: string, kind: EdgeKind) => {
    if (source === target) return
    if (!edges.some((e) => e.source === source && e.target === target && e.relation === relation)) {
      edges.push({ source, target, relation, kind })
    }
  }

  // ---- capabilities (EXTRACTED from the registry) ----
  for (const t of src.tools) {
    addNode({ id: `tool:${t.slug}`, label: t.name, type: 'tool', meta: { slug: t.slug } })
    addEdge('brain', `tool:${t.slug}`, 'reaches', 'EXTRACTED')
    if (t.source.startsWith('plugin:')) {
      const pluginSlug = t.source.slice(7)
      addNodeIf(src.plugins, pluginSlug, nodes)
      addEdge(`plugin:${pluginSlug}`, `tool:${t.slug}`, 'provides', 'EXTRACTED')
    }
  }
  for (const s of src.skills) {
    addNode({ id: `skill:${s.slug}`, label: s.name, type: 'skill', meta: { slug: s.slug } })
    addEdge('brain', `skill:${s.slug}`, 'knows', 'EXTRACTED')
  }
  for (const p of src.plugins) {
    addNode({ id: `plugin:${p.slug}`, label: p.name, type: 'plugin', meta: { installed: p.installed ? 1 : 0 } })
    addEdge('brain', `plugin:${p.slug}`, 'extended-by', 'EXTRACTED')
  }
  for (const m of src.mcps) {
    addNode({ id: `mcp:${m.slug}`, label: m.name, type: 'mcp' })
    addEdge('brain', `mcp:${m.slug}`, 'connected-to', 'EXTRACTED')
    for (const t of m.tools) {
      addNode({ id: `tool:${t.slug}`, label: t.slug, type: 'tool' })
      addEdge(`mcp:${m.slug}`, `tool:${t.slug}`, 'provides', 'EXTRACTED')
    }
  }

  // ---- conversations & runs (EXTRACTED from history) ----
  for (const c of src.conversations) {
    addNode({ id: `conv:${c.id}`, label: c.title.slice(0, 40), type: 'conversation' })
  }
  for (const r of src.runs) {
    addNode({ id: `run:${r.id}`, label: `run ${r.id.slice(-4)}`, type: 'run' })
    addEdge(`conv:${r.conversationId}`, `run:${r.id}`, 'triggered', 'EXTRACTED')
    for (const toolSlug of r.usedTools) {
      if (nodes.some((n) => n.id === `tool:${toolSlug}`)) {
        addEdge(`run:${r.id}`, `tool:${toolSlug}`, 'used', 'EXTRACTED')
      }
    }
    for (const f of r.producedFiles) {
      const id = `artifact:${f}`
      addNode({ id, label: f, type: 'artifact' })
      addEdge(`run:${r.id}`, id, 'produced', 'EXTRACTED')
    }
  }

  // ---- memories (EXTRACTED links to runs; INFERRED/AMBIGUOUS memory↔memory) ----
  for (const m of src.memories) {
    addNode({ id: `mem:${m.id}`, label: m.content.slice(0, 40), type: 'memory', meta: { type: m.type } })
    if (m.runId) {
      if (nodes.some((n) => n.id === `run:${m.runId}`)) {
        addEdge(`run:${m.runId}`, `mem:${m.id}`, 'remembered', 'EXTRACTED')
      }
    } else {
      addEdge('brain', `mem:${m.id}`, 'remembers', 'EXTRACTED')
    }
  }

  // INFERRED (strong overlap ≥ 0.3) vs AMBIGUOUS (weak overlap 0.18–0.3):
  // graphify tags every edge with how confident it is
  const memTokens = src.memories.map((m) => ({ m, tk: tokens(m.content) }))
  for (let i = 0; i < memTokens.length; i++) {
    for (let j = i + 1; j < memTokens.length; j++) {
      const a = memTokens[i]
      const b = memTokens[j]
      if (a.tk.size === 0 || b.tk.size === 0) continue
      let shared = 0
      for (const t of a.tk) if (b.tk.has(t)) shared++
      const overlap = shared / Math.min(a.tk.size, b.tk.size)
      if (overlap >= 0.3 && shared >= 2) {
        addEdge(`mem:${a.m.id}`, `mem:${b.m.id}`, 'relates-to', 'INFERRED')
      } else if (overlap >= 0.18 && shared >= 2) {
        addEdge(`mem:${a.m.id}`, `mem:${b.m.id}`, 'relates-to', 'AMBIGUOUS')
      }
    }
  }

  // ---- stats ----
  const byType: Record<string, number> = {}
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  const hubs = [...degree.entries()]
    .map(([id, d]) => {
      const node = nodes.find((n) => n.id === id)
      return node ? { id, label: node.label, type: node.type, degree: d } : null
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)

  const communities = detectCommunities(nodes, edges)
  const surprising = findSurprisingConnections(nodes, edges, communities)

  const stats: GraphStats = {
    nodes: nodes.length,
    edges: edges.length,
    byType,
    extracted: edges.filter((e) => e.kind === 'EXTRACTED').length,
    inferred: edges.filter((e) => e.kind === 'INFERRED').length,
    ambiguous: edges.filter((e) => e.kind === 'AMBIGUOUS').length,
    hubs,
    communities,
    surprising,
  }

  return { nodes, edges, stats }
}

function addNodeIf(plugins: GraphSource['plugins'], slug: string, nodes: GraphNode[]) {
  const p = plugins.find((x) => x.slug === slug)
  if (p && !nodes.some((n) => n.id === `plugin:${slug}`)) {
    nodes.push({ id: `plugin:${slug}`, label: p.name, type: 'plugin' })
  }
}

// ---------- queries ----------

export interface NeighborQueryResult {
  center: GraphNode
  neighbors: { node: GraphNode; relation: string; kind: EdgeKind; direction: 'out' | 'in' }[]
}

function findNode(graph: BrainGraph, name: string): GraphNode | null {
  const q = norm(name)
  if (!q) return null
  return (
    graph.nodes.find((n) => n.id === name || norm(n.label) === q) ??
    graph.nodes.find((n) => norm(n.label).includes(q) && q.length >= 3) ??
    null
  )
}

/** What is directly connected to a concept? */
export function queryNeighbors(graph: BrainGraph, name: string): NeighborQueryResult | null {
  const center = findNode(graph, name)
  if (!center) return null
  const neighbors: NeighborQueryResult['neighbors'] = []
  for (const e of graph.edges) {
    if (e.source === center.id) {
      const node = graph.nodes.find((n) => n.id === e.target)
      if (node) neighbors.push({ node, relation: e.relation, kind: e.kind, direction: 'out' })
    } else if (e.target === center.id) {
      const node = graph.nodes.find((n) => n.id === e.source)
      if (node) neighbors.push({ node, relation: e.relation, kind: e.kind, direction: 'in' })
    }
  }
  return { center, neighbors: neighbors.slice(0, 24) }
}

/** Shortest path between two concepts (BFS over undirected edges). */
export function queryPath(graph: BrainGraph, from: string, to: string): { found: boolean; path: { node: GraphNode; relation?: string }[] } {
  const a = findNode(graph, from)
  const b = findNode(graph, to)
  if (!a || !b) return { found: false, path: [] }

  const adjacency = new Map<string, { id: string; relation: string }[]>()
  for (const e of graph.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    if (!adjacency.has(e.target)) adjacency.set(e.target, [])
    adjacency.get(e.source)!.push({ id: e.target, relation: e.relation })
    adjacency.get(e.target)!.push({ id: e.source, relation: e.relation })
  }

  const prev = new Map<string, { id: string; relation: string }>()
  const visited = new Set([a.id])
  const queue = [a.id]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === b.id) break
    for (const next of adjacency.get(cur) ?? []) {
      if (visited.has(next.id)) continue
      visited.add(next.id)
      prev.set(next.id, { id: cur, relation: next.relation })
      queue.push(next.id)
    }
  }
  if (!visited.has(b.id)) return { found: false, path: [] }

  // reconstruct
  const chain: { node: GraphNode; relation?: string }[] = []
  let cur: string | undefined = b.id
  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id)
  while (cur && cur !== a.id) {
    const p = prev.get(cur)
    const node = nodeById(cur)
    if (node) chain.unshift({ node, relation: p?.relation })
    cur = p?.id
  }
  const aNode = nodeById(a.id)
  if (aNode) chain.unshift({ node: aNode })
  return { found: true, path: chain }
}

/** Render a query result as text for the LLM (used by the graph_query tool). */
export function renderQueryResult(graph: BrainGraph, mode: string, target: string, target2?: string): string {
  const s = graph.stats
  if (mode === 'stats') {
    return [
      `KNOWLEDGE GRAPH STATS`,
      `- nodes: ${s.nodes} (${Object.entries(s.byType).map(([t, c]) => `${t}: ${c}`).join(', ')})`,
      `- edges: ${s.edges} (${s.extracted} EXTRACTED, ${s.inferred} INFERRED, ${s.ambiguous} AMBIGUOUS)`,
      `- most connected: ${s.hubs.map((h) => `${h.label} (${h.type}, ${h.degree} links)`).join('; ') || 'none'}`,
      `- memory clusters: ${s.communities.map((c) => `${c.label} (${c.members.length})`).join('; ') || 'none'}`,
    ].join('\n')
  }
  if (mode === 'path' && target && target2) {
    const r = queryPath(graph, target, target2)
    if (!r.found) return `No path found between "${target}" and "${target2}" in the knowledge graph.`
    return [
      `PATH: ${r.path.map((p) => p.node.label).join(' → ')}`,
      ...r.path.slice(1).map((p, i) => `  ${r.path[i].node.label} --${p.relation ?? '→'}--> ${p.node.label}`),
    ].join('\n')
  }
  // neighbors (default)
  const r = queryNeighbors(graph, target)
  if (!r) {
    const s2 = renderQueryResult(graph, 'stats', '')
    return `Concept "${target}" not found in the knowledge graph. Try one of the hub concepts below.\n\n${s2}`
  }
  const lines = [
    `CONCEPT: ${r.center.label} (${r.center.type})`,
    ...r.neighbors.map(
      (n) => `- ${n.direction === 'out' ? '→' : '←'} ${n.node.label} (${n.node.type}) [${n.relation}, ${n.kind}]`
    ),
  ]
  if (r.neighbors.length === 0) lines.push('(no connections)')
  return lines.join('\n')
}

/**
 * GRAPH REPORT — graphify's GRAPH_REPORT.md equivalent: the structural
 * findings a human (or the agent itself) should look at next.
 */
export function buildGraphReport(graph: BrainGraph): {
  godNodes: GraphStats['hubs']
  communities: GraphCommunity[]
  surprising: SurprisingConnection[]
  questions: GraphQuestion[]
  edgeMix: { extracted: number; inferred: number; ambiguous: number }
} {
  return {
    godNodes: graph.stats.hubs,
    communities: graph.stats.communities,
    surprising: graph.stats.surprising,
    questions: suggestQuestions(graph),
    edgeMix: {
      extracted: graph.stats.extracted,
      inferred: graph.stats.inferred,
      ambiguous: graph.stats.ambiguous,
    },
  }
}
