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
  /** 0..1 playback progress within the currently active phrase */
  phraseProgress: number
}

const DEFAULT_MAX_CHARS = 74

/** Natural Gemini Live conversational speech rate (~19 chars/sec ≈ 185 WPM) */
const NATURAL_CHARS_PER_SEC = 19.0

/** Default visual anticipation lead (seconds) so captions appear right on vocal onset */
const DEFAULT_VISUAL_LEAD_SEC = 0.16

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
    return { current: '', previous: null, phraseIndex: -1, totalPhrases: 0, phraseProgress: 0 }
  }
  const idx = phrases.length - 1
  return {
    current: phrases[idx],
    previous: idx > 0 ? phrases[idx - 1] : null,
    phraseIndex: idx,
    totalPhrases: phrases.length,
    phraseProgress: 1,
  }
}

/**
 * Estimates natural spoken duration (in seconds) for a phrase based on character
 * length and natural punctuation pauses.
 */
function estimatePhraseDurationSec(phrase: string): number {
  const trimmed = phrase.trim()
  if (!trimmed) return 0.14
  const pauseSec = /[.!?…]$/.test(trimmed)
    ? 0.22
    : /[,;—–:]$/.test(trimmed)
      ? 0.1
      : 0.02
  return Math.max(0.28, trimmed.length / NATURAL_CHARS_PER_SEC + pauseSec)
}

export interface AudioSyncedSubtitleOptions {
  /** Seconds of audio actually played so far in this speaking turn (latency-compensated) */
  elapsedSec: number
  /** Total seconds of audio scheduled for this speaking turn so far */
  totalScheduledSec: number
  /** Offset (sec) of first detected audible vocal energy in the PCM stream (trims leading silence) */
  speechStartSec?: number
  /** Offset (sec) of last detected audible vocal energy in the PCM stream (trims trailing silence) */
  speechEndSec?: number
  /** Visual onset lead in seconds so phrases appear right as Eva speaks them (default 0.16s) */
  leadSec?: number
  /** Whether Gemini has finished generating all audio chunks for this turn */
  isTurnComplete?: boolean
  /** Monotonic lower bound so subtitles never jump backward when new text streams in */
  minPhraseIndex?: number
  /** Maximum characters per subtitle phrase */
  maxChars?: number
}

/**
 * Selects the subtitle phrase and intra-phrase progress synchronized to real
 * WebAudio playback progress.
 *
 * Key sync guarantees:
 * 1. Trims leading/trailing PCM silence via `speechStartSec` / `speechEndSec` so phrases
 *    align with audible speech rather than dead air.
 * 2. Applies a subtle visual anticipation lead (`leadSec`, default 160ms) so each phrase
 *    lands right on vocal onset instead of feeling delayed.
 * 3. While streaming (`isTurnComplete === false`), paces received phrases at natural speech
 *    speed (~19 chars/sec) instead of stretching partial text over future un-transcribed audio
 *    buffers — eliminating half-speed lag when audio arrives faster than transcription.
 * 4. Once generation/turn completes, locks tightly to the exact measured vocal audio span.
 */
