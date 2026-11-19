export type CaptionAnimationStyle = 'typewriter' | 'fade' | 'bounce'

export interface CaptionAnimationOption {
  id: CaptionAnimationStyle
  label: string
  description: string
}

export const CAPTION_STYLE_STORAGE_KEY = 'nexus-caption-animation-style'

export const CAPTION_ANIMATION_OPTIONS: readonly CaptionAnimationOption[] = [
  {
    id: 'typewriter',
    label: 'Typewriter',
    description: 'Progressive character-by-character typing with subtle cursor',
  },
  {
    id: 'fade',
    label: 'Fade-In',
    description: 'Smooth opacity and gentle upward reveal as Eva speaks',
  },
  {
    id: 'bounce',
    label: 'Bouncing',
    description: 'Playful word-by-word spring bounce synced to incoming words',
  },
] as const

export function isCaptionAnimationStyle(value: unknown): value is CaptionAnimationStyle {
  return value === 'typewriter' || value === 'fade' || value === 'bounce'
}

export function readSavedCaptionStyle(): CaptionAnimationStyle {
  if (typeof window === 'undefined') return 'typewriter'
  try {
    const saved = window.localStorage.getItem(CAPTION_STYLE_STORAGE_KEY)
    if (isCaptionAnimationStyle(saved)) return saved
  } catch {
    /* ignore storage errors */
  }
  return 'typewriter'
}

export function persistCaptionStyle(style: CaptionAnimationStyle): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CAPTION_STYLE_STORAGE_KEY, style)
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Computes the shared prefix length so streaming voice transcripts continue typing
 * smoothly from the already-revealed characters instead of restarting from zero.
 */
export function computeTypewriterStartIndex(
  prevText: string,
  nextText: string,
  prevRevealed: number
): number {
  if (!nextText) return 0
  if (prevText && nextText.startsWith(prevText)) {
    return Math.min(prevRevealed, nextText.length)
  }
  return 0
}

/**
 * Splits a caption into non-empty word tokens for word-by-word spring animations.
 */
export function splitCaptionTokens(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return trimmed.split(/\s+/)
}
