import { NextRequest, NextResponse } from 'next/server'
import {
  resolveTruthAuditFinding,
  runBrainTruthAudit,
} from '@/lib/agent/brain-truth-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/brain/truth-audit — scan GBrain entities & memories for contradictions, duplicates, and staleness. */
export async function GET(req: NextRequest) {
  try {
    const deep = req.nextUrl.searchParams.get('deep') === '1'
    const report = await runBrainTruthAudit({ deep })
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Truth audit failed' },
      { status: 500 }
    )
  }
}

/** POST /api/brain/truth-audit — run deep audit or resolve a specific finding atomically. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'scan' | 'keep_newer' | 'merge_entities' | 'archive_stale'
      deep?: boolean
      memoryIds?: string[]
      entityIds?: string[]
    }

    if (!body.action || body.action === 'scan') {
      const report = await runBrainTruthAudit({ deep: Boolean(body.deep) })
      return NextResponse.json({ ok: true, report })
    }

    const res = await resolveTruthAuditFinding({
      action: body.action,
      memoryIds: body.memoryIds,
      entityIds: body.entityIds,
    })
    const report = await runBrainTruthAudit({ deep: false })
    return NextResponse.json({ ok: true, message: res.message, report })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Truth audit action failed' },
      { status: 400 }
    )
  }
}
