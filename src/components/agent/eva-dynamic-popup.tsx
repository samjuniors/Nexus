'use client'

import { ArrowUpRight, Sparkles, X } from 'lucide-react'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import type { Tab } from '@/lib/agent/client'
import { MochiEyes } from '@/components/agent/mochi-eyes'

const VALID_TABS = new Set<Tab>([
  'agent',
  'org',
  'automations',
  'brain',
  'artifacts',
  'marketplace',
  'plugins',
  'skills',
  'tools',
  'mcps',
  'memory',
])

const VALID_SPLITS = new Set<SplitMode>([
  'browser',
  'permissions',
  'devices',
  'org',
  'artifacts',
  'tools',
  'automations',
  'brain',
])

/**
 * Renders dynamic interactive popups spawned by Eva via `app_control({ action: 'open_popup' })`.
 */
export function EvaDynamicPopup() {
  const popups = useEvaControl((s) => s.popups)
  const dismissPopup = useEvaControl((s) => s.dismissPopup)
  const openSplit = useEvaControl((s) => s.openSplit)
  const browserAction = useEvaControl((s) => s.browserAction)
  const setTab = useApp((s) => s.setTab)

  if (popups.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-16 right-4 z-[60] flex w-[min(23rem,calc(100vw-2rem))] flex-col gap-2.5 md:right-6"
    >
      {popups.map((popup) => (
        <div
          key={popup.id}
          data-eva-dynamic-popup="1"
          className="pointer-events-auto rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-xl"
        >
          <div className="flex items-start gap-2.5">
            <MochiEyes expression="wake" archetype="eva" size="xs" trackGaze={false} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-sky-500 dark:text-sky-300">
                  <Sparkles className="h-2.5 w-2.5" /> Eva · {popup.kind}
                </span>
                <button
                  type="button"
                  aria-label={`Dismiss ${popup.title}`}
                  onClick={() => dismissPopup(popup.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <h3 className="mt-0.5 text-xs font-semibold">{popup.title}</h3>
              {popup.body && (
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {popup.body}
                </p>
              )}
              {popup.actions && popup.actions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {popup.actions.map((act, idx) => (
                    <button
                      key={`${popup.id}-act-${idx}`}
                      type="button"
                      onClick={() => {
                        if (act.tab && VALID_TABS.has(act.tab as Tab)) {
                          setTab(act.tab as Tab)
                        }
                        if (act.splitMode && VALID_SPLITS.has(act.splitMode as SplitMode)) {
                          openSplit(act.splitMode as SplitMode)
                        }
                        if (act.url) {
                          openSplit('browser', 'Live Browser')
                          void browserAction({ action: 'navigate', url: act.url })
                        }
                        dismissPopup(popup.id)
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-accent"
                    >
                      {act.label}
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
