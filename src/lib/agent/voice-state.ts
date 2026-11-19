export type VoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir'
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error'
export type WakeWordStatus = 'armed' | 'awaiting-mic' | 'sleeping' | 'off' | 'unsupported' | 'error'
export type VoiceAgentState =
  | 'idle'
  | 'wake'
  | 'sleeping'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'executing'
  | 'speaking'
  | 'muted'
  | 'error'

export const VOICES: VoiceName[] = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir']

export const VOICE_AGENT_STATES: VoiceAgentState[] = [
  'idle',
  'wake',
  'sleeping',
  'connecting',
  'listening',
  'hearing',
  'thinking',
  'executing',
  'speaking',
  'muted',
  'error',
]

export interface ActiveVoiceTool {
  tool: string
  args?: Record<string, unknown>
}

export interface ComposerStateMeta {
  label: string
  hint: string
  auraClass: string
  glowOpacity: string
  ringOpacity: string
  badgeClass: string
  iconClass: string
  barClass: string
}

export function deriveVoiceAgentState(params: {
  status: VoiceStatus
  activeTool: ActiveVoiceTool | null
  isSpeaking: boolean
  isThinking: boolean
  muted: boolean
  isUserSpeaking: boolean
}): VoiceAgentState {
  if (params.status === 'error') return 'error'
  if (params.status === 'connecting') return 'connecting'
  if (params.status === 'idle') return 'idle'
  if (params.activeTool) return 'executing'
  if (params.isSpeaking) return 'speaking'
  if (params.isThinking) return 'thinking'
  if (params.muted) return 'muted'
  if (params.isUserSpeaking) return 'hearing'
  return 'listening'
}

export function deriveEffectiveComposerState(params: {
  isActive: boolean
  voiceStatus: VoiceStatus
  voiceAgentState: VoiceAgentState
  activeTool: ActiveVoiceTool | null
  isSpeaking: boolean
  isRunning: boolean
  isThinking: boolean
  isSending: boolean
  wakeStatus?: WakeWordStatus
  isSleeping?: boolean
}): VoiceAgentState {
  if (params.isActive) {
    if (params.isRunning && !params.activeTool && !params.isSpeaking) {
      return 'executing'
    }
    return params.voiceAgentState
  }
  if (params.voiceStatus === 'error') return 'error'
  if (params.isRunning) return 'executing'
  if (params.isThinking || params.isSending) return 'thinking'
  if (params.isSleeping || params.wakeStatus === 'sleeping') return 'sleeping'
  if (params.wakeStatus === 'armed' || params.wakeStatus === 'awaiting-mic') return 'wake'
  return 'idle'
}

