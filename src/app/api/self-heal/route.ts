import { NextRequest, NextResponse } from 'next/server'
import { requireCapabilityPermission } from '@/lib/agent/permissions'
import { controlBus } from '@/lib/agent/control-bus'
import {
  applySelfHealPatch,
  inspectAppCode,
  rollbackSelfHealSession,
  runAutonomousSelfHeal,
  selfHealManager,
  verifyAppBuild,
  type SelfHealEditInput,
  type SelfHealTrigger,
} from '@/lib/agent/self-heal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/self-heal — list recent self-healing sessions, patches, diffs, and rollback availability. */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') || '20')
  return NextResponse.json({
    ok: true,
    sessions: selfHealManager.listSessions(Number.isFinite(limit) ? Math.min(30, Math.max(1, limit)) : 20),
  })
}

/** POST /api/self-heal — inspect code, run build verification, apply verified patches, auto-heal errors, or rollback snapshots. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: 'verify' | 'inspect' | 'patch' | 'auto_heal' | 'scan_and_heal' | 'rollback'
      mode?: 'list' | 'search' | 'read'
      path?: string
      query?: string
      startLine?: number
      endLine?: number
      testFile?: string
      title?: string
      errorMessage?: string
      stack?: string
      viewName?: string
      targetFileHint?: string
      trigger?: SelfHealTrigger
      edits?: SelfHealEditInput[]
      verify?: boolean
      autoRollbackOnFail?: boolean
      sessionId?: string
    }

    if (body.action === 'verify') {
      const verification = await verifyAppBuild({ testFile: body.testFile })
      return NextResponse.json({ ok: verification.ok, verification })
    }

    if (body.action === 'inspect') {
      const res = await inspectAppCode({
        mode: body.mode ?? 'list',
        path: body.path,
        query: body.query,
        startLine: body.startLine,
        endLine: body.endLine,
      })
      return NextResponse.json(res)
    }

    if (body.action === 'rollback') {
      if (!body.sessionId) {
        return NextResponse.json({ ok: false, error: 'sessionId is required for rollback' }, { status: 400 })
      }
      const res = await rollbackSelfHealSession(body.sessionId)
      controlBus.broadcastEvaMood('happy', 'Rolled back self-heal snapshot cleanly', 2000)
      return NextResponse.json(res)
    }

    if (body.action === 'patch') {
      const perm = await requireCapabilityPermission({
        capability: 'self_code_edit',
        actionSummary: `Self-heal patch: ${body.title || 'Update app source code'}`,
        details: (body.edits ?? []).map((e) => `${e.mode} ${e.path}`).join(', '),
      })
      if (!perm.allowed) {
        return NextResponse.json(
          { ok: false, error: perm.reason || 'Permission denied for self_code_edit' },
          { status: 403 }
        )
      }
      const res = await applySelfHealPatch({
        sessionId: body.sessionId,
        trigger: body.trigger ?? 'user_request',
        title: body.title || 'Surgical self-heal patch',
        errorContext: body.errorMessage,
        edits: body.edits ?? [],
        verify: body.verify !== false,
        autoRollbackOnFail: body.autoRollbackOnFail !== false,
        testFile: body.testFile,
      })
      return NextResponse.json(res, { status: res.ok ? 200 : 422 })
    }

    if (body.action === 'scan_and_heal') {
      const verification = await verifyAppBuild({ testFile: body.testFile })
      if (verification.ok) {
        return NextResponse.json({
          ok: true,
          verification,
          message: `Build scan passed cleanly with 0 TypeScript errors (${verification.durationMs}ms).`,
        })
      }
      const perm = await requireCapabilityPermission({
        capability: 'self_code_edit',
        actionSummary: 'Scan & auto-fix TypeScript compiler errors',
        details: verification.output.slice(0, 220),
      })
      if (!perm.allowed) {
        return NextResponse.json(
          {
            ok: false,
            verification,
            error: perm.reason || 'Permission denied for self_code_edit',
          },
          { status: 403 }
        )
      }
      controlBus.broadcastUiCommand({
        command: 'open_split',
        mode: 'self_heal',
        title: 'Self-Heal Studio',
      })
      controlBus.broadcastEvaMood('working', 'Auto-fixing TypeScript errors…', 20_000)
      const res = await runAutonomousSelfHeal({
        trigger: body.trigger ?? 'user_request',
        errorMessage: 'Fix all TypeScript compiler errors reported by tsc --noEmit',
        stack: verification.output,
      })
      controlBus.broadcastEvaMood(
        res.ok ? 'happy' : 'curious',
        res.ok ? 'Build healed and verified' : 'Self-heal needs follow-up',
        2600
      )
      return NextResponse.json({
        ...res,
        verification: res.session.verification ?? verification,
        error: res.ok ? undefined : res.message,
      })
    }

    if (body.action === 'auto_heal') {
      const errMsg = (body.errorMessage ?? '').trim()
      if (!errMsg) {
        return NextResponse.json(
          { ok: false, error: 'Describe the issue or provide an error message to diagnose.' },
          { status: 400 }
        )
      }
      const perm = await requireCapabilityPermission({
        capability: 'self_code_edit',
        actionSummary: `Auto-heal app error: ${errMsg.slice(0, 120)}`,
        details: body.viewName ? `View: ${body.viewName}` : body.targetFileHint,
      })
      if (!perm.allowed) {
        return NextResponse.json(
          { ok: false, error: perm.reason || 'Permission denied for self_code_edit' },
          { status: 403 }
        )
      }
      controlBus.broadcastUiCommand({
        command: 'open_split',
        mode: 'self_heal',
        title: 'Self-Heal Studio',
      })
      controlBus.broadcastEvaMood('working', 'Diagnosing and repairing code…', 20_000)
      const res = await runAutonomousSelfHeal({
        trigger: body.trigger ?? 'user_request',
        errorMessage: errMsg,
        stack: body.stack,
        viewName: body.viewName,
        targetFileHint: body.targetFileHint,
      })
      controlBus.broadcastEvaMood(
        res.ok ? 'happy' : 'curious',
        res.ok ? 'Self-heal verified' : 'Self-heal needs follow-up',
        2600
      )
      return NextResponse.json({
        ...res,
        error: res.ok ? undefined : res.message,
      })
    }

    return NextResponse.json({ ok: false, error: 'Invalid self-heal action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Self-heal request failed' },
      { status: 500 }
    )
  }
}
