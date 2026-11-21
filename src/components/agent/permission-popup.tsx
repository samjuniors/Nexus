'use client'

import { useEffect, useState } from 'react'
import { Check, CheckCheck, ShieldAlert, X } from 'lucide-react'
import { MochiEyes } from '@/components/agent/mochi-eyes'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { requiresSingleUseApproval } from '@/lib/agent/permission-policy'
import { cn } from '@/lib/utils'

/**
 * Interactive one-time per-capability permission request card.
 * Appears when Eva or a subagent invokes a capability whose policy is set to "ask".
 * Grants: Allow Always (persisted in DB), Allow Once, or Deny.
 */
export function PermissionPopup() {
  const pending = useEvaControl((s) => s.pendingPermissions)
  const respondPermission = useEvaControl((s) => s.respondPermission)
  const openSplit = useEvaControl((s) => s.openSplit)
  const [submitting, setSubmitting] = useState(false)

  const current = pending[0] ?? null

  useEffect(() => {
    if (!current) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        void respondPermission(current.requestId, 'deny')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, respondPermission, submitting])

  if (!current) return null

  const decide = async (decision: 'always' | 'once' | 'deny') => {
    if (submitting) return
    setSubmitting(true)
    try {
      await respondPermission(current.requestId, decision)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="eva-perm-title"
      aria-describedby="eva-perm-desc"
      data-eva-permission-popup="1"
      className="fixed right-4 bottom-20 z-[65] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-amber-400/35 bg-popover p-4 text-popover-foreground shadow-2xl md:right-6 md:bottom-24"
    >
      <div className="flex items-start gap-3">
        <MochiEyes expression="curious" archetype="eva" size="sm" trackGaze={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-amber-500 dark:text-amber-300">
              <ShieldAlert className="h-3 w-3" />
              Permission Request{pending.length > 1 ? ` · 1/${pending.length}` : ''}
            </span>
            <button
              type="button"
              onClick={() => openSplit('permissions', 'Permissions Vault')}
              className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Vault
            </button>
          </div>
          <h2 id="eva-perm-title" className="mt-1 text-sm font-semibold leading-snug">
            {current.title}
          </h2>
          <p id="eva-perm-desc" className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {current.description}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {current.actor} wants to run
        </div>
        <div className="mt-0.5 break-words font-mono text-xs text-foreground">
          {current.actionSummary}
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground" title={current.actionHash}>Action SHA-256: {current.actionHash?.slice(0, 16)}</div>
      </div>

      <div className={cn('mt-3.5 grid gap-2', requiresSingleUseApproval(current.capability) ? 'grid-cols-2' : 'grid-cols-3')}>
        {!requiresSingleUseApproval(current.capability) && <button
          type="button"
          disabled={submitting}
          onClick={() => void decide('always')}
          className={cn(
            'inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-200',
            submitting && 'opacity-50'
          )}
        >
          <CheckCheck className="h-3.5 w-3.5 shrink-0" />
          Allow Always
        </button>}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void decide('once')}
          className={cn(
            'inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-secondary px-2.5 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent',
            submitting && 'opacity-50'
          )}
        >
          <Check className="h-3.5 w-3.5 shrink-0" />
          Allow Once
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void decide('deny')}
          className={cn(
            'inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20',
            submitting && 'opacity-50'
          )}
        >
          <X className="h-3.5 w-3.5 shrink-0" />
          Deny
        </button>
      </div>
    </div>
  )
}
