'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Command,
  Ear,
  Eye,
  Focus,
  Hand,
  Heart,
  MessageCircle,
  Monitor,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useEva } from '@/components/agent/eva-provider'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import {
  EVA_EMOTIONS,
  EVA_EMOTION_LIST,
  type EvaSenseId,
  type SenseStatus,
} from '@/lib/agent/eva-emotions'
import {
  HAND_TRACKING_ACTIONS,
  HAND_TRACKING_PREVIEW_LIST,
} from '@/lib/agent/hand-tracking'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

const WINDOW_TITLES: Record<Tab, string> = {
  agent: 'Agent Console',
  org: 'Company & Org',
  automations: 'Automations',
  brain: 'Portable Brain',
  artifacts: 'Artifacts',
  marketplace: 'Marketplace',
  plugins: 'Plugins',
  skills: 'Skills',
  tools: 'Tools',
  mcps: 'MCP Servers',
  memory: 'Memory Vault',
}

const SENSE_ICONS: Record<EvaSenseId, typeof Eye> = {
  eyes: Eye,
  ears: Ear,
  mouth: MessageCircle,
  hands: Hand,
}

function senseDot(status: SenseStatus): string {
  if (status === 'active') return 'bg-emerald-400'
  if (status === 'ready') return 'bg-sky-400/70'
  return 'bg-muted-foreground/35'
}

/**
 * Dynamic Agent OS Top System Bar — ultra-thin operating system chrome showing
 * the active OS window, live Eva 4-Senses telemetry (Eyes, Ears, Mouth, Hands),
 * Eva's current Emotion/Feeling Control Center popover, Command Bar (⌘K), and clock.
 */
