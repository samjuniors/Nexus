export type GBrainCategoryId =
  | 'agents'
  | 'projects'
  | 'tools'
  | 'concepts'
  | 'people'
  | 'facts'

export interface GBrainCategoryMeta {
  id: GBrainCategoryId
  label: string
  shortLabel: string
  description: string
  accent: string
  stroke: string
  tint: string
  textClass: string
}

export const GBRAIN_CATEGORIES: readonly GBrainCategoryMeta[] = [
  {
    id: 'agents',
    label: 'Agents & Team',
    shortLabel: 'Agents',
    description: 'Eva, AI employees, bots, and autonomous roles',
    accent: '#38bdf8',
    stroke: '#0284c7',
    tint: 'rgba(56, 189, 248, 0.08)',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
  {
    id: 'projects',
    label: 'Projects & Systems',
    shortLabel: 'Projects',
    description: 'Apps, repositories, modules, and architecture nodes',
    accent: '#34d399',
    stroke: '#059669',
    tint: 'rgba(52, 211, 153, 0.08)',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'tools',
    label: 'Tools & Skills',
    shortLabel: 'Tools',
    description: 'Capabilities, skills, plugins, MCPs, and automations',
    accent: '#f59e0b',
    stroke: '#d97706',
    tint: 'rgba(245, 158, 11, 0.08)',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    id: 'concepts',
    label: 'Concepts & Tech',
    shortLabel: 'Concepts',
    description: 'Frameworks, protocols, patterns, and domain ideas',
    accent: '#a78bfa',
    stroke: '#7c3aed',
    tint: 'rgba(167, 139, 250, 0.08)',
    textClass: 'text-violet-600 dark:text-violet-400',
  },
  {
    id: 'people',
    label: 'People & Orgs',
    shortLabel: 'People',
    description: 'Stakeholders, users, teams, and organizations',
    accent: '#fb7185',
    stroke: '#e11d48',
    tint: 'rgba(251, 113, 133, 0.08)',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
  {
    id: 'facts',
    label: 'Facts & Decisions',
    shortLabel: 'Facts',
    description: 'Verified truths, preferences, rules, and lessons',
    accent: '#22d3ee',
    stroke: '#0891b2',
    tint: 'rgba(34, 211, 238, 0.08)',
    textClass: 'text-cyan-600 dark:text-cyan-400',
  },
] as const

export const GBRAIN_CATEGORY_MAP: Record<GBrainCategoryId, GBrainCategoryMeta> =
  GBRAIN_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat.id] = cat
      return acc
    },
    {} as Record<GBrainCategoryId, GBrainCategoryMeta>
  )

export const CATEGORY_TAG_PREFIX = 'cat:'

export function isValidCategory(value: unknown): value is GBrainCategoryId {
  return (
    value === 'agents' ||
    value === 'projects' ||
    value === 'tools' ||
    value === 'concepts' ||
    value === 'people' ||
    value === 'facts'
  )
}

export function extractCategoryTag(variants: string[]): GBrainCategoryId | null {
  for (const v of variants) {
    if (v.startsWith(CATEGORY_TAG_PREFIX)) {
      const raw = v.slice(CATEGORY_TAG_PREFIX.length).trim()
      if (isValidCategory(raw)) return raw
    }
  }
  return null
}

/** Filters out internal `cat:*` tags when showing human aliases in the UI. */
export function visibleAliases(variants: string[]): string[] {
  return variants.filter((v) => !v.startsWith(CATEGORY_TAG_PREFIX))
}

/**
 * Deterministic semantic categorization for GBrain entities.
 * Respects explicit `cat:<id>` variant tags first, then infers cleanly from name & aliases.
 */
export function classifyGBrainEntity(name: string, variants: string[] = []): GBrainCategoryId {
  const tagged = extractCategoryTag(variants)
  if (tagged) return tagged

  const text = `${name} ${variants.join(' ')}`.toLowerCase()

  // Explicit platform/project/system entities (e.g. "Nexus Agent OS", "GBrain Graph") take precedence
  if (
    /\b(os|platform|workspace|project|repository|repo|gbrain|pipeline|dashboard|database|schema|module|service|system|nexus|app|frontend|backend)\b/.test(
      text
    ) &&
    !/\b(eva lead|ai employee|subagent|engineer|researcher|auditor|architect|analyst)\b/.test(text)
  ) {
    return 'projects'
  }

  if (
    /\b(eva|agent|bot|subagent|engineer|researcher|auditor|architect|analyst|assistant|coucou|mochi|lead agent|ai employee|director|specialist)\b/.test(
      text
    )
  ) {
    return 'agents'
  }

  if (
    /\b(rule|decision|preference|fact|policy|truth|lesson|goal|requirement|constraint|adr|prd|verification|memory|note|insight)\b/.test(
      text
    ) &&
    !/\b(vault|tool|skill|plugin|runner)\b/.test(text)
  ) {
    return 'facts'
  }

  if (
    /\b(tool|skill|plugin|mcp|automation|trigger|workflow|browser|playwright|search|email|inbox|voice|calendar|webhook|cron|runner|vault|permission|device)\b/.test(
      text
    )
  ) {
    return 'tools'
  }

  if (/\b(api|route|server|graph)\b/.test(text)) {
    return 'projects'
  }

  if (
    /\b(user|team|org|organization|company|client|founder|owner|manager|member|department|human|customer|person)\b/.test(
      text
    )
  ) {
    return 'people'
  }

  return 'concepts'
}
