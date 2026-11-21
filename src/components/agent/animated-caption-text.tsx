'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  computeTypewriterStartIndex,
  splitCaptionTokens,
  type CaptionAnimationStyle,
} from '@/lib/agent/caption-animation'
import { cn } from '@/lib/utils'

interface AnimatedCaptionTextProps {
  text: string
  styleMode: CaptionAnimationStyle
  accentColor?: string
  /** Phrase-level key (e.g. speaker + phraseIndex + manual replaySeq). Never pass raw `text` here! */
  replayKey?: number | string
  /**
   * Optional 0..1 audio playback progress within this phrase.
   * When provided, character/word pacing locks directly to real WebAudio playback
   * with zero artificial typewriter or exit-animation lag.
   */
  syncProgress?: number
  className?: string
  'data-voice-caption-active'?: string
}

/**
 * Computes how many characters of `text` should be revealed for a given 0..1 audio
 * `syncProgress`, snapping cleanly to whole-word boundaries with a slight visual lead
 * so the word Eva is pronouncing is always fully readable right on vocal onset.
 */
function computeAudioLockedRevealCount(text: string, syncProgress: number): number {
  if (!text) return 0
  if (syncProgress >= 0.85) return text.length
  const leadFraction = Math.min(1, Math.max(0.22, syncProgress * 1.12 + 0.22))
  const rawIdx = Math.ceil(text.length * leadFraction)
  if (rawIdx >= text.length) return text.length
  const nextSpace = text.indexOf(' ', rawIdx)
  return nextSpace === -1 ? text.length : nextSpace
}

/**
 * Renders Voice Focus live captions in the user's chosen animation style
 * (`typewriter`, `fade`, or `bounce`) while respecting `prefers-reduced-motion`,
 * locking directly to WebAudio `syncProgress` when speaking live, and streaming
 * transcript tokens cleanly with ZERO unmount/remount flicker.
 */
