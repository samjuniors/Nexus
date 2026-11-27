import { NextResponse } from 'next/server'
import {
  isValidCapability,
  isValidPolicy,
  requiresSingleUseApproval,
  listPendingPermissionRequests,
  listPermissionAudit,
  listPermissionGrants,
  resolvePermissionDecision,
  setPermissionPolicy,
} from '@/lib/agent/permissions'
import { type PermissionDecision } from '@/lib/agent/control-bus'

export async function GET() {
  try {
    const [grants, audit, pending] = await Promise.all([
      listPermissionGrants(),
      listPermissionAudit(30),
      listPendingPermissionRequests(),
    ])
    return NextResponse.json({
      ok: true,
      grants,
      audit,
      pending,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string
      requestId?: string
      actionHash?: string
      decision?: string
      capability?: string
      policy?: string
    }

    // Respond to an active interactive permission prompt
    if (body.action === 'respond' || body.requestId) {
      const requestId = String(body.requestId ?? '').trim()
      const decision = String(body.decision ?? '').trim() as PermissionDecision
      if (!requestId || !['always', 'once', 'deny'].includes(decision)) {
        return NextResponse.json({ ok: false, error: 'Invalid requestId or decision' }, { status: 400 })
      }
      const actionHash = String(body.actionHash ?? '')
      if (!/^[a-f0-9]{64}$/.test(actionHash)) {
        return NextResponse.json({ ok: false, error: 'Missing action approval fingerprint' }, { status: 400 })
      }
      const res = await resolvePermissionDecision(requestId, decision, actionHash)
      if (res.ok && res.automationId && (decision === 'once' || decision === 'always')) {
        void import('@/lib/agent/scheduler')
          .then(({ executeAutomation }) => executeAutomation(res.automationId!))
          .catch(() => {})
      }
      const [grants, audit, pending] = await Promise.all([
        listPermissionGrants(),
        listPermissionAudit(30),
        listPendingPermissionRequests(),
      ])
      return NextResponse.json({
        ok: res.ok,
        decision: res.decision,
        resumedAutomationId: res.ok ? (res.automationId ?? null) : null,
        grants,
        audit,
        pending,
      })
    }

    // Directly update a capability grant policy ("always" | "ask" | "deny")
    const capability = String(body.capability ?? '').trim()
    const policy = String(body.policy ?? '').trim()
    if (!isValidCapability(capability) || !isValidPolicy(policy)) {
      return NextResponse.json({ ok: false, error: 'Invalid capability or policy' }, { status: 400 })
    }

    if (policy === 'always' && requiresSingleUseApproval(capability)) {
      return NextResponse.json({ ok: false, error: 'Sensitive capabilities require action-by-action approval' }, { status: 400 })
    }
    const updated = await setPermissionPolicy(capability, policy)
    const [grants, audit, pending] = await Promise.all([
      listPermissionGrants(),
      listPermissionAudit(30),
      listPendingPermissionRequests(),
    ])
    return NextResponse.json({ ok: true, grant: updated, grants, audit, pending })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
