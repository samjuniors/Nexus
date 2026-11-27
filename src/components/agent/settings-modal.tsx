'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  BrainCog,
  Captions,
  Download,
  Ear,
  Focus,
  GitBranch,
  Globe,
  Mic,
  Moon,
  Network,
  PanelLeft,
  Plug,
  RotateCcw,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Upload,
  Vibrate,
  X,
} from 'lucide-react'
import { useEva } from '@/components/agent/eva-provider'
import { AnimatedCaptionText } from '@/components/agent/animated-caption-text'
import { SettingsConnectTab } from '@/components/agent/settings-connect-tab'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { CAPTION_ANIMATION_OPTIONS } from '@/lib/agent/caption-animation'
import { VOICE_VISUALIZER_OPTIONS } from '@/lib/agent/voice-visualizer'
import { VOICES, type VoiceName } from '@/lib/agent/voice-state'
import { WAKE_PHRASE_PRESETS } from '@/lib/agent/wake-word'
import { OUTFIT_SELECTIONS, type OutfitSelection } from '@/lib/coucou/wardrobe'
import {
  detectPlatformInfo,
  openAndroidServerPicker,
  triggerHaptic,
} from '@/lib/platform/android-bridge'
import { usePWAInstall } from '@/lib/platform/use-pwa-install'
import { cn } from '@/lib/utils'

type SettingsSection = 'workspace' | 'connect' | 'voice' | 'companion' | 'brain'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Settings }[] = [
  { id: 'workspace', label: 'Workspace', icon: PanelLeft },
  { id: 'connect', label: 'Connect', icon: Plug },
  { id: 'voice', label: 'Voice & Ear', icon: Mic },
  { id: 'companion', label: 'Companion', icon: Sparkles },
  { id: 'brain', label: 'Brain & Safety', icon: BrainCog },
]

function formatOutfitLabel(outfit: OutfitSelection): string {
  return outfit.charAt(0).toUpperCase() + outfit.slice(1)
}

/**
 * Consolidated Settings modal holding all workspace, voice, wake-ear, companion,
 * and brain configuration so the main chat & workspace chrome stay minimal.
 */
