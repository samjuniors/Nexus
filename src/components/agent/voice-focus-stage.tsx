'use client'

import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  Command,
  GitBranch,
  Globe,
  LayoutGrid,
  Mic,
  MicOff,
  Moon,
  Network,
  PhoneOff,
  Shirt,
  Sun,
} from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { useEva } from '@/components/agent/eva-provider'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { EYE_EXPRESSION_LABELS } from '@/lib/agent/mochi-eyes'
import { OUTFIT_SELECTIONS, type OutfitSelection } from '@/lib/coucou/wardrobe'
import { cn } from '@/lib/utils'

const OUTFIT_CYCLE: readonly OutfitSelection[] = OUTFIT_SELECTIONS

/**
 * Instant Voice Focus Mode — uncluttered companion-first canvas where Eva's living
 * 3D Coucou character floats completely borderless over the background with zero
 * outer circle outline, ready to drive every capability by voice or quick actions.
 */
export function VoiceFocusStage({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const { voice, wake, evaExpression, onToggleSleepMode, onArmEar } = useEva()
  const activeConvId = useApp((s) => s.activeConvId)

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

  const [greetSeq, setGreetSeq] = useState(0)

  const latestChain = reasoningChains[0] ?? null
  const latestNode = useMemo(() => {
    if (!latestChain || latestChain.nodes.length === 0) return null
    return latestChain.nodes[latestChain.nodes.length - 1]
  }, [latestChain])

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

  const liveCaption =
    voice.liveOutputTranscript ||
    voice.liveInputTranscript ||
    transientNote ||
    (wake.sleepMode
      ? 'Sleeping — tap Eva to wake her always-on ear'
      : voice.isActive
        ? voice.isSpeaking
          ? 'Eva is speaking…'
          : voice.muted
            ? 'Microphone muted — tap Eva to unmute'
            : 'Listening — speak any command'
        : `Say "${wake.wakePhrase}" or tap Eva to speak`)

  const characterShadow = wake.sleepMode
    ? 'drop-shadow(0 12px 24px rgba(15, 23, 42, 0.28))'
    : voice.isActive
      ? voice.isSpeaking
        ? 'drop-shadow(0 0 36px rgba(16, 185, 129, 0.34)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.25))'
        : 'drop-shadow(0 0 36px rgba(56, 189, 248, 0.36)) drop-shadow(0 14px 26px rgba(0, 0, 0, 0.25))'
      : 'drop-shadow(0 14px 28px rgba(0, 0, 0, 0.22))'

  return (
    <div
      data-voice-focus-stage="1"
      className="relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      {/* Minimal single-line top bar */}
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Eva</span>
          <span>·</span>
          <span>Voice Focus</span>
          <span>·</span>
          <span className="font-mono text-[11px]">{EYE_EXPRESSION_LABELS[evaExpression]}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              title="Command Bar (⌘K)"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Command className="h-3.5 w-3.5" />
              <span className="hidden md:inline font-mono text-[10.5px]">⌘K</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleSplit('reasoning')}
            data-eva-target="focus-reasoning"
            aria-pressed={splitOpen && splitMode === 'reasoning'}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
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
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
              splitOpen && splitMode === 'browser'
                ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Browser</span>
          </button>

          <button
            type="button"
            onClick={() => setGbrainGraphOpen(true)}
            data-eva-target="focus-gbrain"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Network className="h-3.5 w-3.5" />
            <span>GBrain</span>
          </button>

          <button
            type="button"
            onClick={() => setLayoutMode('standard')}
            data-eva-target="exit-voice-focus"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Workspace</span>
          </button>
        </div>
      </header>

      {/* Center dynamic companion stage — completely borderless transparent character */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
          className="relative flex flex-col items-center"
        >
          <motion.button
            type="button"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
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
              'group relative flex h-52 w-52 cursor-pointer items-center justify-center bg-transparent border-0 ring-0 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:rounded-3xl',
              wake.sleepMode && 'opacity-80'
            )}
          >
            <CoucouBot
              expression={evaExpression}
              archetype="eva"
              outfit={coucouOutfit}
              greetSeq={greetSeq}
              dancing={coucouDancing || mediaPlaying}
              size={190}
              interactive={false}
              trackGaze
              label={`Eva companion (${EYE_EXPRESSION_LABELS[evaExpression]})`}
            />
          </motion.button>

          {/* Minimal live voice caption */}
          <p className="mt-5 max-w-lg text-center text-sm leading-relaxed text-foreground/90">
            {liveCaption}
          </p>

          {/* Compact live Reasoning Chain pulse */}
          {latestChain && latestNode && (
            <button
              type="button"
              onClick={() => openReasoningForChain(latestChain.id)}
              className="mt-4 inline-flex max-w-md items-center gap-2 rounded-lg border border-border/80 bg-muted/30 px-3 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-sky-500/40 hover:text-foreground"
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-sky-500" />
              <span className="truncate">
                <span className="font-medium text-foreground">{latestNode.title}</span>
                {latestChain.correctionCount > 0
                  ? ` · ${latestChain.correctionCount} self-corrected`
                  : ''}
              </span>
            </button>
          )}

          {/* Minimal primary voice controls */}
          <div className="mt-7 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (voice.isActive) {
                  voice.toggleMute()
                } else {
                  setGreetSeq((n) => n + 1)
                  void voice.startVoice(activeConvId)
                }
              }}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors',
                voice.isActive && !voice.muted
                  ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-card text-foreground hover:bg-muted'
              )}
            >
              {voice.isActive && voice.muted ? (
                <MicOff className="h-4 w-4 text-amber-500" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              <span>
                {voice.isActive ? (voice.muted ? 'Unmute' : 'Listening') : 'Talk to Eva'}
              </span>
            </button>

            {voice.isActive && (
              <button
                type="button"
                onClick={voice.stopVoice}
                aria-label="End live voice"
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>End</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleSleepMode}
              aria-label={wake.sleepMode ? 'Wake Eva' : 'Put Eva in Sleep Mode'}
              title={wake.sleepMode ? 'Wake Eva' : 'Sleep Mode'}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {wake.sleepMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={cycleOutfit}
              aria-label="Switch Eva outfit"
              title={`Switch outfit (${coucouOutfit})`}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Shirt className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
