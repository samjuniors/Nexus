import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { computeActionHash } from '@/lib/agent/action-binding'
import { requiresSingleUseApproval } from '@/lib/agent/permission-policy'
export { requiresSingleUseApproval } from '@/lib/agent/permission-policy'
import { controlBus, type PermissionDecision, type PermissionRequestPayload } from '@/lib/agent/control-bus'

export interface PermissionExecutionContext {
  automationId?: string
  runId?: string
  deferWhenOffline?: boolean
}

const permissionContextStorage = new AsyncLocalStorage<PermissionExecutionContext>()
const DEFERRED_LEASE_TTL_MS = 15 * 60_000

/** Runs an async block under a scoped automation/run context so offline requests defer cleanly. */
export function runWithPermissionContext<T>(
  ctx: PermissionExecutionContext,
  fn: () => Promise<T>
): Promise<T> {
  return permissionContextStorage.run(ctx, fn)
}

export type CapabilityKey =
  | 'app_ui'
  | 'self_install'
  | 'browser_control'
  | 'mobile_control'
  | 'workspace_shell'
  | 'desktop_bridge'
  | 'self_code_edit'

export type PermissionPolicy = 'always' | 'ask' | 'deny'

export interface CapabilitySpec {
  capability: CapabilityKey
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
}

export const CAPABILITY_SPECS: CapabilitySpec[] = [
  {
    capability: 'app_ui',
    title: 'Drive App UI & Split Workspace',
    description:
      'Allow Eva to switch tabs, open split-screen panels, show popups, click workspace buttons, and animate her live cursor.',
    risk: 'low',
  },
  {
    capability: 'self_install',
    title: 'Self-Install Plugins, Skills & MCPs',
    description:
      'Allow Eva to autonomously install, connect, enable, or create Plugins, Skills, Tools, and MCP servers without asking each time.',
    risk: 'medium',
  },
  {
    capability: 'browser_control',
    title: 'Live Split-Screen Browser Control',
    description:
      'Allow Eva to launch a live Playwright browser, navigate websites, click elements, type into forms, and stream frames.',
    risk: 'medium',
  },
  {
    capability: 'mobile_control',
    title: 'Android & Mobile Device Takeover',
    description:
      'Allow Eva to tap, swipe, type, launch apps, toggle system settings, and automate tasks on a live Android viewport or paired Android/iOS device.',
    risk: 'high',
  },
  {
    capability: 'workspace_shell',
    title: 'Workspace Shell & System Commands',
    description:
      'Allow Eva to run write or destructive shell commands (npm install, file removal, git updates) inside the workspace.',
    risk: 'high',
  },
  {
    capability: 'desktop_bridge',
    title: 'Connected Desktop Computer Control',
    description:
      'Allow Eva to open apps, read host info, or execute approved actions on your paired Mac/Windows/Linux computer.',
    risk: 'high',
  },
  {
    capability: 'self_code_edit',
    title: 'Self-Healing Code & App Repair',
    description:
      'Allow Eva to inspect and surgically patch her own app source code, run TypeScript build verification, and keep automatic pre-patch rollback snapshots.',
    risk: 'high',
  },
]

const SPEC_BY_KEY = new Map<CapabilityKey, CapabilitySpec>(
  CAPABILITY_SPECS.map((s) => [s.capability, s])
)

export function isValidCapability(value: string): value is CapabilityKey {
  return SPEC_BY_KEY.has(value as CapabilityKey)
}

export function isValidPolicy(value: string): value is PermissionPolicy {
  return value === 'always' || value === 'ask' || value === 'deny'
}

export interface PermissionGrantDTO {
  capability: CapabilityKey
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
  policy: PermissionPolicy
  lastUsedAt: string | null
  updatedAt: string | null
}

export interface PermissionAuditDTO {
  id: string
  capability: string
  actionSummary: string
  decision: string
  actor: string
  createdAt: string
}

function resolveEffectivePolicy(capability: CapabilityKey, storedPolicy?: string | null): PermissionPolicy {
  const defaultPolicy: PermissionPolicy = capability === 'app_ui' ? 'always' : 'ask'
  const configuredPolicy: PermissionPolicy =
    storedPolicy && isValidPolicy(storedPolicy) ? storedPolicy : defaultPolicy
  return requiresSingleUseApproval(capability) && configuredPolicy === 'always'
    ? 'ask'
    : configuredPolicy
}