export function SettingsModal() {
  const open = useEvaControl((s) => s.settingsOpen)
  const setOpen = useEvaControl((s) => s.setSettingsOpen)
  const sidebarCollapsed = useEvaControl((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useEvaControl((s) => s.setSidebarCollapsed)
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const autoVoiceFocus = useEvaControl((s) => s.autoVoiceFocus)
  const setAutoVoiceFocus = useEvaControl((s) => s.setAutoVoiceFocus)
  const coucouOutfit = useEvaControl((s) => s.coucouOutfit)
  const setCoucouOutfit = useEvaControl((s) => s.setCoucouOutfit)
  const coucouDancing = useEvaControl((s) => s.coucouDancing)
  const setCoucouDancing = useEvaControl((s) => s.setCoucouDancing)
  const resetCompanionPosition = useEvaControl((s) => s.resetCompanionPosition)
  const openSplit = useEvaControl((s) => s.openSplit)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const captionsEnabled = useEvaControl((s) => s.captionsEnabled)
  const setCaptionsEnabled = useEvaControl((s) => s.setCaptionsEnabled)
  const captionAnimationStyle = useEvaControl((s) => s.captionAnimationStyle)
  const setCaptionAnimationStyle = useEvaControl((s) => s.setCaptionAnimationStyle)
  const voiceVisualizerStyle = useEvaControl((s) => s.voiceVisualizerStyle)
  const setVoiceVisualizerStyle = useEvaControl((s) => s.setVoiceVisualizerStyle)
  const mobileVoiceFirst = useEvaControl((s) => s.mobileVoiceFirst)
  const setMobileVoiceFirst = useEvaControl((s) => s.setMobileVoiceFirst)

  const { voice, wake, onToggleSleepMode, onArmEar } = useEva()
  const { brain, toggleBrain, setBrainPrefs, refreshBrain, refreshMemories } = useApp()
  const { resolvedTheme, setTheme } = useTheme()

  const [section, setSection] = useState<SettingsSection>('workspace')
  const [captionPreviewSeq, setCaptionPreviewSeq] = useState(0)
  const [brainBusy, setBrainBusy] = useState(false)
  const [brainMessage, setBrainMessage] = useState<string | null>(null)
  const [hapticAck, setHapticAck] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall()

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const isLight = mounted && resolvedTheme === 'light'
  const platform = mounted ? detectPlatformInfo() : detectPlatformInfo(undefined)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const brainConnected = brain?.connected ?? true
  const tone = brain?.appPrefs?.tone ?? 'balanced'
  const verbosity = brain?.appPrefs?.missionVerbosity ?? 'balanced'
  const autoDream = brain?.appPrefs?.autoDream ?? true
  const earNeedsUnlock = !wake.sleepMode && (wake.status === 'awaiting-mic' || wake.status === 'error')

  const handleToggleBrain = async (connect: boolean) => {
    setBrainBusy(true)
    setBrainMessage(null)
    try {
      await toggleBrain(connect)
      setBrainMessage(
        connect
          ? 'Portable Brain attached — Brain, Memory & GBrain UI restored.'
          : 'Portable Brain detached — all Brain UI surfaces hidden automatically.'
      )
    } finally {
      setBrainBusy(false)
    }
  }

  const handleImportBrainFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBrainBusy(true)
    setBrainMessage(null)
    try {
      const text = await file.text()
      const res = await fetch('/api/brain/portable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      const data = (await res.json()) as {
        error?: string
        imported?: { memories: number; entities: number; edges: number }
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await Promise.all([refreshBrain(), refreshMemories()])
      setBrainMessage(
        `Imported ${data.imported?.memories ?? 0} memories, ${data.imported?.entities ?? 0} entities, ${data.imported?.edges ?? 0} links and attached Brain.`
      )
    } catch (err) {
      setBrainMessage(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBrainBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workspace and Eva settings"
      data-settings-modal="1"
      onClick={() => {
        triggerHaptic('selection')
        setOpen(false)
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-border bg-card pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl sm:max-h-[85vh] sm:rounded-2xl sm:pb-0"
      >
        {/* Material 3 Drag Handle Pill on Mobile */}
        <div className="flex shrink-0 justify-center pt-2.5 pb-0.5 sm:hidden" aria-hidden>
          <div className="h-1 w-9 rounded-full bg-muted-foreground/35" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Settings</h2>
              <p className="text-[11px] text-muted-foreground">
                Workspace appearance, Eva voice &amp; ear, companion character, and platform controls
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('selection')
              setOpen(false)
            }}
            aria-label="Close settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-7 sm:w-7 sm:rounded-md"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: Left section rail + Right content */}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Settings categories"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/70 bg-muted/25 p-2 sm:w-44 sm:flex-col sm:border-r sm:border-b-0 sm:p-2.5"
          >
            {SECTIONS.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  data-settings-tab={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="nice-scroll flex-1 space-y-5 overflow-y-auto p-5">
            {section === 'workspace' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Appearance
                  </h3>
                  <div className="mt-2.5 flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-background/60 px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Theme</div>
                      <div className="text-[11px] text-muted-foreground">
                        Switch between dark and light workspace palettes
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
                      <button
                        type="button"
                        data-settings-theme="dark"
                        onClick={() => setTheme('dark')}
                        aria-pressed={!isLight}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          !isLight
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Moon className="h-3.5 w-3.5" /> Dark
                      </button>
                      <button
                        type="button"
                        data-settings-theme="light"
                        onClick={() => setTheme('light')}
                        aria-pressed={isLight}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          isLight
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Sun className="h-3.5 w-3.5" /> Light
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Layout &amp; Focus
                  </h3>
                  <div className="mt-2.5 divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Slim Navigation Rail</div>
                        <div className="text-[11px] text-muted-foreground">
                          Collapse sidebar into an icon-only rail for maximum chat width
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={sidebarCollapsed}
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                          sidebarCollapsed
                            ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {sidebarCollapsed ? 'Slim' : 'Expanded'}
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Voice Focus Mode</div>
                        <div className="text-[11px] text-muted-foreground">
                          Distraction-free companion stage for hands-free voice work
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={layoutMode === 'focus'}
                        onClick={() => {
                          setLayoutMode(layoutMode === 'focus' ? 'standard' : 'focus')
                          setOpen(false)
                        }}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                          layoutMode === 'focus'
                            ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Focus className="h-3.5 w-3.5 shrink-0" />
                        {layoutMode === 'focus' ? 'Active' : 'Enter Focus'}
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Auto Hands-Free Voice Focus</div>
                        <div className="text-[11px] text-muted-foreground">
                          Automatically center Eva in Voice Focus Mode when live voice starts
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoVoiceFocus}
                        onClick={() => setAutoVoiceFocus(!autoVoiceFocus)}
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                          autoVoiceFocus
                            ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {autoVoiceFocus ? 'Automatic' : 'Manual'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Mobile &amp; Tablet Start Screen</div>
                        <div className="text-[11px] text-muted-foreground">
                          Launch straight into the minimal Voice Agent first screen on phones and tablets
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        data-settings-mobile-voice-first="1"
                        aria-checked={mobileVoiceFirst}
                        onClick={() => {
                          triggerHaptic('selection')
                          setMobileVoiceFirst(!mobileVoiceFirst)
                        }}
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                          mobileVoiceFirst
                            ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {mobileVoiceFirst ? 'Voice Agent' : 'Workspace Chat'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Android APK, Desktop & Web PWA Platform Controls */}
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Platform &amp; Android APK
                  </h3>
                  <div className="mt-2.5 divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-foreground">
                          Active Runtime: {platform.label}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {platform.isAndroidApk
                            ? `${platform.deviceModel || 'Android Device'} · ${platform.serverUrl || 'Connected'}`
                            : 'Supports Android APK (/android), Desktop (/electron), and Web PWA'}
                        </div>
                      </div>
                      {platform.isAndroidApk ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            openAndroidServerPicker()
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/12 px-3 py-1.5 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
                        >
                          <Server className="h-3.5 w-3.5" />
                          Switch Server
                        </button>
                      ) : !isInstalled && canInstall ? (
                        <button
                          type="button"
                          onClick={() => void promptInstall()}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/12 px-3 py-1.5 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Install App
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {isIOS && !isInstalled ? 'Safari Share → Home' : 'Ready'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Tactile Haptics</div>
                        <div className="text-[11px] text-muted-foreground">
                          Material 3 vibration pulses via native Android bridge or mobile browser
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic('success')
                          setHapticAck(true)
                          window.setTimeout(() => setHapticAck(false), 1200)
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <Vibrate className="h-3.5 w-3.5 text-sky-500" />
                        {hapticAck ? 'Pulsed' : 'Test Pulse'}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Panels
                  </h3>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        openSplit('mobile', 'Android & Mobile Control')
                        setOpen(false)
                      }}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <Smartphone className="h-3.5 w-3.5 text-emerald-500" />
                      Android &amp; Mobile Takeover
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openSplit('reasoning', 'Reasoning Chain')
                        setOpen(false)
                      }}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <GitBranch className="h-3.5 w-3.5 text-sky-500" />
                      Reasoning Chain
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openSplit('browser', 'Live Browser')
                        setOpen(false)
                      }}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <Globe className="h-3.5 w-3.5 text-sky-500" />
                      Live Browser
                    </button>
                    {brainConnected && (
                      <button
                        type="button"
                        data-settings-gbrain-shortcut="1"
                        onClick={() => {
                          setGbrainGraphOpen(true)
                          setOpen(false)
                        }}
                        className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <Network className="h-3.5 w-3.5 text-sky-500" />
                        GBrain Graph
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {section === 'voice' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Eva Voice &amp; Always-On Ear
                  </h3>
                  <div className="mt-2.5 divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Live Voice Timbre</div>
                        <div className="text-[11px] text-muted-foreground">
                          Gemini Live voice used when talking aloud with Eva
                        </div>
                      </div>
                      <select
                        aria-label="Eva live voice"
                        value={voice.voiceName}
                        onChange={(e) => voice.setVoiceName(e.target.value as VoiceName)}
                        className="h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-ring"
                      >
                        {VOICES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Wake Phrase</div>
                        <div className="text-[11px] text-muted-foreground">
                          Hands-free trigger phrase for Eva&apos;s always-on ear
                        </div>
                      </div>
                      <select
                        aria-label="Wake word phrase"
                        value={wake.wakePhrase}
                        onChange={(e) => wake.setWakePhrase(e.target.value)}
                        className="h-8 rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-ring"
                      >
                        {WAKE_PHRASE_PRESETS.map((phrase) => (
                          <option key={phrase} value={phrase}>
                            &ldquo;{phrase}&rdquo;
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Always-On Ear</div>
                        <div className="text-[11px] text-muted-foreground">
                          {wake.sleepMode
                            ? 'Eva is in Sleep Mode — ear paused'
                            : earNeedsUnlock
                              ? 'Microphone permission needed to listen for wake phrase'
                              : `Listening (${wake.engine}) for "${wake.wakePhrase}"`}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {earNeedsUnlock && (
                          <button
                            type="button"
                            onClick={onArmEar}
                            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/12 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                          >
                            <Ear className="h-3.5 w-3.5 shrink-0" />
                            Arm Ear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={onToggleSleepMode}
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                            wake.sleepMode
                              ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                              : 'border-border bg-muted/40 text-foreground hover:bg-muted'
                          )}
                        >
                          {wake.sleepMode ? <Sun className="h-3.5 w-3.5 shrink-0" /> : <Moon className="h-3.5 w-3.5 shrink-0" />}
                          {wake.sleepMode ? 'Wake Eva' : 'Sleep Mode'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Voice Visualizer Style
                  </h3>
                  <div className="mt-2.5 rounded-xl border border-border/80 bg-background/60 p-3.5">
                    <div className="mb-2.5">
                      <div className="text-[13px] font-medium text-foreground">Voice Aura Pattern</div>
                      <div className="text-[11px] text-muted-foreground">
                        Select the ambient animation behind Eva in Voice Focus Mode
                      </div>
                    </div>
                    <div
                      role="group"
                      aria-label="Voice visualizer style"
                      data-settings-visualizer-group="1"
                      className="grid grid-cols-2 gap-1.5 sm:grid-cols-5"
                    >
                      {VOICE_VISUALIZER_OPTIONS.map((opt) => {
                        const active = voiceVisualizerStyle === opt.id
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            data-settings-visualizer-style={opt.id}
                            aria-pressed={active}
                            onClick={() => setVoiceVisualizerStyle(opt.id)}
                            className={cn(
                              'flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors',
                              active
                                ? 'border-sky-500/45 bg-sky-500/12 text-foreground'
                                : 'border-border/70 bg-card/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <span className="text-xs font-medium">{opt.shortLabel}</span>
                            <span className="mt-0.5 line-clamp-1 text-[10px] opacity-75">
                              {opt.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Voice Focus Captions
                  </h3>
                  <div className="mt-2.5 divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                      <div>
                        <div className="text-[13px] font-medium text-foreground">Live Captions</div>
                        <div className="text-[11px] text-muted-foreground">
                          Show live spoken captions at the bottom of Voice Focus Mode
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={captionsEnabled}
                        onClick={() => setCaptionsEnabled(!captionsEnabled)}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                          captionsEnabled
                            ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <Captions className="h-3.5 w-3.5 shrink-0" />
                        {captionsEnabled ? 'On' : 'Off'}
                      </button>
                    </div>

                    <div className="space-y-3 px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-medium text-foreground">
                            Caption Animation Style
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Choose how Eva&apos;s spoken words animate in Voice Focus Mode
                          </div>
                        </div>

                        <div
                          role="group"
                          aria-label="Caption animation style"
                          data-settings-caption-group="1"
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5"
                        >
                          {CAPTION_ANIMATION_OPTIONS.map((opt) => {
                            const active = captionAnimationStyle === opt.id
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                data-settings-caption-style={opt.id}
                                aria-pressed={active}
                                onClick={() => {
                                  setCaptionAnimationStyle(opt.id)
                                  setCaptionPreviewSeq((n) => n + 1)
                                }}
                                className={cn(
                                  'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                                  active
                                    ? 'bg-background text-foreground shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                                )}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Live authentic animation preview */}
                      <div
                        data-settings-caption-preview="1"
                        className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-card/70 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                            <span className="uppercase tracking-wider">Eva · Preview</span>
                            <span aria-hidden>·</span>
                            <span>
                              {CAPTION_ANIMATION_OPTIONS.find((o) => o.id === captionAnimationStyle)?.label}
                            </span>
                          </div>
                          <AnimatedCaptionText
                            text="All systems nominal — ready whenever you want to speak."
                            styleMode={captionAnimationStyle}
                            replayKey={captionPreviewSeq}
                            className="text-xs sm:text-[13px]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setCaptionPreviewSeq((n) => n + 1)}
                          title="Replay caption animation preview"
                          aria-label="Replay caption animation preview"
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {section === 'companion' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Eva Character Wardrobe
                  </h3>
                  <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {OUTFIT_SELECTIONS.map((outfit) => {
                      const active = coucouOutfit === outfit
                      return (
                        <button
                          key={outfit}
                          type="button"
                          onClick={() => setCoucouOutfit(outfit)}
                          aria-pressed={active}
                          className={cn(
                            'rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors',
                            active
                              ? 'border-sky-500/50 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                              : 'border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          {formatOutfitLabel(outfit)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                  <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Dance Mode</div>
                      <div className="text-[11px] text-muted-foreground">
                        Play idle dance animation on the floating companion
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={coucouDancing}
                      onClick={() => setCoucouDancing(!coucouDancing)}
                      className={cn(
                        'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                        coucouDancing
                          ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                          : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {coucouDancing ? 'Dancing' : 'Off'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Companion Position</div>
                      <div className="text-[11px] text-muted-foreground">
                        Snap Eva back to the bottom-right corner if dragged elsewhere
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={resetCompanionPosition}
                      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      Reset position
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === 'brain' && (
              <div className="space-y-4">
                <div className="divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
                  <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Portable NEXUS Brain</div>
                      <div className="text-[11px] text-muted-foreground">
                        {brainConnected
                          ? 'Attached — Brain, Memory, GBrain Graph & recall citations active'
                          : 'Detached — Brain, Memory & GBrain UI hidden automatically (Spine Core active)'}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-settings-brain-plug="1"
                      disabled={brainBusy}
                      onClick={() => void handleToggleBrain(!brainConnected)}
                      className={cn(
                        'shrink-0 whitespace-nowrap rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                        brainConnected
                          ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                      )}
                    >
                      {brainConnected ? 'Detach Brain' : 'Attach Brain'}
                    </button>
                  </div>

                  {/* Portable Brain Bundle Export / Import */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Portable Brain Bundle</div>
                      <div className="text-[11px] text-muted-foreground">
                        Export or import your full Brain (memories, GBrain entities, links &amp; prefs) as JSON
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href="/api/brain/portable"
                        download
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export
                      </a>
                      <button
                        type="button"
                        disabled={brainBusy}
                        onClick={() => importInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Import
                      </button>
                      <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => void handleImportBrainFile(e)}
                        className="hidden"
                        aria-label="Import Portable Brain JSON"
                      />
                    </div>
                  </div>

                  {brainConnected && (
                    <>
                      <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                        <div>
                          <div className="text-[13px] font-medium text-foreground">Chat Tone</div>
                          <div className="text-[11px] text-muted-foreground">
                            Response density for direct answers
                          </div>
                        </div>
                        <select
                          aria-label="Chat tone"
                          value={tone}
                          onChange={(e) =>
                            void setBrainPrefs({ tone: e.target.value as 'concise' | 'balanced' | 'thorough' })
                          }
                          className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                        >
                          <option value="concise">Concise</option>
                          <option value="balanced">Balanced</option>
                          <option value="thorough">Thorough</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                        <div>
                          <div className="text-[13px] font-medium text-foreground">Mission Verbosity</div>
                          <div className="text-[11px] text-muted-foreground">
                            Detail level of step traces and reports
                          </div>
                        </div>
                        <select
                          aria-label="Mission verbosity"
                          value={verbosity}
                          onChange={(e) =>
                            void setBrainPrefs({
                              missionVerbosity: e.target.value as 'brief' | 'balanced' | 'detailed',
                            })
                          }
                          className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                        >
                          <option value="brief">Brief</option>
                          <option value="balanced">Balanced</option>
                          <option value="detailed">Detailed</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between gap-4 px-3.5 py-3">
                        <div>
                          <div className="text-[13px] font-medium text-foreground">Auto-Dream Consolidation</div>
                          <div className="text-[11px] text-muted-foreground">
                            Periodically merge duplicate facts and update GBrain links
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={autoDream}
                          onClick={() => void setBrainPrefs({ autoDream: !autoDream })}
                          className={cn(
                            'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
                            autoDream
                              ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                              : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {autoDream ? 'Enabled' : 'Paused'}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {brainMessage && (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                    {brainMessage}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      openSplit('permissions', 'Permissions Vault')
                      setOpen(false)
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Shield className="h-3.5 w-3.5 text-amber-500" />
                    Open Permissions Vault
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      openSplit('self_heal', 'Self-Heal Studio')
                      setOpen(false)
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    Open Self-Heal Studio
                  </button>
                </div>
              </div>
            )}

            {section === 'connect' && <SettingsConnectTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
