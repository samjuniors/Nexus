import { NextResponse } from 'next/server'
import {
  buildGraphView,
  inspectNode,
  createNode,
  removeNode,
  renameNode,
  addAlias,
  pruneOrphans,
  retrievalLog,
  retrievalTrust,
} from '@brain/index'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { gbrainStore } from '@/lib/agent/gbrain-store'
import {
  CATEGORY_TAG_PREFIX,
  classifyGBrainEntity,
  GBRAIN_CATEGORIES,
  isValidCategory,
  type GBrainCategoryId,
} from '@/lib/agent/gbrain-categories'

export const runtime = 'nodejs'

/**
 * Populate GBrain entities & edges from the real live workspace (AI Team/Agents,
 * Skills, Tools, Automations, Core System Modules, and Memories) idempotently so
 * the GBrain graph is always structured, categorized, and immediately inspectable.
 */
async function syncWorkspaceIntoGBrain(): Promise<{ entities: number; edges: number }> {
  await ensureSeeded()
  const store = gbrainStore()

  const [employees, skills, tools, automations, memories] = await Promise.all([
    db.aiEmployee.findMany({ orderBy: { name: 'asc' }, take: 12 }),
    db.skill.findMany({ orderBy: { name: 'asc' }, take: 12 }),
    db.tool.findMany({ orderBy: { name: 'asc' }, take: 12 }),
    db.automation.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])

  const existingEdges = await store.listEdges()
  const edgeKeys = new Set(existingEdges.map((e) => `${e.sourceId}->${e.targetId}:${e.relation}`))

  const ensureNode = async (name: string, category: GBrainCategoryId, aliases: string[] = []) => {
    const clean = name.trim().slice(0, 80)
    const variants = [...aliases, `${CATEGORY_TAG_PREFIX}${category}`]
    return store.upsertEntity(clean, { origin: 'auto', addVariants: variants })
  }

  let addedEdges = 0
  const ensureEdge = async (
    sourceId: string,
    targetId: string,
    relation: string,
    kind: 'EXTRACTED' | 'INFERRED' = 'EXTRACTED'
  ) => {
    if (sourceId === targetId) return
    const k = `${sourceId}->${targetId}:${relation}`
    if (edgeKeys.has(k)) return
    edgeKeys.add(k)
    await store.saveEdge({ sourceId, targetId, relation, kind, weight: kind === 'EXTRACTED' ? 1 : 0.7 })
    addedEdges += 1
  }

  // Core OS architecture hubs
  const evaNode = await ensureNode('Eva Lead Agent', 'agents', ['Eva', 'Lead Agent'])
  const nexusNode = await ensureNode('Nexus Agent OS', 'projects', ['Workspace', 'Agent OS'])
  const gbrainNode = await ensureNode('GBrain Knowledge Graph', 'projects', ['GBrain', 'Knowledge Graph'])
  const reasoningNode = await ensureNode('Reasoning Chain', 'facts', ['Decision Trace', 'Self-Correction'])
  const browserNode = await ensureNode('Live Browser Autopilot', 'tools', ['Playwright Browser', 'Browser Control'])
  const voiceNode = await ensureNode('Voice Focus & Wake Ear', 'tools', ['Voice Mode', 'Hey Eva'])
  const vaultNode = await ensureNode('Permission Vault', 'facts', ['Capability Policies', 'One-Time Approval'])

  await ensureEdge(evaNode.id, nexusNode.id, 'orchestrates')
  await ensureEdge(evaNode.id, gbrainNode.id, 'recalls_from')
  await ensureEdge(evaNode.id, reasoningNode.id, 'logs_decisions')
  await ensureEdge(evaNode.id, browserNode.id, 'drives')
  await ensureEdge(evaNode.id, voiceNode.id, 'listens_via')
  await ensureEdge(browserNode.id, vaultNode.id, 'gated_by')
  await ensureEdge(browserNode.id, reasoningNode.id, 'emits_pivots', 'INFERRED')
  await ensureEdge(gbrainNode.id, nexusNode.id, 'part_of')

  // Sync AI Team / Subagents
  const empById = new Map<string, string>()
  const toolBySlug = new Map<string, string>()
  const skillBySlug = new Map<string, string>()

  for (const t of tools.slice(0, 8)) {
    const tn = await ensureNode(t.name, 'tools', [t.slug])
    toolBySlug.set(t.slug, tn.id)
    await ensureEdge(nexusNode.id, tn.id, 'provides_tool')
  }

  for (const s of skills.slice(0, 8)) {
    const sn = await ensureNode(s.name, 'tools', [s.slug])
    skillBySlug.set(s.slug, sn.id)
    await ensureEdge(evaNode.id, sn.id, 'equipped_with')
  }

  for (const emp of employees) {
    const en = await ensureNode(emp.name, 'agents', [emp.title, emp.department].filter(Boolean))
    empById.set(emp.id, en.id)
    await ensureEdge(en.id, evaNode.id, 'reports_to')

    try {
      const empTools = JSON.parse(emp.toolsJson || '[]') as string[]
      for (const slug of empTools.slice(0, 3)) {
        const tid = toolBySlug.get(slug)
        if (tid) await ensureEdge(en.id, tid, 'uses_tool')
      }
    } catch {
      /* ignore malformed json */
    }
    try {
      const empSkills = JSON.parse(emp.skillsJson || '[]') as string[]
      for (const slug of empSkills.slice(0, 3)) {
        const sid = skillBySlug.get(slug)
        if (sid) await ensureEdge(en.id, sid, 'has_skill')
      }
    } catch {
      /* ignore malformed json */
    }
  }

  for (const emp of employees) {
    if (emp.reportsToId && empById.has(emp.id) && empById.has(emp.reportsToId)) {
      await ensureEdge(empById.get(emp.id)!, empById.get(emp.reportsToId)!, 'reports_to')
    }
  }

  for (const auto of automations.slice(0, 5)) {
    const an = await ensureNode(auto.name, 'tools', [auto.triggerType])
    const ownerId = auto.assigneeId ? empById.get(auto.assigneeId) : evaNode.id
    await ensureEdge(ownerId ?? evaNode.id, an.id, 'automates')
  }

  // Link existing memories to matching entities or facts hub
  for (const mem of memories.slice(0, 12)) {
    const lower = mem.content.toLowerCase()
    let linked = false
    if (lower.includes('eva') || lower.includes('voice')) {
      await store.linkMemory(evaNode.id, mem.id)
      linked = true
    }
    if (lower.includes('browser') || lower.includes('youtube')) {
      await store.linkMemory(browserNode.id, mem.id)
      linked = true
    }
    if (!linked) {
      await store.linkMemory(gbrainNode.id, mem.id)
    }
  }

  const allEntities = await store.listEntities()
  return { entities: allEntities.length, edges: addedEdges }
}

