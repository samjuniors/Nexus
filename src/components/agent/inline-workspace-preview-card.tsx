'use client'

import { useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Globe,
  Hand,
  Laptop,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  X,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

const STATUS_META: Record<
  string,
  { label: string; dotClass: string; textClass: string }
> = {
  running: {
    label: 'Running in background',
    dotClass: 'bg-emerald-500 animate-pulse',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  paused: {
    label: 'Paused',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  awaiting_approval: {
    label: 'Approval required',
    dotClass: 'bg-amber-500 animate-pulse',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  takeover: {
    label: 'Manual takeover',
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
  completed: {
    label: 'Completed',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  error: {
    label: 'Attention needed',
    dotClass: 'bg-destructive',
    textClass: 'text-destructive',
  },
}

/**
 * Inline live workspace preview card embedded inside the chat stream.
 * Keeps the user's main screen & cursor free while showing the isolated browser
 * or connected Windows PC workspace with Pause, Take Over, Approval, and Expand Split controls.
 */
export function InlineWorkspacePreviewCard() {
  const session = useEvaControl((s) => s.automationSession)
  const browserFrame = useEvaControl((s) => s.browserFrame)
  const desktopFrame = useEvaControl((s) => s.desktopFrame)
  const pendingPermissions = useEvaControl((s) => s.pendingPermissions)
  const computerBusy = useEvaControl((s) => s.computerControlBusy)
  const browserBusy = useEvaControl((s) => s.browserBusy)
  const controlAutomationSession = useEvaControl((s) => s.controlAutomationSession)
  const respondPermission = useEvaControl((s) => s.respondPermission)
  const openSplit = useEvaControl((s) => s.openSplit)
  const browserAction = useEvaControl((s) => s.browserAction)
  const captureWindowsScreen = useEvaControl((s) => s.captureWindowsScreen)
  const windowsBridgeAction = useEvaControl((s) => s.windowsBridgeAction)

  const [viewTarget, setViewTarget] = useState<'auto' | 'browser' | 'windows'>('auto')
  const [collapsed, setCollapsed] = useState(false)
  const [dismissedSessionId, setDismissedSessionId] = useState<string | null>(null)

  const hasBrowser = Boolean(browserFrame?.active)
  const hasDesktop = Boolean(desktopFrame?.active)
  const hasActiveSession = Boolean(session && session.status !== 'idle')
  const isDismissed =
    !hasBrowser &&
    !hasDesktop &&
    session?.status === 'completed' &&
    session.sessionId === dismissedSessionId

  if ((!hasActiveSession && !hasBrowser && !hasDesktop) || isDismissed) {
    return null
  }

  const effectiveTarget: 'browser' | 'windows' =
    viewTarget === 'browser' && hasBrowser
      ? 'browser'
      : viewTarget === 'windows' && hasDesktop
        ? 'windows'
        : session?.target === 'windows' && hasDesktop
          ? 'windows'
          : hasBrowser
            ? 'browser'
            : hasDesktop
              ? 'windows'
              : 'browser'

  const statusKey = session?.status && session.status !== 'idle' ? session.status : 'running'
  const meta = STATUS_META[statusKey] ?? STATUS_META.running
  const isPaused = session?.status === 'paused'
  const isTakeover = session?.status === 'takeover'
  const canControlSession = Boolean(
    session &&
      (session.status === 'running' ||
        session.status === 'paused' ||
        session.status === 'takeover' ||
        session.status === 'awaiting_approval')
  )
  const activePermission = pendingPermissions[0] ?? null

  const handleViewportClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height

    if (effectiveTarget === 'browser' && browserFrame) {
      if (!isTakeover && session?.status === 'running') {
        void controlAutomationSession('takeover')
      }
      const x = Math.round(relX * browserFrame.width)
      const y = Math.round(relY * browserFrame.height)
      void browserAction({ action: 'click', x, y })
      return
    }

    if (effectiveTarget === 'windows' && desktopFrame) {
      const x = Math.round(relX * Math.max(1, desktopFrame.width))
      const y = Math.round(relY * Math.max(1, desktopFrame.height))
      void windowsBridgeAction('ui_click', { x, y }, desktopFrame.deviceId)
    }
  }

  return (
    <section
      data-inline-workspace-card="1"
      aria-label="Isolated workspace live preview"
      className="my-4 overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm"
    >
      {/* Top status strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dotClass)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-foreground">Isolated Workspace</span>
              <span className="text-muted-foreground">·</span>
              <span className={cn('font-medium', meta.textClass)}>{meta.label}</span>
              {session && session.totalSteps > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    Step {Math.min(session.stepIndex, session.totalSteps)}/{session.totalSteps}
                  </span>
                </>
              )}
            </div>
            {(session?.currentStep || browserFrame?.lastAction || desktopFrame?.lastAction) && (
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {session?.currentStep ||
                  (effectiveTarget === 'windows' ? desktopFrame?.lastAction : browserFrame?.lastAction)}
              </p>
            )}
          </div>
        </div>

        {/* Source toggle & expand controls */}
        <div className="flex shrink-0 items-center gap-1">
          {hasBrowser && hasDesktop && (
            <div className="mr-1 inline-flex overflow-hidden rounded-md border border-border bg-background">
              <button
                type="button"
                onClick={() => setViewTarget('browser')}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors',
                  effectiveTarget === 'browser'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Globe className="h-3 w-3" />
                Browser
              </button>
              <button
                type="button"
                onClick={() => setViewTarget('windows')}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors',
                  effectiveTarget === 'windows'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Laptop className="h-3 w-3" />
                Windows PC
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              openSplit(
                'browser',
                effectiveTarget === 'windows' ? 'Windows PC & Browser Workspace' : 'Isolated Browser Workspace'
              )
            }
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Maximize2 className="h-3 w-3" />
            Expand Split
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Show live preview' : 'Minimize live preview'}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>

          {session?.status === 'completed' && !hasBrowser && !hasDesktop && (
            <button
              type="button"
              onClick={() => setDismissedSessionId(session.sessionId)}
              aria-label="Dismiss completed workspace card"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Inline Sensitive-Step Approval Gate */}
      {activePermission && (
        <div
          data-inline-approval-bar="1"
          className="flex flex-col gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-foreground">{activePermission.title}</div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {activePermission.actionSummary}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void respondPermission(activePermission.requestId, 'once')}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
            >
              <Check className="h-3 w-3" />
              Approve Once
            </button>
            <button
              type="button"
              onClick={() => void respondPermission(activePermission.requestId, 'always')}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
            >
              <CheckCheck className="h-3 w-3" />
              Always Allow
            </button>
            <button
              type="button"
              onClick={() => void respondPermission(activePermission.requestId, 'deny')}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 text-[11px] font-medium text-destructive hover:bg-destructive/20"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Live 16:10 Viewport Preview */}
      {!collapsed && (
        <div className="bg-zinc-950/90 p-2.5">
          <div className="relative overflow-hidden rounded-lg border border-border/80 bg-black">
            {effectiveTarget === 'windows' && desktopFrame?.imageBase64 ? (
              <img
                src={`data:image/jpeg;base64,${desktopFrame.imageBase64}`}
                alt={desktopFrame.windowTitle || desktopFrame.deviceName}
                onClick={handleViewportClick}
                className={cn(
                  'block max-h-72 w-full object-contain select-none',
                  isTakeover ? 'cursor-crosshair' : 'cursor-pointer'
                )}
              />
            ) : effectiveTarget === 'browser' && browserFrame?.imageBase64 ? (
              <>
                <img
                  src={`data:image/jpeg;base64,${browserFrame.imageBase64}`}
                  alt={browserFrame.title || browserFrame.url}
                  onClick={handleViewportClick}
                  className={cn(
                    'block max-h-72 w-full object-contain select-none',
                    browserBusy ? 'opacity-80' : isTakeover ? 'cursor-crosshair' : 'cursor-pointer'
                  )}
                />
                {browserFrame.cursorX !== null && browserFrame.cursorY !== null && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -translate-x-1 -translate-y-1 transition-all duration-200"
                    style={{
                      left: `${(browserFrame.cursorX / Math.max(1, browserFrame.width)) * 100}%`,
                      top: `${(browserFrame.cursorY / Math.max(1, browserFrame.height)) * 100}%`,
                    }}
                  >
                    <MousePointer2 className="h-4 w-4 fill-sky-400 text-zinc-950 drop-shadow" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex aspect-[16/9] max-h-56 items-center justify-center text-xs text-muted-foreground">
                {effectiveTarget === 'windows'
                  ? 'Connected Windows PC ready — capture a frame or launch a desktop action.'
                  : 'Waiting for isolated browser viewport…'}
              </div>
            )}

            {isTakeover && (
              <div className="pointer-events-none absolute top-2 left-2 rounded border border-sky-400/40 bg-zinc-950/85 px-2 py-0.5 font-mono text-[10px] text-sky-300">
                Takeover Active · Click viewport to interact directly
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-3.5 py-2">
        <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {effectiveTarget === 'windows' && desktopFrame
            ? `${desktopFrame.deviceName} · ${desktopFrame.windowTitle || 'Desktop'}`
            : browserFrame
              ? `${browserFrame.title || browserFrame.url}`
              : session?.goal || 'Your main cursor remains free while Eva works here.'}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {effectiveTarget === 'windows' && (
            <button
              type="button"
              disabled={computerBusy}
              onClick={() => void captureWindowsScreen(desktopFrame?.deviceId)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
            >
              <RefreshCw className={cn('h-3 w-3', computerBusy && 'animate-spin')} />
              Refresh Screen
            </button>
          )}

          {canControlSession && (
            <>
              <button
                type="button"
                disabled={computerBusy}
                onClick={() => void controlAutomationSession(isPaused ? 'resume' : 'pause')}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40',
                  isPaused
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300'
                )}
              >
                {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>

              <button
                type="button"
                disabled={computerBusy}
                onClick={() =>
                  void controlAutomationSession(isTakeover ? 'release_takeover' : 'takeover')
                }
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-40',
                  isTakeover
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                )}
              >
                <Hand className="h-3 w-3" />
                {isTakeover ? 'Hand Back' : 'Take Over'}
              </button>

              <button
                type="button"
                disabled={computerBusy}
                onClick={() => void controlAutomationSession('stop')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/35 bg-destructive/10 px-2.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
