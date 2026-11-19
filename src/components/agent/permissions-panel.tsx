'use client'

import { useEffect } from 'react'
import { CheckCheck, Clock, Shield, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { PermissionPolicy } from '@/lib/agent/permissions'
import { cn } from '@/lib/utils'

const POLICIES: { value: PermissionPolicy; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
]

/**
 * Permissions Vault panel — manage Eva's one-time capability grants and review audit history.
 */
export function PermissionsPanel() {
  const grants = useEvaControl((s) => s.grants)
  const auditLog = useEvaControl((s) => s.auditLog)
  const refreshPermissions = useEvaControl((s) => s.refreshPermissions)
  const updateGrantPolicy = useEvaControl((s) => s.updateGrantPolicy)

  useEffect(() => {
    void refreshPermissions()
  }, [refreshPermissions])

  const allowAllCount = grants.filter((g) => g.policy === 'always').length

  return (
    <div data-permissions-panel="1" className="nice-scroll flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 pb-28">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold">Permissions Vault</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Grant a capability once with <span className="font-medium text-foreground">Always</span> and Eva handles installs, UI panels, browser automation, and tool setup autonomously.
          </p>
        </div>
        <div className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {allowAllCount}/{grants.length || 5} always
        </div>
      </div>

      {/* Capability Grant Table */}
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

            {/* Segmented Always / Ask / Deny control */}
            <div
              role="group"
              aria-label={`Permission policy for ${grant.title}`}
              className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-background"
            >
              {POLICIES.map((opt) => {
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
    </div>
  )
}
