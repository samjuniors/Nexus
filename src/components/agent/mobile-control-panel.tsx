'use client'

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  ArrowDown,
  ArrowUp,
  Battery,
  Bell,
  Bluetooth,
  Calendar,
  Camera,
  Check,
  ChevronLeft,
  Circle,
  Copy,
  CornerDownLeft,
  Download,
  Flashlight,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  Moon,
  Phone,
  PhoneCall,
  PhoneOff,
  Plane,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  StickyNote,
  Wifi,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

const AUTOPILOT_PRESETS = [
  { label: 'DND On', goal: 'Open Settings and enable Do Not Disturb' },
  { label: 'Text Alex', goal: 'Text Alex saying On my way in 5 minutes' },
  { label: 'Shade', goal: 'Pull down notifications' },
  { label: 'Chrome', goal: 'Open Chrome and search weather in Tokyo' },
] as const

const APP_ICONS: Record<string, { icon: typeof Phone; bg: string; fg: string }> = {
  phone: { icon: Phone, bg: 'bg-emerald-500/18 border-emerald-500/30', fg: 'text-emerald-400' },
  messages: { icon: MessageSquare, bg: 'bg-sky-500/18 border-sky-500/30', fg: 'text-sky-400' },
  chrome: { icon: Globe, bg: 'bg-amber-500/18 border-amber-500/30', fg: 'text-amber-400' },
  camera: { icon: Camera, bg: 'bg-zinc-500/20 border-zinc-400/30', fg: 'text-zinc-200' },
  settings: { icon: Settings, bg: 'bg-slate-500/20 border-slate-400/30', fg: 'text-slate-200' },
  notes: { icon: StickyNote, bg: 'bg-yellow-500/18 border-yellow-500/30', fg: 'text-yellow-300' },
  maps: { icon: MapPin, bg: 'bg-rose-500/18 border-rose-500/30', fg: 'text-rose-400' },
  calendar: { icon: Calendar, bg: 'bg-indigo-500/18 border-indigo-500/30', fg: 'text-indigo-400' },
}

const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/**
 * Interactive Android & Mobile Takeover Panel — mirrors LiveBrowserPanel & Computer Use.
 * Supports both the zero-setup Live Android Viewport (with real app states, animated
 * touch ripples, swipe trails, and end-to-end Eva Autopilot) and pairing a real Android
 * phone via the ADB / Wireless Debugging Bridge (`nexus-android-bridge.mjs`).
 */
