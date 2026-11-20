'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUp,
  Camera,
  CameraOff,
  Captions,
  CaptionsOff,
  Ear,
  EarOff,
  GitBranch,
  Globe,
  Hand,
  Heart,
  Keyboard,
  LayoutGrid,
  Loader2,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Network,
  PhoneOff,
  Play,
  RefreshCw,
  Shirt,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  SwitchCamera,
  X,
} from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { VisionPreviewStrip } from '@/components/agent/vision-preview-pip'
import { AnimatedCaptionText } from '@/components/agent/animated-caption-text'
import { VoiceVisualizerAura } from '@/components/agent/voice-visualizer-aura'
import { MaterialBottomSheet } from '@/components/agent/material-bottom-sheet'
import { useEva } from '@/components/agent/eva-provider'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { EYE_EXPRESSION_LABELS } from '@/lib/agent/mochi-eyes'
import { EVA_EMOTIONS, type EvaEmotionId } from '@/lib/agent/eva-emotions'
import { CAPTION_ANIMATION_OPTIONS } from '@/lib/agent/caption-animation'
import {
  VOICE_VISUALIZER_OPTIONS,
  computeVisualizerIntensity,
} from '@/lib/agent/voice-visualizer'
import { GAZE_TRACKING_MODE_OPTIONS } from '@/lib/agent/camera-gaze'
import {
  computeSubtitleFadeMs,
  extractActiveSubtitleCue,
} from '@/lib/agent/subtitle-engine'
import { useViewportTier } from '@/lib/agent/responsive-layout'
import { triggerHaptic } from '@/lib/platform/android-bridge'
import { OUTFIT_SELECTIONS, type OutfitSelection } from '@/lib/coucou/wardrobe'
import { cn } from '@/lib/utils'

const OUTFIT_CYCLE: readonly OutfitSelection[] = OUTFIT_SELECTIONS

const VOICE_MOOD_PRESETS: readonly EvaEmotionId[] = [
  'calm',
  'happy',
  'curious',
  'focused',
  'excited',
  'empathetic',
  'proud',
]

const SUBTITLE_DEMO_PHRASES = [
  'How are you doing today?',
  "I'm Eva — looking right at you and ready to help.",
]

interface ActiveSubtitleState {
  id: string
  speaker: 'Eva' | 'You' | 'System'
  text: string
  live: boolean
  isWhisper?: boolean
  isThinking?: boolean
}