/** Returns the effective server-side policy for a capability, failing closed to 'ask'. */
export async function getCapabilityPolicy(capability: CapabilityKey): Promise<PermissionPolicy> {
  const row = await db.permissionGrant.findUnique({ where: { capability } })
  return resolveEffectivePolicy(capability, row?.policy)
}

export async function listPermissionGrants(): Promise<PermissionGrantDTO[]> {
  const rows = await db.permissionGrant.findMany()
  const byKey = new Map(rows.map((r) => [r.capability, r]))
  return CAPABILITY_SPECS.map((spec) => {
    const row = byKey.get(spec.capability)
    const policy = resolveEffectivePolicy(spec.capability, row?.policy)
    return {
      ...spec,
      policy,
      lastUsedAt: row?.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    }
  })
}

export async function listPermissionAudit(limit = 30): Promise<PermissionAuditDTO[]> {
  const rows = await db.permissionAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    capability: r.capability,
    actionSummary: r.actionSummary,
    decision: r.decision,
    actor: r.actor,
    createdAt: new Date(r.createdAt).toISOString(),
  }))
}

export async function setPermissionPolicy(
  capability: CapabilityKey,
  policy: PermissionPolicy
): Promise<PermissionGrantDTO> {
  if (policy === 'always' && requiresSingleUseApproval(capability)) {
    throw new Error('This sensitive capability requires per-action approval and cannot be set to Always')
  }
  const row = await db.permissionGrant.upsert({
    where: { capability },
    create: { capability, policy },
    update: { policy },
  })
  const spec = SPEC_BY_KEY.get(capability)!
  controlBus.broadcast({
    type: 'permission:grants_updated',
    capability,
    policy,
  })
  return {
    ...spec,
    policy,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  }
}

export async function recordPermissionAudit(opts: {
  capability: string
  actionSummary: string
  decision: PermissionDecision
  actor?: string
}) {
  try {
    await db.permissionAuditLog.create({
      data: {
        capability: opts.capability,
        actionSummary: opts.actionSummary.slice(0, 260),
        decision: opts.decision,
        actor: opts.actor || 'Eva',
      },
    })
  } catch (err) {
    // Only deny/timeout audit entries reach here (grants fail closed inline above).
    console.warn('[permissions] Failed to persist denial/timeout audit entry:', err)
  }
}

async function expireStalePermissionRequests(now = new Date()): Promise<void> {
  await db.permissionRequest
    .updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired', decision: 'timeout', resolvedAt: now },
    })
    .catch(() => {})
}

/** Lists active live and persisted deferred pending permission requests (unexpired). */
export async function listPendingPermissionRequests(): Promise<PermissionRequestPayload[]> {
  const now = new Date()
  await expireStalePermissionRequests(now)
  const live = controlBus.getPendingPermissions()
  const byId = new Map<string, PermissionRequestPayload>(live.map((p) => [p.requestId, p]))
  const rows = await db.permissionRequest
    .findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => [])
  for (const r of rows) {
    if (new Date(r.expiresAt).getTime() <= now.getTime()) continue
    if (!byId.has(r.requestId)) {
      const spec = SPEC_BY_KEY.get(r.capability as CapabilityKey)
      byId.set(r.requestId, {
        requestId: r.requestId,
        actionHash: r.actionHash,
        capability: r.capability,
        title: spec?.title ?? r.capability,
        description: spec?.description ?? r.actionSummary,
        actionSummary: r.actionSummary,
        actor: r.actor,
        details: r.details || undefined,
        automationId: r.automationId,
        runId: r.runId,
        createdAt: new Date(r.createdAt).toISOString(),
        expiresAt: new Date(r.expiresAt).toISOString(),
      })
    }
  }
  return Array.from(byId.values())
}

async function hasPendingPermissionForScope(where: { automationId?: string; runId?: string }): Promise<boolean> {
  const now = new Date()
  await expireStalePermissionRequests(now)
  const row = await db.permissionRequest
    .findFirst({
      where: { ...where, status: 'pending', expiresAt: { gt: now } },
    })
    .catch(() => null)
  return Boolean(row)
}

/** Returns true when an automation currently has at least one unexpired pending approval request. */
export async function hasPendingPermissionForAutomation(automationId: string): Promise<boolean> {
  return hasPendingPermissionForScope({ automationId })
}