export function getVoiceStateMeta(
  state: VoiceAgentState,
  voiceName: VoiceName,
  toolName?: string,
  wakePhrase = 'Hey Eva'
): ComposerStateMeta {
  switch (state) {
    case 'wake':
      return {
        label: `Wake · "${wakePhrase}"`,
        hint: `Always-on ear listening across all tabs — say "${wakePhrase}" anytime, or switch to Sleep Mode`,
        auraClass: 'voice-aura-wake',
        glowOpacity: 'opacity-35',
        ringOpacity: 'opacity-70',
        badgeClass: 'border-sky-500/40 bg-sky-500/12 text-sky-700 dark:border-sky-400/35 dark:text-sky-300',
        iconClass: 'text-sky-600 dark:text-sky-300',
        barClass: 'bg-sky-500 dark:bg-sky-400',
      }
    case 'sleeping':
      return {
        label: 'Sleep Mode · Eva',
        hint: 'Eva is sleeping — ear paused until you click Wake Eva',
        auraClass: 'voice-aura-sleeping',
        glowOpacity: 'opacity-18',
        ringOpacity: 'opacity-35',
        badgeClass: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-700 dark:border-indigo-400/30 dark:text-indigo-300',
        iconClass: 'text-indigo-500 dark:text-indigo-300',
        barClass: 'bg-indigo-400/60 dark:bg-indigo-300/60',
      }
    case 'connecting':
      return {
        label: `Connecting · Eva (${voiceName})`,
        hint: 'Opening microphone and Eva live voice channel…',
        auraClass: 'voice-aura-connecting',
        glowOpacity: 'opacity-45',
        ringOpacity: 'opacity-85',
        badgeClass: 'border-cyan-500/40 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/35 dark:text-cyan-300',
        iconClass: 'text-cyan-600 dark:text-cyan-300',
        barClass: 'bg-cyan-500 dark:bg-cyan-400',
      }
    case 'listening':
      return {
        label: `Listening · Eva (${voiceName})`,
        hint: 'Mic open — speak to Eva or type into the live session',
        auraClass: 'voice-aura-listening',
        glowOpacity: 'opacity-40',
        ringOpacity: 'opacity-80',
        badgeClass: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:border-emerald-400/35 dark:text-emerald-300',
        iconClass: 'text-emerald-600 dark:text-emerald-400',
        barClass: 'bg-emerald-500 dark:bg-emerald-400',
      }
    case 'hearing':
      return {
        label: `Hearing voice · Eva`,
        hint: 'Receiving live speech & streaming transcript…',
        auraClass: 'voice-aura-hearing',
        glowOpacity: 'opacity-65',
        ringOpacity: 'opacity-95',
        badgeClass: 'border-teal-500/45 bg-teal-500/15 text-teal-800 dark:border-teal-400/40 dark:text-teal-200',
        iconClass: 'text-teal-600 dark:text-teal-300',
        barClass: 'bg-teal-500 dark:bg-teal-300',
      }
    case 'thinking':
      return {
        label: 'Eva Thinking',
        hint: 'Eva is reasoning across memory graph, org team & skills…',
        auraClass: 'voice-aura-thinking',
        glowOpacity: 'opacity-55',
        ringOpacity: 'opacity-90',
        badgeClass: 'border-violet-500/45 bg-violet-500/15 text-violet-800 dark:border-violet-400/40 dark:text-violet-200',
        iconClass: 'text-violet-600 dark:text-violet-300',
        barClass: 'bg-violet-500 dark:bg-violet-400',
      }
    case 'executing':
      return {
        label: toolName ? `Running · ${toolName}` : 'Executing task',
        hint: 'Eva & subagents running tools, bots, or hiring team members…',
        auraClass: 'voice-aura-executing',
        glowOpacity: 'opacity-65',
        ringOpacity: 'opacity-95',
        badgeClass: 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:border-amber-400/45 dark:text-amber-200',
        iconClass: 'text-amber-600 dark:text-amber-300',
        barClass: 'bg-amber-500 dark:bg-amber-400',
      }
    case 'speaking':
      return {
        label: `Speaking · Eva (${voiceName})`,
        hint: 'Eva voice reply streaming — speak anytime or click Interrupt',
        auraClass: 'voice-aura-speaking',
        glowOpacity: 'opacity-70',
        ringOpacity: 'opacity-100',
        badgeClass: 'border-pink-500/45 bg-pink-500/15 text-pink-800 dark:border-pink-400/40 dark:text-pink-200',
        iconClass: 'text-pink-600 dark:text-pink-300',
        barClass: 'bg-pink-500 dark:bg-pink-400',
      }
    case 'muted':
      return {
        label: `Muted · ${voiceName}`,
        hint: 'Microphone muted — unmute to speak or type below',
        auraClass: 'voice-aura-muted',
        glowOpacity: 'opacity-30',
        ringOpacity: 'opacity-60',
        badgeClass: 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:text-amber-300',
        iconClass: 'text-amber-600 dark:text-amber-300',
        barClass: 'bg-amber-500/60 dark:bg-amber-400/60',
      }
    case 'error':
      return {
        label: 'Voice error',
        hint: 'Session interrupted — retry connection or continue in text',
        auraClass: 'voice-aura-error',
        glowOpacity: 'opacity-50',
        ringOpacity: 'opacity-85',
        badgeClass: 'border-red-500/45 bg-red-500/12 text-red-700 dark:border-red-400/40 dark:text-red-300',
        iconClass: 'text-red-600 dark:text-red-400',
        barClass: 'bg-red-500 dark:bg-red-400',
      }
    case 'idle':
    default:
      return {
        label: `Standby · Eva (${voiceName})`,
        hint: 'Enter to send · Shift+Enter for new line · Enable "Hey Eva" wake word or click Voice',
        auraClass: 'voice-aura-idle',
        glowOpacity: 'opacity-18 group-focus-within/composer:opacity-40 group-hover/composer:opacity-30',
        ringOpacity: 'opacity-30 group-focus-within/composer:opacity-70 group-hover/composer:opacity-50',
        badgeClass: 'border-border bg-muted/60 text-muted-foreground',
        iconClass: 'text-muted-foreground',
        barClass: 'bg-muted-foreground/60',
      }
  }
}

export function computeDynamicHaloScale(state: VoiceAgentState, micLevel: number): number {
  if (state === 'hearing') {
    return Math.min(1.06, 1 + Math.max(0, micLevel) * 0.08)
  }
  if (state === 'speaking' || state === 'executing') {
    return 1.02
  }
  return 1
}

export function computeEqualizerBarHeight(state: VoiceAgentState, scale: number, micLevel: number): number {
  if (state === 'muted' || state === 'error') return 22
  const level = Math.max(0, Math.min(1, micLevel))
  if (state === 'hearing') {
    return Math.max(22, Math.min(100, Math.round(level * 100 * scale + 20)))
  }
  if (state === 'listening') {
    return Math.max(20, Math.min(85, Math.round(level * 90 * scale + 22)))
  }
  return Math.round(scale * 92)
}
