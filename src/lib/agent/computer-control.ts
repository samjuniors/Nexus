import { db } from '@/lib/db'
import {
  controlBus,
  type AutomationSessionActionLog,
  type AutomationSessionSnapshot,
  type AutomationSessionStatus,
} from '@/lib/agent/control-bus'

import {
  DEFAULT_WINDOWS_APP_PRESETS,
  DEFAULT_WINDOWS_FOLDER_PRESETS,
  type AllowedDesktopAppDTO,
  type AppAllowPolicy,
  type ConnectedFolderDTO,
  type FolderAccessMode,
} from '@/lib/agent/computer-control-types'

export {
  DEFAULT_WINDOWS_APP_PRESETS,
  DEFAULT_WINDOWS_FOLDER_PRESETS,
  type AllowedDesktopAppDTO,
  type AppAllowPolicy,
  type ConnectedFolderDTO,
  type FolderAccessMode,
}

/**
 * Pure path normalization for cross-platform Windows (`C:\Users\...`, `%USERPROFILE%\...`)
 * and POSIX (`/Users/...`) folder containment checks. Blocks `..` traversal and prefix spoofing.
 */
export function normalizeFolderPath(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '')
  if (!trimmed) return ''
  // Normalize slashes consistently; preserve drive letter casing cleanly
  const isWinStyle = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.includes('\\') || trimmed.startsWith('%')
  if (isWinStyle) {
    const parts = trimmed.replace(/\//g, '\\').split('\\').filter((p, idx) => p.length > 0 || idx === 0)
    const stack: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        if (stack.length > 1) stack.pop()
        continue
      }
      stack.push(part)
    }
    return stack.join('\\').replace(/\\+$/, '')
  }
  const parts = trimmed.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return '/' + stack.join('/')
}

/**
 * Strict containment check: verifies `targetPath` lies inside an enabled ConnectedFolder
 * and respects `read` vs `read_write` access mode.
 */
export function evaluateFolderAccess(
  targetPath: string,
  operation: 'read' | 'write',
  folders: Pick<ConnectedFolderDTO, 'id' | 'label' | 'path' | 'accessMode' | 'enabled'>[]
): {
  allowed: boolean
  folder: Pick<ConnectedFolderDTO, 'id' | 'label' | 'path' | 'accessMode' | 'enabled'> | null
  reason: string
} {
  if (!targetPath || !targetPath.trim()) {
    return { allowed: false, folder: null, reason: 'Target path is empty.' }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(targetPath)) {
    return { allowed: false, folder: null, reason: 'Path traversal (..) is blocked by Connected Folders guard.' }
  }
  const normTarget = normalizeFolderPath(targetPath).toLowerCase()
  const enabledFolders = folders.filter((f) => f.enabled)
  for (const folder of enabledFolders) {
    const normRoot = normalizeFolderPath(folder.path).toLowerCase()
    if (!normRoot) continue
    const sep = normRoot.includes('\\') ? '\\' : '/'
    const isExact = normTarget === normRoot
    const isChild = normTarget.startsWith(normRoot + sep)
    if (isExact || isChild) {
      if (operation === 'write' && folder.accessMode !== 'read_write') {
        return {
          allowed: false,
          folder,
          reason: `Connected folder "${folder.label}" is set to Read-Only. Switch it to Read & Write in Permissions to allow edits.`,
        }
      }
      return {
        allowed: true,
        folder,
        reason: `Authorized under Connected Folder "${folder.label}" (${folder.accessMode}).`,
      }
    }
  }
  return {
    allowed: false,
    folder: null,
    reason: `Path "${targetPath}" is outside your Connected Folders allowlist. Add its parent folder in Permissions > Connected Folders.`,
  }
}

/**
 * Evaluates whether an application launch or focus command is permitted by the per-app allowlist.
 */
export function evaluateAppPolicy(
  appQuery: string,
  apps: Pick<AllowedDesktopAppDTO, 'name' | 'executable' | 'policy'>[]
): {
  policy: AppAllowPolicy
  matchedApp: Pick<AllowedDesktopAppDTO, 'name' | 'executable' | 'policy'> | null
} {
  const clean = appQuery.trim().toLowerCase()
  if (!clean) return { policy: 'deny', matchedApp: null }
  const bareExe = clean.split(/[\\/]/).pop() ?? clean
  const bareNoExt = bareExe.replace(/\.exe$/i, '')

  for (const app of apps) {
    const exeLower = app.executable.toLowerCase()
    const exeNoExt = exeLower.replace(/\.exe$/i, '')
    const nameLower = app.name.toLowerCase()
    if (
      bareExe === exeLower ||
      bareNoExt === exeNoExt ||
      clean === nameLower ||
      nameLower.includes(clean)
    ) {
      return { policy: app.policy, matchedApp: app }
    }
  }
  // Unlisted apps default to "ask" so user must explicitly approve before launch
  return { policy: 'ask', matchedApp: null }
}

