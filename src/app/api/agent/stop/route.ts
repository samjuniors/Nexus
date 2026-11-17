import { NextResponse } from 'next/server'
import { stopRun } from '@/lib/agent/orchestrator'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { runId?: string }
    if (!body.runId) {
      return NextResponse.json({ ok: false, error: 'runId is required' }, { status: 400 })
    }
    const ok = await stopRun(body.runId)
    return NextResponse.json({ ok })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
