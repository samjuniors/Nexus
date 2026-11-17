'use client'

// Client-side DTOs mirroring the API responses

export type Tab =
  | 'agent'
  | 'brain'
  | 'artifacts'
  | 'marketplace'
  | 'plugins'
  | 'skills'
  | 'tools'
  | 'mcps'
  | 'memory'

/** The four "Customize" sub-areas share a segmented switcher on mobile. */
export type CustomizeTab = 'plugins' | 'skills' | 'tools' | 'mcps'

export interface RunEventDTO {
  id: string
  seq: number
  type: string
  data: Record<string, unknown>
  createdAt: string
}

export interface RunDTO {
  id: string
  status: string
  userMessage: string
  events: RunEventDTO[]
  createdAt: string
}

export interface MessageDTO {
  id: string
  role: string
  content: string
  runId: string | null
  createdAt: string
}

export interface SuggestionDTO {
  id: string
  runId: string | null
  title: string
  description: string
  kind: string
  createdAt: string
}

export interface ConversationDTO {
  id: string
  title: string
  messages: MessageDTO[]
  runs: RunDTO[]
  suggestions: SuggestionDTO[]
  updatedAt: string
}

export interface PluginDTO {
  id: string
  slug: string
  name: string
  description: string
  category: string
  icon: string
  source: string
  installed: boolean
  enabled: boolean
  configJson: string
  toolSlug: string | null
  usageCount: number
}

export interface SkillDTO {
  id: string
  slug: string
  name: string
  description: string
  category: string
  icon: string
  enabled: boolean
  usageCount: number
}

export interface ToolDTO {
  id: string
  slug: string
  name: string
  description: string
  source: string
  enabled: boolean
  usageCount: number
}

export interface McpToolDef {
  slug: string
  name: string
  description: string
}

export interface McpDTO {
  id: string
  slug: string
  name: string
  description: string
  status: string
  mode: string
  toolsJson: string
  enabled: boolean
  usageCount: number
}

export interface MemoryDTO {
  id: string
  content: string
  type: string
  source: string
  runId: string | null
  createdAt: string
}

export interface EventOutDTO {
  seq: number
  type: string
  data: Record<string, unknown>
}

/** The start endpoint routes each message: streamed chat answer (SSE), or a
 *  full agent run. Legacy non-stream shape kept for one-shot clients. */
export type StartResponse =
  | { mode: 'task'; conversationId: string; runId: string }
  | {
      mode: 'chat'
      conversationId: string
      reply: string
      suggestions?: string[]
      recalled?: { id: string; content: string; type: string; cite: number }[]
    }

export type RecalledRefDTO = { id: string; content: string; type: string; cite: number }

/** SSE events emitted by POST /api/agent/start with { stream: true }. */
export type StartStreamEvent =
  | {
      type: 'meta'
      mode: 'chat' | 'task'
      conversationId: string
      runId?: string
      brainConnected: boolean
      recalled?: RecalledRefDTO[]
    }
  | { type: 'token'; text: string }
  | { type: 'done'; messageId: string; suggestions: string[]; recalled: RecalledRefDTO[] }
  | { type: 'error'; error: string }

// ---------- Brain ----------

export interface BrainCapabilityGroup {
  key: 'tools' | 'skills' | 'plugins' | 'mcps' | 'memory'
  label: string
  description: string
  items: { slug: string; name: string; description: string }[]
  count: number
  memoryCount?: number
}

export interface BrainInfo {
  connected: boolean
  personality: string
  since: string | null
  summary: string
  inventory: BrainCapabilityGroup[]
  appPrefs: { tone: 'concise' | 'balanced' | 'thorough'; missionVerbosity: 'brief' | 'balanced' | 'detailed'; autoDream: boolean }
  appControl: { lever: string; value: string; effect: string }[]
  lastDream: { summary: string; mergedCount: number; totalMemories: number; createdAt: string } | null
  coach?: {
    lessons: number
    avgWeight: number
    topLessons: { content: string; weight: number; timesUsed: number }[]
  }
  graphMemory?: {
    entities: number
    edges: number
    extracted: number
    inferred: number
    indexedMemories: number
    hubEntities: { name: string; degree: number }[]
  }
  cache?: {
    hits: number
    misses: number
    evictions: number
    estTokensSaved: number
    hitRate: number
    size: number
    maxEntries: number
  }
  refine?: { rewrites: number }
  llm?: {
    provider: string
    model: string | null
    configured: boolean
    fallback?: string
  }
}