export function extractAudioSyncedSubtitleCue(
  rawText: string,
  opts: AudioSyncedSubtitleOptions
): ActiveSubtitleCue {
  const phrases = splitIntoSubtitlePhrases(rawText, opts.maxChars ?? DEFAULT_MAX_CHARS)
  if (phrases.length === 0) {
    return { current: '', previous: null, phraseIndex: -1, totalPhrases: 0, phraseProgress: 0 }
  }

  const floorIdx = Math.max(0, Math.min(phrases.length - 1, opts.minPhraseIndex ?? 0))
  const elapsed = Math.max(0, opts.elapsedSec)
  const scheduled = Math.max(0, opts.totalScheduledSec)
  const lead = opts.leadSec ?? DEFAULT_VISUAL_LEAD_SEC

  const speechStart = Math.max(0, Math.min(scheduled, opts.speechStartSec ?? 0))
  const rawSpeechEnd =
    opts.speechEndSec !== undefined && opts.speechEndSec > speechStart + 0.12
      ? Math.min(scheduled, opts.speechEndSec)
      : scheduled
  const activeAudioSpanSec = Math.max(0.22, rawSpeechEnd - speechStart)

  if (phrases.length === 1) {
    const singleDur = opts.isTurnComplete && scheduled > 0.05
      ? activeAudioSpanSec
      : estimatePhraseDurationSec(phrases[0])
    const spokenElapsed = Math.max(0, elapsed - speechStart + (scheduled > 0.05 ? lead : 0))
    const phraseProgress =
      scheduled <= 0.05 && elapsed <= 0.05
        ? 0.25
        : Math.max(0, Math.min(1, spokenElapsed / Math.max(0.2, singleDur)))
    return {
      current: phrases[0],
      previous: null,
      phraseIndex: 0,
      totalPhrases: 1,
      phraseProgress,
    }
  }

  // Before audio actually starts playing, stay on the first phrase rather than jumping ahead
  if (scheduled <= 0.05 && elapsed <= 0.05) {
    return {
      current: phrases[floorIdx],
      previous: floorIdx > 0 ? phrases[floorIdx - 1] : null,
      phraseIndex: floorIdx,
      totalPhrases: phrases.length,
      phraseProgress: 0.2,
    }
  }

  // When audio generation is done and playback has nearly reached the end of audible speech, show final phrase
  if (opts.isTurnComplete && rawSpeechEnd > 0 && elapsed >= rawSpeechEnd - 0.16) {
    const lastIdx = phrases.length - 1
    return {
      current: phrases[lastIdx],
      previous: lastIdx > 0 ? phrases[lastIdx - 1] : null,
      phraseIndex: lastIdx,
      totalPhrases: phrases.length,
      phraseProgress: 1,
    }
  }

  const phraseDurations = phrases.map(estimatePhraseDurationSec)
  const estimatedTotalSec = phraseDurations.reduce((acc, d) => acc + d, 0)

  // Determine the timeline duration represented by the currently available phrases:
  // - When the turn is complete, we have the exact full text AND exact full vocal span.
  // - While still streaming, NEVER stretch partial received text across future un-transcribed
  //   audio buffers (`activeAudioSpanSec` may already include upcoming sentences whose
  //   transcript deltas haven't arrived yet!). Instead pace received phrases at natural speed,
  //   clamped lightly if audio is shorter than the estimate.
  const effectiveDurationSec = opts.isTurnComplete
    ? activeAudioSpanSec
    : Math.max(0.25, estimatedTotalSec)

  // Scale factor mapping estimated phrase durations onto `effectiveDurationSec`
  const scale = effectiveDurationSec / Math.max(0.2, estimatedTotalSec)
  const spokenElapsed = Math.max(0, elapsed - speechStart + lead)

  let cumulativeSec = 0
  let computedIdx = phrases.length - 1
  let activeStartSec = 0
  let activeDurSec = phraseDurations[phrases.length - 1] * scale

  for (let i = 0; i < phraseDurations.length; i++) {
    const segDur = phraseDurations[i] * scale
    if (spokenElapsed < cumulativeSec + segDur) {
      computedIdx = i
      activeStartSec = cumulativeSec
      activeDurSec = segDur
      break
    }
    cumulativeSec += segDur
    if (i === phraseDurations.length - 1) {
      activeStartSec = cumulativeSec - segDur
      activeDurSec = segDur
    }
  }

  const idx = Math.max(floorIdx, Math.min(phrases.length - 1, computedIdx))

  // Compute 0..1 progress inside the selected phrase
  let phraseProgress: number
  if (idx > computedIdx) {
    // Held forward by monotonic floor after new transcript streamed in
    phraseProgress = 0.25
  } else if (spokenElapsed >= effectiveDurationSec) {
    phraseProgress = 1
  } else {
    phraseProgress = Math.max(
      0,
      Math.min(1, (spokenElapsed - activeStartSec) / Math.max(0.14, activeDurSec))
    )
  }

  return {
    current: phrases[idx],
    previous: idx > 0 ? phrases[idx - 1] : null,
    phraseIndex: idx,
    totalPhrases: phrases.length,
    phraseProgress,
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