export function OsTopBar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const { activeTab, runningRunId } = useApp()
  const { emotion, senses, handTracking, toggleSense, vision } = useEva()
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const manualEmotion = useEvaControl((s) => s.manualEmotion)
  const setManualEmotion = useEvaControl((s) => s.setManualEmotion)
  const previewHandAction = useEvaControl((s) => s.previewHandAction)
  const setPreviewHandAction = useEvaControl((s) => s.setPreviewHandAction)

  const [panelOpen, setPanelOpen] = useState(false)
  const [clockText, setClockText] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const updateClock = () => {
      try {
        setClockText(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        )
      } catch {
        setClockText('')
      }
    }
    updateClock()
    const id = window.setInterval(updateClock, 15_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!panelOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [panelOpen])

  const senseList = [senses.eyes, senses.ears, senses.mouth, senses.hands]
  const windowName = layoutMode === 'focus' ? 'Voice Focus' : WINDOW_TITLES[activeTab]

  return (
    <header
      data-os-top-bar="1"
      className="relative z-30 flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-sidebar/90 px-3 text-[11.5px] backdrop-blur-sm select-none"
    >
      {/* Left: Active OS Window & Live Process indicator */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Nexus OS
        </span>
        <span className="text-border">/</span>
        <span className="truncate font-medium text-foreground">{windowName}</span>
        {runningRunId && (
          <span className="hidden items-center gap-1.5 font-mono text-[10px] text-sky-600 sm:inline-flex dark:text-sky-400">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 pulse-dot" />
            Hands executing
          </span>
        )}
      </div>

      {/* Center: Interactive Eva 4-Senses Strip (Eyes · Ears · Mouth · Hands) */}
      <div
        role="group"
        aria-label="Eva live senses"
        data-os-senses-strip="1"
        className="hidden items-center gap-0.5 rounded-lg border border-border/70 bg-background/60 p-0.5 lg:flex"
      >
        {senseList.map((sense) => {
          const Icon = SENSE_ICONS[sense.id]
          const isActive = sense.status === 'active'
          return (
            <button
              key={sense.id}
              type="button"
              data-os-sense={sense.id}
              data-sense-status={sense.status}
              onClick={() => toggleSense(sense.id)}
              title={`${sense.label} (${sense.verb}) — ${sense.detail}`}
              aria-pressed={isActive}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-medium transition-colors',
                isActive
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', senseDot(sense.status))} />
              <Icon className="h-3 w-3 shrink-0" />
              <span>{sense.label}</span>
            </button>
          )
        })}
      </div>

      {/* Right: Emotion & Senses Control Center trigger + Quick Focus + Command Bar + Clock */}
      <div className="flex shrink-0 items-center gap-1.5" ref={popoverRef}>
        <button
          type="button"
          data-os-emotion-trigger="1"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
          title={`Eva is feeling ${emotion.label} — click to open Senses & Feelings Center`}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors',
            panelOpen
              ? 'border-sky-500/45 bg-sky-500/10 text-foreground'
              : 'border-border/70 bg-background/60 text-foreground hover:bg-muted'
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', emotion.dotClass)} />
          <span>{emotion.shortLabel}</span>
          <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground sm:inline">
            {senses.activeCount}/4
          </span>
        </button>

        <button
          type="button"
          onClick={() => setLayoutMode(layoutMode === 'focus' ? 'standard' : 'focus')}
          aria-pressed={layoutMode === 'focus'}
          title="Toggle Voice Focus Mode"
          className={cn(
            'hidden h-6 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors sm:inline-flex',
            layoutMode === 'focus'
              ? 'border-sky-500/45 bg-sky-500/12 text-sky-600 dark:text-sky-400'
              : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Focus className="h-3 w-3" />
          Focus
        </button>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Open Nexus OS Command Bar (⌘K)"
          className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border/70 bg-background/60 px-2 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Command className="h-3 w-3" />
          <span className="hidden sm:inline">⌘K</span>
        </button>

        {clockText && (
          <span className="hidden pl-1 font-mono text-[10.5px] tabular-nums text-muted-foreground md:inline">
            {clockText}
          </span>
        )}

        {/* OS Senses & Feelings Control Center Popover */}
        {panelOpen && (
          <div
            role="dialog"
            aria-label="Eva Senses and Feelings Center"
            data-os-senses-popover="1"
            className="absolute top-10 right-3 z-50 w-[340px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-3.5 text-foreground shadow-xl"
          >
            {/* Current Emotion & Feeling readout */}
            <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Heart className={cn('h-3.5 w-3.5 shrink-0', emotion.textClass)} />
                  <span className="text-xs font-semibold text-foreground">{emotion.label}</span>
                  {emotion.isManual && (
                    <span className="font-mono text-[9.5px] text-muted-foreground">· pinned</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {emotion.feelingLine}
                </p>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                  Trigger: {emotion.reason}
                </div>
              </div>
              {manualEmotion && (
                <button
                  type="button"
                  onClick={() => setManualEmotion(null)}
                  title="Return to automatic live emotions"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Auto
                </button>
              )}
            </div>

            {/* Emotion / Feeling Resonance Grid */}
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Eva Feeling &amp; Mood</span>
                <Sparkles className="h-3 w-3" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                {EVA_EMOTION_LIST.map((id) => {
                  const meta = EVA_EMOTIONS[id]
                  const active = emotion.id === id
                  return (
                    <button
                      key={id}
                      type="button"
                      data-emotion-option={id}
                      onClick={() => setManualEmotion(manualEmotion === id ? null : id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] font-medium transition-colors',
                        active
                          ? 'border-sky-500/45 bg-sky-500/10 text-foreground'
                          : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClass)} />
                      <span className="truncate">{meta.shortLabel}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 4 Embodied Senses Grid (Eyes, Ears, Mouth, Hands) */}
            <div className="mt-3.5 border-t border-border/70 pt-3">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Active Senses (Eyes · Ears · Mouth · Hands)
              </div>
              <div className="space-y-1.5">
                {senseList.map((sense) => {
                  const Icon = SENSE_ICONS[sense.id]
                  const isActive = sense.status === 'active'
                  return (
                    <div
                      key={sense.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            isActive ? 'text-emerald-500' : 'text-muted-foreground'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-medium text-foreground">
                            {sense.label}{' '}
                            <span className="font-normal text-muted-foreground">· {sense.verb}</span>
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {sense.detail}
                          </div>
                        </div>
                      </div>
                      {sense.id === 'eyes' ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void vision.toggleCamera()}
                            title="Toggle Camera Eye"
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded border transition-colors',
                              vision.cameraActive
                                ? 'border-sky-500/45 bg-sky-500/15 text-sky-500'
                                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <Camera className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void vision.toggleScreen()}
                            title="Toggle Screen Eye"
                            className={cn(
                              'flex h-6 w-6 items-center justify-center rounded border transition-colors',
                              vision.screenActive
                                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-500'
                                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <Monitor className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSense(sense.id)}
                          className={cn(
                            'shrink-0 rounded-md border px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                            isActive
                              ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                          )}
                        >
                          {isActive ? 'Active' : 'Use'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Physical Hand-Tracking Motion Strip — live indicator + on-demand choreography preview */}
              <div className="mt-2.5 rounded-lg border border-border/70 bg-background/50 p-2">
                <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground/85">Hand-Tracking Gestures</span>
                  <span className="font-mono text-[10px]">
                    {handTracking.active ? handTracking.shortLabel : 'Auto'}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {HAND_TRACKING_PREVIEW_LIST.map((actionId) => {
                    const meta = HAND_TRACKING_ACTIONS[actionId]
                    const active = handTracking.action === actionId && handTracking.active
                    return (
                      <button
                        key={actionId}
                        type="button"
                        data-hand-preview-option={actionId}
                        aria-pressed={active}
                        onClick={() =>
                          setPreviewHandAction(previewHandAction === actionId ? null : actionId)
                        }
                        title={`${meta.label} — click to preview hand-tracking SVG motion`}
                        className={cn(
                          'flex h-6 items-center justify-center rounded border px-1 text-[10px] font-medium whitespace-nowrap transition-colors',
                          active
                            ? 'border-sky-500/45 bg-sky-500/12 text-foreground'
                            : 'border-border/60 bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {meta.shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
