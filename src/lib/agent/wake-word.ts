import type { VoiceStatus } from '@/lib/agent/voice-state'

export const DEFAULT_WAKE_PHRASE = 'Hey Eva'

export const WAKE_PHRASE_PRESETS = ['Hey Eva', 'Eva', 'OK Eva'] as const

export interface WakeMatchResult {
  matched: boolean
  matchedPhrase: string
  trailingCommand: string
}

const DEFAULT_EVA_VARIANTS = [
  'hey eva',
  'hey ava',
  'hey evah',
  'hey eba',
  'hey ewa',
  'hey iva',
  'hey ever',
  'hey evo',
  'hey viva',
  'hey if a',
  'hey e v a',
  'a eva',
  'a ava',
  'hi eva',
  'hi ava',
  'hi ever',
  'okay eva',
  'okay ava',
  'ok eva',
  'ok ava',
  'hello eva',
  'hello ava',
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Matches spoken/ASR transcript text against the configured wake word (default "Hey Eva").
 * Extracts any command spoken immediately after the wake word so single-breath utterances
 * like "Hey Eva create a QA bot" forward directly into Live Voice.
 */
export function matchWakeWord(transcript: string, customPhrase = DEFAULT_WAKE_PHRASE): WakeMatchResult {
  const raw = transcript.trim()
  if (!raw) {
    return { matched: false, matchedPhrase: '', trailingCommand: '' }
  }

  const normalizedCustom = normalizePhrase(customPhrase || DEFAULT_WAKE_PHRASE)
  const candidates =
    normalizedCustom === 'hey eva'
      ? DEFAULT_EVA_VARIANTS
      : normalizedCustom === 'eva'
        ? [...DEFAULT_EVA_VARIANTS, 'eva', 'ava']
        : Array.from(new Set([normalizedCustom, ...DEFAULT_EVA_VARIANTS]))

  // Sort longer phrases first so "hey eva" matches ahead of "eva"
  const ordered = [...candidates].sort((a, b) => b.length - a.length)

  // Work over cleaned text while preserving case of trailing words
  for (const candidate of ordered) {
    const tokens = candidate.split(' ').filter(Boolean).map(escapeRegex)
    if (tokens.length === 0) continue
    const pattern = new RegExp(`(?:^|[\\s,.;:!?]+)(${tokens.join('[\\s,.-]+')})(?:[\\s,.;:!?]+(.*))?$`, 'i')
    const match = pattern.exec(raw)
    if (match) {
      const matchedPhrase = match[1].trim()
      const trailingCommand = (match[2] ?? '').trim()
      return {
        matched: true,
        matchedPhrase,
        trailingCommand,
      }
    }
  }

  return { matched: false, matchedPhrase: '', trailingCommand: '' }
}

/**
 * Tests multiple ASR alternatives (and combined rolling chunks) and returns the first match.
 */
export function matchWakeWordCandidates(
  transcripts: string[],
  customPhrase = DEFAULT_WAKE_PHRASE
): WakeMatchResult {
  for (const t of transcripts) {
    const res = matchWakeWord(t, customPhrase)
    if (res.matched) return res
  }
  return { matched: false, matchedPhrase: '', trailingCommand: '' }
}

const SLEEP_COMMAND_PATTERNS = [
  /\b(?:eva|hey\s+eva|okay\s+eva|ok\s+eva)\s*,?\s*(?:go\s+to\s+sleep|sleep(?:\s+now|\s+mode)?|enter\s+sleep\s+mode|good\s*night|stop\s+listening)\b/i,
  /\b(?:go\s+to\s+sleep|enter\s+sleep\s+mode|good\s*night)\s*,?\s*(?:eva)\b/i,
  /^\s*(?:sleep\s+mode|go\s+to\s+sleep)\s*[.!?]*\s*$/i,
]

/**
 * Recognizes explicit spoken commands to put Eva into Sleep Mode.
 */
export function matchSleepCommand(transcript: string): boolean {
  const raw = transcript.trim()
  if (!raw) return false
  return SLEEP_COMMAND_PATTERNS.some((re) => re.test(raw))
}

/**
 * Wake-word recognition must pause ONLY when Eva is in Sleep Mode or when a Live Voice
 * session is connecting/connected (to avoid mic contention). Otherwise her ear stays ALWAYS ON.
 */
export function shouldSuspendWakeWord(params: {
  sleepMode?: boolean
  wakeEnabled?: boolean
  voiceStatus: VoiceStatus
}): boolean {
  if (params.sleepMode) return true
  if (params.wakeEnabled === false) return true
  return params.voiceStatus === 'connecting' || params.voiceStatus === 'connected'
}