// ---------- Knowledge graph ----------

export interface GraphNodeDTO {
  id: string
  label: string
  type: string
  meta?: Record<string, string | number>
}

export interface GraphEdgeDTO {
  source: string
  target: string
  relation: string
  kind: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
}

export interface GraphCommunityDTO {
  id: number
  label: string
  members: { id: string; label: string; type: string }[]
}

export interface GraphStatsDTO {
  nodes: number
  edges: number
  byType: Record<string, number>
  extracted: number
  inferred: number
  ambiguous: number
  hubs: { id: string; label: string; type: string; degree: number }[]
  communities: GraphCommunityDTO[]
  surprising: { edge: GraphEdgeDTO; reason: string }[]
}

export interface BrainGraphDTO {
  nodes: GraphNodeDTO[]
  edges: GraphEdgeDTO[]
  stats: GraphStatsDTO
}

/** graphify-style structural report derived from the knowledge graph */
export interface GraphReportDTO {
  godNodes: { id: string; label: string; type: string; degree: number }[]
  communities: GraphCommunityDTO[]
  surprising: { edge: GraphEdgeDTO; reason: string }[]
  questions: { question: string; why: string }[]
  edgeMix: { extracted: number; inferred: number; ambiguous: number }
}

export interface DreamReportDTO {
  before: number
  after: number
  mergedCount: number
  relationsFound: number
  summary: string
}

// ---------- Artifacts ----------

export interface ArtifactDTO {
  name: string
  kind: 'image' | 'audio' | 'document' | 'data' | 'text'
  mime: string
  size: number
  sizeLabel: string
  createdAt: string
  url: string
}

// ---------- Marketplace ----------

export interface SmitheryServerDTO {
  qualifiedName: string
  displayName: string
  description: string
  iconUrl: string | null
  verified: boolean
  useCount: number
  homepage: string | null
}

export interface NpmPackageDTO {
  name: string
  description: string
  version: string
  keywords: string[]
  downloads: number
  isMcp: boolean
}

export interface GithubRepoDTO {
  owner: string
  name: string
  branch: string
  url: string
  description: string
}

export interface GithubResolutionDTO {
  repo: GithubRepoDTO
  found: { type: 'plugin' | 'skill' | 'mcp'; path: string; payload: Record<string, unknown> }[]
  fallback: { type: 'skill' | 'mcp'; payload: Record<string, unknown>; reason: string } | null
}

export interface FetchUrlResolutionDTO {
  type: 'plugin' | 'skill' | 'mcp'
  payload: Record<string, unknown>
}

// ---------- GBRAIN graph (interactive memory graph) ----------

export interface GBrainNodeDTO {
  id: string
  name: string
  variants: string[]
  origin: 'auto' | 'manual'
  degree: number
  memoryCount: number
  createdAt: string
}

export interface GBrainEdgeDTO {
  id: string
  sourceId: string
  targetId: string
  relation: string
  kind: string
  weight: number
}

export interface GBrainGraphDTO {
  nodes: GBrainNodeDTO[]
  edges: GBrainEdgeDTO[]
  stats: { nodes: number; edges: number; extracted: number; inferred: number; manual: number; auto: number; orphaned: number }
}

export interface GBrainNodeDetailDTO {
  entity: GBrainNodeDTO & { id: string; name: string; variants: string[]; origin: 'auto' | 'manual'; createdAt: string }
  neighbors: { id: string; name: string }[]
  edges: { sourceId: string; targetId: string; relation: string; kind: string; weight: number }[]
  memories: {
    id: string
    type: string
    truth: string | null
    content: string
    alwaysLoad: boolean
    trust: number
    accessCount: number
    recentQueries: string[]
  }[]
}

export interface CatalogDTO {
  plugins: PluginDTO[]
  skills: { slug: string; name: string; description: string; category: string; icon: string; prompt: string }[]
}

// ---------- API helpers ----------

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = (await res.json()) as T & { ok?: boolean; error?: string }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }
  return data
}

