'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
  /** Optional key to force replaying the animation (e.g. in Settings live preview) */
  replayKey?: number | string
  className?: string
  'data-voice-caption-active'?: string
}

/**
 * Renders Voice Focus live captions in the user's chosen animation style
 * (`typewriter`, `fade`, or `bounce`) while respecting `prefers-reduced-motion`
 * and streaming live transcript prefixes without jarring restarts.
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
    // Adaptive speed: crisp & natural (~22ms/char, slightly faster for long sentences)
    const stepMs = text.length > 110 ? 14 : 22
    const timer = window.setInterval(() => {
      current = Math.min(text.length, current + 1)
      setRevealedCount(current)
      if (current >= text.length) {
        window.clearInterval(timer)
      }
    }, stepMs)

    return () => window.clearInterval(timer)
  }, [text, styleMode, reducedMotion, replayKey])

  const tokens = useMemo(() => splitCaptionTokens(text), [text])

  if (reducedMotion) {
    return (
      <p
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style={styleMode}
        className={cn(
          'min-w-0 flex-1 text-sm font-medium leading-relaxed text-foreground sm:text-[15px]',
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
          'min-w-0 flex-1 text-sm font-medium leading-relaxed text-foreground sm:text-[15px]',
          className
        )}
      >
        <span>{visibleSlice}</span>
        {isTyping && (
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 0.15, 1] }}
            transition={{ duration: 0.65, repeat: Infinity, ease: 'easeInOut' }}
            className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-full align-baseline"
            style={{ backgroundColor: accentColor }}
          />
        )}
        {/* Screen readers always receive full text */}
        {isTyping && <span className="sr-only">{text.slice(revealedCount)}</span>}
      </p>
    )
  }

  if (styleMode === 'bounce') {
    return (
      <p
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style="bounce"
        className={cn(
          'min-w-0 flex-1 text-sm font-medium leading-relaxed text-foreground sm:text-[15px]',
          className
        )}
      >
        {tokens.map((word, idx) => (
          <motion.span
            key={`${replayKey}-${idx}-${word}`}
            initial={{ opacity: 0, y: 9, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              type: 'spring',
              stiffness: 420,
              damping: 18,
              mass: 0.65,
              delay: Math.min(idx * 0.032, 0.48),
            }}
            className="mr-[0.28em] inline-block"
          >
            {word}
          </motion.span>
        ))}
      </p>
    )
  }

  // 'fade'
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.p
        key={`${replayKey}-${text}`}
        data-voice-caption-active={dataVoiceCaptionActive}
        data-caption-style="fade"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'min-w-0 flex-1 text-sm font-medium leading-relaxed text-foreground sm:text-[15px]',
          className
        )}
      >
        {text}
      </motion.p>
    </AnimatePresence>
  )
}