function SpeechCadenceDots({
  active,
  thinking = false,
  color,
}: {
  active: boolean
  thinking?: boolean
  color: string
}) {
  if (thinking) {
    return (
      <span className="inline-flex h-3 items-center gap-[3.5px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-[4.5px] w-[4.5px] rounded-full transform-gpu"
            style={{ backgroundColor: color }}
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.15, 0.85] }}
            transition={{
              duration: 1.05,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.18,
            }}
          />
        ))}
      </span>
    )
  }
  if (!active) return null
  return (
    <span className="inline-flex h-3 items-end gap-[2.5px]" aria-hidden>
      {[0.45, 0.95, 0.65, 0.85].map((h, i) => (
        <motion.span
          key={i}
          className="h-[11px] w-[2px] rounded-full transform-gpu"
          style={{
            backgroundColor: color,
            transformOrigin: '50% 100%',
          }}
          animate={{ scaleY: [Math.max(0.28, h * 0.45), h, Math.max(0.28, h * 0.45)] }}
          transition={{
            duration: 0.72,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.11,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Dynamic Voice Focus OS Mode — ultra-minimal hands-free voice agent stage where
 * Coucou sits borderless over a selectable Voice Visualizer Aura, tracks the Founder's
 * live camera gaze & gestures, and renders borderless cinema-style phrase-by-phrase
 * subtitles that naturally appear and clear in rhythm with speech.
 */
export function VoiceFocusStage({
  onOpenCommandPalette: _onOpenCommandPalette,
}: {
  onOpenCommandPalette?: () => void
}) {
  const {
    voice,
    wake,
    vision,
    evaExpression,
    emotion,
    senses,
    handTracking,
    cameraGreetSeq,
    onToggleSleepMode,
    onArmEar,
  } = useEva()
  const activeConvId = useApp((s) => s.activeConvId)
  const brainConnected = useApp((s) => s.brain?.connected ?? true)

  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const coucouOutfit = useEvaControl((s) => s.coucouOutfit)
  const setCoucouOutfit = useEvaControl((s) => s.setCoucouOutfit)
  const coucouDancing = useEvaControl((s) => s.coucouDancing)
  const mediaPlaying = useEvaControl((s) => Boolean(s.browserFrame?.mediaEmbedUrl))
  const transientNote = useEvaControl((s) => s.transientMoodNote)
  const reasoningChains = useEvaControl((s) => s.reasoningChains)
  const openReasoningForChain = useEvaControl((s) => s.openReasoningForChain)
  const manualEmotion = useEvaControl((s) => s.manualEmotion)
  const setManualEmotion = useEvaControl((s) => s.setManualEmotion)
  const captionsEnabled = useEvaControl((s) => s.captionsEnabled)
  const setCaptionsEnabled = useEvaControl((s) => s.setCaptionsEnabled)
  const captionAnimationStyle = useEvaControl((s) => s.captionAnimationStyle)
  const setCaptionAnimationStyle = useEvaControl((s) => s.setCaptionAnimationStyle)
  const voiceVisualizerStyle = useEvaControl((s) => s.voiceVisualizerStyle)
  const setVoiceVisualizerStyle = useEvaControl((s) => s.setVoiceVisualizerStyle)

  const [greetSeq, setGreetSeq] = useState(0)
  const [stageSettingsOpen, setStageSettingsOpen] = useState(false)
  const [manualComposerOpen, setManualComposerOpen] = useState(false)
  const [fallbackInput, setFallbackInput] = useState('')
  const [sendingFallback, setSendingFallback] = useState(false)
  const [subtitleFaded, setSubtitleFaded] = useState(false)
  const [heldSubtitle, setHeldSubtitle] = useState<ActiveSubtitleState | null>(null)
  const [demoSubtitle, setDemoSubtitle] = useState<string | null>(null)
  const [subtitleReplaySeq, setSubtitleReplaySeq] = useState(0)
  const settingsPopoverRef = useRef<HTMLDivElement>(null)
  const fallbackInputRef = useRef<HTMLInputElement>(null)
  const demoTimersRef = useRef<number[]>([])
  const lastEvaCueRef = useRef<ActiveSubtitleState | null>(null)
  const heldTimerRef = useRef<number | null>(null)
  const { isCompact } = useViewportTier()
  const sendTask = useApp((s) => s.sendTask)

  const voiceBlockedOrError =
    voice.status === 'error' ||
    Boolean(voice.lastError) ||
    wake.status === 'error' ||
    wake.status === 'unsupported'
  const showDynamicComposer = voiceBlockedOrError || manualComposerOpen

  // Listen for OsTopBar mobile Stage Settings button toggle
  useEffect(() => {
    const onToggleStageSettings = () => {
      triggerHaptic('selection')
      setStageSettingsOpen((v) => !v)
    }
    window.addEventListener('nexus:toggle-voice-stage-settings', onToggleStageSettings)
    return () => {
      window.removeEventListener('nexus:toggle-voice-stage-settings', onToggleStageSettings)
    }
  }, [])

  // Auto-collapse manual composer once Live Voice connects cleanly
  useEffect(() => {
    if (voice.status === 'connected') {
      setManualComposerOpen(false)
    }
  }, [voice.status])

  const submitFallbackMessage = async () => {
    const text = fallbackInput.trim()
    if (!text || sendingFallback) return
    setFallbackInput('')
    if (voice.status === 'connected' && voice.sendLiveText(text)) {
      setManualComposerOpen(false)
      return
    }
    setSendingFallback(true)
    try {
      setManualComposerOpen(false)
      setLayoutMode('standard')
      await sendTask(text)
    } finally {
      setSendingFallback(false)
    }
  }

  const latestChain = reasoningChains[0] ?? null
  const latestNode = useMemo(() => {
    if (!latestChain || latestChain.nodes.length === 0) return null
    return latestChain.nodes[latestChain.nodes.length - 1]
  }, [latestChain])

  // Close Stage Settings popover on outside click / Escape
  useEffect(() => {
    if (!stageSettingsOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-voice-stage-settings-trigger="1"]')) return
      if (settingsPopoverRef.current && !settingsPopoverRef.current.contains(e.target as Node)) {
        setStageSettingsOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStageSettingsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [stageSettingsOpen])

  useEffect(() => {
    return () => {
      demoTimersRef.current.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  const triggerSubtitleDemo = () => {
    demoTimersRef.current.forEach((id) => window.clearTimeout(id))
    demoTimersRef.current = []
    if (!captionsEnabled) setCaptionsEnabled(true)
    setStageSettingsOpen(false)
    setSubtitleFaded(false)
    setDemoSubtitle(SUBTITLE_DEMO_PHRASES[0])
    setSubtitleReplaySeq((n) => n + 1)

    const t1 = window.setTimeout(() => {
      setDemoSubtitle(SUBTITLE_DEMO_PHRASES[1])
      setSubtitleReplaySeq((n) => n + 1)
    }, 2400)
    const t2 = window.setTimeout(() => {
      setDemoSubtitle(null)
    }, 5800)
    demoTimersRef.current = [t1, t2]
  }

  const subtitleMaxChars = isCompact ? 48 : 70
  const isVoiceThinking = voice.agentState === 'thinking' || voice.status === 'connecting'

  // Retain Eva's final spoken phrase briefly across turn_complete so mobile users
  // can finish reading the last words before captions gently return to Listening…
  useEffect(() => {
    const trimmedOut = voice.liveOutputTranscript.trim()
    if (trimmedOut) {
      const cue = extractActiveSubtitleCue(trimmedOut, { maxChars: subtitleMaxChars })
      if (cue.current) {
        lastEvaCueRef.current = {
          id: `eva:${cue.phraseIndex}`,
          speaker: 'Eva',
          text: cue.current,
          live: true,
        }
      }
      if (heldTimerRef.current) {
        window.clearTimeout(heldTimerRef.current)
        heldTimerRef.current = null
      }
      setHeldSubtitle(null)
      return
    }

    // Live output just cleared (turn_complete) — hold the last spoken phrase for a natural reading window
    if (lastEvaCueRef.current && voice.isActive && !voice.liveInputTranscript.trim() && !voice.isUserSpeaking && !isVoiceThinking) {
      const toHold = { ...lastEvaCueRef.current, live: false }
      lastEvaCueRef.current = null
      setHeldSubtitle(toHold)
      if (heldTimerRef.current) window.clearTimeout(heldTimerRef.current)
      const holdMs = computeSubtitleFadeMs(toHold.text, false)
      heldTimerRef.current = window.setTimeout(() => {
        setHeldSubtitle(null)
        heldTimerRef.current = null
      }, holdMs)
    }
  }, [
    voice.liveOutputTranscript,
    voice.liveInputTranscript,
    voice.isActive,
    voice.isUserSpeaking,
    isVoiceThinking,
    subtitleMaxChars,
  ])

  // Clear held subtitle immediately when user starts talking, thinking begins, or voice stops
  useEffect(() => {
    if (!voice.isActive || voice.isUserSpeaking || isVoiceThinking || voice.liveInputTranscript.trim()) {
      if (heldTimerRef.current) {
        window.clearTimeout(heldTimerRef.current)
        heldTimerRef.current = null
      }
      setHeldSubtitle(null)
    }
  }, [voice.isActive, voice.isUserSpeaking, isVoiceThinking, voice.liveInputTranscript])

  useEffect(() => {
    return () => {
      if (heldTimerRef.current) window.clearTimeout(heldTimerRef.current)
    }
  }, [])

  // Phrase-by-phrase cinema subtitle derivation:
  // Key strictly by speaker + phraseIndex (NEVER embed `cue.current`) so streamed tokens
  // flow smoothly in-place without unmounting/flickering on every word!
  const rawSubtitle: ActiveSubtitleState | null = useMemo(() => {
    if (demoSubtitle) {
      return {
        id: `demo:${demoSubtitle}`,
        speaker: 'Eva',
        text: demoSubtitle,
        live: true,
      }
    }
    if (voice.liveOutputTranscript.trim()) {
      const cue = extractActiveSubtitleCue(voice.liveOutputTranscript, { maxChars: subtitleMaxChars })
      if (cue.current) {
        return {
          id: `eva:${cue.phraseIndex}`,
          speaker: 'Eva',
          text: cue.current,
          live: true,
        }
      }
    }
    if (voice.liveInputTranscript.trim()) {
      const cue = extractActiveSubtitleCue(voice.liveInputTranscript, { maxChars: subtitleMaxChars })
      if (cue.current) {
        return {
          id: `you:${cue.phraseIndex}`,
          speaker: 'You',
          text: cue.current,
          live: true,
        }
      }
    }
    if (heldSubtitle && voice.isActive) {
      return heldSubtitle
    }
    if (transientNote) {
      return {
        id: `note:${transientNote}`,
        speaker: 'Eva',
        text: transientNote,
        live: false,
      }
    }
    if (voice.isActive) {
      if (voice.status === 'connecting') {
        return {
          id: 'connecting',
          speaker: 'Eva',
          text: 'Connecting…',
          live: true,
          isWhisper: true,
          isThinking: true,
        }
      }
      if (voice.muted) {
        return {
          id: 'muted',
          speaker: 'System',
          text: 'Microphone muted',
          live: false,
          isWhisper: true,
        }
      }
      if (voice.agentState === 'thinking') {
        return {
          id: 'thinking',
          speaker: 'Eva',
          text: 'Thinking…',
          live: true,
          isWhisper: true,
          isThinking: true,
        }
      }
      if (voice.isSpeaking) {
        return {
          id: 'speaking',
          speaker: 'Eva',
          text: 'Speaking…',
          live: true,
          isWhisper: true,
        }
      }
      return {
        id: 'listening',
        speaker: 'Eva',
        text: 'Listening…',
        live: true,
        isWhisper: true,
      }
    }
    if (wake.sleepMode) {
      return {
        id: 'sleeping',
        speaker: 'System',
        text: 'Tap Eva to wake',
        live: false,
        isWhisper: true,
      }
    }
    return {
      id: 'idle-whisper',
      speaker: 'Eva',
      text: `Say "${wake.wakePhrase}" or tap to speak`,
      live: false,
      isWhisper: true,
    }
  }, [
    demoSubtitle,
    voice.liveOutputTranscript,
    voice.liveInputTranscript,
    heldSubtitle,
    voice.isActive,
    voice.status,
    voice.agentState,
    voice.isSpeaking,
    voice.muted,
    transientNote,
    wake.sleepMode,
    wake.wakePhrase,
    subtitleMaxChars,
  ])

  // Auto-fade finished live speech subtitles after a natural reading window so stale text clears away
  const rawSubtitleId = rawSubtitle?.id ?? ''
  const rawSubtitleText = rawSubtitle?.text ?? ''
  const rawSubtitleIsLiveSpeech = Boolean(
    rawSubtitle &&
      !rawSubtitle.isWhisper &&
      rawSubtitle.live &&
      (rawSubtitle.id.startsWith('eva:') || rawSubtitle.id.startsWith('you:'))
  )

  useEffect(() => {
    setSubtitleFaded(false)
    if (!rawSubtitleIsLiveSpeech || !rawSubtitleText) return
    const fadeMs = computeSubtitleFadeMs(rawSubtitleText, voice.isSpeaking || voice.isUserSpeaking)
    const timer = window.setTimeout(() => {
      if (!voice.isSpeaking && !voice.isUserSpeaking) {
        setSubtitleFaded(true)
      }
    }, fadeMs)
    return () => window.clearTimeout(timer)
  }, [rawSubtitleId, rawSubtitleText, rawSubtitleIsLiveSpeech, voice.isSpeaking, voice.isUserSpeaking])

  const visibleSubtitle = subtitleFaded && rawSubtitleIsLiveSpeech ? null : rawSubtitle

  const cycleOutfit = () => {
    const idx = OUTFIT_CYCLE.indexOf(coucouOutfit)
    const next = OUTFIT_CYCLE[(idx + 1) % OUTFIT_CYCLE.length]
    setCoucouOutfit(next)
  }

  const handleCharacterTap = () => {
    if (wake.sleepMode) {
      onToggleSleepMode()
      setGreetSeq((n) => n + 1)
      return
    }
    if (voice.isActive) {
      voice.toggleMute()
      return
    }
    if (wake.status === 'awaiting-mic' || wake.status === 'error') {
      onArmEar()
    }
    setGreetSeq((n) => n + 1)
    void voice.startVoice(activeConvId)
  }

  const toggleSplit = (mode: 'reasoning' | 'browser') => {
    if (splitOpen && splitMode === mode) closeSplit()
    else openSplit(mode)
  }

  const speakingLevel = voice.isSpeaking
    ? 0.72
    : voice.isUserSpeaking
      ? Math.max(0.28, voice.micLevel)
      : 0

  const visualizerIntensity = computeVisualizerIntensity({
    voiceActive: voice.isActive,
    isSpeaking: voice.isSpeaking,
    isUserSpeaking: voice.isUserSpeaking,
    speakingLevel,
    micLevel: voice.micLevel,
    sleepMode: wake.sleepMode,
  })

  // On compact mobile WebViews, skip dynamic multi-pass CSS drop-shadow filters over
  // the 2D canvas (VoiceVisualizerAura provides the smooth GPU-composited ambient glow)
  // so transitioning between listening, thinking, and speaking never flashes or jitters.
  const characterShadow = isCompact
    ? undefined
    : wake.sleepMode
      ? 'drop-shadow(0 12px 24px rgba(15, 23, 42, 0.25))'
      : voice.isSpeaking
        ? `drop-shadow(0 0 38px ${emotion.accentHex}52) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.24))`
        : isVoiceThinking
          ? 'drop-shadow(0 0 34px rgba(139, 92, 246, 0.34)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.22))'
          : voice.isActive
            ? 'drop-shadow(0 0 34px rgba(56, 189, 248, 0.32)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.24))'
            : `drop-shadow(0 0 26px ${emotion.accentHex}22) drop-shadow(0 14px 28px rgba(0, 0, 0, 0.18))`

  const gazeStatusText =
    vision.founderGaze?.target === 'face'
      ? 'Eye contact'
      : vision.founderGaze?.target === 'hand'
        ? 'Glancing at hand'
        : 'Camera on'

  const permissionLabel =
    vision.cameraActive
      ? `Live · ${gazeStatusText}`
      : vision.cameraPermission === 'denied'
        ? 'Blocked in browser settings'
        : vision.cameraPermission === 'unsupported'
          ? 'HTTPS required on mobile'
          : vision.cameraPermission === 'granted'
            ? 'Ready'
            : 'Tap to allow camera'

  return (
    <div
      data-voice-focus-stage="1"
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Subtle emotion-tinted ambient canvas glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{
          background: `radial-gradient(540px 360px at 50% 42%, ${emotion.accentHex}12, transparent 74%)`,
        }}
      />

      {/* Desktop-only OS Stage Action Strip (mobile/tablet stay completely open & borderless) */}
      <header className="relative z-10 hidden items-center justify-between gap-3 border-b border-border/60 px-5 py-2 lg:flex">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span
            className="h-2 w-2 shrink-0 rounded-full transition-colors"
            style={{ backgroundColor: emotion.accentHex }}
          />
          <span className="font-medium text-foreground">Voice Focus</span>
          <span className="opacity-45">·</span>
          <span className="truncate font-mono text-[11px]">
            {emotion.label} · {EYE_EXPRESSION_LABELS[evaExpression]}
            {vision.cameraActive && vision.founderGaze?.present ? ' · Looking at you' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => toggleSplit('reasoning')}
            data-eva-target="focus-reasoning"
            aria-pressed={splitOpen && splitMode === 'reasoning'}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors',
              splitOpen && splitMode === 'reasoning'
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>Reasoning</span>
          </button>

          <button
            type="button"
            onClick={() => toggleSplit('browser')}
            data-eva-target="focus-browser"
            aria-pressed={splitOpen && splitMode === 'browser'}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium whitespace-nowrap transition-colors',
              splitOpen && splitMode === 'browser'
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Browser</span>
          </button>

          {brainConnected && (
            <button
              type="button"
              onClick={() => setGbrainGraphOpen(true)}
              data-eva-target="focus-gbrain"
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11.5px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Network className="h-3.5 w-3.5" />
              <span>GBrain</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setLayoutMode('standard')}
            data-eva-target="exit-voice-focus"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 text-[11.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </button>
        </div>
      </header>

      {/* Floating corner Camera/Screen PiP + actionable camera permission error banner */}
      <VisionPreviewStrip vision={vision} variant="floating" />

      {/* Center Stage: Voice Visualizer Aura + Borderless Coucou looking toward user */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-2">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col items-center"
        >
          <div className="relative flex h-64 w-64 items-center justify-center sm:h-72 sm:w-72">
            <VoiceVisualizerAura
              style={voiceVisualizerStyle}
              accentColor={emotion.accentHex}
              intensity={visualizerIntensity}
              isSpeaking={voice.isSpeaking}
              isThinking={isVoiceThinking}
              isListening={voice.isActive && !voice.muted && !voice.isSpeaking && !isVoiceThinking}
              compact={isCompact}
              size={isCompact ? 286 : 308}
            />

            <button
              type="button"
              onClick={handleCharacterTap}
              aria-label={
                wake.sleepMode
                  ? 'Wake Eva'
                  : voice.isActive
                    ? voice.muted
                      ? 'Unmute microphone'
                      : 'Mute microphone'
                    : 'Tap to talk to Eva'
              }
              style={characterShadow ? { filter: characterShadow } : undefined}
              className={cn(
                'group relative z-10 flex h-56 w-56 cursor-pointer items-center justify-center border-0 bg-transparent ring-0 outline-none focus-visible:rounded-3xl focus-visible:ring-2 focus-visible:ring-sky-500/60',
                wake.sleepMode && 'opacity-80'
              )}
            >
              <CoucouBot
                expression={evaExpression}
                emotion={emotion.id}
                archetype="eva"
                outfit={coucouOutfit}
                greetSeq={greetSeq + cameraGreetSeq}
                dancing={coucouDancing || mediaPlaying}
                isSpeaking={voice.isSpeaking}
                speakingLevel={speakingLevel}
                visionActive={vision.anyActive}
                earListening={senses.ears.status === 'active'}
                handsActive={senses.hands.status === 'active'}
                handTracking={handTracking}
                gazeOverride={vision.founderGaze}
                size={212}
                interactive={false}
                trackGaze
                label={`Eva companion (${emotion.label}, ${EYE_EXPRESSION_LABELS[evaExpression]})`}
              />
            </button>
          </div>

          {/* Active physical hand-tracking task readout when tools or file ops run */}
          {handTracking.active && (
            <div
              data-voice-hand-status="1"
              className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            >
              <Hand className="h-3 w-3 shrink-0" style={{ color: handTracking.accentHex }} />
              <span className="font-medium text-foreground">{handTracking.label}</span>
              {handTracking.targetLabel && (
                <>
                  <span className="opacity-45">·</span>
                  <span className="max-w-[200px] truncate">{handTracking.targetLabel}</span>
                </>
              )}
            </div>
          )}

          {/* Mobile (< lg): zero idle chrome — only show gaze status subtly when camera eye is actively on */}
          {vision.cameraActive && (
            <div className="mt-1 flex items-center justify-center text-[11.5px] text-sky-500 lg:hidden">
              <span>{gazeStatusText}</span>
            </div>
          )}

          {/* Desktop (>= lg): Emotion & Feeling Presence Bar */}
          <div
            data-voice-emotion-ribbon="1"
            className="mt-1 hidden flex-col items-center gap-2 text-center lg:flex"
          >
            <div className="flex items-center gap-2 text-xs">
              <Heart className="h-3.5 w-3.5" style={{ color: emotion.accentHex }} />
              <span className="font-semibold text-foreground">{emotion.label}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {vision.cameraActive && vision.founderGaze?.present
                  ? gazeStatusText
                  : emotion.reason}
              </span>
            </div>

            <div
              role="group"
              aria-label="Eva feeling tone"
              className="flex flex-wrap items-center justify-center gap-1"
            >
              <button
                type="button"
                onClick={() => setManualEmotion(null)}
                aria-pressed={manualEmotion === null}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium whitespace-nowrap transition-colors',
                  manualEmotion === null
                    ? 'border-foreground/30 bg-foreground/10 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Sparkles className="h-2.5 w-2.5" />
                <span>Auto</span>
              </button>
              {VOICE_MOOD_PRESETS.map((id) => {
                const meta = EVA_EMOTIONS[id]
                const active = emotion.id === id
                return (
                  <button
                    key={id}
                    type="button"
                    data-voice-mood={id}
                    onClick={() => setManualEmotion(manualEmotion === id ? null : id)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[10.5px] font-medium whitespace-nowrap transition-colors',
                      active
                        ? 'border-foreground/30 bg-muted text-foreground'
                        : 'border-border/70 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: meta.accentHex }}
                    />
                    <span>{meta.shortLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Compact live Reasoning Chain pulse when Eva's Hands are working */}
          {latestChain && latestNode && (
            <button
              type="button"
              onClick={() => openReasoningForChain(latestChain.id)}
              className={cn(
                'mt-3 max-w-md items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-3 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-sky-500/40 hover:text-foreground',
                latestChain.status === 'active' ? 'inline-flex' : 'hidden lg:inline-flex'
              )}
            >
              <Hand className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="truncate">
                <span className="font-medium text-foreground">{latestNode.title}</span>
                {latestChain.correctionCount > 0
                  ? ` · ${latestChain.correctionCount} self-corrected`
                  : ''}
              </span>
            </button>
          )}
        </motion.div>
      </div>

      {/* Borderless Cinema-Style Live Subtitles — Fixed height prevents vertical stage jump on mobile */}
      <div className="relative z-10 mx-auto flex h-[86px] w-full max-w-xl shrink-0 flex-col items-center justify-center px-5 pb-2 sm:h-[90px] sm:px-6 lg:pb-3">
        <AnimatePresence mode="wait" initial={false}>
          {captionsEnabled && visibleSubtitle && (
            <motion.section
              key={visibleSubtitle.id}
              data-voice-captions="1"
              data-subtitle-borderless="1"
              aria-live="polite"
              aria-label="Live voice subtitles"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="flex w-full flex-col items-center justify-center bg-transparent text-center"
            >
              {!visibleSubtitle.isWhisper && (
                <div className="mb-1 flex items-center justify-center gap-1.5">
                  <SpeechCadenceDots
                    active={
                      visibleSubtitle.live &&
                      (voice.isSpeaking || voice.isUserSpeaking || Boolean(demoSubtitle))
                    }
                    color={visibleSubtitle.speaker === 'You' ? '#38bdf8' : emotion.accentHex}
                  />
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                    {visibleSubtitle.speaker}
                  </span>
                </div>
              )}

              {visibleSubtitle.isWhisper ? (
                <div className="inline-flex items-center justify-center gap-2">
                  {(visibleSubtitle.isThinking ||
                    (visibleSubtitle.id === 'listening' && voice.isUserSpeaking)) && (
                    <SpeechCadenceDots
                      active={visibleSubtitle.id === 'listening' && voice.isUserSpeaking}
                      thinking={Boolean(visibleSubtitle.isThinking)}
                      color={visibleSubtitle.isThinking ? '#8b5cf6' : '#38bdf8'}
                    />
                  )}
                  <p
                    data-voice-caption-active="1"
                    data-caption-style={captionAnimationStyle}
                    className={cn(
                      'text-center text-[13.5px] font-normal tracking-tight',
                      visibleSubtitle.isThinking
                        ? 'text-violet-500 dark:text-violet-300'
                        : 'text-muted-foreground/80'
                    )}
                  >
                    {visibleSubtitle.text}
                  </p>
                </div>
              ) : (
                <AnimatedCaptionText
                  text={visibleSubtitle.text}
                  styleMode={captionAnimationStyle}
                  replayKey={`${visibleSubtitle.id}-${subtitleReplaySeq}`}
                  accentColor={visibleSubtitle.speaker === 'You' ? '#38bdf8' : emotion.accentHex}
                  data-voice-caption-active="1"
                  className="line-clamp-2 w-full flex-none text-center text-[15.5px] font-medium leading-[1.35] tracking-tight text-balance text-foreground sm:text-[17px]"
                />
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* Voice Focus Stage Settings — Material 3 Bottom Sheet on Mobile/Tablet (< lg), Floating Popover on Desktop (>= lg) */}
      {isCompact ? (
        <MaterialBottomSheet
          open={stageSettingsOpen}
          onOpenChange={setStageSettingsOpen}
          title="Voice Stage Settings"
          subtitle="Voice visualizer aura, cinema subtitles & camera gaze"
          dataAttr="voice-stage-settings"
        >
          <div data-voice-stage-settings="1" className="px-5 pt-3 pb-2">
            {/* 1. Voice Visualizer Style Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Voice Visualizer Style</span>
                <span className="font-mono normal-case text-foreground/80">
                  {VOICE_VISUALIZER_OPTIONS.find((o) => o.id === voiceVisualizerStyle)?.label}
                </span>
              </div>
              <div role="group" aria-label="Voice Visualizer Style" className="grid grid-cols-5 gap-1.5">
                {VOICE_VISUALIZER_OPTIONS.map((opt) => {
                  const active = voiceVisualizerStyle === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-visualizer-style-option={opt.id}
                      aria-pressed={active}
                      onClick={() => {
                        triggerHaptic('selection')
                        setVoiceVisualizerStyle(opt.id)
                      }}
                      title={opt.description}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-xl border px-1 text-[11.5px] font-medium transition-colors active:scale-95',
                        active
                          ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                          : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {opt.shortLabel}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. Cinema Subtitle Style + Toggle + Live Phrase Demo */}
            <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Live Subtitles
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-preview-subtitle-btn="1"
                    onClick={() => {
                      triggerHaptic('light')
                      triggerSubtitleDemo()
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Play className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={captionsEnabled}
                    onClick={() => {
                      triggerHaptic('selection')
                      setCaptionsEnabled(!captionsEnabled)
                    }}
                    className={cn(
                      'inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-xs font-medium transition-colors',
                      captionsEnabled
                        ? 'border-sky-500/45 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                        : 'border-border/70 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {captionsEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div role="group" aria-label="Subtitle animation style" className="grid grid-cols-3 gap-1.5">
                {CAPTION_ANIMATION_OPTIONS.map((opt) => {
                  const active = captionAnimationStyle === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-stage-caption-style={opt.id}
                      aria-pressed={active}
                      onClick={() => {
                        triggerHaptic('selection')
                        setCaptionAnimationStyle(opt.id)
                        setSubtitleReplaySeq((n) => n + 1)
                      }}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-xl border text-xs font-medium transition-colors active:scale-95',
                        active
                          ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                          : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 3. Camera Eye & Founder Gaze Permission Controls */}
            <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium uppercase tracking-wider text-muted-foreground">
                  Camera &amp; Gaze
                </span>
                <span className="text-muted-foreground">{permissionLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-stage-camera-permission-btn="1"
                  onClick={() => {
                    triggerHaptic('light')
                    void vision.toggleCamera()
                  }}
                  className={cn(
                    'flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border text-[13px] font-medium transition-colors active:scale-[0.98]',
                    vision.cameraActive
                      ? 'border-sky-500/45 bg-sky-500/14 text-sky-600 dark:text-sky-400'
                      : 'border-border/80 bg-background/70 text-foreground hover:bg-muted'
                  )}
                >
                  {vision.cameraActive ? (
                    <>
                      <CameraOff className="h-4 w-4" />
                      <span>Turn Off Camera</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4" />
                      <span>Enable Camera Eye</span>
                    </>
                  )}
                </button>
                {vision.cameraActive && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('selection')
                      void vision.flipCamera()
                    }}
                    aria-label="Switch front or rear camera"
                    title="Flip camera"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background/70 text-foreground transition-colors hover:bg-muted active:scale-95"
                  >
                    <SwitchCamera className="h-5 w-5" />
                  </button>
                )}
              </div>

              <div className="pt-1">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Eye-Contact Target</span>
                  <span className="font-mono text-foreground/80">
                    {GAZE_TRACKING_MODE_OPTIONS.find((m) => m.id === vision.gazeMode)?.label}
                  </span>
                </div>
                <div role="group" aria-label="Gaze tracking target mode" className="grid grid-cols-3 gap-1.5">
                  {GAZE_TRACKING_MODE_OPTIONS.map((opt) => {
                    const active = vision.gazeMode === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-gaze-mode-option={opt.id}
                        aria-pressed={active}
                        onClick={() => {
                          triggerHaptic('selection')
                          vision.setGazeMode(opt.id)
                        }}
                        title={opt.description}
                        className={cn(
                          'flex h-11 items-center justify-center rounded-xl border text-xs font-medium transition-colors active:scale-95',
                          active
                            ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                            : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {opt.shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>

              <p className="text-[11.5px] leading-snug text-muted-foreground">
                {GAZE_TRACKING_MODE_OPTIONS.find((m) => m.id === vision.gazeMode)?.description}.
              </p>
            </div>

            {/* 4. Eva Feeling Tone (kept off the clean voice-first stage) */}
            <div className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium uppercase tracking-wider text-muted-foreground">
                  Eva Tone
                </span>
                <span className="text-foreground/80">{emotion.label}</span>
              </div>
              <div role="group" aria-label="Eva feeling tone" className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('selection')
                    setManualEmotion(null)
                  }}
                  aria-pressed={manualEmotion === null}
                  className={cn(
                    'inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-xs font-medium transition-colors',
                    manualEmotion === null
                      ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                      : 'border-border/70 bg-background/60 text-muted-foreground'
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  Auto
                </button>
                {VOICE_MOOD_PRESETS.map((id) => {
                  const meta = EVA_EMOTIONS[id]
                  const active = emotion.id === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        triggerHaptic('selection')
                        setManualEmotion(manualEmotion === id ? null : id)
                      }}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors',
                        active
                          ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                          : 'border-border/70 bg-background/60 text-muted-foreground'
                      )}
                    >
                      {meta.shortLabel}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 5. Dynamic Workspace Shortcuts */}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-4">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection')
                  setStageSettingsOpen(false)
                  setLayoutMode('standard')
                }}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-border/80 bg-background/70 text-xs font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
              >
                <MessageSquare className="h-4 w-4 text-sky-500" />
                <span>Chat History</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection')
                  setStageSettingsOpen(false)
                  openSplit('mobile', 'Android & Mobile Control')
                }}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-border/80 bg-background/70 text-xs font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
              >
                <Smartphone className="h-4 w-4 text-emerald-500" />
                <span>Android Control</span>
              </button>
            </div>
          </div>
        </MaterialBottomSheet>
      ) : (
        <AnimatePresence>
          {stageSettingsOpen && (
            <motion.div
              ref={settingsPopoverRef}
              role="dialog"
              aria-label="Voice Focus Stage Settings"
              data-voice-stage-settings="1"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-6 bottom-16 z-40 w-[min(calc(100vw-2rem),22rem)] rounded-2xl border border-border/80 bg-card/95 p-4 text-foreground shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-sky-500" />
                  <span className="text-xs font-semibold tracking-tight text-foreground">
                    Voice Stage Settings
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setStageSettingsOpen(false)}
                  aria-label="Close voice stage settings"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 1. Voice Visualizer Style Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Voice Visualizer Style</span>
                  <span className="font-mono normal-case text-foreground/80">
                    {VOICE_VISUALIZER_OPTIONS.find((o) => o.id === voiceVisualizerStyle)?.label}
                  </span>
                </div>
                <div role="group" aria-label="Voice Visualizer Style" className="grid grid-cols-5 gap-1">
                  {VOICE_VISUALIZER_OPTIONS.map((opt) => {
                    const active = voiceVisualizerStyle === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-visualizer-style-option={opt.id}
                        aria-pressed={active}
                        onClick={() => setVoiceVisualizerStyle(opt.id)}
                        title={opt.description}
                        className={cn(
                          'flex h-9 items-center justify-center rounded-lg border px-1 text-[11px] font-medium transition-colors',
                          active
                            ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                            : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {opt.shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 2. Cinema Subtitle Style + Toggle + Live Phrase Demo */}
              <div className="mt-3.5 space-y-2 border-t border-border/70 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                    Live Subtitles
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-preview-subtitle-btn="1"
                      onClick={triggerSubtitleDemo}
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 px-2 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Play className="h-2.5 w-2.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={captionsEnabled}
                      onClick={() => setCaptionsEnabled(!captionsEnabled)}
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[10.5px] font-medium transition-colors',
                        captionsEnabled
                          ? 'border-sky-500/45 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                          : 'border-border/70 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {captionsEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>

                <div role="group" aria-label="Subtitle animation style" className="grid grid-cols-3 gap-1">
                  {CAPTION_ANIMATION_OPTIONS.map((opt) => {
                    const active = captionAnimationStyle === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-stage-caption-style={opt.id}
                        aria-pressed={active}
                        onClick={() => {
                          setCaptionAnimationStyle(opt.id)
                          setSubtitleReplaySeq((n) => n + 1)
                        }}
                        className={cn(
                          'flex h-8 items-center justify-center rounded-lg border text-[11px] font-medium transition-colors',
                          active
                            ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                            : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 3. Camera Eye & Founder Gaze Permission Controls */}
              <div className="mt-3.5 space-y-2 border-t border-border/70 pt-3">
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="font-medium uppercase tracking-wider text-muted-foreground">
                    Camera &amp; Gaze
                  </span>
                  <span className="text-muted-foreground">{permissionLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-stage-camera-permission-btn="1"
                    onClick={() => void vision.toggleCamera()}
                    className={cn(
                      'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-colors',
                      vision.cameraActive
                        ? 'border-sky-500/45 bg-sky-500/14 text-sky-600 dark:text-sky-400'
                        : 'border-border/80 bg-background/70 text-foreground hover:bg-muted'
                    )}
                  >
                    {vision.cameraActive ? (
                      <>
                        <CameraOff className="h-3.5 w-3.5" />
                        <span>Turn Off Camera</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-3.5 w-3.5" />
                        <span>Enable Camera Eye</span>
                      </>
                    )}
                  </button>
                  {vision.cameraActive && (
                    <button
                      type="button"
                      onClick={() => void vision.flipCamera()}
                      aria-label="Switch front or rear camera"
                      title="Flip camera"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-background/70 text-foreground transition-colors hover:bg-muted"
                    >
                      <SwitchCamera className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Eye-contact target mode */}
                <div className="pt-1">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Eye-Contact Target</span>
                    <span className="font-mono text-foreground/80">
                      {GAZE_TRACKING_MODE_OPTIONS.find((m) => m.id === vision.gazeMode)?.label}
                    </span>
                  </div>
                  <div role="group" aria-label="Gaze tracking target mode" className="grid grid-cols-3 gap-1">
                    {GAZE_TRACKING_MODE_OPTIONS.map((opt) => {
                      const active = vision.gazeMode === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          data-gaze-mode-option={opt.id}
                          aria-pressed={active}
                          onClick={() => vision.setGazeMode(opt.id)}
                          title={opt.description}
                          className={cn(
                            'flex h-8 items-center justify-center rounded-lg border text-[11px] font-medium transition-colors',
                            active
                              ? 'border-sky-500/50 bg-sky-500/14 text-foreground'
                              : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          {opt.shortLabel}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  {GAZE_TRACKING_MODE_OPTIONS.find((m) => m.id === vision.gazeMode)?.description}.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Dynamic Minimalistic Fallback Composer — slides in ONLY when voice is blocked/errored or user taps Type */}
      <AnimatePresence>
        {showDynamicComposer && (
          <motion.div
            data-voice-fallback-composer="1"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-20 mx-auto w-full max-w-md px-4 pb-3"
          >
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/92 shadow-lg backdrop-blur-md">
              {voiceBlockedOrError && (
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-1.5 text-[11.5px]">
                  <span className="truncate text-muted-foreground">
                    {voice.lastError || 'Voice unavailable — type to Eva'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light')
                      void voice.startVoice(activeConvId)
                    }}
                    className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-sky-500 hover:text-sky-400"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submitFallbackMessage()
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5"
              >
                <input
                  ref={fallbackInputRef}
                  type="text"
                  value={fallbackInput}
                  onChange={(e) => setFallbackInput(e.target.value)}
                  placeholder="Message Eva…"
                  aria-label="Message Eva"
                  className="h-11 min-w-0 flex-1 bg-transparent px-1.5 text-[14px] text-foreground placeholder:text-muted-foreground/75 focus:outline-none"
                />
                {!voiceBlockedOrError && (
                  <button
                    type="button"
                    onClick={() => setManualComposerOpen(false)}
                    aria-label="Close text composer"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!fallbackInput.trim() || sendingFallback}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-35 active:scale-95"
                >
                  {sendingFallback ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile & Tablet (< lg): Pure 3-Control Voice-First Thumb Dock */}
      <div
        data-mobile-voice-dock="1"
        className="relative z-10 flex flex-col items-center px-6 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="flex w-full max-w-[248px] items-center justify-between">
          {/* 1. Camera Eye (explicit Camera trigger for mobile eye-contact & vision) */}
          <button
            type="button"
            data-mobile-camera-trigger="1"
            onClick={() => {
              triggerHaptic('light')
              void vision.toggleCamera()
            }}
            aria-pressed={vision.cameraActive}
            aria-label={vision.cameraActive ? 'Turn off camera' : 'Enable camera so Eva can see you'}
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95',
              vision.cameraActive
                ? 'border-sky-500/50 bg-sky-500/15 text-sky-500'
                : 'border-border/70 bg-card/65 text-muted-foreground hover:text-foreground'
            )}
          >
            {vision.cameraActive ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </button>

          {/* 2. Center Hero Voice Orb */}
          <button
            type="button"
            data-mobile-voice-orb="1"
            onClick={() => {
              triggerHaptic('medium')
              if (voice.isActive) {
                voice.toggleMute()
              } else {
                setGreetSeq((n) => n + 1)
                void voice.startVoice(activeConvId)
              }
            }}
            aria-label={
              voice.isActive
                ? voice.muted
                  ? 'Unmute microphone'
                  : 'Mute microphone'
                : 'Talk to Eva'
            }
            className={cn(
              'relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full border shadow-lg transition-all active:scale-95',
              voice.isActive && !voice.muted
                ? 'border-emerald-400/60 bg-emerald-500 text-zinc-950 shadow-emerald-500/25'
                : voice.isActive && voice.muted
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-500'
                  : voiceBlockedOrError
                    ? 'border-amber-400/60 bg-card text-amber-500 shadow-black/20'
                    : 'border-sky-400/35 bg-foreground text-background shadow-black/25'
            )}
          >
            {voice.isActive && voice.muted ? (
              <MicOff className="h-6 w-6" />
            ) : voice.isSpeaking ? (
              <MessageCircle className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
          </button>

          {/* 3. End Live Voice (when active) OR Dynamic Minimal Composer toggle (when idle) */}
          {voice.isActive ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('warning')
                voice.stopVoice()
              }}
              aria-label="End live voice session"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/15 text-destructive transition-colors active:scale-95"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              data-mobile-type-trigger="1"
              onClick={() => {
                triggerHaptic('selection')
                setManualComposerOpen((v) => {
                  const next = !v
                  if (next) {
                    window.setTimeout(() => fallbackInputRef.current?.focus(), 60)
                  }
                  return next
                })
              }}
              aria-pressed={showDynamicComposer}
              aria-label={showDynamicComposer ? 'Hide text composer' : 'Type a message to Eva'}
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95',
                showDynamicComposer
                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-500'
                  : 'border-border/70 bg-card/65 text-muted-foreground hover:text-foreground'
              )}
            >
              <Keyboard className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Desktop (>= lg): Bottom 4-Sense OS Dock (Mouth · Eyes · Ears · Hands · Captions · Visualizer Settings · Wardrobe) */}
      <footer className="relative z-10 hidden border-t border-border/70 bg-sidebar/80 px-5 py-3 backdrop-blur-sm lg:block">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          {/* Primary Mouth / Talk control */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-eva-target="focus-talk"
              onClick={() => {
                if (voice.isActive) {
                  voice.toggleMute()
                } else {
                  setGreetSeq((n) => n + 1)
                  void voice.startVoice(activeConvId)
                }
              }}
              className={cn(
                'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-xs font-medium transition-colors',
                voice.isActive && !voice.muted
                  ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-card text-foreground hover:bg-muted'
              )}
            >
              {voice.isActive && voice.muted ? (
                <MicOff className="h-3.5 w-3.5 text-amber-500" />
              ) : voice.isSpeaking ? (
                <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              <span>
                {voice.isActive
                  ? voice.muted
                    ? 'Unmute'
                    : voice.isSpeaking
                      ? 'Speaking'
                      : 'Listening'
                  : 'Talk to Eva'}
              </span>
            </button>

            {voice.isActive && (
              <button
                type="button"
                onClick={voice.stopVoice}
                aria-label="End live voice"
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>End</span>
              </button>
            )}
          </div>

          {/* Embodied Senses Controls: Eyes, Ears, Hands */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-eva-target="focus-toggle-camera"
              onClick={() => void vision.toggleCamera()}
              aria-pressed={vision.cameraActive}
              aria-label={vision.cameraActive ? 'Disable Eva camera eye' : 'Enable Eva camera eye'}
              title={vision.cameraActive ? 'Turn off Camera Eye' : 'Camera Eye — Eva sees you & follows your gaze'}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                vision.cameraActive
                  ? 'border-sky-500/45 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {vision.cameraActive ? <CameraOff className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Camera</span>
            </button>

            <button
              type="button"
              data-eva-target="focus-toggle-screen"
              onClick={() => void vision.toggleScreen()}
              aria-pressed={vision.screenActive}
              aria-label={vision.screenActive ? 'Stop sharing screen with Eva' : 'Share screen with Eva'}
              title={vision.screenActive ? 'Stop Screen Eye' : 'Screen Eye'}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                vision.screenActive
                  ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {vision.screenActive ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Screen</span>
            </button>

            <button
              type="button"
              data-eva-target="focus-toggle-ear"
              onClick={onToggleSleepMode}
              aria-pressed={!wake.sleepMode}
              aria-label={wake.sleepMode ? 'Wake Eva ears' : 'Mute wake ears (Sleep Mode)'}
              title={wake.sleepMode ? 'Wake Ears' : 'Ears Active (Click to Sleep)'}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                !wake.sleepMode
                  ? 'border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {wake.sleepMode ? <EarOff className="h-3.5 w-3.5" /> : <Ear className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{wake.sleepMode ? 'Asleep' : 'Ears'}</span>
            </button>

            <button
              type="button"
              data-eva-target="focus-toggle-hands"
              onClick={() => toggleSplit('browser')}
              aria-pressed={senses.hands.status === 'active' || (splitOpen && splitMode === 'browser')}
              aria-label="Open Eva hands browser workspace"
              title={`Hands: ${senses.hands.detail}`}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                senses.hands.status === 'active' || (splitOpen && splitMode === 'browser')
                  ? 'border-amber-500/45 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Hand className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Hands</span>
            </button>
          </div>

          {/* Captions + Stage Settings (Visualizer Style) + Wardrobe */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-eva-target="focus-toggle-captions"
              onClick={() => setCaptionsEnabled(!captionsEnabled)}
              aria-pressed={captionsEnabled}
              aria-label={captionsEnabled ? 'Hide live subtitles' : 'Show live subtitles'}
              title={captionsEnabled ? 'Hide Subtitles' : 'Show Subtitles'}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                captionsEnabled
                  ? 'border-foreground/25 bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {captionsEnabled ? <Captions className="h-3.5 w-3.5" /> : <CaptionsOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">CC</span>
            </button>

            <button
              type="button"
              data-voice-stage-settings-trigger="1"
              onClick={() => setStageSettingsOpen((v) => !v)}
              aria-expanded={stageSettingsOpen}
              aria-label="Open Voice Focus stage settings"
              title="Voice Visualizer Style, Subtitles & Camera"
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                stageSettingsOpen
                  ? 'border-sky-500/45 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Stage</span>
            </button>

            <button
              type="button"
              onClick={cycleOutfit}
              aria-label="Switch Eva outfit"
              title={`Switch outfit (${coucouOutfit})`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Shirt className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
