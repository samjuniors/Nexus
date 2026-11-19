/**
 * PORTABLE BRAIN SNAPSHOTS — zero app-specific imports.
 *
 * Exports and validates a self-contained JSON bundle of everything that makes
 * a NEXUS Brain portable across projects: persona preferences, learned facts,
 * entity graph relations, skills, and project architecture truths.
 */

export interface PortableMemoryRecord {
  content: string
  type: string
  kind: string
  importance: number
  alwaysLoad?: boolean
  truth?: string | null
  createdAt?: string
}

export interface PortableSkillRecord {
  slug: string
  name: string
  description: string
  category: string
  prompt: string
}

export interface PortableEntityEdge {
  source: string
  target: string
  relation: string
  kind: string
}

export interface PortableBrainBundle {
  format: 'nexus-portable-brain/v1'
  exportedAt: string
  personality: string
  appPrefs: {
    tone: 'concise' | 'balanced' | 'thorough'
    missionVerbosity: 'brief' | 'balanced' | 'detailed'
    autoDream: boolean
  }
  memories: PortableMemoryRecord[]
  entities: { name: string; variants: string[]; origin: string }[]
  edges: PortableEntityEdge[]
  skills: PortableSkillRecord[]
}

export function createPortableBundle(input: Omit<PortableBrainBundle, 'format' | 'exportedAt'>): PortableBrainBundle {
  return {
    format: 'nexus-portable-brain/v1',
    exportedAt: new Date().toISOString(),
    personality: input.personality || 'NEXUS',
    appPrefs: input.appPrefs,
    memories: input.memories.slice(0, 500),
    entities: input.entities.slice(0, 400),
    edges: input.edges.slice(0, 1000),
    skills: input.skills.slice(0, 100),
  }
}

export function parsePortableBundle(raw: unknown): PortableBrainBundle | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<PortableBrainBundle>
  if (r.format !== 'nexus-portable-brain/v1') return null
  if (!Array.isArray(r.memories)) return null
  return {
    format: 'nexus-portable-brain/v1',
    exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : new Date().toISOString(),
    personality: typeof r.personality === 'string' ? r.personality : 'NEXUS',
    appPrefs: {
      tone: r.appPrefs?.tone === 'concise' || r.appPrefs?.tone === 'thorough' ? r.appPrefs.tone : 'balanced',
      missionVerbosity:
        r.appPrefs?.missionVerbosity === 'brief' || r.appPrefs?.missionVerbosity === 'detailed'
          ? r.appPrefs.missionVerbosity
          : 'balanced',
      autoDream: typeof r.appPrefs?.autoDream === 'boolean' ? r.appPrefs.autoDream : true,
    },
    memories: r.memories.filter(
      (m): m is PortableMemoryRecord => Boolean(m && typeof m.content === 'string' && m.content.trim())
    ),
    entities: Array.isArray(r.entities) ? r.entities : [],
    edges: Array.isArray(r.edges) ? r.edges : [],
    skills: Array.isArray(r.skills) ? r.skills : [],
  }
}
