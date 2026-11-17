import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSeeded()
    const tools = await db.tool.findMany({ orderBy: [{ source: 'asc' }, { name: 'asc' }] })
    return NextResponse.json({ ok: true, tools })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; enabled?: boolean }
    if (!body.id || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'id and enabled required' }, { status: 400 })
    }
    const tool = await db.tool.update({ where: { id: body.id }, data: { enabled: body.enabled } })
    return NextResponse.json({ ok: true, tool })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Uninstall a tool. Core system tools (source "builtin") are protected;
// plugin/mcp-sourced tools can be removed — reinstalling their plugin recreates them.
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const tool = await db.tool.findUnique({ where: { id } })
    if (!tool) return NextResponse.json({ ok: false, error: 'Tool not found' }, { status: 404 })
    if (tool.source === 'builtin') {
      return NextResponse.json(
        { ok: false, error: 'Core system tools cannot be removed' },
        { status: 400 }
      )
    }
    await db.tool.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
