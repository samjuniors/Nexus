import { NextRequest, NextResponse } from 'next/server'
import { brainTrace } from '@/lib/agent/brain-trace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/brain/trace — recent live Working Memory Trace events. */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') || '25')
  return NextResponse.json({
    ok: true,
    traces: brainTrace.list(Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 25),
  })
}

/** POST /api/brain/trace — clear working memory trace buffer. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: 'clear' }
    if (body.action === 'clear') {
      brainTrace.clear()
      return NextResponse.json({ ok: true, traces: [] })
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
}
