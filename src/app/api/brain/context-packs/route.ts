import { NextRequest, NextResponse } from 'next/server'
import {
  createContextPack,
  deleteContextPack,
  getActiveContextPackScope,
  listContextPacks,
  toggleContextPack,
} from '@/lib/agent/brain-context-packs'
import type { GBrainCategoryId } from '@/lib/agent/gbrain-categories'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/brain/context-packs — list all Scoped Brain Context Packs + resolved active scope stats. */
export async function GET() {
  try {
    const [packs, scope] = await Promise.all([
      listContextPacks(),
      getActiveContextPackScope(),
    ])
    return NextResponse.json({
      ok: true,
      packs,
      activeSummary: {
        activePackCount: scope.packs.length,
        activePackNames: scope.packs.map((p) => p.name),
        entityIds: Array.from(scope.entityIds),
        entityCount: scope.entityIds.size,
        memoryCount: scope.memoryIds.size,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to load context packs' },
      { status: 500 }
    )
  }
}

/** POST /api/brain/context-packs — create, toggle active state, or delete a Context Pack. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'create' | 'toggle' | 'delete'
      packId?: string
      name?: string
      description?: string
      categories?: GBrainCategoryId[]
      entityIds?: string[]
      active?: boolean
    }

    if (body.action === 'create') {
      const created = await createContextPack({
        name: String(body.name ?? ''),
        description: body.description,
        categories: body.categories,
        entityIds: body.entityIds,
        active: body.active,
      })
      const scope = await getActiveContextPackScope()
      return NextResponse.json({
        ok: true,
        pack: created.pack,
        packs: created.packs,
        activeSummary: {
          activePackCount: scope.packs.length,
          activePackNames: scope.packs.map((p) => p.name),
          entityIds: Array.from(scope.entityIds),
          entityCount: scope.entityIds.size,
          memoryCount: scope.memoryIds.size,
        },
      })
    }

    if (body.action === 'toggle') {
      if (!body.packId) {
        return NextResponse.json({ ok: false, error: 'packId is required' }, { status: 400 })
      }
      const toggled = await toggleContextPack(body.packId, body.active)
      const scope = await getActiveContextPackScope()
      return NextResponse.json({
        ok: true,
        pack: toggled.pack,
        packs: toggled.packs,
        activeSummary: {
          activePackCount: scope.packs.length,
          activePackNames: scope.packs.map((p) => p.name),
          entityIds: Array.from(scope.entityIds),
          entityCount: scope.entityIds.size,
          memoryCount: scope.memoryIds.size,
        },
      })
    }

    if (body.action === 'delete') {
      if (!body.packId) {
        return NextResponse.json({ ok: false, error: 'packId is required' }, { status: 400 })
      }
      const packs = await deleteContextPack(body.packId)
      const scope = await getActiveContextPackScope()
      return NextResponse.json({
        ok: true,
        packs,
        activeSummary: {
          activePackCount: scope.packs.length,
          activePackNames: scope.packs.map((p) => p.name),
          entityIds: Array.from(scope.entityIds),
          entityCount: scope.entityIds.size,
          memoryCount: scope.memoryIds.size,
        },
      })
    }

    return NextResponse.json({ ok: false, error: 'Invalid context pack action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Context pack action failed' },
      { status: 400 }
    )
  }
}
