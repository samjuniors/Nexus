import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'mcp'
  )
}

export async function GET() {
  try {
    await ensureSeeded()
    const servers = await db.mcpServer.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json({ ok: true, servers })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// add a custom (simulated) MCP server from a JSON definition
export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      name?: string
      description?: string
      tools?: { name?: string; description?: string }[]
    }
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ ok: false, error: 'Server name is required' }, { status: 400 })
    const tools = (body.tools ?? []).filter((t) => t && typeof t.name === 'string' && t.name.trim())
    if (tools.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'At least one tool with a "name" is required' },
        { status: 400 }
      )
    }

    let slug = slugify(name)
    const existing = await db.mcpServer.findUnique({ where: { slug } })
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

    const toolDefs = tools.slice(0, 8).map((t) => ({
      slug: `${slug}.${slugify(t.name ?? 'tool').replace(/-/g, '_')}`,
      name: String(t.name).slice(0, 60),
      description: String(t.description ?? '').slice(0, 300),
    }))

    const server = await db.mcpServer.create({
      data: {
        slug,
        name: name.slice(0, 80),
        description: (body.description ?? 'Custom MCP server (simulated tools)').slice(0, 300),
        status: 'connected',
        mode: 'simulated',
        toolsJson: JSON.stringify(toolDefs),
        enabled: true,
      },
    })
    return NextResponse.json({ ok: true, server })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; enabled?: boolean; status?: string }
    if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const data: { enabled?: boolean; status?: string } = {}
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    if (body.status === 'connected' || body.status === 'disconnected') data.status = body.status
    const server = await db.mcpServer.update({ where: { id: body.id }, data })
    return NextResponse.json({ ok: true, server })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const server = await db.mcpServer.findUnique({ where: { id } })
    if (!server) return NextResponse.json({ ok: false, error: 'Server not found' }, { status: 404 })
    if (server.mode === 'builtin') {
      return NextResponse.json(
        { ok: false, error: 'Built-in MCP servers cannot be deleted — disconnect them instead' },
        { status: 400 }
      )
    }
    await db.mcpServer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
