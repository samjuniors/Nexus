import { db } from '@/lib/db'
import type { GraphSource } from '@brain/index'
import type { BrainGraph, GraphNode, GraphEdge } from '@brain/index'

/**
 * Build the graphify-style GraphSource from the app's Prisma data.
 * Deterministic: reads the registry + run events, no LLM involved.
 * Shared by the graph_query agent tool and the /api/brain graph endpoint.
 */

interface ToolResultDisplayLike {
  kind?: string
  url?: string
  files?: string[]
}

export async function buildGraphSource(): Promise<GraphSource> {
  const [tools, skills, plugins, mcps, memories, conversations, runs] = await Promise.all([
    db.tool.findMany(),
    db.skill.findMany(),
    db.plugin.findMany(),
    db.mcpServer.findMany(),
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 120 }),
    db.conversation.findMany({ orderBy: { updatedAt: 'desc' }, take: 20 }),
    db.run.findMany({ orderBy: { createdAt: 'desc' }, take: 30, include: { events: { orderBy: { seq: 'asc' } } } }),
  ])

  const runData = runs.map((r) => {
    const usedTools = new Set<string>()
    const producedFiles = new Set<string>()
    for (const e of r.events) {
      if (e.type !== 'tool_call' && e.type !== 'tool_result') continue
      try {
        const d = JSON.parse(e.data) as { tool?: string; display?: ToolResultDisplayLike }
        if (e.type === 'tool_call' && d.tool) usedTools.add(d.tool)
        if (e.type === 'tool_result' && d.display) {
          if (d.display.kind === 'image' && d.display.url) {
            producedFiles.add(decodeURIComponent(d.display.url.split('name=').pop() ?? ''))
          } else if (Array.isArray(d.display.files)) {
            d.display.files.forEach((f) => producedFiles.add(f))
          }
        }
      } catch {
        /* ignore malformed events */
      }
    }
    return {
      id: r.id,
      conversationId: r.conversationId,
      usedTools: [...usedTools],
      producedFiles: [...producedFiles].filter(Boolean),
    }
  })

  return {
    tools: tools.map((t) => ({ slug: t.slug, name: t.name, source: t.source })),
    skills: skills.map((s) => ({ slug: s.slug, name: s.name })),
    plugins: plugins.map((p) => ({
      slug: p.slug,
      name: p.name,
      installed: p.installed,
      toolSlug: p.toolSlug,
    })),
    mcps: mcps.map((m) => {
      let mcpTools: { slug: string }[] = []
      try {
        mcpTools = (JSON.parse(m.toolsJson) as { slug: string }[]) ?? []
      } catch {
        mcpTools = []
      }
      return { slug: m.slug, name: m.name, tools: mcpTools }
    }),
    memories: memories.map((m) => ({ id: m.id, content: m.content, type: m.type, runId: m.runId })),
    conversations: conversations.map((c) => ({ id: c.id, title: c.title })),
    runs: runData,
  }
}

export async function buildAppGraph(): Promise<BrainGraph> {
  const { buildGraph } = await import('@brain/index')
  return buildGraph(await buildGraphSource())
}

export type { BrainGraph, GraphNode, GraphEdge }
