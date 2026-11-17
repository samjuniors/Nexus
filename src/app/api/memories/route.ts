import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSeeded()
    const memories = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
    return NextResponse.json({ ok: true, memories })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { content?: string; type?: string }
    const content = (body.content ?? '').trim()
    if (!content) return NextResponse.json({ ok: false, error: 'content required' }, { status: 400 })
    const type = ['fact', 'preference', 'insight', 'note'].includes(body.type ?? '')
      ? (body.type as string)
      : 'note'
    // GBRAIN write path: dedup → truth → conflicts → entity resolution.
    try {
      const { saveMemoryGbrain } = await import('@/lib/agent/gbrain-store')
      const res = await saveMemoryGbrain({
        content: content.slice(0, 400),
        type,
        kind: type === 'fact' || type === 'insight' ? 'semantic' : 'episodic',
        importance: 5,
      })
      const memory = await db.memory.findUnique({ where: { id: res.page.id } })
      return NextResponse.json({ ok: true, memory, gbrain: { deduplicated: res.deduplicated, conflicts: res.conflicts.length, newEntities: res.newEntities.length } })
    } catch {
      const memory = await db.memory.create({
        data: { content: content.slice(0, 400), type, source: 'user' },
      })
      return NextResponse.json({ ok: true, memory })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const all = searchParams.get('all')
    if (all === 'true') {
      await db.memory.deleteMany({})
      return NextResponse.json({ ok: true })
    }
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    await db.memory.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
