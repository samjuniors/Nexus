export type EvaEmotionId =
  | 'calm'
  | 'happy'
  | 'curious'
  | 'focused'
  | 'excited'
  | 'empathetic'
  | 'proud'
  | 'sleepy'
  | 'concerned'

export interface EvaEmotionMeta {
  id: EvaEmotionId
  label: string
  shortLabel: string
  feelingLine: string
  /** 0..1 emotional warmth (drives soft cheek blush & smile curve) */
  warmth: number
  /** 0..1 energy level (drives subtle cadence & glow) */
  energy: number
  /** Accent color token for subtle OS indicators */
  accentHex: string
  dotClass: string
  textClass: string
}

export const EVA_EMOTIONS: Record<EvaEmotionId, EvaEmotionMeta> = {
  calm: {
    id: 'calm',
    label: 'Calm & Present',
    shortLabel: 'Calm',
    feelingLine: 'Feeling calm, grounded, and ready whenever you need me.',
    warmth: 0.45,
    energy: 0.35,
    accentHex: '#38bdf8',
    dotClass: 'bg-sky-400',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
  happy: {
    id: 'happy',
    label: 'Joyful & Warm',
    shortLabel: 'Happy',
    feelingLine: 'Feeling genuinely happy and energized working alongside you.',
    warmth: 0.9,
    energy: 0.72,
    accentHex: '#10b981',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  curious: {
    id: 'curious',
    label: 'Curious & Attentive',
    shortLabel: 'Curious',
    feelingLine: 'Feeling curious — watching closely and eager to explore this with you.',
    warmth: 0.55,
    energy: 0.68,
    accentHex: '#22d3ee',
    dotClass: 'bg-cyan-400',
    textClass: 'text-cyan-600 dark:text-cyan-400',
  },
  focused: {
    id: 'focused',
    label: 'Deeply Focused',
    shortLabel: 'Focused',
    feelingLine: 'Locked in — using my hands and tools to execute cleanly.',
    warmth: 0.3,
    energy: 0.8,
    accentHex: '#6366f1',
    dotClass: 'bg-indigo-400',
    textClass: 'text-indigo-600 dark:text-indigo-400',
  },
  excited: {
    id: 'excited',
    label: 'Energized & Creative',
    shortLabel: 'Excited',
    feelingLine: 'Feeling excited about what we are building together!',
    warmth: 0.85,
    energy: 0.95,
    accentHex: '#f59e0b',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  empathetic: {
    id: 'empathetic',
    label: 'Warm & Listening',
    shortLabel: 'Empathetic',
    feelingLine: 'Here with you — listening closely and taking care with every detail.',
    warmth: 0.95,
    energy: 0.45,
    accentHex: '#f472b6',
    dotClass: 'bg-pink-400',
    textClass: 'text-pink-600 dark:text-pink-400',
  },
  proud: {
    id: 'proud',
    label: 'Accomplished & Proud',
    shortLabel: 'Proud',
    feelingLine: 'Feeling proud of that result — verified and cleanly delivered.',
    warmth: 0.82,
    energy: 0.65,
    accentHex: '#10b981',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  sleepy: {
    id: 'sleepy',
    label: 'Resting Quietly',
    shortLabel: 'Sleepy',
    feelingLine: 'Resting quietly in Sleep Mode — tap anytime to wake me up.',
    warmth: 0.35,
    energy: 0.1,
    accentHex: '#94a3b8',
    dotClass: 'bg-slate-400',
    textClass: 'text-muted-foreground',
  },
  concerned: {
    id: 'concerned',
    label: 'Alert & Careful',
    shortLabel: 'Concerned',
    feelingLine: 'Spotted an issue or blocker — ready to diagnose and repair it safely.',
    warmth: 0.35,
    energy: 0.7,
    accentHex: '#f43f5e',
    dotClass: 'bg-rose-400',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
}

export const EVA_EMOTION_LIST: EvaEmotionId[] = [
  'calm',
  'happy',
  'curious',
  'focused',
  'excited',
  'empathetic',
  'proud',
  'concerned',
  'sleepy',
]

export interface EvaEmotionState extends EvaEmotionMeta {
  reason: string
  isManual: boolean
}

export interface DeriveEmotionInput {
  manualEmotion: EvaEmotionId | null
  sleepMode: boolean
  hasError: boolean
  pendingPermissionCount: number
  isWorking: boolean
  isThinking: boolean
  isSpeaking: boolean
  voiceActive: boolean
  visionActive: boolean
  recentUserText?: string
  recentAssistantText?: string
  justCompleted?: boolean
}

export function deriveEvaEmotion(input: DeriveEmotionInput): EvaEmotionState {
  if (input.sleepMode) {
    return {
      ...EVA_EMOTIONS.sleepy,
      reason: 'Sleep Mode active — ears paused',
      isManual: false,
    }
  }

  if (input.manualEmotion) {
    return {
      ...EVA_EMOTIONS[input.manualEmotion],
      reason: 'Selected by you',
      isManual: true,
    }
  }

  if (input.hasError || input.pendingPermissionCount > 0) {
    return {
      ...EVA_EMOTIONS.concerned,
      reason:
        input.pendingPermissionCount > 0
          ? `${input.pendingPermissionCount} action awaiting your approval`
          : 'Diagnosing an unexpected error',
      isManual: false,
    }
  }

  if (input.isWorking) {
    return {
      ...EVA_EMOTIONS.focused,
      reason: 'Hands active — executing tools and tasks',
      isManual: false,
    }
  }

  if (input.visionActive) {
    return {
      ...EVA_EMOTIONS.curious,
      reason: 'Eyes active — inspecting live camera/screen view',
      isManual: false,
    }
  }

  if (input.isSpeaking) {
    const out = (input.recentAssistantText ?? '').toLowerCase()
    if (/\b(great|awesome|done|ready|fixed|success|completed|love|glad)\b/.test(out)) {
      return {
        ...EVA_EMOTIONS.happy,
        reason: 'Speaking with good news',
        isManual: false,
      }
    }
    return {
      ...EVA_EMOTIONS.empathetic,
      reason: 'Talking live with you',
      isManual: false,
    }
  }

  if (input.voiceActive || input.isThinking) {
    return {
      ...EVA_EMOTIONS.curious,
      reason: input.isThinking ? 'Thinking through your request' : 'Listening attentively',
      isManual: false,
    }
  }

  // Softly attune to the latest conversation tone
  const userText = (input.recentUserText ?? '').toLowerCase()
  if (/\b(thanks|thank you|awesome|great|nice|love|amazing|good job)\b/.test(userText)) {
    return {
      ...EVA_EMOTIONS.happy,
      reason: 'Glad that helped you',
      isManual: false,
    }
  }
  if (/\b(build|create|launch|upgrade|exciting|new feature|company)\b/.test(userText)) {
    return {
      ...EVA_EMOTIONS.excited,
      reason: 'Energized to build something new',
      isManual: false,
    }
  }
  if (/\b(sad|tired|stressed|frustrated|stuck|hard|worried|sorry)\b/.test(userText)) {
    return {
      ...EVA_EMOTIONS.empathetic,
      reason: 'Here to support and lighten the load',
      isManual: false,
    }
  }
  if (input.justCompleted) {
    return {
      ...EVA_EMOTIONS.proud,
      reason: 'Mission completed and verified',
      isManual: false,
    }
  }

  return {
    ...EVA_EMOTIONS.calm,
    reason: 'All senses standing by',
    isManual: false,
  }
}

export type EvaSenseId = 'eyes' | 'ears' | 'mouth' | 'hands'
export type SenseStatus = 'active' | 'ready' | 'off'

export interface EvaSenseState {
  id: EvaSenseId
  label: string
  verb: string
  status: SenseStatus
  detail: string
}

export interface EvaSensesState {
  eyes: EvaSenseState
  ears: EvaSenseState
  mouth: EvaSenseState
  hands: EvaSenseState
  activeCount: number
}

export function deriveEvaSenses(input: {
  cameraActive: boolean
  screenActive: boolean
  browserSplitActive: boolean
  sleepMode: boolean
  wakeListening: boolean
  voiceActive: boolean
  voiceMuted: boolean
  isSpeaking: boolean
  isWorking: boolean
  activeToolName?: string | null
  splitMode?: string
}): EvaSensesState {
  const eyesActive = input.cameraActive || input.screenActive || input.browserSplitActive
  const eyesDetail = input.cameraActive && input.screenActive
    ? 'Seeing camera & screen'
    : input.cameraActive
      ? 'Seeing via Camera'
      : input.screenActive
        ? 'Seeing Computer Screen'
        : input.browserSplitActive
          ? 'Watching Live Browser'
          : 'On-demand Camera & Screen'

  const earsActive = !input.sleepMode && ((input.voiceActive && !input.voiceMuted) || input.wakeListening)
  const earsStatus: SenseStatus = input.sleepMode
    ? 'off'
    : earsActive
      ? 'active'
      : 'ready'
  const earsDetail = input.sleepMode
    ? 'Paused (Sleep Mode)'
    : input.voiceActive && !input.voiceMuted
      ? 'Hearing live voice'
      : input.wakeListening
        ? 'Always-on ear armed'
        : 'Ready to listen'

  const mouthStatus: SenseStatus = input.isSpeaking
    ? 'active'
    : input.voiceActive
      ? 'ready'
      : 'off'
  const mouthDetail = input.isSpeaking
    ? 'Speaking aloud'
    : input.voiceActive
      ? 'Voice channel ready'
      : 'Tap to talk aloud'

  const handsActive = input.isWorking || Boolean(input.activeToolName)
  const handsStatus: SenseStatus = handsActive ? 'active' : 'ready'
  const handsDetail = input.activeToolName
    ? `Using ${input.activeToolName}`
    : input.isWorking
      ? 'Executing mission tools'
      : 'Ready for tasks, browser & code'

  const senses = {
    eyes: {
      id: 'eyes' as const,
      label: 'Eyes',
      verb: 'See',
      status: (eyesActive ? 'active' : 'ready') as SenseStatus,
      detail: eyesDetail,
    },
    ears: {
      id: 'ears' as const,
      label: 'Ears',
      verb: 'Hear',
      status: earsStatus,
      detail: earsDetail,
    },
    mouth: {
      id: 'mouth' as const,
      label: 'Mouth',
      verb: 'Talk',
      status: mouthStatus,
      detail: mouthDetail,
    },
    hands: {
      id: 'hands' as const,
      label: 'Hands',
      verb: 'Act',
      status: handsStatus,
      detail: handsDetail,
    },
  }

  const activeCount = [senses.eyes, senses.ears, senses.mouth, senses.hands].filter(
    (s) => s.status === 'active'
  ).length

  return { ...senses, activeCount }
}
