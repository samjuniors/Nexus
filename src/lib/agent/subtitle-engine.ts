/**
 * Pure cinema-style live subtitle phrase engine for Voice Focus mode.
 * Breaks live speech into crisp, readable 1-2 line phrases so previous
 * sentences naturally disappear as Eva moves to the next thought
 * (e.g. "How are you?" -> fades -> "I'm Eva.").
 */

export interface ActiveSubtitleCue {
  current: string
  previous: string | null
  phraseIndex: number
  totalPhrases: number
}

const DEFAULT_MAX_CHARS = 74

function splitLongClause(clause: string, maxChars: number): string[] {
  const words = clause.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const chunks: string[] = []
  let buf = ''
  for (const word of words) {
    if (!buf) {
      buf = word
      continue
    }
    if (buf.length + 1 + word.length <= maxChars) {
      buf = `${buf} ${word}`
    } else {
      chunks.push(buf)
      buf = word
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/**
 * Splits a streaming or complete spoken utterance into natural subtitle phrases.
 * Priority: sentence boundaries (. ! ? …) -> soft clause breaks (, ; — :) -> word-wrap chunks.
 */
export function splitIntoSubtitlePhrases(rawText: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const normalized = rawText.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  // First break by terminal sentence punctuation while keeping punctuation attached
  const sentences = normalized
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const phrases: string[] = []
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      phrases.push(sentence)
      continue
    }

    // Break longer sentences gently on commas / dashes / semicolons
    const clauses = sentence
      .split(/(?<=[,;—–:])\s+/)
      .map((c) => c.trim())
      .filter(Boolean)

    let combined = ''
    for (const clause of clauses) {
      if (!combined) {
        if (clause.length <= maxChars) {
          combined = clause
        } else {
          phrases.push(...splitLongClause(clause, maxChars))
        }
        continue
      }
      if (combined.length + 1 + clause.length <= maxChars) {
        combined = `${combined} ${clause}`
      } else {
        phrases.push(combined)
        if (clause.length <= maxChars) {
          combined = clause
        } else {
          phrases.push(...splitLongClause(clause, maxChars))
          combined = ''
        }
      }
    }
    if (combined) phrases.push(combined)
  }

  return phrases
}

/**
 * Extracts the currently spoken subtitle phrase from a live transcript stream.
 * Always shows only the active sentence/phrase so earlier sentences clear out cleanly.
 */
export function extractActiveSubtitleCue(
  rawText: string,
  opts?: { maxChars?: number }
): ActiveSubtitleCue {
  const phrases = splitIntoSubtitlePhrases(rawText, opts?.maxChars ?? DEFAULT_MAX_CHARS)
  if (phrases.length === 0) {
    return { current: '', previous: null, phraseIndex: -1, totalPhrases: 0 }
  }
  const idx = phrases.length - 1
  return {
    current: phrases[idx],
    previous: idx > 0 ? phrases[idx - 1] : null,
    phraseIndex: idx,
    totalPhrases: phrases.length,
  }
}

/**
 * Computes how long a subtitle cue should remain visible after speech pauses
 * before fading cleanly back to a serene minimalist canvas.
 */
export function computeSubtitleFadeMs(text: string, isActivelySpeaking: boolean): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const readingMs = Math.min(4600, Math.max(2400, 1400 + words * 210))
  return isActivelySpeaking ? readingMs + 1200 : readingMs
}
