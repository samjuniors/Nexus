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
  className?: string
  'data-voice-caption-active'?: string
}

/**
 * Renders Voice Focus live captions in the user's chosen animation style
 * (`typewriter`, `fade`, or `bounce`) while respecting `prefers-reduced-motion`
 * and streaming live transcript tokens cleanly with ZERO unmount/remount flicker.
 */
export function AnimatedCaptionText({
  text,
  styleMode,
  accentColor = '#38bdf8',
  replayKey = 0,
  className,
  'data-voice-caption-active': dataVoiceCaptionActive,
}: AnimatedCaptionTextProps) {
  const reducedMotion = Boolean(useReducedMotion())

  // Typewriter reveal state with streaming prefix continuity
  const [revealedCount, setRevealedCount] = useState<number>(() =>
    styleMode === 'typewriter' && !reducedMotion ? 0 : text.length
  )
  const prevTextRef = useRef<string>('')
  const prevReplayRef = useRef<number | string>(replayKey)
  const revealedRef = useRef<number>(revealedCount)
  revealedRef.current = revealedCount

  // Track how many words were already visible for the current `replayKey` so
  // live-streamed words animate in immediately without re-bouncing earlier words.
  const wordBoundaryRef = useRef<{ key: number | string; count: number }>({
    key: replayKey,
    count: 0,
  })

  useEffect(() => {
    if (styleMode !== 'typewriter' || reducedMotion) {
      setRevealedCount(text.length)
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

    setRevealedCount(startIdx)
    if (startIdx >= text.length) return

    let current = startIdx
    const remaining = text.length - startIdx
    // Catch up swiftly when a chunk of words arrives so subtitles never lag behind live speech
    const stepChars = remaining > 28 ? 2 : 1
    const stepMs = remaining > 50 ? 12 : 18
    const timer = window.setInterval(() => {
      current = Math.min(text.length, current + stepChars)
      setRevealedCount(current)
      if (current >= text.length) {
        window.clearInterval(timer)
      }
    }, stepMs)

    return () => window.clearInterval(timer)
  }, [text, styleMode, reducedMotion, replayKey])

  const tokens = useMemo(() => splitCaptionTokens(text), [text])

  // Determine how many tokens were already mounted in this phrase
  const priorWordCount =
    wordBoundaryRef.current.key === replayKey ? wordBoundaryRef.current.count : 0

  useEffect(() => {
    wordBoundaryRef.current = { key: replayKey, count: tokens.length }
  }, [replayKey, tokens.length])

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
    const visibleSlice = text.slice(0, revealedCount)
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
        {isTyping && (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ duration: 0.65, repeat: Infinity, ease: 'easeInOut' }}
            className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[2px] rounded-full align-baseline"
            style={{ backgroundColor: accentColor }}
          />
        )}
        {/* Screen readers always receive full text */}
        {isTyping && <span className="sr-only">{text.slice(revealedCount)}</span>}
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
          return (
            <motion.span
              key={`${replayKey}-${idx}`}
              initial={{ opacity: 0, y: 7, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 440,
                damping: 22,
                mass: 0.6,
                delay: Math.min(batchOffset * 0.026, 0.26),
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

  // 'fade' — NEVER unmount/remount the paragraph when tokens stream in!
  // Key strictly on `replayKey` (phrase boundary) and softly fade in newly arriving words.
  const isInitialBatch = priorWordCount === 0
  return (
    <motion.p
      key={String(replayKey)}
      data-voice-caption-active={dataVoiceCaptionActive}
      data-caption-style="fade"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'min-w-0 text-sm font-medium leading-snug text-foreground sm:text-[15px]',
        className
      )}
    >
      {tokens.map((word, idx) => {
        const batchOffset = isInitialBatch ? idx : Math.max(0, idx - priorWordCount)
        return (
          <motion.span
            key={`${replayKey}-${idx}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: 0.16,
              ease: 'easeOut',
              delay: Math.min(batchOffset * 0.018, 0.18),
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