export function MobileControlPanel() {
  const frame = useEvaControl((s) => s.mobileFrame)
  const busy = useEvaControl((s) => s.mobileBusy)
  const mobileAction = useEvaControl((s) => s.mobileAction)
  const setMobileFrame = useEvaControl((s) => s.setMobileFrame)
  const devices = useEvaControl((s) => s.devices)
  const pairDevice = useEvaControl((s) => s.pairDevice)
  const refreshDevices = useEvaControl((s) => s.refreshDevices)

  const [goalInput, setGoalInput] = useState('')
  const [typeInput, setTypeInput] = useState('')
  const [pairOpen, setPairOpen] = useState(false)
  const [phoneName, setPhoneName] = useState('')
  const [pairing, setPairing] = useState(false)
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)

  useEffect(() => {
    void refreshDevices()
    if (frame) return
    let cancelled = false
    fetch('/api/mobile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.frame) {
          setMobileFrame(data.frame)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [frame, setMobileFrame, refreshDevices])

  const mobileDevices = devices.filter((d) => d.platform === 'android' || d.platform === 'ios')
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  const adbCommand = freshToken
    ? `curl -fsSL "${origin}/api/devices/mobile-runner" -o nexus-android-bridge.mjs && NEXUS_DEVICE_TOKEN="${freshToken.token}" node nexus-android-bridge.mjs`
    : ''

  const runAction = async (body: Record<string, unknown>) => {
    const res = await mobileAction(body)
    if (res.summary) setStatusNote(res.summary)
    else if (res.error) setStatusNote(res.error)
  }

  const handleAutopilot = (e: React.FormEvent) => {
    e.preventDefault()
    const goal = goalInput.trim()
    if (!goal || busy) return
    setGoalInput('')
    void runAction({ action: 'autopilot', goal })
  }

  const handleTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = typeInput.trim()
    if (!text || busy) return
    setTypeInput('')
    void runAction({ action: 'type', text })
  }

  const handlePairAndroid = async (e: React.FormEvent) => {
    e.preventDefault()
    setPairing(true)
    try {
      const res = await pairDevice(phoneName.trim() || 'My Android Phone', 'android')
      if (res) {
        setFreshToken({ name: res.device.name, token: res.pairingToken })
        setPhoneName('')
      }
    } finally {
      setPairing(false)
    }
  }

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!frame || busy) return
    if ((e.target as HTMLElement).closest('button, input, a')) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height)
    void runAction({ action: 'tap', x, y })
  }

  const activeThread =
    frame?.threads.find((t) => t.id === frame.activeThreadId) ?? frame?.threads[0] ?? null

  return (
    <div
      data-mobile-control-panel="1"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      {/* Target Device Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Smartphone className="h-4 w-4 shrink-0 text-emerald-500" />
          <select
            aria-label="Target Android or mobile device"
            value={frame?.deviceId ?? 'live_emulator'}
            onChange={(e) => void runAction({ action: 'select_device', deviceId: e.target.value })}
            className="h-8 max-w-[210px] truncate rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:border-emerald-500/60"
          >
            <option value="live_emulator">Pixel 9 Pro · Live Android</option>
            {mobileDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.platform} · {d.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-mobile-pair-toggle="1"
            onClick={() => setPairOpen((v) => !v)}
            aria-expanded={pairOpen}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors',
              pairOpen
                ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
                : 'border-border bg-background text-foreground hover:bg-muted'
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Pair Android</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void runAction({ action: 'reset' })}
            aria-label="Reset Android screen"
            title="Reset Android viewport"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible Real Android ADB / Wireless Bridge Setup */}
      {pairOpen && (
        <div
          data-android-pair-panel="1"
          className="space-y-2.5 border-b border-border bg-card/70 px-3 py-3 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-foreground">Connect Real Android Phone (ADB Bridge)</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Enable USB or Wireless Debugging on your Android phone, pair a token below, and run the bridge so Eva controls your physical phone live.
              </p>
            </div>
            <a
              href="/api/devices/mobile-runner"
              download="nexus-android-bridge.mjs"
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 font-mono text-[10.5px] text-foreground hover:bg-muted"
            >
              <Download className="h-3 w-3" />
              Bridge
            </a>
          </div>

          <form onSubmit={handlePairAndroid} className="flex items-center gap-2">
            <input
              type="text"
              value={phoneName}
              onChange={(e) => setPhoneName(e.target.value)}
              placeholder="e.g. Pixel 9 Pro or Galaxy S25"
              aria-label="Android phone name"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-emerald-500/60"
            />
            <button
              type="submit"
              disabled={pairing}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-300"
            >
              {pairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Generate Token
            </button>
          </form>

          {freshToken && (
            <div className="space-y-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/8 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-300">
                  Paired: {freshToken.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(adbCommand).catch(() => {})
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] hover:bg-muted"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy ADB Command'}
                </button>
              </div>
              <pre className="nice-scroll overflow-x-auto rounded border border-border bg-background p-2 font-mono text-[10px] text-foreground">
                {adbCommand}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Eva Android Autopilot Bar */}
      <form
        onSubmit={handleAutopilot}
        className="flex items-center gap-1.5 border-b border-border bg-card/30 px-3 py-2"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <input
          type="text"
          data-mobile-autopilot-input="1"
          value={goalInput}
          onChange={(e) => setGoalInput(e.target.value)}
          placeholder='Eva Android Takeover (e.g. "Open Settings and enable Do Not Disturb")…'
          aria-label="Eva Android autopilot command"
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          data-mobile-autopilot-run="1"
          disabled={busy || !goalInput.trim()}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:opacity-40 dark:text-emerald-300"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          <span>Run</span>
        </button>
      </form>

      {/* Quick one-tap Android goal chips */}
      <div className="nice-scroll flex items-center gap-1.5 overflow-x-auto border-b border-border/70 px-3 py-1.5">
        {AUTOPILOT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={busy}
            onClick={() => void runAction({ action: 'autopilot', goal: preset.goal })}
            className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card/70 px-2.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:border-emerald-500/40 hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Main Live Android Viewport Stage */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-muted/20 px-3 py-2.5">
        {!frame ? (
          <div className="my-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Connecting Android viewport…
          </div>
        ) : (
          <div className="flex h-full max-h-[600px] min-h-0 w-full max-w-[310px] flex-col items-center gap-2">
            {/* Android Device Bezel */}
            <div
              data-android-screen="1"
              data-android-app={frame.currentApp}
              data-android-dnd={frame.quickSettings.dnd ? 'on' : 'off'}
              onClick={handleViewportTap}
              className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[28px] border-2 border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-2xl select-none"
            >
              {/* Status Bar (Tap to toggle Notification Shade) */}
              <button
                type="button"
                onClick={() => void runAction({ action: 'notifications' })}
                aria-label="Toggle Android notification shade"
                className="relative z-20 flex h-8 w-full shrink-0 items-center justify-between px-4 text-[11px] font-medium text-zinc-200 hover:bg-white/5"
              >
                <span className="font-mono tabular-nums">{frame.timeLabel}</span>
                <span className="h-3 w-3 rounded-full bg-zinc-800 ring-1 ring-zinc-700" aria-hidden />
                <span className="flex items-center gap-1.5">
                  {frame.quickSettings.airplane && <Plane className="h-3 w-3 text-amber-400" />}
                  {frame.quickSettings.dnd && <Moon className="h-3 w-3 text-violet-400" />}
                  {frame.quickSettings.wifi && <Wifi className="h-3 w-3 text-zinc-200" />}
                  <Battery className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="font-mono text-[10px] tabular-nums">{frame.battery}%</span>
                </span>
              </button>

              {/* Live Screen Content */}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {frame.screenshotBase64 ? (
                  <img
                    src={`data:image/png;base64,${frame.screenshotBase64}`}
                    alt={frame.deviceName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-2">
                    {/* HOME LAUNCHER */}
                    {frame.currentApp === 'home' && (
                      <div className="flex flex-1 flex-col justify-between py-2">
                        <div className="pt-2 text-center">
                          <div className="font-mono text-3xl font-light tracking-tight tabular-nums text-white">
                            {frame.timeLabel}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">
                            {frame.osVersion} · Eva Takeover Ready
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2.5 py-4">
                          {(['settings', 'notes', 'maps', 'calendar'] as const).map((appId) => {
                            const spec = APP_ICONS[appId]
                            const Icon = spec.icon
                            return (
                              <button
                                key={appId}
                                type="button"
                                onClick={() => void runAction({ action: 'open_app', app: appId })}
                                className="flex flex-col items-center gap-1.5 rounded-xl p-1 transition-transform active:scale-95"
                              >
                                <span
                                  className={cn(
                                    'flex h-11 w-11 items-center justify-center rounded-2xl border',
                                    spec.bg
                                  )}
                                >
                                  <Icon className={cn('h-5 w-5', spec.fg)} />
                                </span>
                                <span className="text-[10px] capitalize text-zinc-300">{appId}</span>
                              </button>
                            )
                          })}
                        </div>

                        {/* Bottom Android Launcher Dock */}
                        <div className="grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/[0.05] p-2">
                          {(['phone', 'messages', 'chrome', 'camera'] as const).map((appId) => {
                            const spec = APP_ICONS[appId]
                            const Icon = spec.icon
                            return (
                              <button
                                key={appId}
                                type="button"
                                aria-label={`Open ${appId}`}
                                onClick={() => void runAction({ action: 'open_app', app: appId })}
                                className="flex flex-col items-center gap-1 rounded-xl py-1 transition-transform active:scale-95"
                              >
                                <span
                                  className={cn(
                                    'flex h-10 w-10 items-center justify-center rounded-xl border',
                                    spec.bg
                                  )}
                                >
                                  <Icon className={cn('h-4 w-4', spec.fg)} />
                                </span>
                                <span className="text-[9.5px] capitalize text-zinc-300">{appId}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* ANDROID SETTINGS */}
                    {frame.currentApp === 'settings' && (
                      <div className="space-y-2 py-1">
                        <div className="pb-1 text-base font-semibold text-white">Settings</div>
                        {(
                          [
                            { key: 'wifi', label: 'Wi-Fi', sub: frame.quickSettings.wifi ? 'Connected' : 'Off', icon: Wifi },
                            { key: 'bluetooth', label: 'Bluetooth', sub: frame.quickSettings.bluetooth ? 'Discoverable' : 'Off', icon: Bluetooth },
                            { key: 'dnd', label: 'Do Not Disturb', sub: frame.quickSettings.dnd ? 'Silenced' : 'Off', icon: Moon },
                            { key: 'airplane', label: 'Airplane Mode', sub: frame.quickSettings.airplane ? 'Active' : 'Off', icon: Plane },
                            { key: 'flashlight', label: 'Flashlight', sub: frame.quickSettings.flashlight ? 'On' : 'Off', icon: Flashlight },
                          ] as const
                        ).map(({ key, label, sub, icon: Icon }) => {
                          const on = frame.quickSettings[key]
                          return (
                            <button
                              key={key}
                              type="button"
                              data-android-setting={key}
                              aria-pressed={on}
                              onClick={() => void runAction({ action: 'toggle_setting', setting: key })}
                              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.08]"
                            >
                              <div className="flex items-center gap-2.5">
                                <Icon className={cn('h-4 w-4', on ? 'text-emerald-400' : 'text-zinc-500')} />
                                <div>
                                  <div className="text-xs font-medium text-zinc-100">{label}</div>
                                  <div className="text-[10px] text-zinc-400">{sub}</div>
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
                                  on ? 'justify-end bg-emerald-500' : 'justify-start bg-zinc-700'
                                )}
                              >
                                <span className="h-4 w-4 rounded-full bg-white" />
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* ANDROID MESSAGES */}
                    {frame.currentApp === 'messages' && (
                      <div className="flex flex-1 flex-col gap-2 py-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">Messages</span>
                          <div className="flex gap-1">
                            {frame.threads.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => void runAction({ action: 'tap', target: t.contact })}
                                className={cn(
                                  'rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors',
                                  activeThread?.id === t.id
                                    ? 'border-sky-500/50 bg-sky-500/20 text-sky-200'
                                    : 'border-white/10 text-zinc-400 hover:text-zinc-200'
                                )}
                              >
                                {t.contact.split(' ')[0]}
                              </button>
                            ))}
                          </div>
                        </div>

                        {activeThread && (
                          <div className="flex flex-1 flex-col justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                            <div className="border-b border-white/10 pb-1.5 text-[11px] font-medium text-zinc-200">
                              {activeThread.contact}
                            </div>
                            <div className="nice-scroll flex-1 space-y-2 overflow-y-auto py-1">
                              {activeThread.messages.map((m, idx) => (
                                <div
                                  key={idx}
                                  className={cn(
                                    'max-w-[85%] rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed',
                                    m.from === 'me'
                                      ? 'ml-auto bg-sky-500/25 text-sky-100'
                                      : 'bg-zinc-800 text-zinc-200'
                                  )}
                                >
                                  {m.text}
                                </div>
                              ))}
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              Type below to reply as {frame.deviceName.split('·')[0].trim()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ANDROID PHONE DIALER */}
                    {frame.currentApp === 'phone' && (
                      <div className="flex flex-1 flex-col justify-between py-1">
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
                          <div className="font-mono text-lg tracking-wider text-white">
                            {frame.dialerNumber || 'Dial number'}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-emerald-400">
                            {frame.callState === 'calling' ? 'Calling…' : 'Ready'}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 py-2">
                          {DIAL_KEYS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => void runAction({ action: 'type', text: k })}
                              className="flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] font-mono text-sm font-medium text-white active:scale-95"
                            >
                              {k}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => void runAction({ action: 'tap', target: 'call' })}
                          className={cn(
                            'mx-auto flex h-11 w-28 items-center justify-center gap-1.5 rounded-full text-xs font-semibold text-white transition-colors',
                            frame.callState === 'calling'
                              ? 'bg-red-500 hover:bg-red-600'
                              : 'bg-emerald-500 hover:bg-emerald-600'
                          )}
                        >
                          {frame.callState === 'calling' ? (
                            <>
                              <PhoneOff className="h-4 w-4" /> End
                            </>
                          ) : (
                            <>
                              <PhoneCall className="h-4 w-4" /> Call
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* ANDROID CHROME MOBILE */}
                    {frame.currentApp === 'chrome' && (
                      <div className="flex flex-1 flex-col gap-2.5 py-1">
                        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] text-zinc-200">
                          <Globe className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                          <span className="truncate font-mono">{frame.url}</span>
                        </div>
                        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-xs font-semibold text-white">{frame.chromeTitle}</div>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                            {frame.chromeSnippet}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void runAction({ action: 'open_url', url: 'https://news.ycombinator.com' })}
                              className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10.5px] text-zinc-200 hover:bg-white/10"
                            >
                              Hacker News
                            </button>
                            <button
                              type="button"
                              onClick={() => void runAction({ action: 'open_url', url: 'https://en.wikipedia.org' })}
                              className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10.5px] text-zinc-200 hover:bg-white/10"
                            >
                              Wikipedia
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ANDROID NOTES */}
                    {frame.currentApp === 'notes' && (
                      <div className="space-y-2 py-1">
                        <div className="text-sm font-semibold text-white">Notes</div>
                        {frame.notes.map((n) => (
                          <div
                            key={n.id}
                            className="rounded-xl border border-yellow-500/20 bg-yellow-500/8 p-2.5"
                          >
                            <div className="text-xs font-medium text-yellow-100">{n.title}</div>
                            <p className="mt-1 whitespace-pre-line text-[10.5px] leading-relaxed text-zinc-300">
                              {n.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* CAMERA / MAPS / CALENDAR */}
                    {(frame.currentApp === 'camera' ||
                      frame.currentApp === 'maps' ||
                      frame.currentApp === 'calendar') && (
                      <div className="my-auto flex flex-col items-center justify-center gap-2 py-8 text-center">
                        <div className="text-sm font-semibold capitalize text-white">{frame.currentApp}</div>
                        <p className="max-w-[210px] text-[11px] text-zinc-400">
                          Active Android viewport. Use Eva Autopilot or tap controls below to operate this app.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* NOTIFICATION SHADE OVERLAY */}
                {frame.notificationShadeOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    data-android-shade="1"
                    className="absolute inset-0 z-10 flex flex-col gap-3 bg-zinc-950/95 p-3 backdrop-blur-md"
                  >
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { key: 'wifi', label: 'Wi-Fi', icon: Wifi },
                          { key: 'bluetooth', label: 'BT', icon: Bluetooth },
                          { key: 'dnd', label: 'DND', icon: Moon },
                          { key: 'flashlight', label: 'Torch', icon: Flashlight },
                          { key: 'airplane', label: 'Flight', icon: Plane },
                        ] as const
                      ).map(({ key, label, icon: Icon }) => {
                        const on = frame.quickSettings[key]
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => void runAction({ action: 'toggle_setting', setting: key })}
                            className={cn(
                              'flex flex-col items-center gap-1 rounded-xl border py-2 text-[10px] font-medium transition-colors',
                              on
                                ? 'border-emerald-500/45 bg-emerald-500/20 text-emerald-200'
                                : 'border-white/10 bg-white/[0.04] text-zinc-400'
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            <span>{label}</span>
                          </button>
                        )
                      })}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                        Notifications
                      </div>
                      {frame.notifications.map((n) => (
                        <div
                          key={n.id}
                          className="rounded-xl border border-white/10 bg-white/[0.05] p-2.5 text-left"
                        >
                          <div className="flex items-center justify-between text-[10px] text-zinc-400">
                            <span className="font-medium text-zinc-200">{n.app}</span>
                            <span>{n.time}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] font-medium text-white">{n.title}</div>
                          <div className="truncate text-[10.5px] text-zinc-400">{n.body}</div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void runAction({ action: 'notifications', open: false })}
                      className="mt-auto rounded-lg border border-white/10 bg-white/[0.06] py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-white/10"
                    >
                      Close Shade
                    </button>
                  </motion.div>
                )}

                {/* RECENTS APP SWITCHER OVERLAY */}
                {frame.recentsOpen && (
                  <div className="absolute inset-0 z-10 flex flex-col gap-2 bg-zinc-950/92 p-3 backdrop-blur-md">
                    <div className="text-xs font-semibold text-white">Recent Apps</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(['settings', 'messages', 'chrome', 'notes'] as const).map((appId) => (
                        <button
                          key={appId}
                          type="button"
                          onClick={() => void runAction({ action: 'open_app', app: appId })}
                          className="rounded-xl border border-white/15 bg-white/[0.05] p-3 text-left text-xs font-medium capitalize text-zinc-200 hover:bg-white/10"
                        >
                          {appId}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Eva Animated Touch Ripple */}
                {frame.touchX !== null && frame.touchY !== null && (
                  <motion.div
                    key={`${frame.updatedAt}-${frame.touchX}-${frame.touchY}`}
                    aria-hidden
                    initial={{ scale: 0.4, opacity: 0.95 }}
                    animate={{ scale: 1.35, opacity: 0.25 }}
                    transition={{ duration: 0.45 }}
                    className="pointer-events-none absolute z-30 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400 bg-emerald-400/25"
                    style={{
                      left: `${(frame.touchX / Math.max(1, frame.width)) * 100}%`,
                      top: `${(frame.touchY / Math.max(1, frame.height)) * 100}%`,
                    }}
                  />
                )}

                {/* Eva Swipe Vector Overlay */}
                {frame.swipeVector && (
                  <svg
                    aria-hidden
                    viewBox={`0 0 ${frame.width} ${frame.height}`}
                    className="pointer-events-none absolute inset-0 z-30 h-full w-full"
                  >
                    <line
                      x1={frame.swipeVector.fromX}
                      y1={frame.swipeVector.fromY}
                      x2={frame.swipeVector.toX}
                      y2={frame.swipeVector.toY}
                      stroke="#34d399"
                      strokeWidth="22"
                      strokeLinecap="round"
                      strokeDasharray="36 24"
                      opacity="0.7"
                    />
                  </svg>
                )}
              </div>

              {/* Android Bottom Navigation Bar */}
              <div className="relative z-20 flex h-10 shrink-0 items-center justify-around border-t border-white/10 bg-zinc-950/95 px-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'press_key', key: 'back' })}
                  aria-label="Android Back"
                  className="flex h-8 w-10 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'press_key', key: 'home' })}
                  aria-label="Android Home"
                  className="flex h-8 w-10 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <Circle className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'press_key', key: 'recents' })}
                  aria-label="Android Recents"
                  className="flex h-8 w-10 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <Square className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Hardware Gesture & Status Strip */}
            <div className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate font-mono" data-mobile-last-action="1">
                {statusNote || frame.lastAction}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'notifications' })}
                  aria-label="Toggle notification shade"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] hover:bg-muted"
                >
                  <Bell className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'swipe', direction: 'up' })}
                  aria-label="Swipe up on phone"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] hover:bg-muted"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction({ action: 'swipe', direction: 'down' })}
                  aria-label="Swipe down on phone"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] hover:bg-muted"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline Mobile Keyboard Input Bar */}
      <form
        onSubmit={handleTypeSubmit}
        className="flex items-center gap-1.5 border-t border-border bg-card/50 px-3 py-2"
      >
        <input
          type="text"
          value={typeInput}
          onChange={(e) => setTypeInput(e.target.value)}
          placeholder="Type into active Android app (SMS, URL, note, dial)…"
          aria-label="Type text into active mobile app"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-emerald-500/60"
        />
        <button
          type="submit"
          disabled={busy || !typeInput.trim()}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-accent disabled:opacity-40"
        >
          <CornerDownLeft className="h-3 w-3" />
          Send
        </button>
      </form>
    </div>
  )
}