/** Returns true when a mission run currently has at least one unexpired pending approval request. */
export async function hasPendingPermissionForRun(runId: string): Promise<boolean> {
  return hasPendingPermissionForScope({ runId })
}

async function consumeApprovedLease(opts: {
  capability: CapabilityKey
  actionHash: string
  actionSummary: string
  actor: string
}): Promise<boolean> {
  const now = new Date()
  const lease = await db.permissionRequest
    .findFirst({
      where: {
        actionHash: opts.actionHash,
        capability: opts.capability,
        status: 'approved',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => null)
  if (!lease) return false

  if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
    await db.permissionRequest
      .updateMany({
        where: { id: lease.id, status: 'approved' },
        data: { status: 'expired' },
      })
      .catch(() => {})
    return false
  }

  // Atomic single-use claim prevents replay of the same actionHash lease.
  const claimed = await db.permissionRequest.updateMany({
    where: { id: lease.id, status: 'approved', consumedAt: null },
    data: { status: 'consumed', consumedAt: now },
  })
  if (claimed.count !== 1) return false

  // Fail closed if durable audit cannot be written.
  await db.permissionAuditLog.create({
    data: {
      capability: opts.capability,
      actionSummary: opts.actionSummary.slice(0, 140) + ' [sha256:' + opts.actionHash + ']',
      decision: 'once',
      actor: opts.actor,
    },
  })
  await db.permissionGrant
    .update({
      where: { capability: opts.capability },
      data: { lastUsedAt: now },
    })
    .catch(() => {})
  return true
}

export async function resolvePermissionDecision(
  requestId: string,
  decision: PermissionDecision,
  actionHash: string
): Promise<{ ok: boolean; capability?: string; decision: PermissionDecision; automationId?: string | null }> {
  if (!['always', 'once', 'deny'].includes(decision)) return { ok: false, decision }
  const now = new Date()
  const isLive = controlBus.hasLiveOrResolvingPermission(requestId)
  const livePending = isLive ? controlBus.beginPermissionResolution(requestId, actionHash) : null

  if (isLive) {
    if (!livePending) return { ok: false, decision }
    if (decision === 'always' && requiresSingleUseApproval(livePending.capability)) {
      controlBus.abortPermissionResolution(requestId)
      return { ok: false, decision: 'deny' }
    }
    // A granted action is never released when the durable audit cannot be written.
    if (decision === 'always' || decision === 'once') {
      try {
        await db.permissionAuditLog.create({
          data: {
            capability: livePending.capability,
            actionSummary: livePending.actionSummary.slice(0, 150) + ' [sha256:' + actionHash + ']',
            decision,
            actor: livePending.actor || 'Nexus owner',
          },
        })
      } catch (err) {
        controlBus.abortPermissionResolution(requestId)
        throw err
      }
    }
    await db.permissionRequest
      .updateMany({
        where: { requestId, status: 'pending' },
        data: {
          status: decision === 'deny' ? 'denied' : 'consumed',
          decision,
          resolvedAt: now,
          ...(decision === 'deny' ? {} : { consumedAt: now }),
        },
      })
      .catch(() => {})

    const req = controlBus.resolvePermission(requestId, decision, actionHash)
    if (!req) return { ok: false, decision }

    if (decision === 'always' && isValidCapability(req.capability)) {
      await setPermissionPolicy(req.capability, 'always')
    }
    if (decision === 'always' || decision === 'once') {
      controlBus.broadcastEvaMood('happy', `Permission granted: ${req.title}`, 1800)
    } else {
      controlBus.broadcastEvaMood('idle', `Permission declined: ${req.title}`, 1200)
    }
    if (decision === 'deny') {
      await recordPermissionAudit({
        capability: req.capability,
        actionSummary: req.actionSummary,
        decision,
        actor: req.actor,
      })
    }
    return { ok: true, capability: req.capability, decision, automationId: req.automationId ?? null }
  }

  // Durable fallback path: resolve a persisted pending/deferred request (survives restarts & offline runs)
  const row = await db.permissionRequest.findUnique({ where: { requestId } }).catch(() => null)
  if (!row || row.status !== 'pending' || row.actionHash !== actionHash) {
    return { ok: false, decision }
  }
  const expiresMs = new Date(row.expiresAt).getTime()
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
    await db.permissionRequest
      .updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'expired', decision: 'timeout', resolvedAt: now },
      })
      .catch(() => {})
    return { ok: false, decision: 'timeout' }
  }
  if (decision === 'always' && requiresSingleUseApproval(row.capability)) {
    return { ok: false, decision: 'deny' }
  }

  // Atomically claim single-flight lock in DB before writing audit log
  const claimed = await db.permissionRequest.updateMany({
    where: { id: row.id, status: 'pending' },
    data: { status: 'resolving' },
  })
  if (claimed.count !== 1) return { ok: false, decision }

  try {
    // Write durable audit BEFORE releasing an approved lease.
    if (decision === 'always' || decision === 'once') {
      await db.permissionAuditLog.create({
        data: {
          capability: row.capability,
          actionSummary: row.actionSummary.slice(0, 150) + ' [sha256:' + actionHash + ']',
          decision,
          actor: row.actor || 'Nexus owner',
        },
      })
    } else {
      await recordPermissionAudit({
        capability: row.capability,
        actionSummary: row.actionSummary,
        decision: 'deny',
        actor: row.actor,
      })
    }

    const leaseExpiresAt =
      decision === 'deny'
        ? row.expiresAt
        : new Date(Math.max(expiresMs, Date.now() + DEFERRED_LEASE_TTL_MS))

    await db.permissionRequest.updateMany({
      where: { id: row.id, status: 'resolving' },
      data: {
        status: decision === 'deny' ? 'denied' : 'approved',
        decision,
        resolvedAt: now,
        expiresAt: leaseExpiresAt,
      },
    })
  } catch (err) {
    await db.permissionRequest
      .updateMany({
        where: { id: row.id, status: 'resolving' },
        data: { status: 'pending' },
      })
      .catch(() => {})
    throw err
  }

  if (decision === 'always' && isValidCapability(row.capability)) {
    await setPermissionPolicy(row.capability, 'always')
  }

  controlBus.broadcast({
    type: 'permission:resolved',
    requestId,
    decision,
    capability: row.capability,
  })
  const spec = SPEC_BY_KEY.get(row.capability as CapabilityKey)
  if (spec) {
    if (decision === 'always' || decision === 'once') {
      controlBus.broadcastEvaMood('happy', `Permission granted: ${spec.title}`, 1800)
    } else {
      controlBus.broadcastEvaMood('idle', `Permission declined: ${spec.title}`, 1200)
    }
  }
  return { ok: true, capability: row.capability, decision, automationId: row.automationId ?? null }
}