let defaultsSeedPromise: Promise<void> | null = null

export function ensureComputerControlDefaults(): Promise<void> {
  if (defaultsSeedPromise) return defaultsSeedPromise
  defaultsSeedPromise = (async () => {
    try {
      const existingApps = await db.allowedDesktopApp.count()
      if (existingApps === 0) {
        for (const preset of DEFAULT_WINDOWS_APP_PRESETS) {
          await db.allowedDesktopApp.upsert({
            where: { executable: preset.executable },
            create: {
              name: preset.name,
              executable: preset.executable,
              platform: 'windows',
              policy: preset.policy,
              category: preset.category,
            },
            update: {},
          })
        }
      }
      const existingFolders = await db.connectedFolder.count()
      if (existingFolders === 0) {
        // Seed Downloads & Desktop as safe default entries (Documents/Pictures one-click addable)
        for (const preset of DEFAULT_WINDOWS_FOLDER_PRESETS.slice(0, 2)) {
          await db.connectedFolder.upsert({
            where: { path: preset.path },
            create: {
              label: preset.label,
              path: preset.path,
              platform: 'windows',
              accessMode: preset.accessMode,
              enabled: true,
            },
            update: {},
          })
        }
      }
    } catch {
      defaultsSeedPromise = null
    }
  })()
  return defaultsSeedPromise
}

export async function listConnectedFolders(): Promise<ConnectedFolderDTO[]> {
  await ensureComputerControlDefaults()
  const rows = await db.connectedFolder.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    path: r.path,
    platform: (r.platform === 'macos' || r.platform === 'linux' ? r.platform : 'windows') as ConnectedFolderDTO['platform'],
    accessMode: r.accessMode === 'read_write' ? 'read_write' : 'read',
    enabled: Boolean(r.enabled),
    lastAccessedAt: r.lastAccessedAt ? new Date(r.lastAccessedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  }))
}

export async function listAllowedDesktopApps(): Promise<AllowedDesktopAppDTO[]> {
  await ensureComputerControlDefaults()
  const rows = await db.allowedDesktopApp.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    executable: r.executable,
    platform: (r.platform === 'macos' || r.platform === 'linux' ? r.platform : 'windows') as AllowedDesktopAppDTO['platform'],
    policy: (r.policy === 'always' || r.policy === 'deny' ? r.policy : 'ask') as AppAllowPolicy,
    category: (['browser', 'creative', 'dev', 'system', 'productivity'].includes(r.category)
      ? r.category
      : 'productivity') as AllowedDesktopAppDTO['category'],
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
    createdAt: new Date(r.createdAt).toISOString(),
  }))
}

export async function syncAllowlistsToConnectedDevices(): Promise<void> {
  const [folders, apps] = await Promise.all([listConnectedFolders(), listAllowedDesktopApps()])
  controlBus.pushAllowlistToDevices({
    folders: folders.map((f) => ({
      id: f.id,
      label: f.label,
      path: f.path,
      accessMode: f.accessMode,
      enabled: f.enabled,
    })),
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      executable: a.executable,
      policy: a.policy,
    })),
  })
}

