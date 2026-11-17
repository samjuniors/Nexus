import { NextResponse } from 'next/server'
import { stepRun } from '@/lib/agent/orchestrator'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { runId?: string }
    if (!body.runId) {
      return NextResponse.json({ ok: false, error: 'runId is required' }, { status: 400 })
    }
    const result = await stepRun(body.runId)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, status: 'error', events: [], error: msg }, { status: 500 })
  }
}
