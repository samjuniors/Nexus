import { NextRequest, NextResponse } from 'next/server'
import { reasoningChain, type ReasoningNodeKind, type ReasoningSource } from '@/lib/agent/reasoning-chain'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    const runId = req.nextUrl.searchParams.get('runId')
    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Math.max(1, Math.min(40, Number(limitRaw) || 20)) : 20

    if (id) {
      const chain = reasoningChain.getChain(id)
      return NextResponse.json({ ok: true, chain })
    }
    if (runId) {
      const chain = reasoningChain.getChainByRunId(runId)
      return NextResponse.json({ ok: true, chain })
    }

    const chains = reasoningChain.listChains(limit)
    return NextResponse.json({ ok: true, chains })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action.trim() : ''

    if (action === 'clear') {
      reasoningChain.clearChains()
      return NextResponse.json({ ok: true, chains: [] })
    }

    if (action === 'start') {
      const source = (
        body.source === 'browser_autopilot' || body.source === 'mission' || body.source === 'voice_live'
          ? body.source
          : 'voice_live'
      ) as ReasoningSource
      const goal = typeof body.goal === 'string' ? body.goal : ''
      if (!goal.trim()) {
        return NextResponse.json({ ok: false, error: 'Missing goal' }, { status: 400 })
      }
      const chain = reasoningChain.startChain({
        source,
        goal,
        actor: typeof body.actor === 'string' ? body.actor : 'Eva',
        runId: typeof body.runId === 'string' ? body.runId : undefined,
        goalDetail: typeof body.goalDetail === 'string' ? body.goalDetail : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
      })
      return NextResponse.json({ ok: true, chain })
    }

    if (action === 'node') {
      const chainId = typeof body.chainId === 'string' ? body.chainId : ''
      const kind = (
        body.kind === 'goal' ||
        body.kind === 'decision' ||
        body.kind === 'observation' ||
        body.kind === 'self_correction' ||
        body.kind === 'verification'
          ? body.kind
          : 'decision'
      ) as ReasoningNodeKind
      const rawCorrection =
        body.correction && typeof body.correction === 'object'
          ? (body.correction as Record<string, unknown>)
          : null
      const correction =
        rawCorrection &&
        typeof rawCorrection.whatFailed === 'string' &&
        typeof rawCorrection.pivotStrategy === 'string'
          ? {
              whatFailed: rawCorrection.whatFailed,
              pivotStrategy: rawCorrection.pivotStrategy,
            }
          : undefined

      const node = reasoningChain.addNode(chainId, {
        kind,
        title: typeof body.title === 'string' ? body.title : kind,
        detail: typeof body.detail === 'string' ? body.detail : '',
        actor: typeof body.actor === 'string' ? body.actor : undefined,
        tool: typeof body.tool === 'string' ? body.tool : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
        correction,
        verified: typeof body.verified === 'boolean' ? body.verified : undefined,
      })
      if (!node) {
        return NextResponse.json({ ok: false, error: 'Chain not found' }, { status: 404 })
      }
      return NextResponse.json({ ok: true, node, chain: reasoningChain.getChain(chainId) })
    }

    if (action === 'complete') {
      const chainId = typeof body.chainId === 'string' ? body.chainId : ''
      const chain = reasoningChain.completeChain(chainId, {
        ok: Boolean(body.ok),
        verificationDetail:
          typeof body.verificationDetail === 'string' ? body.verificationDetail : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
      })
      if (!chain) {
        return NextResponse.json({ ok: false, error: 'Chain not found' }, { status: 404 })
      }
      return NextResponse.json({ ok: true, chain })
    }

    return NextResponse.json({ ok: false, error: `Unsupported action "${action}"` }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
