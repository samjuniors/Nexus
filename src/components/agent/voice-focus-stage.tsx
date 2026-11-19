'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Camera,
  CameraOff,
  Captions,
  CaptionsOff,
  Ear,
  EarOff,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  Hand,
  Heart,
  LayoutGrid,
  MessageCircle,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Network,
  PhoneOff,
  Shirt,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { VisionPreviewStrip } from '@/components/agent/vision-preview-pip'
import { AnimatedCaptionText } from '@/components/agent/animated-caption-text'
import { useEva } from '@/components/agent/eva-provider'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { EYE_EXPRESSION_LABELS } from '@/lib/agent/mochi-eyes'
import {
  EVA_EMOTIONS,
  type EvaEmotionId,
} from '@/lib/agent/eva-emotions'
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

interface CaptionLine {
  id: string
  speaker: 'Eva' | 'You' | 'System'
  text: string
  live: boolean
}

function SpeechCadenceBars({ active, color }: { active: boolean; color: string }) {
  return (
    <span className="inline-flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0.45, 0.9, 0.6, 1, 0.5].map((h, i) => (
        <span
          key={i}
          className={cn(
            'w-[2px] rounded-full transition-all duration-150',
            active ? 'animate-pulse' : 'opacity-35'
          )}
          style={{
            height: active ? `${Math.round(h * 13)}px` : '3px',
            backgroundColor: color,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Dynamic Voice Focus OS Mode — hands-free living workspace where Eva sits
 * borderless at center with embodied Eyes, Ears, Mouth, and Hands, live emotional
 * resonance, and a cinema-grade bottom-anchored Live Captions stage.
 */
export function VoiceFocusStage({
  onOpenCommandPalette: _onOpenCommandPalette,
}: {
  onOpenCommandPalette?: () => void
}) {
  const { voice, wake, vision, evaExpression, emotion, senses, handTracking, onToggleSleepMode, onArmEar } =
    useEva()
  const activeConvId = useApp((s) => s.activeConvId)
  const conversations = useApp((s) => s.conversations)
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

  const [greetSeq, setGreetSeq] = useState(0)
  const [previousCaption, setPreviousCaption] = useState<CaptionLine | null>(null)
  const [mobileMoodOpen, setMobileMoodOpen] = useState(false)
  const lastCaptionTextRef = useRef<string>('')

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConvId) ?? null,
    [conversations, activeConvId]
  )

  const latestAssistantText = useMemo(() => {
    const msgs = activeConversation?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].content.trim()) {
        const clean = msgs[i].content.replace(/\s+/g, ' ').trim()
        return clean.length > 220 ? `${clean.slice(0, 217)}…` : clean
      }
    }
    return null
  }, [activeConversation?.messages])

  const latestChain = reasoningChains[0] ?? null
  const latestNode = useMemo(() => {
    if (!latestChain || latestChain.nodes.length === 0) return null
    return latestChain.nodes[latestChain.nodes.length - 1]
  }, [latestChain])

  // Derive the active bottom-stage caption line
  const activeCaption: CaptionLine = useMemo(() => {
    if (voice.liveOutputTranscript.trim()) {
      return {
        id: 'live-out',
        speaker: 'Eva',
        text: voice.liveOutputTranscript.trim(),
        live: true,
      }
    }
    if (voice.liveInputTranscript.trim()) {
      return {
        id: 'live-in',
        speaker: 'You',
        text: voice.liveInputTranscript.trim(),
        live: true,
      }
    }
    if (transientNote) {
      return {
        id: 'transient',
        speaker: 'Eva',
        text: transientNote,
        live: false,
      }
    }
    if (wake.sleepMode) {
      return {
        id: 'sleep',
        speaker: 'System',
        text: 'Sleeping — tap Eva or wake her Ears to resume hands-free listening.',
        live: false,
      }
    }
    if (voice.isActive) {
      if (voice.isSpeaking) {
        return {
          id: 'speaking',
          speaker: 'Eva',
          text: 'Speaking live…',
          live: true,
        }
      }
      if (voice.muted) {
        return {
          id: 'muted',
          speaker: 'System',
          text: 'Microphone muted — tap Eva or Unmute to continue talking.',
          live: false,
        }
      }
      return {
        id: 'listening',
        speaker: 'Eva',
        text: 'Listening — speak naturally and I will answer with voice and live captions.',
        live: true,
      }
    }
    if (latestAssistantText) {
      return {
        id: 'latest-msg',
        speaker: 'Eva',
        text: latestAssistantText,
        live: false,
      }
    }
    return {
      id: 'ready',
      speaker: 'Eva',
      text: `${emotion.feelingLine} Say "${wake.wakePhrase}" or tap me to begin a hands-free session.`,
      live: false,
    }
  }, [
    voice.liveOutputTranscript,
    voice.liveInputTranscript,
    voice.isActive,
    voice.isSpeaking,
    voice.muted,
    transientNote,
    wake.sleepMode,
    wake.wakePhrase,
    latestAssistantText,
    emotion.feelingLine,
  ])

  // Keep a smooth fading previous caption line when the live speaker switches or finishes a sentence
  const captionKey = `${activeCaption.speaker}:${activeCaption.text}`
  useEffect(() => {
    const prev = lastCaptionTextRef.current
    if (prev && prev !== captionKey) {
      const splitIdx = prev.indexOf(':')
      const prevSpeaker = (splitIdx > 0 ? prev.slice(0, splitIdx) : 'Eva') as CaptionLine['speaker']
      const prevText = splitIdx > 0 ? prev.slice(splitIdx + 1) : prev
      // Only promote meaningful non-prefix shifts to the fading prior line
      if (prevText && !activeCaption.text.startsWith(prevText.slice(0, Math.min(24, prevText.length)))) {
        setPreviousCaption({
          id: `prev-${Date.now()}`,
          speaker: prevSpeaker,
          text: prevText,
          live: false,
        })
      }
    }
    lastCaptionTextRef.current = captionKey
  }, [captionKey, activeCaption.text])

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

  const characterShadow = wake.sleepMode
    ? 'drop-shadow(0 12px 24px rgba(15, 23, 42, 0.25))'
    : voice.isSpeaking
      ? `drop-shadow(0 0 38px ${emotion.accentHex}52) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.24))`
      : voice.isActive
        ? 'drop-shadow(0 0 34px rgba(56, 189, 248, 0.32)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.24))'
        : `drop-shadow(0 0 28px ${emotion.accentHex}24) drop-shadow(0 14px 28px rgba(0, 0, 0, 0.20))`

  return (
    <div
      data-voice-focus-stage="1"
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Subtle emotion-tinted ambient aura behind stage */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          background: `radial-gradient(520px 340px at 50% 42%, ${emotion.accentHex}18, transparent 72%)`,
        }}
      />

      {/* Desktop-only OS Stage Action Strip (mobile/tablet use the single 48px OsTopBar) */}
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

      <VisionPreviewStrip vision={vision} />

      {/* Center Stage: Borderless Eva + Emotional Resonance + Active Sense Readout */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col items-center"
        >
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
            style={{ filter: characterShadow }}
            className={cn(
              'group relative flex h-56 w-56 cursor-pointer items-center justify-center border-0 bg-transparent ring-0 outline-none focus-visible:rounded-3xl focus-visible:ring-2 focus-visible:ring-sky-500/60',
              wake.sleepMode && 'opacity-80'
            )}
          >
            <CoucouBot
              expression={evaExpression}
              emotion={emotion.id}
              archetype="eva"
              outfit={coucouOutfit}
              greetSeq={greetSeq}
              dancing={coucouDancing || mediaPlaying}
              isSpeaking={voice.isSpeaking}
              speakingLevel={speakingLevel}
              visionActive={vision.anyActive}
              earListening={senses.ears.status === 'active'}
              handsActive={senses.hands.status === 'active'}
              handTracking={handTracking}
              size={212}
              interactive={false}
              trackGaze
              label={`Eva companion (${emotion.label}, ${EYE_EXPRESSION_LABELS[evaExpression]})`}
            />
          </button>

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
                  <span className="truncate max-w-[200px]">{handTracking.targetLabel}</span>
                </>
              )}
            </div>
          )}

          {/* Mobile & Tablet (< lg): single quiet tappable feeling line — keeps first screen serene */}
          <div className="mt-2 flex flex-col items-center gap-2 text-center lg:hidden">
            <button
              type="button"
              data-mobile-mood-toggle="1"
              onClick={() => setMobileMoodOpen((v) => !v)}
              aria-expanded={mobileMoodOpen}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: emotion.accentHex }}
              />
              <span className="font-medium text-foreground">{emotion.label}</span>
              <span className="opacity-50">·</span>
              <span className="truncate max-w-[200px]">
                {voice.isActive
                  ? voice.muted
                    ? 'Muted'
                    : voice.isSpeaking
                      ? 'Speaking'
                      : 'Listening'
                  : wake.sleepMode
                    ? 'Sleeping'
                    : 'Tap to speak'}
              </span>
            </button>

            <AnimatePresence>
              {mobileMoodOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.14 }}
                  role="group"
                  aria-label="Eva feeling tone"
                  className="flex max-w-xs flex-wrap items-center justify-center gap-1.5 pt-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setManualEmotion(null)
                      setMobileMoodOpen(false)
                    }}
                    aria-pressed={manualEmotion === null}
                    className={cn(
                      'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-medium transition-colors',
                      manualEmotion === null
                        ? 'border-foreground/30 bg-foreground/10 text-foreground'
                        : 'border-border/70 text-muted-foreground'
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
                          setManualEmotion(manualEmotion === id ? null : id)
                          setMobileMoodOpen(false)
                        }}
                        aria-pressed={active}
                        className={cn(
                          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors',
                          active
                            ? 'border-foreground/30 bg-muted text-foreground'
                            : 'border-border/70 text-muted-foreground'
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: meta.accentHex }}
                        />
                        {meta.shortLabel}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop (>= lg): Emotion & Feeling Presence Bar */}
          <div
            data-voice-emotion-ribbon="1"
            className="mt-2 hidden flex-col items-center gap-2 text-center lg:flex"
          >
            <div className="flex items-center gap-2 text-xs">
              <Heart className="h-3.5 w-3.5" style={{ color: emotion.accentHex }} />
              <span className="font-semibold text-foreground">{emotion.label}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{emotion.reason}</span>
            </div>

            {/* Interactive Feeling Attunement Strip */}
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

      {/* Bottom Live Captions Stage — anchored right above the voice dock */}
      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 pb-2 lg:px-5 lg:pb-3">
        <AnimatePresence initial={false}>
          {captionsEnabled && (
            <motion.section
              key="live-captions"
              data-voice-captions="1"
              aria-live="polite"
              aria-label="Live voice captions"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="rounded-2xl border border-border/70 bg-card/80 px-4 py-3 backdrop-blur-md lg:rounded-xl lg:border-border/80 lg:bg-card/85"
            >
              {/* Fading previous caption line */}
              {previousCaption && (
                <p
                  data-voice-caption-prev="1"
                  className="mb-1.5 truncate text-xs text-muted-foreground/65 transition-opacity"
                  style={{
                    WebkitMaskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                    maskImage: 'linear-gradient(to right, black 82%, transparent 100%)',
                  }}
                >
                  <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider opacity-80">
                    {previousCaption.speaker}
                  </span>
                  {previousCaption.text}
                </p>
              )}

              {/* Active crisp live caption line */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                  <SpeechCadenceBars
                    active={voice.isSpeaking || voice.isUserSpeaking || activeCaption.live}
                    color={activeCaption.speaker === 'You' ? '#38bdf8' : emotion.accentHex}
                  />
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {activeCaption.speaker}
                  </span>
                </div>

                <AnimatedCaptionText
                  text={activeCaption.text}
                  styleMode={captionAnimationStyle}
                  accentColor={activeCaption.speaker === 'You' ? '#38bdf8' : emotion.accentHex}
                  data-voice-caption-active="1"
                />
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile & Tablet (< lg): Real Voice Agent Thumb-Zone Dock */}
      <div
        data-mobile-voice-dock="1"
        className="relative z-10 flex flex-col items-center gap-2 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="flex w-full max-w-sm items-center justify-between gap-2">
          {/* Camera / Vision Eye */}
          <button
            type="button"
            onClick={() => {
              if (vision.screenActive) void vision.toggleScreen()
              else void vision.toggleCamera()
            }}
            aria-pressed={vision.anyActive}
            aria-label={vision.anyActive ? 'Turn off Eva eyes' : 'Turn on Eva camera eye'}
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95',
              vision.anyActive
                ? 'border-sky-500/45 bg-sky-500/15 text-sky-500'
                : 'border-border/80 bg-card/80 text-muted-foreground hover:text-foreground'
            )}
          >
            {vision.anyActive ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>

          {/* Android / Mobile Takeover */}
          <button
            type="button"
            data-mobile-takeover-trigger="1"
            onClick={() => openSplit('mobile', 'Android & Mobile Control')}
            aria-label="Open Android and Mobile Takeover"
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95',
              splitOpen && splitMode === 'mobile'
                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-500'
                : 'border-border/80 bg-card/80 text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="h-5 w-5" />
          </button>

          {/* Center Hero Talk / Voice Orb */}
          <button
            type="button"
            data-mobile-voice-orb="1"
            onClick={() => {
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
              'relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border shadow-lg transition-all active:scale-95',
              voice.isActive && !voice.muted
                ? 'border-emerald-400/60 bg-emerald-500 text-zinc-950 shadow-emerald-500/25'
                : voice.isActive && voice.muted
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-500'
                  : 'border-sky-400/40 bg-foreground text-background shadow-black/25'
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

          {/* Switch to Workspace Chat */}
          <button
            type="button"
            data-mobile-switch-chat="1"
            onClick={() => setLayoutMode('standard')}
            aria-label="Open chat workspace"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/80 bg-card/80 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
          >
            <MessageSquare className="h-5 w-5" />
          </button>

          {/* Toggle Live Captions or End Voice Call */}
          {voice.isActive ? (
            <button
              type="button"
              onClick={voice.stopVoice}
              aria-label="End live voice session"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/15 text-destructive transition-colors active:scale-95"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCaptionsEnabled(!captionsEnabled)}
              aria-pressed={captionsEnabled}
              aria-label={captionsEnabled ? 'Hide live captions' : 'Show live captions'}
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95',
                captionsEnabled
                  ? 'border-foreground/25 bg-muted text-foreground'
                  : 'border-border/80 bg-card/80 text-muted-foreground hover:text-foreground'
              )}
            >
              {captionsEnabled ? <Captions className="h-5 w-5" /> : <CaptionsOff className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Desktop (>= lg): Bottom 4-Sense OS Dock (Mouth · Eyes · Ears · Hands · Captions · Wardrobe) */}
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
              title={vision.cameraActive ? 'Turn off Camera Eye' : 'Camera Eye'}
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

          {/* Captions + Wardrobe */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-eva-target="focus-toggle-captions"
              onClick={() => setCaptionsEnabled(!captionsEnabled)}
              aria-pressed={captionsEnabled}
              aria-label={captionsEnabled ? 'Hide live captions' : 'Show live captions'}
              title={captionsEnabled ? 'Hide Captions' : 'Show Captions'}
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
