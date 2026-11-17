import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSeeded()
    const conversations = await db.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        runs: {
          orderBy: { createdAt: 'asc' },
          include: { events: { orderBy: { seq: 'asc' } } },
        },
        suggestions: { orderBy: { createdAt: 'asc' } },
      },
    })
    // parse the JSON payload of every event so the client receives objects
    const parsed = conversations.map((c) => ({
      ...c,
      runs: c.runs.map((r) => ({
        ...r,
        events: r.events.map((e) => ({
          ...e,
          data: safeParse(e.data),
        })),
      })),
    }))
    return NextResponse.json({ ok: true, conversations: parsed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function POST() {
  try {
    const conv = await db.conversation.create({ data: { title: 'New Mission' } })
    return NextResponse.json({ ok: true, conversation: { ...conv, messages: [], runs: [], suggestions: [] } })
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
    await db.conversation.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
