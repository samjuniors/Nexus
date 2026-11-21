import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { computeActionHash } from '@/lib/agent/action-binding'
import { controlBus, type PermissionDecision } from '@/lib/agent/control-bus'

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

const SINGLE_USE_CAPABILITIES = new Set<CapabilityKey>([
  'self_install', 'mobile_control', 'workspace_shell', 'desktop_bridge', 'self_code_edit',
])

/** Consequential capabilities must not silently inherit an unlimited old Always grant. */
export function requiresSingleUseApproval(capability: string): boolean {
  return SINGLE_USE_CAPABILITIES.has(capability as CapabilityKey)
}

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

export async function listPermissionGrants(): Promise<PermissionGrantDTO[]> {
  const rows = await db.permissionGrant.findMany()
  const byKey = new Map(rows.map((r) => [r.capability, r]))
  return CAPABILITY_SPECS.map((spec) => {
    const row = byKey.get(spec.capability)
    const configuredPolicy: PermissionPolicy =
      row && isValidPolicy(row.policy) ? row.policy : 'ask'
    const policy: PermissionPolicy = requiresSingleUseApproval(spec.capability) && configuredPolicy === 'always'
      ? 'ask'
      : configuredPolicy
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
  } catch {
    /* audit logging is best-effort */
  }
}

export async function resolvePermissionDecision(
  requestId: string,
  decision: PermissionDecision,
  actionHash: string
): Promise<{ ok: boolean; capability?: string; decision: PermissionDecision }> {
  const pending = controlBus.getPendingPermission(requestId)
  if (!pending || pending.actionHash !== actionHash ||
      !['always', 'once', 'deny'].includes(decision)) return { ok: false, decision }
  if (decision === 'always' && requiresSingleUseApproval(pending.capability)) {
    return { ok: false, decision: 'deny' }
  }
  // A granted action is never released when the durable audit cannot be written.
  if (decision === 'always' || decision === 'once') {
    await db.permissionAuditLog.create({
      data: {
        capability: pending.capability,
        actionSummary: pending.actionSummary.slice(0, 150) + ' [sha256:' + actionHash + ']',
        decision,
        actor: pending.actor || 'Nexus owner',
      },
    })
  }
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
  return { ok: true, capability: req.capability, decision }
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
}): Promise<{ allowed: boolean; decision: PermissionDecision; reason?: string; actionHash: string }> {
  const actor = opts.actor || 'Eva'
  const actionHash = computeActionHash({
    actionName: opts.actionName ?? opts.capability + ':' + opts.actionSummary,
    target: opts.target ?? null,
    payload: opts.payload ?? null,
  })
  const spec = SPEC_BY_KEY.get(opts.capability)!
  const row = await db.permissionGrant.findUnique({ where: { capability: opts.capability } })
  const configuredPolicy: PermissionPolicy = row && isValidPolicy(row.policy) ? row.policy : 'ask'
  const policy: PermissionPolicy = requiresSingleUseApproval(opts.capability) && configuredPolicy === 'always'
    ? 'ask'
    : configuredPolicy

  if (policy === 'always') {
    await db.permissionGrant
      .update({
        where: { capability: opts.capability },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {})
    await recordPermissionAudit({
      capability: opts.capability,
      actionSummary: opts.actionSummary,
      decision: 'always',
      actor,
    })
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

  // Policy is 'ask' -> request interactive one-time decision from the active browser client
  if (!controlBus.hasUiClients()) {
    return {
      allowed: false,
      decision: 'timeout',
      reason: `Permission "${spec.title}" requires approval in the open Nexus workspace UI (no active browser client connected).`,
      actionHash,
    }
  }

  const requestId = 'perm_' + randomUUID()
  controlBus.broadcastEvaMood('curious', `Waiting for approval: ${spec.title}`, 45_000)
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
      createdAt: new Date().toISOString(),
    },
    opts.timeoutMs ?? 45_000
  )

  if (decision === 'always' || decision === 'once') {
    if (decision === 'always') {
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