function enrichGraphView(view: Awaited<ReturnType<typeof buildGraphView>>) {
  const byCategory: Record<GBrainCategoryId, number> = {
    agents: 0,
    projects: 0,
    tools: 0,
    concepts: 0,
    people: 0,
    facts: 0,
  }

  const nodes = view.nodes.map((n) => {
    const category = classifyGBrainEntity(n.name, n.variants)
    byCategory[category] += 1
    return {
      ...n,
      category,
    }
  })

  return {
    ...view,
    nodes,
    stats: {
      ...view.stats,
      byCategory,
    },
    categories: GBRAIN_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      count: byCategory[c.id],
    })),
  }
}

export async function GET() {
  try {
    const store = gbrainStore()
    let view = await buildGraphView(store)
    // Auto-bootstrap from real live workspace entities if GBrain has never been indexed yet
    if (view.nodes.length === 0) {
      await syncWorkspaceIntoGBrain()
      view = await buildGraphView(store)
    }
    return NextResponse.json({ ok: true, ...enrichGraphView(view) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

interface GraphAction {
  action:
    | 'inspect'
    | 'create'
    | 'remove'
    | 'rename'
    | 'alias'
    | 'prune'
    | 'sync_workspace'
    | 'link'
    | 'set_category'
  nodeId?: string
  targetId?: string
  relation?: string
  name?: string
  note?: string
  alias?: string
  category?: GBrainCategoryId
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GraphAction
    const store = gbrainStore()

    switch (body.action) {
      case 'inspect': {
        if (!body.nodeId) return NextResponse.json({ ok: false, error: 'nodeId required' }, { status: 400 })
        const detail = await inspectNode(store, body.nodeId)
        if (!detail) return NextResponse.json({ ok: false, error: 'node not found' }, { status: 404 })
        const category = classifyGBrainEntity(detail.entity.name, detail.entity.variants)
        return NextResponse.json({
          ok: true,
          entity: { ...detail.entity, category },
          neighbors: detail.neighbors,
          edges: detail.edges,
          memories: detail.memories.map((m) => ({
            id: m.id,
            type: m.type,
            truth: m.truth,
            content: m.content,
            alwaysLoad: m.alwaysLoad,
            trust: Number(retrievalTrust(m).toFixed(2)),
            accessCount: m.accessCount,
            recentQueries: retrievalLog(m, 5).map((r) => r.q),
          })),
        })
      }
      case 'create': {
        if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
        const res = await createNode(store, body.name, { note: body.note })
        if (res.kind === 'created' && isValidCategory(body.category)) {
          await store.upsertEntity(res.entity.name, {
            origin: 'manual',
            addVariants: [`${CATEGORY_TAG_PREFIX}${body.category}`],
          })
        }
        return NextResponse.json({ ok: true, ...res })
      }
      case 'set_category': {
        if (!body.nodeId || !isValidCategory(body.category)) {
          return NextResponse.json({ ok: false, error: 'nodeId and valid category required' }, { status: 400 })
        }
        const row = await db.memoryEntity.findUnique({ where: { id: body.nodeId } })
        if (!row) return NextResponse.json({ ok: false, error: 'Entity not found' }, { status: 404 })
        let variants: string[] = []
        try {
          variants = JSON.parse(row.variants || '[]') as string[]
        } catch {
          variants = []
        }
        const cleaned = variants.filter((v) => !v.startsWith(CATEGORY_TAG_PREFIX))
        cleaned.push(`${CATEGORY_TAG_PREFIX}${body.category}`)
        await db.memoryEntity.update({
          where: { id: row.id },
          data: { variants: JSON.stringify(cleaned.slice(0, 20)) },
        })
        return NextResponse.json({ ok: true, category: body.category })
      }
      case 'link': {
        if (!body.nodeId || !body.targetId) {
          return NextResponse.json({ ok: false, error: 'nodeId and targetId required' }, { status: 400 })
        }
        if (body.nodeId === body.targetId) {
          return NextResponse.json({ ok: false, error: 'Cannot link an entity to itself' }, { status: 400 })
        }
        const rel = (body.relation?.trim() || 'related_to').slice(0, 48)
        await store.saveEdge({
          sourceId: body.nodeId,
          targetId: body.targetId,
          relation: rel,
          kind: 'EXTRACTED',
          weight: 1,
        })
        return NextResponse.json({ ok: true, relation: rel })
      }
      case 'sync_workspace': {
        const res = await syncWorkspaceIntoGBrain()
        return NextResponse.json({ ok: true, ...res })
      }
      case 'remove': {
        if (!body.nodeId) return NextResponse.json({ ok: false, error: 'nodeId required' }, { status: 400 })
        const res = await removeNode(store, body.nodeId)
        return NextResponse.json({ ok: true, removed: res })
      }
      case 'rename': {
        if (!body.nodeId || !body.name?.trim()) {
          return NextResponse.json({ ok: false, error: 'nodeId and name required' }, { status: 400 })
        }
        const entity = await renameNode(store, body.nodeId, body.name)
        return NextResponse.json({ ok: true, entity })
      }
      case 'alias': {
        if (!body.nodeId || !body.alias?.trim()) {
          return NextResponse.json({ ok: false, error: 'nodeId and alias required' }, { status: 400 })
        }
        const entity = await addAlias(store, body.nodeId, body.alias)
        return NextResponse.json({ ok: true, entity })
      }
      case 'prune': {
        const res = await pruneOrphans(store)
        return NextResponse.json({ ok: true, ...res })
      }
      default:
        return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
