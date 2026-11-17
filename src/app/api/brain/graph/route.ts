import { NextResponse } from 'next/server'
import { buildGraphView, inspectNode, createNode, removeNode, renameNode, addAlias, pruneOrphans } from '@brain/index'
import { gbrainStore } from '@/lib/agent/gbrain-store'
import { retrievalLog, retrievalTrust } from '@brain/index'

export const runtime = 'nodejs'

/**
 * THE GBRAIN GRAPH API — how a person (and the app) interact with the
 * memory graph:
 *
 *   GET                          → full interactive view (nodes, edges, stats)
 *   POST { action: 'inspect' }   → one node deep-inspected
 *   POST { action: 'create' }    → create a node by hand (near-matches flagged)
 *   POST { action: 'remove' }    → remove a node (memories survive, unlinked)
 *   POST { action: 'rename' }    → rename (old name becomes an alias)
 *   POST { action: 'alias' }     → add an alias to a node
 *   POST { action: 'prune' }     → auto-remove orphaned nodes (brain hygiene)
 */

export async function GET() {
  try {
    const view = await buildGraphView(gbrainStore())
    return NextResponse.json({ ok: true, ...view })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

interface GraphAction {
  action: 'inspect' | 'create' | 'remove' | 'rename' | 'alias' | 'prune'
  nodeId?: string
  name?: string
  note?: string
  alias?: string
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
        return NextResponse.json({
          ok: true,
          entity: detail.entity,
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
