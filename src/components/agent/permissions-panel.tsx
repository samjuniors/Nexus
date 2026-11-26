'use client'

import { useEffect, useState } from 'react'
import {
  AppWindow,
  CheckCheck,
  Clock,
  FolderCheck,
  FolderPlus,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { requiresSingleUseApproval } from '@/lib/agent/permission-policy'
import type { PermissionPolicy } from '@/lib/agent/permissions'
import {
  DEFAULT_WINDOWS_FOLDER_PRESETS,
  type AppAllowPolicy,
  type FolderAccessMode,
} from '@/lib/agent/computer-control-types'
import { cn } from '@/lib/utils'

const POLICIES: { value: PermissionPolicy; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
]

/**
 * Permissions Vault panel — manage Eva's capability grants, Connected Folders allowlist,
 * Per-App Desktop Allowlist, and review audit history.
 */
export function PermissionsPanel() {
  const grants = useEvaControl((s) => s.grants)
  const auditLog = useEvaControl((s) => s.auditLog)
  const pendingPermissions = useEvaControl((s) => s.pendingPermissions)
  const connectedFolders = useEvaControl((s) => s.connectedFolders)
  const allowedApps = useEvaControl((s) => s.allowedApps)
  const computerBusy = useEvaControl((s) => s.computerControlBusy)

  const refreshPermissions = useEvaControl((s) => s.refreshPermissions)
  const respondPermission = useEvaControl((s) => s.respondPermission)
  const refreshComputerControl = useEvaControl((s) => s.refreshComputerControl)
  const updateGrantPolicy = useEvaControl((s) => s.updateGrantPolicy)
  const addConnectedFolder = useEvaControl((s) => s.addConnectedFolder)
  const updateConnectedFolder = useEvaControl((s) => s.updateConnectedFolder)
  const deleteConnectedFolder = useEvaControl((s) => s.deleteConnectedFolder)
  const addAllowedApp = useEvaControl((s) => s.addAllowedApp)
  const updateAllowedApp = useEvaControl((s) => s.updateAllowedApp)
  const deleteAllowedApp = useEvaControl((s) => s.deleteAllowedApp)

  const [tab, setTab] = useState<'capabilities' | 'folders' | 'apps'>('capabilities')

  // Custom folder form
  const [folderLabel, setFolderLabel] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [folderAccess, setFolderAccess] = useState<FolderAccessMode>('read_write')
  const [folderError, setFolderError] = useState<string | null>(null)

  // Custom app form
  const [appName, setAppName] = useState('')
  const [appExe, setAppExe] = useState('')
  const [appPolicy, setAppPolicy] = useState<AppAllowPolicy>('always')
  const [appError, setAppError] = useState<string | null>(null)

  useEffect(() => {
    void refreshPermissions()
    void refreshComputerControl()
  }, [refreshPermissions, refreshComputerControl])

  const allowAllCount = grants.filter((g) => g.policy === 'always').length
  const enabledFolderCount = connectedFolders.filter((f) => f.enabled).length
  const allowedAppCount = allowedApps.filter((a) => a.policy === 'always').length

  const handleAddFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folderPath.trim()) return
    setFolderError(null)
    const res = await addConnectedFolder({
      label: folderLabel.trim() || folderPath.trim().split(/[\\/]/).pop() || 'Custom Folder',
      path: folderPath.trim(),
      accessMode: folderAccess,
    })
    if (res.ok) {
      setFolderLabel('')
      setFolderPath('')
    } else if (res.error) {
      setFolderError(res.error)
    }
  }

  const handleAddApp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appExe.trim()) return
    setAppError(null)
    const res = await addAllowedApp({
      name: appName.trim() || appExe.trim(),
      executable: appExe.trim(),
      policy: appPolicy,
      category: 'productivity',
    })
    if (res.ok) {
      setAppName('')
      setAppExe('')
    } else if (res.error) {
      setAppError(res.error)
    }
  }

  return (
    <div
      data-permissions-panel="1"
      className="nice-scroll flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 pb-28"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Permissions &amp; Access Controls</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Control exactly which capabilities, local Windows folders, and desktop apps Eva can touch. Changes sync live to connected bridges.
          </p>
        </div>
        <div className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {tab === 'capabilities'
            ? `${allowAllCount}/${grants.length || 5} always`
            : tab === 'folders'
              ? `${enabledFolderCount}/${connectedFolders.length} active`
              : `${allowedAppCount}/${allowedApps.length} always`}
        </div>
      </div>

      {/* Segmented sub-tabs */}
      <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-md border border-border bg-card/40">
        {(
          [
            { id: 'capabilities', label: 'Capabilities', icon: Shield },
            { id: 'folders', label: 'Connected Folders', icon: FolderCheck },
            { id: 'apps', label: 'Allowed Apps', icon: AppWindow },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11.5px] font-medium transition-colors',
              tab === id
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* CAPABILITIES TAB */}
      {tab === 'capabilities' && (
        <>
          {pendingPermissions.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/8 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Pending &amp; Deferred Approvals
                </span>
                <span className="font-mono text-[10px] tabular-nums text-amber-600 dark:text-amber-300">
                  {pendingPermissions.length} queued
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {pendingPermissions.map((req) => {
                  const singleUseOnly = requiresSingleUseApproval(req.capability)
                  return (
                    <div
                      key={req.requestId}
                      className="rounded-md border border-border bg-background/90 p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{req.title}</span>
                        {req.automationId && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9.5px] text-amber-600 dark:text-amber-300">
                            Deferred Automation
                          </span>
                        )}
                      </div>
                      <div className="mt-1 break-words font-mono text-[11px] text-foreground">
                        {req.actionSummary}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground" title={req.actionHash}>
                        {req.actor} · {req.capability} · sha256:{req.actionHash.slice(0, 12)}
                      </div>
                      <div className={cn('mt-2 grid gap-1.5', singleUseOnly ? 'grid-cols-2' : 'grid-cols-3')}>
                        {!singleUseOnly && (
                          <button
                            type="button"
                            onClick={() => void respondPermission(req.requestId, 'always')}
                            className="rounded border border-emerald-500/40 bg-emerald-500/12 px-2 py-1 font-mono text-[10.5px] font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-200"
                          >
                            Allow Always
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void respondPermission(req.requestId, 'once')}
                          className="rounded border border-border bg-secondary px-2 py-1 font-mono text-[10.5px] font-medium text-secondary-foreground hover:bg-accent"
                        >
                          Allow Once
                        </button>
                        <button
                          type="button"
                          onClick={() => void respondPermission(req.requestId, 'deny')}
                          className="rounded border border-destructive/35 bg-destructive/10 px-2 py-1 font-mono text-[10.5px] font-medium text-destructive hover:bg-destructive/20"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-card/40">
            {grants.map((grant) => (
              <div key={grant.capability} className="flex flex-col gap-2.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {grant.policy === 'always' ? (
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : grant.policy === 'deny' ? (
                        <ShieldOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : (
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      )}
                      <span className="text-xs font-semibold text-foreground">{grant.title}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                      {grant.description}
                    </p>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {grant.capability} · risk: {grant.risk}
                      {grant.lastUsedAt && ` · last used ${new Date(grant.lastUsedAt).toLocaleTimeString()}`}
                    </div>
                  </div>
                </div>

                <div
                  role="group"
                  aria-label={`Permission policy for ${grant.title}`}
                  className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-background"
                >
                  {POLICIES.filter((opt) => !(opt.value === 'always' && requiresSingleUseApproval(grant.capability))).map((opt) => {
                    const active = grant.policy === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => void updateGrantPolicy(grant.capability, opt.value)}
                        className={cn(
                          'px-2 py-1.5 font-mono text-[11px] font-medium transition-colors',
                          active && opt.value === 'always'
                            ? 'bg-emerald-500/18 text-emerald-600 dark:text-emerald-300'
                            : active && opt.value === 'ask'
                              ? 'bg-amber-500/18 text-amber-600 dark:text-amber-300'
                              : active && opt.value === 'deny'
                                ? 'bg-destructive/18 text-destructive'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Audit Log */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <Clock className="h-3 w-3" /> Recent Permission Audit
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {auditLog.length} events
              </span>
            </div>

            {auditLog.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No permission events recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border bg-card/30">
                {auditLog.slice(0, 15).map((ev) => (
                  <div key={ev.id} className="flex items-start justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{ev.actionSummary}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {ev.actor} · {ev.capability} · {new Date(ev.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[10.5px] font-medium',
                        ev.decision === 'always' || ev.decision === 'once'
                          ? 'text-emerald-500 dark:text-emerald-300'
                          : 'text-destructive'
                      )}
                    >
                      {ev.decision === 'always' && <CheckCheck className="mr-0.5 inline h-3 w-3" />}
                      {ev.decision}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* CONNECTED FOLDERS TAB */}
      {tab === 'folders' && (
        <div className="mt-3 space-y-3">
          {/* Quick Windows presets */}
          <div className="rounded-lg border border-border bg-card/40 p-3">
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Windows Folder Presets
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEFAULT_WINDOWS_FOLDER_PRESETS.map((preset) => {
                const exists = connectedFolders.some(
                  (f) => f.path.toLowerCase() === preset.path.toLowerCase()
                )
                return (
                  <button
                    key={preset.path}
                    type="button"
                    disabled={computerBusy || exists}
                    onClick={() =>
                      void addConnectedFolder({
                        label: preset.label,
                        path: preset.path,
                        platform: 'windows',
                        accessMode: preset.accessMode,
                      })
                    }
                    className={cn(
                      'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                      exists
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-border bg-background text-foreground hover:bg-muted'
                    )}
                  >
                    <FolderPlus className="h-3 w-3" />
                    {preset.label}
                    {exists && ' · Added'}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Add custom folder */}
          <form
            onSubmit={handleAddFolder}
            className="space-y-2 rounded-lg border border-border bg-card/40 p-3"
          >
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Add Custom Folder Allowlist
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={folderLabel}
                onChange={(e) => setFolderLabel(e.target.value)}
                placeholder="Label (e.g. Product Photos)"
                className="h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
              />
              <select
                value={folderAccess}
                onChange={(e) => setFolderAccess(e.target.value as FolderAccessMode)}
                className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none"
              >
                <option value="read">Read-Only</option>
                <option value="read_write">Read &amp; Write</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="C:\Users\You\Pictures\Inventory or %USERPROFILE%\Documents"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                disabled={computerBusy || !folderPath.trim()}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-40 dark:text-emerald-300"
              >
                <Plus className="h-3.5 w-3.5" />
                Connect
              </button>
            </div>
            {folderError && <p className="text-xs text-destructive">{folderError}</p>}
          </form>

          {/* Connected folders list */}
          {connectedFolders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              No folders connected. Eva is blocked from reading or writing local files until you connect a folder above.
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
              {connectedFolders.map((folder) => (
                <div key={folder.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            folder.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                          )}
                        />
                        <span className="truncate">{folder.label}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                        {folder.path}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteConnectedFolder(folder.id)}
                      aria-label={`Remove ${folder.label}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                      <button
                        type="button"
                        onClick={() => void updateConnectedFolder(folder.id, { accessMode: 'read' })}
                        className={cn(
                          'px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors',
                          folder.accessMode === 'read'
                            ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Read-Only
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateConnectedFolder(folder.id, { accessMode: 'read_write' })
                        }
                        className={cn(
                          'px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors',
                          folder.accessMode === 'read_write'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Read &amp; Write
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void updateConnectedFolder(folder.id, { enabled: !folder.enabled })
                      }
                      className={cn(
                        'rounded-md border px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors',
                        folder.enabled
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-border bg-background text-muted-foreground'
                      )}
                    >
                      {folder.enabled ? 'Enabled' : 'Paused'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ALLOWED APPS TAB */}
      {tab === 'apps' && (
        <div className="mt-3 space-y-3">
          <form
            onSubmit={handleAddApp}
            className="space-y-2 rounded-lg border border-border bg-card/40 p-3"
          >
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              Add Desktop App Policy
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="App Name (e.g. Blender)"
                className="h-8 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/50"
              />
              <input
                type="text"
                required
                value={appExe}
                onChange={(e) => setAppExe(e.target.value)}
                placeholder="Executable (e.g. blender.exe)"
                className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/50"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={appPolicy}
                onChange={(e) => setAppPolicy(e.target.value as AppAllowPolicy)}
                className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none"
              >
                <option value="always">Always Allow</option>
                <option value="ask">Ask Before Launch</option>
                <option value="deny">Block / Deny</option>
              </select>
              <button
                type="submit"
                disabled={computerBusy || !appExe.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-40 dark:text-emerald-300"
              >
                <Plus className="h-3.5 w-3.5" />
                Add App
              </button>
            </div>
            {appError && <p className="text-xs text-destructive">{appError}</p>}
          </form>

          <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
            {allowedApps.map((app) => (
              <div key={app.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">{app.name}</div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {app.executable} · {app.category}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteAllowedApp(app.id)}
                    aria-label={`Remove ${app.name}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div
                  role="group"
                  aria-label={`Allow policy for ${app.name}`}
                  className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-background"
                >
                  {POLICIES.map((opt) => {
                    const active = app.policy === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => void updateAllowedApp(app.id, { policy: opt.value })}
                        className={cn(
                          'px-2 py-1 font-mono text-[10.5px] font-medium transition-colors',
                          active && opt.value === 'always'
                            ? 'bg-emerald-500/18 text-emerald-600 dark:text-emerald-300'
                            : active && opt.value === 'ask'
                              ? 'bg-amber-500/18 text-amber-600 dark:text-amber-300'
                              : active && opt.value === 'deny'
                                ? 'bg-destructive/18 text-destructive'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