export function AnimatedCaptionText({
  text,
  styleMode,
  accentColor = '#38bdf8',
  replayKey = 0,
  syncProgress,
  className,
  'data-voice-caption-active': dataVoiceCaptionActive,
}: AnimatedCaptionTextProps) {
  const reducedMotion = Boolean(useReducedMotion())
  const isAudioLocked = typeof syncProgress === 'number' && Number.isFinite(syncProgress)

  // Typewriter reveal state for non-audio-locked contexts (demo, settings preview, user mic)
  const [timerRevealedCount, setTimerRevealedCount] = useState<number>(() =>
    styleMode === 'typewriter' && !reducedMotion && !isAudioLocked ? 0 : text.length
  )
  const prevTextRef = useRef<string>('')
  const prevReplayRef = useRef<number | string>(replayKey)
  const revealedRef = useRef<number>(timerRevealedCount)
  revealedRef.current = timerRevealedCount

  // Track how many words were already visible for the current `replayKey` so
  // live-streamed words animate in immediately without re-bouncing earlier words.
  const wordBoundaryRef = useRef<{ key: number | string; count: number }>({
    key: replayKey,
    count: 0,
  })

  useEffect(() => {
    if (styleMode !== 'typewriter' || reducedMotion || isAudioLocked) {
      setTimerRevealedCount(text.length)
      prevTextRef.current = text
      prevReplayRef.current = replayKey
      return
    }

    const forcedReplay = prevReplayRef.current !== replayKey
    const startIdx = forcedReplay
      ? 0
      : computeTypewriterStartIndex(prevTextRef.current, text, revealedRef.current)
    prevTextRef.current = text
    prevReplayRef.current = replayKey

    setTimerRevealedCount(startIdx)
    if (startIdx >= text.length) return

    let current = startIdx
    const remaining = text.length - startIdx
    // Ultra-snappy catch-up so non-audio-locked captions never feel sluggish
    const stepChars = remaining > 24 ? 3 : 2
    const stepMs = 10
    const timer = window.setInterval(() => {
      current = Math.min(text.length, current + stepChars)
      setTimerRevealedCount(current)
      if (current >= text.length) {
        window.clearInterval(timer)
      }
    }, stepMs)

    return () => window.clearInterval(timer)
  }, [text, styleMode, reducedMotion, replayKey, isAudioLocked])

  const tokens = useMemo(() => splitCaptionTokens(text), [text])

  // Determine how many tokens were already mounted in this phrase
  const priorWordCount =
    wordBoundaryRef.current.key === replayKey ? wordBoundaryRef.current.count : 0

  useEffect(() => {
    wordBoundaryRef.current = { key: replayKey, count: tokens.length }
  }, [replayKey, tokens.length])

  // Spoken word boundary for real-time vocal emphasis in fade/bounce styles
  const spokenWordCount = isAudioLocked
    ? Math.max(
        1,
        Math.min(
          tokens.length,
          Math.ceil(tokens.length * Math.min(1, (syncProgress ?? 0) * 1.12 + 0.16))
        )
      )
    : tokens.length

  if (reducedMotion) {
    return (
      <p
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style={styleMode}
        className={cn(
          'min-w-0 text-sm font-medium leading-snug text-foreground sm:text-[15px]',
          className
        )}
      >
        {text}
      </p>
    )
  }

  if (styleMode === 'typewriter') {
    const revealedCount = isAudioLocked
      ? computeAudioLockedRevealCount(text, syncProgress ?? 1)
      : timerRevealedCount
    const visibleSlice = text.slice(0, revealedCount)
    const upcomingSlice = text.slice(revealedCount)
    const isTyping = revealedCount < text.length
    return (
      <p
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style="typewriter"
        className={cn(
          'min-w-0 text-sm font-medium leading-snug text-foreground sm:text-[15px]',
          className
        )}
      >
        <span>{visibleSlice}</span>
        {isTyping && !isAudioLocked && (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ duration: 0.65, repeat: Infinity, ease: 'easeInOut' }}
            className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[2px] rounded-full align-baseline"
            style={{ backgroundColor: accentColor }}
          />
        )}
        {/* When audio-locked, show remaining words softly ahead so layout never jumps and eyes stay synced */}
        {isTyping && isAudioLocked && (
          <span className="text-foreground/40 transition-colors duration-100">{upcomingSlice}</span>
        )}
        {/* Screen readers always receive full text */}
        {isTyping && !isAudioLocked && <span className="sr-only">{upcomingSlice}</span>}
      </p>
    )
  }

  if (styleMode === 'bounce') {
    const isInitialBatch = priorWordCount === 0
    return (
      <p
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style="bounce"
        className={cn(
          'min-w-0 text-sm font-medium leading-snug text-foreground sm:text-[15px]',
          className
        )}
      >
        {tokens.map((word, idx) => {
          const batchOffset = isInitialBatch ? idx : Math.max(0, idx - priorWordCount)
          const isSpoken = idx < spokenWordCount
          return (
            <motion.span
              key={`${replayKey}-${idx}`}
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: isSpoken ? 1 : 0.5, y: 0, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 520,
                damping: 26,
                mass: 0.5,
                delay: Math.min(batchOffset * 0.01, 0.05),
              }}
              className="mr-[0.26em] inline-block last:mr-0"
            >
              {word}
            </motion.span>
          )
        })}
      </p>
    )
  }

  // 'fade' — instant non-blocking entrance with subtle real-time spoken word tracking
  const isInitialBatch = priorWordCount === 0
  return (
    <motion.p
      key={String(replayKey)}
      data-voice-caption-active={dataVoiceCaptionActive}
      data-caption-style="fade"
      initial={{ opacity: 0.35, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.08, ease: 'easeOut' }}
      className={cn(
        'min-w-0 text-sm font-medium leading-snug text-foreground sm:text-[15px]',
        className
      )}
    >
      {tokens.map((word, idx) => {
        const batchOffset = isInitialBatch ? idx : Math.max(0, idx - priorWordCount)
        const isSpoken = idx < spokenWordCount
        return (
          <motion.span
            key={`${replayKey}-${idx}`}
            initial={{ opacity: 0.25 }}
            animate={{ opacity: isSpoken ? 1 : 0.52 }}
            transition={{
              duration: 0.09,
              ease: 'easeOut',
              delay: Math.min(batchOffset * 0.008, 0.04),
            }}
            className="mr-[0.26em] inline-block last:mr-0"
          >
            {word}
          </motion.span>
        )
      })}
    </motion.p>
  )
}