export async function addConnectedFolder(input: {
  label: string
  path: string
  platform?: 'windows' | 'macos' | 'linux'
  accessMode?: FolderAccessMode
}): Promise<ConnectedFolderDTO> {
  const cleanPath = normalizeFolderPath(input.path)
  if (!cleanPath) throw new Error('Folder path is required.')
  const label = input.label.trim() || cleanPath.split(/[\\/]/).pop() || 'Connected Folder'
  const accessMode: FolderAccessMode = input.accessMode === 'read_write' ? 'read_write' : 'read'
  const platform = input.platform ?? (cleanPath.startsWith('/') ? 'macos' : 'windows')

  const row = await db.connectedFolder.upsert({
    where: { path: cleanPath },
    create: {
      label,
      path: cleanPath,
      platform,
      accessMode,
      enabled: true,
    },
    update: {
      label,
      accessMode,
      enabled: true,
    },
  })
  await syncAllowlistsToConnectedDevices()
  return {
    id: row.id,
    label: row.label,
    path: row.path,
    platform: (row.platform === 'macos' || row.platform === 'linux' ? row.platform : 'windows') as ConnectedFolderDTO['platform'],
    accessMode: row.accessMode === 'read_write' ? 'read_write' : 'read',
    enabled: Boolean(row.enabled),
    lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

export async function updateConnectedFolder(
  id: string,
  patch: { label?: string; accessMode?: FolderAccessMode; enabled?: boolean }
): Promise<ConnectedFolderDTO> {
  const row = await db.connectedFolder.update({
    where: { id },
    data: {
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.accessMode !== undefined ? { accessMode: patch.accessMode } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  })
  await syncAllowlistsToConnectedDevices()
  return {
    id: row.id,
    label: row.label,
    path: row.path,
    platform: (row.platform === 'macos' || row.platform === 'linux' ? row.platform : 'windows') as ConnectedFolderDTO['platform'],
    accessMode: row.accessMode === 'read_write' ? 'read_write' : 'read',
    enabled: Boolean(row.enabled),
    lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

export async function deleteConnectedFolder(id: string): Promise<void> {
  await db.connectedFolder.delete({ where: { id } }).catch(() => {})
  await syncAllowlistsToConnectedDevices()
}

export async function addAllowedDesktopApp(input: {
  name: string
  executable: string
  platform?: 'windows' | 'macos' | 'linux'
  policy?: AppAllowPolicy
  category?: AllowedDesktopAppDTO['category']
}): Promise<AllowedDesktopAppDTO> {
  const exe = input.executable.trim()
  if (!exe) throw new Error('Application executable or identifier is required.')
  const name = input.name.trim() || exe
  const policy: AppAllowPolicy =
    input.policy === 'always' || input.policy === 'deny' ? input.policy : 'ask'
  const category = input.category ?? 'productivity'
  const platform = input.platform ?? 'windows'

  const row = await db.allowedDesktopApp.upsert({
    where: { executable: exe },
    create: { name, executable: exe, platform, policy, category },
    update: { name, policy, category },
  })
  await syncAllowlistsToConnectedDevices()
  return {
    id: row.id,
    name: row.name,
    executable: row.executable,
    platform: (row.platform === 'macos' || row.platform === 'linux' ? row.platform : 'windows') as AllowedDesktopAppDTO['platform'],
    policy: (row.policy === 'always' || row.policy === 'deny' ? row.policy : 'ask') as AppAllowPolicy,
    category: (['browser', 'creative', 'dev', 'system', 'productivity'].includes(row.category)
      ? row.category
      : 'productivity') as AllowedDesktopAppDTO['category'],
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

export async function updateAllowedDesktopApp(
  id: string,
  patch: { policy?: AppAllowPolicy; name?: string }
): Promise<AllowedDesktopAppDTO> {
  const row = await db.allowedDesktopApp.update({
    where: { id },
    data: {
      ...(patch.policy !== undefined ? { policy: patch.policy } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    },
  })
  await syncAllowlistsToConnectedDevices()
  return {
    id: row.id,
    name: row.name,
    executable: row.executable,
    platform: (row.platform === 'macos' || row.platform === 'linux' ? row.platform : 'windows') as AllowedDesktopAppDTO['platform'],
    policy: (row.policy === 'always' || row.policy === 'deny' ? row.policy : 'ask') as AppAllowPolicy,
    category: (['browser', 'creative', 'dev', 'system', 'productivity'].includes(row.category)
      ? row.category
      : 'productivity') as AllowedDesktopAppDTO['category'],
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

export async function deleteAllowedDesktopApp(id: string): Promise<void> {
  await db.allowedDesktopApp.delete({ where: { id } }).catch(() => {})
  await syncAllowlistsToConnectedDevices()
}

// ============================================================================
// Live Automation Session Controller (Pause / Resume / Takeover / Stop)
// ============================================================================

class AutomationSessionController {
  private snapshot: AutomationSessionSnapshot = {
    sessionId: null,
    target: 'browser',
    status: 'idle',
    goal: '',
    currentStep: '',
    stepIndex: 0,
    totalSteps: 0,
    canTakeOver: true,
    actionLog: [],
    updatedAt: new Date().toISOString(),
  }
  private aborted = false
  private resumeWaiters: (() => void)[] = []

  getSnapshot(): AutomationSessionSnapshot {
    return {
      ...this.snapshot,
      actionLog: [...this.snapshot.actionLog],
    }
  }

  private emit() {
    this.snapshot.updatedAt = new Date().toISOString()
    controlBus.broadcastAutomationSession(this.getSnapshot())
  }

  startSession(params: {
    target: 'browser' | 'windows' | 'hybrid'
    goal: string
    totalSteps?: number
  }): string {
    this.aborted = false
    const sessionId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    this.snapshot = {
      sessionId,
      target: params.target,
      status: 'running',
      goal: params.goal.trim().slice(0, 220),
      currentStep: 'Starting isolated workspace…',
      stepIndex: 0,
      totalSteps: params.totalSteps ?? 8,
      canTakeOver: true,
      actionLog: [],
      updatedAt: new Date().toISOString(),
    }
    this.releaseWaiters()
    this.emit()
    return sessionId
  }

  recordStep(stepIndex: number, label: string, detail?: string, status: AutomationSessionActionLog['status'] = 'running') {
    this.snapshot.stepIndex = stepIndex
    this.snapshot.currentStep = label
    if (this.snapshot.status !== 'paused' && this.snapshot.status !== 'takeover' && this.snapshot.status !== 'awaiting_approval') {
      this.snapshot.status = 'running'
    }
    const entry: AutomationSessionActionLog = {
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      step: stepIndex,
      label,
      detail,
      status,
      ts: new Date().toISOString(),
    }
    this.snapshot.actionLog = [...this.snapshot.actionLog.slice(-14), entry]
    this.emit()
  }

  setAwaitingApproval(summary: string) {
    if (this.snapshot.status === 'idle') return
    this.snapshot.status = 'awaiting_approval'
    this.snapshot.currentStep = `Waiting for approval: ${summary}`
    this.emit()
  }

  clearAwaitingApproval(resumedLabel?: string) {
    if (this.snapshot.status === 'awaiting_approval') {
      this.snapshot.status = 'running'
      if (resumedLabel) this.snapshot.currentStep = resumedLabel
      this.emit()
    }
  }

  pause(): AutomationSessionSnapshot {
    if (this.snapshot.status === 'running' || this.snapshot.status === 'takeover') {
      this.snapshot.status = 'paused'
      this.snapshot.currentStep = 'Paused by you — resume anytime'
      this.emit()
    }
    return this.getSnapshot()
  }

  resume(): AutomationSessionSnapshot {
    if (this.snapshot.status === 'paused' || this.snapshot.status === 'takeover') {
      this.snapshot.status = 'running'
      this.snapshot.currentStep = 'Resuming isolated workflow…'
      this.releaseWaiters()
      this.emit()
    }
    return this.getSnapshot()
  }

  enterTakeover(): AutomationSessionSnapshot {
    if (this.snapshot.status !== 'idle') {
      this.snapshot.status = 'takeover'
      this.snapshot.currentStep = 'Manual takeover active — click or type in preview'
      this.emit()
    }
    return this.getSnapshot()
  }

  stop(reason = 'Stopped by user'): AutomationSessionSnapshot {
    this.aborted = true
    this.snapshot.status = 'idle'
    this.snapshot.currentStep = reason
    this.releaseWaiters()
    this.emit()
    return this.getSnapshot()
  }

  complete(summary: string) {
    this.aborted = false
    this.snapshot.status = 'completed'
    this.snapshot.currentStep = summary
    this.releaseWaiters()
    this.emit()
  }

  fail(errorMsg: string) {
    this.aborted = false
    this.snapshot.status = 'error'
    this.snapshot.currentStep = errorMsg
    this.releaseWaiters()
    this.emit()
  }

  isStopped(): boolean {
    return this.aborted
  }

  /**
   * Async execution barrier checked before every automation step.
   * Suspends cleanly while Paused or in Manual Takeover, and returns `false` if Stopped.
   */
  async waitIfPausedOrTakeover(): Promise<boolean> {
    if (this.aborted) return false
    while (this.snapshot.status === 'paused' || this.snapshot.status === 'takeover') {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve)
      })
      if (this.aborted) return false
    }
    return !this.aborted
  }

  private releaseWaiters() {
    const list = this.resumeWaiters
    this.resumeWaiters = []
    for (const fn of list) fn()
  }
}

const g = globalThis as unknown as { __nexusAutomationSession?: AutomationSessionController }
export const automationSession = g.__nexusAutomationSession ?? new AutomationSessionController()
g.__nexusAutomationSession = automationSession
