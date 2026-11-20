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
  'hey evay',
  'hey eeva',
  'hey ava',
  'hey evah',
  'hey eba',
  'hey ewa',
  'hey iva',
  'hey ever',
  'hey evo',
  'hey viva',
  'hey aiva',
  'hey eiva',
  'hey ifa',
  'hey eeba',
  'hey if a',
  'hey e v a',
  'hay eva',
  'hay evay',
  'a eva',
  'a ava',
  'hi eva',
  'hi evay',
  'hi ava',
  'hi ever',
  'okay eva',
  'okay evay',
  'okay ava',
  'ok eva',
  'ok evay',
  'ok ava',
  'hello eva',
  'hello evay',
  'hello ava',
  'yo eva',
  'yo ava',
]

// Direct single-word wake calls ("Eva", "Evay", "Eva check my tasks", "Eva?") allowed under
// the default "Hey Eva" / "Eva" wake profile without triggering on substrings like "whatever" or "evaluate".
const DIRECT_EVA_VARIANTS = [
  'eva',
  'evay',
  'evah',
  'eeva',
  'ava',
  'avah',
  'aiva',
  'eiva',
  'iva',
  'ivah',
  'eba',
  'ewa',
  'eeba',
  'heva',
  'ifa',
  'e v a',
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
 * Matches spoken/ASR transcript text against the configured wake word (default "Hey Eva" / "Eva").
 * Extracts any command spoken immediately after the wake word so single-breath utterances
 * like "Hey Eva create a QA bot" or "Eva check my tasks" forward directly into Live Voice.
 */
export function matchWakeWord(transcript: string, customPhrase = DEFAULT_WAKE_PHRASE): WakeMatchResult {
  const raw = transcript.trim()
  if (!raw) {
    return { matched: false, matchedPhrase: '', trailingCommand: '' }
  }

  const normalizedCustom = normalizePhrase(customPhrase || DEFAULT_WAKE_PHRASE)
  const isDefaultEvaProfile = normalizedCustom === 'hey eva' || normalizedCustom === 'eva' || normalizedCustom === 'ok eva'

  const multiWordCandidates = isDefaultEvaProfile
    ? Array.from(new Set([normalizedCustom, ...DEFAULT_EVA_VARIANTS]))
    : Array.from(new Set([normalizedCustom, ...DEFAULT_EVA_VARIANTS]))

  // Sort longer phrases first so "hey eva" always matches ahead of standalone "eva"
  const orderedMulti = [...multiWordCandidates].sort((a, b) => b.length - a.length)

  for (const candidate of orderedMulti) {
    const tokens = candidate.split(' ').filter(Boolean).map(escapeRegex)
    if (tokens.length === 0) continue
    // Skip single-token items here; they are matched with stricter boundary rules below
    if (tokens.length === 1 && isDefaultEvaProfile) continue
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

  // Also allow direct "Eva" / "Eva, <command>" calls for the default Eva wake profiles
  // (matches standalone "Eva", "Eva?", start-of-utterance "Eva open browser", or "... Eva" at the end)
  if (isDefaultEvaProfile) {
    const orderedDirect = [...DIRECT_EVA_VARIANTS].sort((a, b) => b.length - a.length)
    for (const candidate of orderedDirect) {
      const tokens = candidate.split(' ').filter(Boolean).map(escapeRegex)
      const joined = tokens.join('[\\s,.-]+')
      // Match at the start of utterance (with optional trailing command) OR at the end of a short callout
      const startPattern = new RegExp(`^(${joined})(?:[\\s,.;:!?]+(.*))?$`, 'i')
      const startMatch = startPattern.exec(raw)
      if (startMatch) {
        return {
          matched: true,
          matchedPhrase: startMatch[1].trim(),
          trailingCommand: (startMatch[2] ?? '').trim(),
        }
      }
      const endPattern = new RegExp(`(?:^|[\\s,.;:!?]+)(${joined})[\\s,.;:!?]*$`, 'i')
      const endMatch = endPattern.exec(raw)
      if (endMatch) {
        return {
          matched: true,
          matchedPhrase: endMatch[1].trim(),
          trailingCommand: '',
        }
      }
    }
  }

  return { matched: false, matchedPhrase: '', trailingCommand: '' }
}

/**
 * Tests multiple ASR alternatives (and combined rolling chunks) and returns the best match.
 * Prefers candidates that include a trailing command or a longer multi-word wake phrase
 * (e.g. "Hey Eva review team" wins over bare "Eva").
 */
export function matchWakeWordCandidates(
  transcripts: string[],
  customPhrase = DEFAULT_WAKE_PHRASE
): WakeMatchResult {
  let best: WakeMatchResult | null = null
  for (const t of transcripts) {
    const res = matchWakeWord(t, customPhrase)
    if (!res.matched) continue
    if (!best) {
      best = res
      continue
    }
    const resHasCmd = res.trailingCommand.length > 0
    const bestHasCmd = best.trailingCommand.length > 0
    if (resHasCmd && !bestHasCmd) {
      best = res
    } else if (resHasCmd === bestHasCmd) {
      if (
        res.trailingCommand.length > best.trailingCommand.length ||
        (res.trailingCommand.length === best.trailingCommand.length &&
          res.matchedPhrase.length > best.matchedPhrase.length)
      ) {
        best = res
      }
    }
  }
  return best ?? { matched: false, matchedPhrase: '', trailingCommand: '' }
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
