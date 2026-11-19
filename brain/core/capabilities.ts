import type { BrainCapabilitySet } from '../types'

/**
 * CAPABILITY REGISTRY — the brain's map of the host body.
 *
 * The brain never owns tools, skills, plugins or MCP servers — the body
 * does. This module builds an inventory of what is currently reachable
 * through the BrainHost adapter, so the brain (and the Brain tab UI)
 * can show exactly what the brain can drive right now.
 */

export interface CapabilityGroup {
  key: 'tools' | 'skills' | 'plugins' | 'mcps' | 'memory'
  label: string
  description: string
  items: { slug: string; name: string; description: string }[]
  count: number
  memoryCount?: number
}

export function buildInventory(caps: BrainCapabilitySet): CapabilityGroup[] {
  return [
    {
      key: 'tools',
      label: 'Tools',
      description: 'Executable actions the brain can call — web search, code sandbox, image generation, TTS, and more.',
      items: caps.tools,
      count: caps.tools.length,
    },
    {
      key: 'skills',
      label: 'Skills',
      description: 'Knowledge packs injected into the brain when a mission needs them.',
      items: caps.skills,
      count: caps.skills.length,
    },
    {
      key: 'plugins',
      label: 'Plugins',
      description: 'Installed extensions that lend the brain extra abilities.',
      items: caps.plugins,
      count: caps.plugins.length,
    },
    {
      key: 'mcps',
      label: 'MCP Servers',
      description: 'Connected Model Context Protocol servers exposing external tool surfaces.',
      items: caps.mcps,
      count: caps.mcps.length,
    },
    {
      key: 'memory',
      label: 'Memory',
      description: 'Long-term memories the brain carries across conversations and missions.',
      items: [],
      count: caps.memoryCount,
      memoryCount: caps.memoryCount,
    },
  ]
}

/** Flatten the inventory into one human-readable brain power summary. */
export function summarizeInventory(caps: BrainCapabilitySet): string {
  const mcpTools = caps.mcps.length
  const empCount = caps.employees?.length ?? 0
  const autoCount = caps.automations?.filter((a) => a.enabled).length ?? 0
  const parts = [
    `${caps.tools.length} tools`,
    `${caps.skills.length} skills`,
    `${caps.plugins.length} plugins`,
    `${mcpTools} MCP servers`,
    `${caps.memoryCount} memories`,
  ]
  if (empCount > 0) parts.push(`${empCount} AI staff`)
  if (autoCount > 0) parts.push(`${autoCount} automations`)
  return parts.join(' · ')
}
