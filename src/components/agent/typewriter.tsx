'use client'

import { useEffect, useMemo, useState } from 'react'
import { Markdown } from '@/components/agent/markdown'
import { cn } from '@/lib/utils'

/**
 * Typewriter reveal for chat answers (Claude/ChatGPT feel).
 *
 * The full answer arrives at once from the API; this component reveals it
 * progressively so it reads like it is being typed, never a wall of text
 * appearing at once. Speed adapts to length: every answer finishes in
 * roughly 1.2–7s no matter how long it is — short answers type gently,
 * long ones stream faster.
 *
 * Natural breathing: the cursor lingers briefly at paragraph breaks and
 * sentence ends, the way a person (or a streaming model) actually types.
 *
 * Click anywhere on the text to reveal the rest instantly.
 */
export function Typewriter({
  text,
  animate,
  className,
}: {
  text: string
  animate: boolean
  className?: string
}) {
  // chars revealed so far — only advances while animating
  const [progress, setProgress] = useState(0)

  // adaptive pacing: total duration grows with length but is capped
  const { chunk, intervalMs } = useMemo(() => {
    const durationSec = Math.min(7, Math.max(1.2, 1.2 + text.length / 420))
    const interval = 16
    const ticks = Math.max(8, Math.round((durationSec * 1000) / interval))
    return { chunk: Math.max(1, Math.ceil(text.length / ticks)), intervalMs: interval }
  }, [text.length])

  useEffect(() => {
    if (!animate) return
    let current = 0
    let pause = 0
    const timer = setInterval(() => {
      // breathing pause — hold the cursor still for a few ticks
      if (pause > 0) {
        pause -= 1
        return
      }
      const before = current
      current = Math.min(text.length, current + chunk)
      const slice = text.slice(before, current)
      // linger at structural boundaries: paragraphs longest, then sentences
      if (slice.includes('\n\n') || slice.endsWith('\n#')) pause = 10
      else if (slice.includes('\n') || (before > 0 && /[.!?]\s*$/.test(text.slice(0, before)))) pause = 4
      setProgress(current)
      if (current >= text.length) clearInterval(timer)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [text, animate, chunk, intervalMs])

  const done = !animate || progress >= text.length
  const shown = animate ? progress : text.length

  if (!animate) {
    return (
      <div className={className}>
        <Markdown>{text}</Markdown>
      </div>
    )
  }

  return (
    <div
      className={cn('cursor-text', className)}
      onClick={() => setProgress(text.length)}
      role="presentation"
    >
      <Markdown>{text.slice(0, shown)}</Markdown>
      {!done && (
        <span
          aria-hidden
          className="mt-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse rounded-[2px] bg-zinc-400/80"
        />
      )}
    </div>
  )
}
