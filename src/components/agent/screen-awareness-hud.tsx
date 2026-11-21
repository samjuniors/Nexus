'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
  Laptop,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Monitor,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { cn } from '@/lib/utils'

interface NexusDesktopBridge {
  isElectron?: boolean
  captureScreen?: () => Promise<{
    dataUrl: string
    base64: string
    mimeType: string
    name?: string
  } | null>
  injectText?: (text: string) => Promise<{ ok: boolean; error?: string }>
}

const SCREEN_QUICK_PROMPTS = [
  'Explain what is on my screen and suggest the best next step.',
  'Spot any errors, warnings, or issues visible here.',
  'Summarize the key information shown in this window.',
]

/**
 * Screen Awareness (Alt+Space / Alt+Shift+S) & Quick Dictation (Alt+Shift+D) HUD.
 * Works natively inside Electron (auto-capturing active Windows screens & pasting dictation
 * directly into the focused app), via the Windows Companion Bridge, or right in the browser.
 */
export function ScreenAwarenessHud({
  onInsertIntoChat,
}: {
  onInsertIntoChat?: (text: string) => void
}) {
  const open = useEvaControl((s) => s.screenHudOpen)
  const tab = useEvaControl((s) => s.screenHudTab)
  const capturedFrame = useEvaControl((s) => s.screenHudCapturedFrame)
  const openScreenHud = useEvaControl((s) => s.openScreenHud)
  const closeScreenHud = useEvaControl((s) => s.closeScreenHud)
  const captureWindowsScreen = useEvaControl((s) => s.captureWindowsScreen)
  const windowsBridgeAction = useEvaControl((s) => s.windowsBridgeAction)
  const devices = useEvaControl((s) => s.devices)

  const activeConvId = useApp((s) => s.activeConvId)
  const refreshConversations = useApp((s) => s.refreshConversations)
  const setActiveConv = useApp((s) => s.setActiveConv)

  // Screen Awareness state
  const [screenPrompt, setScreenPrompt] = useState('')
  const [screenBusy, setScreenBusy] = useState(false)
  const [screenReply, setScreenReply] = useState<string | null>(null)
  const [screenError, setScreenError] = useState<string | null>(null)

  // Quick Dictation state
  const [dictationStyle, setDictationStyle] = useState<'clean' | 'email' | 'bullets'>('clean')
  const [recording, setRecording] = useState(false)
  const [dictationBusy, setDictationBusy] = useState(false)
  const [rawDraft, setRawDraft] = useState('')
  const [formattedText, setFormattedText] = useState('')
  const [dictationError, setDictationError] = useState<string | null>(null)
  const [dictationNotice, setDictationNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const desktopBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { nexusDesktop?: NexusDesktopBridge }).nexusDesktop
      : undefined
  const isElectron = Boolean(desktopBridge?.isElectron)
  const onlineDesktop = devices.find(
    (d) => d.status === 'online' && d.platform !== 'android' && d.platform !== 'ios'
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeScreenHud()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeScreenHud])

  if (!open) return null

  const handleCaptureScreen = async (source: 'auto' | 'browser' | 'windows') => {
    setScreenBusy(true)
    setScreenError(null)
    try {
      if ((source === 'auto' || source === 'windows') && isElectron && desktopBridge?.captureScreen) {
        const frame = await desktopBridge.captureScreen()
        if (frame?.base64) {
          openScreenHud('screen', frame)
          return
        }
      }

      if ((source === 'auto' || source === 'windows') && onlineDesktop) {
        const res = await captureWindowsScreen(onlineDesktop.id)
        if (res.ok && res.desktopFrame?.imageBase64) {
          openScreenHud('screen', {
            dataUrl: `data:image/jpeg;base64,${res.desktopFrame.imageBase64}`,
            base64: res.desktopFrame.imageBase64,
            mimeType: 'image/jpeg',
            name: res.desktopFrame.windowTitle || onlineDesktop.name,
          })
          return
        }
        if (source === 'windows') {
          throw new Error(res.error || 'Could not capture Windows PC screen')
        }
      }

      // Fallback: browser getDisplayMedia single-frame grab
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen capture is unavailable in this browser. Connect the Windows Companion Bridge or Electron app.')
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      try {
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        await video.play()
        await new Promise((r) => setTimeout(r, 150))
        const canvas = document.createElement('canvas')
        const maxW = 1280
        const scale = Math.min(1, maxW / Math.max(1, video.videoWidth))
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
        openScreenHud('screen', {
          dataUrl,
          base64,
          mimeType: 'image/jpeg',
          name: 'Shared Window',
        })
      } finally {
        stream.getTracks().forEach((t) => t.stop())
      }
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : String(e))
    } finally {
      setScreenBusy(false)
    }
  }

  const handleAnalyzeScreen = async (promptOverride?: string) => {
    if (!capturedFrame?.base64) {
      setScreenError('Capture a screen or window first.')
      return
    }
    setScreenBusy(true)
    setScreenError(null)
    try {
      const prompt = (promptOverride ?? screenPrompt).trim() || SCREEN_QUICK_PROMPTS[0]
      const res = await fetch('/api/vision/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConvId,
          prompt,
          imageBase64: capturedFrame.base64,
          mimeType: capturedFrame.mimeType || 'image/jpeg',
          source: 'screen',
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        reply?: string
        conversationId?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Screen analysis failed')
      }
      setScreenReply(data.reply || 'Analysis complete.')
      await refreshConversations()
      if (data.conversationId) setActiveConv(data.conversationId)
    } catch (e) {
      setScreenError(e instanceof Error ? e.message : String(e))
    } finally {
      setScreenBusy(false)
    }
  }

  const processDictation = async (payload: { audioBase64?: string; mimeType?: string; rawText?: string }) => {
    setDictationBusy(true)
    setDictationError(null)
    setDictationNotice(null)
    try {
      const res = await fetch('/api/dictation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, style: dictationStyle }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        rawTranscript?: string
        formattedText?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Dictation failed')
      }
      if (data.rawTranscript) setRawDraft(data.rawTranscript)
      setFormattedText(data.formattedText || '')
    } catch (e) {
      setDictationError(e instanceof Error ? e.message : String(e))
    } finally {
      setDictationBusy(false)
    }
  }

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      return
    }
    setDictationError(null)
    setDictationNotice(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone recording is unavailable here — type rough notes below to format.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const reader = new FileReader()
        reader.onloadend = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          if (dataUrl) {
            void processDictation({
              audioBase64: dataUrl,
              mimeType: mimeType.split(';')[0] || 'audio/webm',
            })
          }
        }
        reader.readAsDataURL(blob)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (e) {
      setDictationError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleInjectToWindows = async () => {
    const text = formattedText.trim()
    if (!text) return
    setDictationError(null)
    setDictationNotice(null)

    if (isElectron && desktopBridge?.injectText) {
      const res = await desktopBridge.injectText(text)
      if (res?.ok) {
        setDictationNotice('Injected clean dictation into your active Windows app.')
        return
      }
    }

    if (onlineDesktop) {
      const res = await windowsBridgeAction('paste_text', { text }, onlineDesktop.id)
      if (res.ok) {
        setDictationNotice(`Pasted into active window on ${onlineDesktop.name}.`)
        return
      }
      setDictationError(res.error || 'Could not paste into Windows app')
      return
    }

    navigator.clipboard?.writeText(text).catch(() => {})
    setDictationNotice('Copied to clipboard — press Ctrl+V in any Windows app.')
  }

  const handleCopyDictation = () => {
    if (!formattedText.trim()) return
    navigator.clipboard?.writeText(formattedText).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screen Awareness and Quick Dictation"
      data-screen-awareness-hud="1"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        {/* Top tab bar */}
        <div className="flex items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-2.5">
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
            <button
              type="button"
              onClick={() => openScreenHud('screen')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'screen'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
              Screen Awareness
              <kbd className="ml-1 hidden font-mono text-[10px] text-muted-foreground sm:inline">
                Alt+Space
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => openScreenHud('dictation')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                tab === 'dictation'
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Mic className="h-3.5 w-3.5" />
              Quick Dictation
              <kbd className="ml-1 hidden font-mono text-[10px] text-muted-foreground sm:inline">
                Alt+Shift+D
              </kbd>
            </button>
          </div>
          <button
            type="button"
            onClick={closeScreenHud}
            aria-label="Close overlay"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="nice-scroll flex-1 overflow-y-auto p-4">
          {tab === 'screen' ? (
            <div className="space-y-3">
              {/* Capture controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {capturedFrame?.name
                    ? `Captured: ${capturedFrame.name}`
                    : 'Capture your Windows PC or any open window for Gemini multimodal analysis.'}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(isElectron || onlineDesktop) && (
                    <button
                      type="button"
                      disabled={screenBusy}
                      onClick={() => void handleCaptureScreen('windows')}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
                    >
                      <Laptop className="h-3.5 w-3.5" />
                      Capture Windows PC
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={screenBusy}
                    onClick={() => void handleCaptureScreen('browser')}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Share Window
                  </button>
                </div>
              </div>

              {/* Screen preview */}
              <div className="overflow-hidden rounded-lg border border-border bg-zinc-950">
                {capturedFrame?.dataUrl ? (
                  <img
                    src={capturedFrame.dataUrl}
                    alt="Captured screen preview"
                    className="block max-h-60 w-full object-contain"
                  />
                ) : (
                  <div className="flex h-44 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Monitor className="h-6 w-6 opacity-50" />
                    <span>No screen frame captured yet</span>
                  </div>
                )}
              </div>

              {/* Quick prompt buttons */}
              <div className="flex flex-wrap gap-1.5">
                {SCREEN_QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={screenBusy || !capturedFrame}
                    onClick={() => {
                      setScreenPrompt(q)
                      void handleAnalyzeScreen(q)
                    }}
                    className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Custom question form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleAnalyzeScreen()
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={screenPrompt}
                  onChange={(e) => setScreenPrompt(e.target.value)}
                  placeholder="Ask Eva about what is on your screen…"
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary/50"
                />
                <button
                  type="submit"
                  disabled={screenBusy || !capturedFrame}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
                >
                  {screenBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Analyze
                </button>
              </form>

              {screenError && (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {screenError}
                </div>
              )}

              {screenReply && (
                <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Eva Screen Analysis
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {screenReply}
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={closeScreenHud}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium text-foreground hover:bg-muted"
                    >
                      Continue in Chat
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Dictation controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                  {(
                    [
                      { id: 'clean', label: 'Clean Text' },
                      { id: 'email', label: 'Email' },
                      { id: 'bullets', label: 'Bullets' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDictationStyle(opt.id)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-medium transition-colors',
                        dictationStyle === opt.id
                          ? 'bg-primary/12 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={dictationBusy}
                  onClick={() => void toggleRecording()}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50',
                    recording
                      ? 'border-destructive/50 bg-destructive/15 text-destructive'
                      : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300'
                  )}
                >
                  {recording ? (
                    <>
                      <MicOff className="h-3.5 w-3.5" /> Stop &amp; Format
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" /> Record Dictation
                    </>
                  )}
                </button>
              </div>

              {/* Rough draft / transcript box */}
              <div className="space-y-1.5">
                <label className="block font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  Spoken / Raw Draft
                </label>
                <div className="flex gap-2">
                  <textarea
                    rows={3}
                    value={rawDraft}
                    onChange={(e) => setRawDraft(e.target.value)}
                    placeholder="Press Record Dictation above, or type rough notes to polish…"
                    className="min-w-0 flex-1 rounded-md border border-border bg-background p-2.5 text-xs text-foreground outline-none focus:border-primary/50"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={dictationBusy || !rawDraft.trim()}
                    onClick={() => void processDictation({ rawText: rawDraft })}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
                  >
                    {dictationBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 text-sky-500" />
                    )}
                    Polish Text
                  </button>
                </div>
              </div>

              {dictationError && (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {dictationError}
                </div>
              )}

              {dictationNotice && (
                <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {dictationNotice}
                </div>
              )}

              {/* Polished paste-ready output */}
              <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    Formatted Output
                  </span>
                  {dictationBusy && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Formatting…
                    </span>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={formattedText}
                  onChange={(e) => setFormattedText(e.target.value)}
                  placeholder="Your clean, formatted dictation will appear here ready to paste…"
                  className="w-full rounded-md border border-border bg-card/40 p-2.5 text-xs leading-relaxed text-foreground outline-none focus:border-primary/50"
                />
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={!formattedText.trim()}
                    onClick={handleCopyDictation}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  {onInsertIntoChat && (
                    <button
                      type="button"
                      disabled={!formattedText.trim()}
                      onClick={() => {
                        onInsertIntoChat(formattedText.trim())
                        closeScreenHud()
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
                    >
                      <MessageSquarePlus className="h-3 w-3" />
                      Insert into Chat
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!formattedText.trim()}
                    onClick={() => void handleInjectToWindows()}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 text-[11px] font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
                  >
                    <Send className="h-3 w-3" />
                    {isElectron || onlineDesktop ? 'Paste into Active Windows App' : 'Copy for Windows App'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