/**
 * Checks the SQLite PermissionGrant vault for a capability.
 * - `always` -> immediately allowed (and refreshes lastUsedAt)
 * - `deny`   -> immediately denied
 * - `ask`    -> sends interactive Allow Always / Allow Once / Deny popup over `/api/control`
 */
export async function requireCapabilityPermission(opts: {
  capability: CapabilityKey
  actionSummary: string
  actor?: string
  details?: string
  timeoutMs?: number
  actionName?: string
  target?: unknown
  payload?: unknown
  deferWhenOffline?: boolean
}): Promise<{
  allowed: boolean
  decision: PermissionDecision
  deferred?: boolean
  requestId?: string
  reason?: string
  actionHash: string
}> {
  const actor = opts.actor || 'Eva'
  const actionName = opts.actionName ?? opts.capability + ':' + opts.actionSummary
  const actionHash = computeActionHash({
    actionName,
    target: opts.target ?? null,
    payload: opts.payload ?? null,
  })
  const spec = SPEC_BY_KEY.get(opts.capability)!
  const policy = await getCapabilityPolicy(opts.capability)

  if (policy === 'always') {
    // Fail-closed durable audit even for standing non-sensitive grants.
    await db.permissionAuditLog.create({
      data: {
        capability: opts.capability,
        actionSummary: opts.actionSummary.slice(0, 150) + ' [sha256:' + actionHash + ']',
        decision: 'always',
        actor,
      },
    })
    await db.permissionGrant
      .update({
        where: { capability: opts.capability },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {})
    return { allowed: true, decision: 'always', actionHash }
  }

  if (policy === 'deny') {
    await recordPermissionAudit({
      capability: opts.capability,
      actionSummary: opts.actionSummary,
      decision: 'deny',
      actor,
    })
    return {
      allowed: false,
      decision: 'deny',
      reason: `Permission "${spec.title}" is set to Deny. Change it in the Permissions panel to allow Eva to run this action.`,
      actionHash,
    }
  }

  // Check for an approved, unexpired, single-use durable lease matching this exact actionHash.
  if (
    await consumeApprovedLease({
      capability: opts.capability,
      actionHash,
      actionSummary: opts.actionSummary,
      actor,
    })
  ) {
    return { allowed: true, decision: 'once', actionHash }
  }

  const ctx = permissionContextStorage.getStore()
  const shouldDeferOffline = Boolean(ctx?.automationId || ctx?.deferWhenOffline || opts.deferWhenOffline)

  // Policy is 'ask' -> request interactive one-time decision or queue a deferred approval for unattended runs
  if (!controlBus.hasUiClients()) {
    if (shouldDeferOffline) {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + DEFERRED_LEASE_TTL_MS)
      const existingPending = await db.permissionRequest
        .findFirst({
          where: {
            actionHash,
            capability: opts.capability,
            status: 'pending',
            expiresAt: { gt: now },
          },
        })
        .catch(() => null)
      const requestId = existingPending?.requestId ?? 'perm_' + randomUUID()
      if (!existingPending) {
        await db.permissionRequest
          .create({
            data: {
              requestId,
              actionHash,
              capability: opts.capability,
              actionName: actionName.slice(0, 120),
              actionSummary: opts.actionSummary.slice(0, 260),
              actor,
              details: (opts.details ?? '').slice(0, 500),
              status: 'pending',
              automationId: ctx?.automationId ?? null,
              runId: ctx?.runId ?? null,
              expiresAt,
            },
          })
          .catch(() => {})
      }
      return {
        allowed: false,
        decision: 'timeout',
        deferred: true,
        requestId,
        reason: `Queued "${spec.title}" in Deferred Approvals Inbox awaiting owner approval.`,
        actionHash,
      }
    }
    return {
      allowed: false,
      decision: 'timeout',
      reason: `Permission "${spec.title}" requires approval in the open Nexus workspace UI (no active browser client connected).`,
      actionHash,
    }
  }

  const requestId = 'perm_' + randomUUID()
  const timeoutMs = opts.timeoutMs ?? 45_000
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + timeoutMs)

  await db.permissionRequest
    .create({
      data: {
        requestId,
        actionHash,
        capability: opts.capability,
        actionName: actionName.slice(0, 120),
        actionSummary: opts.actionSummary.slice(0, 260),
        actor,
        details: (opts.details ?? '').slice(0, 500),
        status: 'pending',
        automationId: ctx?.automationId ?? null,
        runId: ctx?.runId ?? null,
        expiresAt,
      },
    })
    .catch(() => {})

  controlBus.broadcastEvaMood('curious', `Waiting for approval: ${spec.title}`, timeoutMs)
  const decision = await controlBus.waitForPermission(
    {
      requestId,
      actionHash,
      capability: opts.capability,
      title: spec.title,
      description: spec.description,
      actionSummary: opts.actionSummary,
      actor,
      details: opts.details,
      automationId: ctx?.automationId ?? null,
      runId: ctx?.runId ?? null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    timeoutMs
  )

  if (decision === 'always' || decision === 'once') {
    if (decision === 'always' && !requiresSingleUseApproval(opts.capability)) {
      await db.permissionGrant
        .upsert({
          where: { capability: opts.capability },
          create: { capability: opts.capability, policy: 'always', lastUsedAt: new Date() },
          update: { policy: 'always', lastUsedAt: new Date() },
        })
        .catch(() => {})
    }
    return { allowed: true, decision, actionHash }
  }

  if (decision === 'timeout') {
    await db.permissionRequest
      .updateMany({
        where: { requestId, status: 'pending' },
        data: { status: 'expired', decision: 'timeout', resolvedAt: new Date() },
      })
      .catch(() => {})
    await recordPermissionAudit({
      capability: opts.capability,
      actionSummary: opts.actionSummary,
      decision: 'timeout',
      actor,
    })
    return {
      allowed: false,
      decision: 'timeout',
      reason: `Permission prompt for "${spec.title}" timed out without a response.`,
      actionHash,
    }
  }

  return {
    allowed: false,
    decision: 'deny',
    reason: `User declined permission "${spec.title}" for: ${opts.actionSummary}`,
    actionHash,
  }
}