export const api = {
  conversations: () => jsonFetch<{ conversations: ConversationDTO[] }>('/api/conversations'),
  createConversation: () => jsonFetch<{ conversation: ConversationDTO }>('/api/conversations', { method: 'POST' }),
  deleteConversation: (id: string) => jsonFetch<{ ok: boolean }>(`/api/conversations?id=${id}`, { method: 'DELETE' }),

  brain: () =>
    jsonFetch<{
      status: {
        connected: boolean
        personality: string
        since: string | null
        appPrefs: BrainInfo['appPrefs']
      }
      summary: string
      inventory: BrainCapabilityGroup[]
      appControl: BrainInfo['appControl']
      lastDream: BrainInfo['lastDream']
      coach: BrainInfo['coach']
      graphMemory: BrainInfo['graphMemory']
      cache: BrainInfo['cache']
      refine: BrainInfo['refine']
      llm?: BrainInfo['llm']
    }>('/api/brain'),
  brainGraph: () =>
    jsonFetch<{ graph: BrainGraphDTO; report: GraphReportDTO }>('/api/brain?graph=1'),
  gbrainGraph: () => jsonFetch<GBrainGraphDTO>('/api/brain/graph'),
  gbrainGraphAction: (action: 'inspect' | 'create' | 'remove' | 'rename' | 'alias' | 'prune', extra?: { nodeId?: string; name?: string; note?: string; alias?: string }) =>
    jsonFetch<
      (GBrainNodeDetailDTO & { removed?: { unlinked: number; edges: number } }) | { kind: string; entity?: GBrainNodeDTO; hint?: string; via?: string } | { pruned: number }
    >('/api/brain/graph', {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    }),
  brainToggle: (action: 'connect' | 'disconnect' | 'dream' | 'coach' | 'backfill' | 'teach', extra?: { fact?: string }) =>
    jsonFetch<{ ok: boolean; status: { connected: boolean; personality: string; since: string | null }; dream?: DreamReportDTO; review?: { lessons: number; summary: string }; taught?: { content: string; entities: number }; backfill?: { indexed: number } }>('/api/brain', {
      method: 'POST',
      body: JSON.stringify({ action, ...extra }),
    }),
  brainPrefs: (prefs: Partial<BrainInfo['appPrefs']>) =>
    jsonFetch<{
      ok: boolean
      status: { connected: boolean; personality: string; since: string | null; appPrefs: BrainInfo['appPrefs'] }
      appControl: BrainInfo['appControl']
    }>('/api/brain', {
      method: 'POST',
      body: JSON.stringify({ action: 'prefs', prefs }),
    }),

  artifacts: () => jsonFetch<{ artifacts: ArtifactDTO[] }>('/api/files?list=1'),
  deleteArtifact: (name: string) =>
    jsonFetch<{ ok: boolean }>(`/api/files?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),

  plugins: () => jsonFetch<{ plugins: PluginDTO[] }>('/api/plugins'),
  patchPlugin: (id: string, data: { installed?: boolean; enabled?: boolean }) =>
    jsonFetch<{ plugin: PluginDTO }>('/api/plugins', { method: 'PATCH', body: JSON.stringify({ id, ...data }) }),
  installCustomPlugin: (payload: unknown) =>
    jsonFetch<{ plugin: PluginDTO }>('/api/plugins', { method: 'POST', body: JSON.stringify(payload) }),
  deletePlugin: (id: string) => jsonFetch<{ ok: boolean }>(`/api/plugins?id=${id}`, { method: 'DELETE' }),

  skills: () => jsonFetch<{ skills: SkillDTO[] }>('/api/skills'),
  patchSkill: (id: string, enabled: boolean) =>
    jsonFetch<{ skill: SkillDTO }>('/api/skills', { method: 'PATCH', body: JSON.stringify({ id, enabled }) }),
  createSkill: (payload: { name: string; description: string; prompt: string; category?: string; icon?: string }) =>
    jsonFetch<{ skill: SkillDTO }>('/api/skills', { method: 'POST', body: JSON.stringify(payload) }),
  restoreDefaultSkills: () =>
    jsonFetch<{ restored: number; skills: SkillDTO[] }>('/api/skills', {
      method: 'POST',
      body: JSON.stringify({ restoreDefaults: true }),
    }),
  deleteSkill: (id: string) => jsonFetch<{ ok: boolean }>(`/api/skills?id=${id}`, { method: 'DELETE' }),

  tools: () => jsonFetch<{ tools: ToolDTO[] }>('/api/tools'),
  patchTool: (id: string, enabled: boolean) =>
    jsonFetch<{ tool: ToolDTO }>('/api/tools', { method: 'PATCH', body: JSON.stringify({ id, enabled }) }),
  deleteTool: (id: string) => jsonFetch<{ ok: boolean }>(`/api/tools?id=${id}`, { method: 'DELETE' }),

  mcps: () => jsonFetch<{ servers: McpDTO[] }>('/api/mcps'),
  patchMcp: (id: string, data: { enabled?: boolean; status?: string }) =>
    jsonFetch<{ server: McpDTO }>('/api/mcps', { method: 'PATCH', body: JSON.stringify({ id, ...data }) }),
  addCustomMcp: (payload: unknown) =>
    jsonFetch<{ server: McpDTO }>('/api/mcps', { method: 'POST', body: JSON.stringify(payload) }),
  deleteMcp: (id: string) => jsonFetch<{ ok: boolean }>(`/api/mcps?id=${id}`, { method: 'DELETE' }),

  // ---------- Marketplace ----------
  marketplaceCatalog: () => jsonFetch<CatalogDTO>('/api/marketplace?action=catalog'),
  marketplaceSmithery: (query: string) =>
    jsonFetch<{ servers: SmitheryServerDTO[]; total: number }>(
      `/api/marketplace?action=smithery&query=${encodeURIComponent(query)}`
    ),
  marketplaceNpm: (query: string) =>
    jsonFetch<{ packages: NpmPackageDTO[] }>(`/api/marketplace?action=npm&query=${encodeURIComponent(query)}`),
  marketplaceGithub: (url: string) =>
    jsonFetch<GithubResolutionDTO>(`/api/marketplace?action=github&url=${encodeURIComponent(url)}`),
  marketplaceFetchUrl: (url: string) =>
    jsonFetch<FetchUrlResolutionDTO>(`/api/marketplace?action=fetch-url&url=${encodeURIComponent(url)}`),
  marketplaceInstall: (payload: {
    type: 'plugin' | 'skill' | 'mcp' | 'smithery' | 'npm'
    payload?: unknown
    origin?: Record<string, unknown>
  }) => jsonFetch<{ ok: boolean; kind: string }>('/api/marketplace', { method: 'POST', body: JSON.stringify(payload) }),

  memories: () => jsonFetch<{ memories: MemoryDTO[] }>('/api/memories'),
  addMemory: (content: string, type: string) =>
    jsonFetch<{ memory: MemoryDTO }>('/api/memories', { method: 'POST', body: JSON.stringify({ content, type }) }),
  deleteMemory: (id: string) => jsonFetch<{ ok: boolean }>(`/api/memories?id=${id}`, { method: 'DELETE' }),
  clearMemories: () => jsonFetch<{ ok: boolean }>('/api/memories?all=true', { method: 'DELETE' }),

  startRun: (conversationId: string | null, message: string) =>
    jsonFetch<StartResponse>('/api/agent/start', {
      method: 'POST',
      body: JSON.stringify({ conversationId, message }),
    }),
  /** Streaming front door — the chat answer arrives token by token (typing feel). */
  startRunStream: async (
    conversationId: string | null,
    message: string,
    handlers: {
      onEvent: (ev: StartStreamEvent) => void
    }
  ): Promise<void> => {
    const res = await fetch('/api/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message, stream: true }),
    })
    if (!res.ok || !res.body) {
      let error = `Request failed (${res.status})`
      try {
        const data = (await res.json()) as { error?: string }
        if (data.error) error = data.error
      } catch {
        /* keep status error */
      }
      throw new Error(error)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? '' // keep the partial event for the next chunk
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        let ev: StartStreamEvent
        try {
          ev = JSON.parse(line.slice(6)) as StartStreamEvent
        } catch {
          // partial JSON — ignore
          continue
        }
        handlers.onEvent(ev)
      }
    }
    if (buffer.trim()) {
      const line = buffer.split('\n').find((l) => l.startsWith('data: '))
      if (line) {
        let ev: StartStreamEvent | null = null
        try {
          ev = JSON.parse(line.slice(6)) as StartStreamEvent
        } catch {
          ev = null
        }
        if (ev) handlers.onEvent(ev)
      }
    }
  },
  stepRun: async (runId: string) => {
    const res = await fetch('/api/agent/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    })
    const data = (await res.json().catch(() => null)) as {
      ok: boolean
      busy?: boolean
      status: string
      events: EventOutDTO[]
      error?: string
    } | null
    if (data && typeof data.status === 'string') return data
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  },
  stopRun: (runId: string) =>
    jsonFetch<{ ok: boolean }>('/api/agent/stop', { method: 'POST', body: JSON.stringify({ runId }) }),
}
