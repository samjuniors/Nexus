'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CornerDownLeft,
  ExternalLink,
  Globe,
  Hand,
  Laptop,
  Loader2,
  MousePointer2,
  Music,
  Pause,
  Play,
  Power,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

const QUICK_URLS = [
  { label: 'example.com', url: 'https://example.com' },
  { label: 'Hacker News', url: 'https://news.ycombinator.com' },
  { label: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { label: 'GitHub', url: 'https://github.com' },
]

/**
 * Live Split-Screen Playwright Browser + Interactive Media Player panel.
 * Streams real Chromium viewport frames from `/api/browser` & `/api/control`,
 * plays verified YouTube embeds natively with audio/video when Eva runs `play_media`,
 * and supports one-shot autonomous `autopilot` goals directly from the bar.
 */
export function LiveBrowserPanel() {
  const frame = useEvaControl((s) => s.browserFrame)
  const desktopFrame = useEvaControl((s) => s.desktopFrame)
  const automationSession = useEvaControl((s) => s.automationSession)
  const busy = useEvaControl((s) => s.browserBusy)
  const computerBusy = useEvaControl((s) => s.computerControlBusy)
  const browserAction = useEvaControl((s) => s.browserAction)
  const setBrowserFrame = useEvaControl((s) => s.setBrowserFrame)
  const controlAutomationSession = useEvaControl((s) => s.controlAutomationSession)
  const captureWindowsScreen = useEvaControl((s) => s.captureWindowsScreen)
  const windowsBridgeAction = useEvaControl((s) => s.windowsBridgeAction)

  const [viewSource, setViewSource] = useState<'browser' | 'windows'>('browser')
  const [urlInput, setUrlInput] = useState(frame?.url || 'https://example.com')
  const [autopilotInput, setAutopilotInput] = useState('')
  const [typeInput, setTypeInput] = useState('')
  const [showDomOverride, setShowDomOverride] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Hydrate latest frame on mount if store is empty
  useEffect(() => {
    if (frame) {
      setUrlInput(frame.url)
      return
    }
    let cancelled = false
    fetch('/api/browser', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.frame?.active) {
          setBrowserFrame(data.frame)
          setUrlInput(data.frame.url)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [frame, setBrowserFrame])

  // Reset DOM override whenever a new media video starts playing
  const mediaVideoId = frame?.mediaVideoId ?? null
  useEffect(() => {
    if (mediaVideoId) {
      setShowDomOverride(false)
    }
  }, [mediaVideoId])

  const runAction = async (body: Record<string, unknown>) => {
    setErrorMsg(null)
    const res = await browserAction(body)
    if (!res.ok && res.error) {
      setErrorMsg(res.error)
    }
  }

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    const raw = urlInput.trim()
    if (!raw) return
    const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setUrlInput(target)
    void runAction({ action: 'navigate', url: target })
  }

  const handleAutopilotSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const goal = autopilotInput.trim()
    if (!goal || busy) return
    setAutopilotInput('')
    void runAction({ action: 'autopilot', goal })
  }

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!frame || busy) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    const x = Math.round(relX * frame.width)
    const y = Math.round(relY * frame.height)
    void runAction({ action: 'click', x, y })
  }

  const handleTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!typeInput.trim() || busy) return
    const text = typeInput
    setTypeInput('')
    void runAction({ action: 'type', text, submit: true })
  }

  const showingMediaPlayer = Boolean(frame?.mediaEmbedUrl && !showDomOverride)
  const isPaused = automationSession?.status === 'paused'
  const isTakeover = automationSession?.status === 'takeover'
  const sessionActive = Boolean(
    automationSession &&
      automationSession.status !== 'idle' &&
      automationSession.status !== 'completed'
  )

  const handleWindowsClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!desktopFrame || computerBusy) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = Math.round(((e.clientX - rect.left) / rect.width) * Math.max(1, desktopFrame.width))
    const y = Math.round(((e.clientY - rect.top) / rect.height) * Math.max(1, desktopFrame.height))
    void windowsBridgeAction('ui_click', { x, y }, desktopFrame.deviceId)
  }

  return (
    <div data-live-browser-panel="1" className="flex h-full min-h-0 flex-col bg-background">
      {/* Workspace target & live automation session control strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/60 px-3 py-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
          <button
            type="button"
            onClick={() => setViewSource('browser')}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors',
              viewSource === 'browser'
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Globe className="h-3 w-3" />
            Isolated Browser
          </button>
          <button
            type="button"
            onClick={() => setViewSource('windows')}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors',
              viewSource === 'windows'
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Laptop className="h-3 w-3" />
            Windows PC
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {viewSource === 'windows' && (
            <button
              type="button"
              disabled={computerBusy}
              onClick={async () => {
                setErrorMsg(null)
                const res = await captureWindowsScreen()
                if (!res.ok && res.error) setErrorMsg(res.error)
              }}
              className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-2 font-mono text-[10.5px] text-foreground hover:bg-muted disabled:opacity-40"
            >
              <RefreshCw className={cn('h-3 w-3', computerBusy && 'animate-spin')} />
              Capture PC
            </button>
          )}
          {sessionActive && (
            <>
              <button
                type="button"
                disabled={computerBusy}
                onClick={() => void controlAutomationSession(isPaused ? 'resume' : 'pause')}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded border px-2 font-mono text-[10.5px] font-medium transition-colors disabled:opacity-40',
                  isPaused
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                )}
              >
                {isPaused ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                disabled={computerBusy}
                onClick={() =>
                  void controlAutomationSession(isTakeover ? 'release_takeover' : 'takeover')
                }
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded border px-2 font-mono text-[10.5px] font-medium transition-colors disabled:opacity-40',
                  isTakeover
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                )}
              >
                <Hand className="h-2.5 w-2.5" />
                {isTakeover ? 'Hand Back' : 'Take Over'}
              </button>
              <button
                type="button"
                disabled={computerBusy}
                onClick={() => void controlAutomationSession('stop')}
                className="inline-flex h-6 items-center gap-1 rounded border border-destructive/35 bg-destructive/10 px-2 font-mono text-[10.5px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-40"
              >
                <Square className="h-2.5 w-2.5" />
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      {/* Browser address & navigation bar */}
      <form
        onSubmit={handleNavigate}
        className={cn(
          'flex items-center gap-1.5 border-b border-border bg-card/50 px-3 py-2',
          viewSource === 'windows' && 'hidden'
        )}
      >
        <button
          type="button"
          disabled={!frame || busy}
          onClick={() => void runAction({ action: 'back' })}
          aria-label="Browser back"
          title="Back"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!frame || busy}
          onClick={() => void runAction({ action: 'reload' })}
          aria-label="Reload page"
          title="Reload"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        </button>

        <div className="relative flex min-w-0 flex-1 items-center">
          <Globe className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com"
            aria-label="Browser URL"
            className="h-7 w-full rounded-md border border-border bg-background pr-2 pl-8 font-mono text-xs text-foreground outline-none focus:border-sky-400/60"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="h-7 shrink-0 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          Go
        </button>

        {frame && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction({ action: 'close' })}
            aria-label="Close live browser session"
            title="Stop Chromium & Player"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-40"
          >
            <Power className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {/* Autonomous Goal / Play Media Quick Bar */}
      <form
        onSubmit={handleAutopilotSubmit}
        className="flex items-center gap-1.5 border-b border-border bg-card/30 px-3 py-1.5"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <input
          type="text"
          value={autopilotInput}
          onChange={(e) => setAutopilotInput(e.target.value)}
          placeholder='Eva Autopilot or Play (e.g. "open youtube.com and play rafta rafta")…'
          aria-label="Eva browser autopilot or media goal"
          className="h-6 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          disabled={busy || !autopilotInput.trim()}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-sky-400/35 bg-sky-500/15 px-2 text-[11px] font-medium text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-40"
        >
          <Play className="h-2.5 w-2.5" />
          Run
        </button>
      </form>

      {errorMsg && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {errorMsg}
        </div>
      )}

      {/* Main viewport stage */}
      <div className="nice-scroll relative flex min-h-0 flex-1 flex-col overflow-auto bg-zinc-950/80 p-3">
        {viewSource === 'windows' ? (
          desktopFrame?.imageBase64 ? (
            <div className="flex flex-col gap-2">
              <div className="relative overflow-hidden rounded-lg border border-border bg-black">
                <img
                  src={`data:image/jpeg;base64,${desktopFrame.imageBase64}`}
                  alt={desktopFrame.windowTitle || desktopFrame.deviceName}
                  onClick={handleWindowsClick}
                  className={cn(
                    'block h-auto w-full select-none',
                    computerBusy ? 'cursor-wait opacity-80' : 'cursor-crosshair'
                  )}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span className="truncate">
                  {desktopFrame.deviceName} · {desktopFrame.windowTitle || 'Windows Desktop'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {desktopFrame.width}×{desktopFrame.height}
                </span>
              </div>
            </div>
          ) : (
            <div className="my-auto flex flex-col items-center justify-center px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
                <Laptop className="h-5 w-5 text-emerald-400" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">Windows PC Live Workspace</h3>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Connect your Windows PC in Devices using the Companion Bridge, then capture a live desktop frame or click anywhere to interact.
              </p>
              <button
                type="button"
                disabled={computerBusy}
                onClick={async () => {
                  setErrorMsg(null)
                  const res = await captureWindowsScreen()
                  if (!res.ok && res.error) setErrorMsg(res.error)
                }}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-300"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', computerBusy && 'animate-spin')} />
                Capture Windows Screen
              </button>
            </div>
          )
        ) : !frame ? (
          <div className="my-auto flex flex-col items-center justify-center px-4 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
              <Globe className="h-5 w-5 text-sky-400" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Live Playwright Browser &amp; Media</h3>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Real Chromium engine + interactive YouTube player driven end-to-end by Eva Autopilot or directly by you.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {QUICK_URLS.map((q) => (
                <button
                  key={q.url}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setUrlInput(q.url)
                    void runAction({ action: 'navigate', url: q.url })
                  }}
                  className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:border-sky-400/50 hover:bg-accent disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : showingMediaPlayer && frame.mediaEmbedUrl ? (
          <div data-live-media-player="1" className="flex flex-col gap-2.5">
            {/* Now Playing header strip */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Music className="h-4 w-4 shrink-0 text-sky-400" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-foreground">
                    {frame.mediaTitle || frame.title || 'Now Playing on YouTube'}
                  </div>
                  <div className="truncate font-mono text-[10px] text-sky-300/80">
                    Live Interactive Audio &amp; Video · {frame.url}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {frame.url && (
                  <a
                    href={frame.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open video on YouTube"
                    className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-2 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    YouTube
                  </a>
                )}
                {frame.imageBase64 && (
                  <button
                    type="button"
                    onClick={() => setShowDomOverride(true)}
                    className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    DOM View
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'clear_media' })}
                  aria-label="Stop media player"
                  title="Close player"
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* 16:9 Interactive YouTube Player */}
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
              <iframe
                key={frame.mediaVideoId || frame.mediaEmbedUrl}
                src={frame.mediaEmbedUrl}
                title={frame.mediaTitle || 'YouTube Media Player'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full border-0"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="truncate font-mono">Eva Autopilot · Coucou Dance Sync Active</span>
              <span className="font-mono text-[10px] text-sky-400">ID: {frame.mediaVideoId}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {frame.mediaEmbedUrl && (
              <div className="flex items-center justify-between rounded-md border border-sky-400/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px]">
                <span className="truncate text-sky-200">Media ready: {frame.mediaTitle || 'YouTube'}</span>
                <button
                  type="button"
                  onClick={() => setShowDomOverride(false)}
                  className="rounded border border-sky-400/40 bg-sky-500/20 px-2 py-0.5 font-mono text-[10px] text-sky-100 hover:bg-sky-500/30"
                >
                  Show Player
                </button>
              </div>
            )}

            {/* Viewport frame container */}
            <div className="relative overflow-hidden rounded-lg border border-border bg-black">
              {frame.imageBase64 ? (
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${frame.imageBase64}`}
                  alt={frame.title || frame.url}
                  onClick={handleImageClick}
                  className={cn(
                    'block h-auto w-full select-none',
                    busy ? 'cursor-wait opacity-80' : 'cursor-crosshair'
                  )}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                  Waiting for browser viewport frame…
                </div>
              )}

              {/* Eva cursor indicator inside the browser viewport */}
              {frame.cursorX !== null && frame.cursorY !== null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -translate-x-1 -translate-y-1 transition-all duration-200 ease-out"
                  style={{
                    left: `${(frame.cursorX / Math.max(1, frame.width)) * 100}%`,
                    top: `${(frame.cursorY / Math.max(1, frame.height)) * 100}%`,
                  }}
                >
                  <MousePointer2 className="h-4 w-4 fill-sky-400 text-zinc-950 drop-shadow" />
                </div>
              )}

              {busy && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                  <div className="flex items-center gap-1.5 rounded-md border border-border bg-popover/95 px-2.5 py-1 font-mono text-[11px] text-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                    Eva driving browser…
                  </div>
                </div>
              )}
            </div>

            {/* Metadata footer + scroll controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="min-w-0 truncate font-mono">
                <span className="text-foreground">{frame.title || 'Untitled'}</span>
                <span className="mx-1.5">·</span>
                <span className="tabular-nums">
                  {frame.width}×{frame.height}
                </span>
                {frame.lastAction && (
                  <>
                    <span className="mx-1.5">·</span>
                    <span>{frame.lastAction}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'scroll', deltaY: -420 })}
                  aria-label="Scroll page up"
                  className="inline-flex h-6 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] hover:bg-accent disabled:opacity-40"
                >
                  <ArrowUp className="h-3 w-3" /> Up
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'scroll', deltaY: 420 })}
                  aria-label="Scroll page down"
                  className="inline-flex h-6 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] hover:bg-accent disabled:opacity-40"
                >
                  <ArrowDown className="h-3 w-3" /> Down
                </button>
              </div>
            </div>

            {/* Interactive DOM element quick-click strip */}
            {frame.elements.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-2">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Detected Interactive Targets ({frame.elements.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {frame.elements.slice(0, 10).map((el) => (
                    <button
                      key={`${el.index}-${el.selector}`}
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction({ action: 'click', x: el.x, y: el.y })}
                      title={`${el.tag} @ (${el.x}, ${el.y})`}
                      className="max-w-44 truncate rounded border border-border bg-background px-2 py-0.5 font-mono text-[10.5px] text-foreground transition-colors hover:border-sky-400/50 hover:bg-accent disabled:opacity-40"
                    >
                      {el.text || el.tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline keyboard typing bar when browser DOM is active */}
      {frame && !showingMediaPlayer && (
        <form
          onSubmit={handleTypeSubmit}
          className="flex items-center gap-1.5 border-t border-border bg-card/50 px-3 py-2"
        >
          <input
            type="text"
            value={typeInput}
            onChange={(e) => setTypeInput(e.target.value)}
            placeholder="Click an input above, then type here & press Enter…"
            aria-label="Type into focused browser element"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-sky-400/60"
          />
          <button
            type="submit"
            disabled={busy || !typeInput.trim()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-40"
          >
            <CornerDownLeft className="h-3 w-3" />
            Send
          </button>
        </form>
      )}
    </div>
  )
}
