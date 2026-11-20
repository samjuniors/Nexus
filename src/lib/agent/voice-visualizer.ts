export type VoiceVisualizerStyle = 'halo' | 'ripples' | 'waveform' | 'aurora' | 'minimal'

export interface VoiceVisualizerOption {
  id: VoiceVisualizerStyle
  label: string
  shortLabel: string
  description: string
}

export const VOICE_VISUALIZER_STORAGE_KEY = 'nexus-voice-visualizer-style'

export const VOICE_VISUALIZER_OPTIONS: readonly VoiceVisualizerOption[] = [
  {
    id: 'halo',
    label: 'Soft Halo',
    shortLabel: 'Halo',
    description: 'Warm breathing radial glow that expands gently with Eva’s voice',
  },
  {
    id: 'ripples',
    label: 'Echo Ripples',
    shortLabel: 'Ripples',
    description: 'Concentric acoustic wave rings radiating smoothly outward',
  },
  {
    id: 'waveform',
    label: 'Orbital Bars',
    shortLabel: 'Orbital',
    description: 'Minimal circular cadence bars pulsing around Eva in sync with speech',
  },
  {
    id: 'aurora',
    label: 'Liquid Aurora',
    shortLabel: 'Aurora',
    description: 'Slow-drifting layered ambient light lobes behind Eva',
  },
  {
    id: 'minimal',
    label: 'Pure Minimal',
    shortLabel: 'Minimal',
    description: 'Whisper-quiet hairline breath ring with zero visual clutter',
  },
] as const

const VALID_STYLES = new Set<VoiceVisualizerStyle>(['halo', 'ripples', 'waveform', 'aurora', 'minimal'])

export function isVoiceVisualizerStyle(value: unknown): value is VoiceVisualizerStyle {
  return typeof value === 'string' && VALID_STYLES.has(value as VoiceVisualizerStyle)
}

export function readSavedVisualizerStyle(): VoiceVisualizerStyle {
  if (typeof window === 'undefined') return 'halo'
  try {
    const raw = window.localStorage.getItem(VOICE_VISUALIZER_STORAGE_KEY)
    if (isVoiceVisualizerStyle(raw)) return raw
  } catch {
    /* ignore storage errors */
  }
  return 'halo'
}

export function persistVisualizerStyle(style: VoiceVisualizerStyle): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(VOICE_VISUALIZER_STORAGE_KEY, style)
  } catch {
    /* ignore storage errors */
  }
}

export interface VisualizerIntensityInput {
  voiceActive: boolean
  isSpeaking: boolean
  isUserSpeaking: boolean
  speakingLevel: number
  micLevel: number
  sleepMode?: boolean
}

/**
 * Pure normalized energy (0..1) driving Voice Focus aura visuals.
 * Keeps motion calm when idle, attentive while listening, and lively while speaking.
 */
export function computeVisualizerIntensity(input: VisualizerIntensityInput): number {
  if (input.sleepMode) return 0.06
  if (input.isSpeaking) {
    return Math.min(1, Math.max(0.42, 0.45 + input.speakingLevel * 0.55))
  }
  if (input.isUserSpeaking) {
    return Math.min(0.95, Math.max(0.32, 0.3 + input.micLevel * 0.7))
  }
  if (input.voiceActive) {
    return 0.28
  }
  return 0.14
}
