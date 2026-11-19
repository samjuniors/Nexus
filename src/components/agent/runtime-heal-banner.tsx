'use client'

import { AlertTriangle, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEvaControl } from '@/lib/agent/eva-control-store'

/**
 * Floating automatic error-recovery trigger banner for uncaught client runtime errors.
 * Offers one-click dispatch to Eva's Self-Heal Studio with full stack context.
 */
export function RuntimeHealBanner() {
  const alert = useEvaControl((s) => s.runtimeErrorAlert)
  const busy = useEvaControl((s) => s.selfHealBusy)
  const triggerAutoHeal = useEvaControl((s) => s.triggerAutoHeal)
  const dismiss = useEvaControl((s) => s.dismissRuntimeErrorAlert)

  if (!alert) return null

  return (
    <div
      role="alert"
      data-runtime-heal-banner="1"
      className="fixed bottom-4 left-4 z-50 w-full max-w-md rounded-xl border border-red-500/35 bg-card p-3.5 shadow-xl"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">Runtime error detected</span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss runtime error alert"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 line-clamp-2 font-mono text-[11px] leading-relaxed text-muted-foreground break-words">
            {alert.message}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy}
              className="h-7 gap-1.5 text-xs"
              onClick={() =>
                void triggerAutoHeal({
                  trigger: 'runtime_error',
                  errorMessage: alert.message,
                  stack: alert.stack,
                  viewName: alert.source,
                })
              }
            >
              <Sparkles className="h-3 w-3" />
              <span>Auto-Heal with Eva</span>
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
