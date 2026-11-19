export type EyeExpression =
  | 'idle'
  | 'wake'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'happy'
  | 'curious'
  | 'sleeping'
  | 'error'

export type EyeArchetype = 'eva' | 'engineer' | 'researcher' | 'auditor' | 'bot'

export interface EyePalette {
  /** Primary luminous OLED eye color */
  primary: string
  /** Soft halo glow around the eyes */
  glow: string
  /** Visor background */
  visorBg: string
  /** Visor hairline border */
  visorBorder: string
  /** Eye corner radius ratio (0.18 = visor rect, 0.45 = soft mochi pill) */
  roundness: number
  /** Slight base tilt/aspect personality */
  aspectScaleX: number
  aspectScaleY: number
}

export const EYE_ARCHETYPE_PALETTES: Record<EyeArchetype, EyePalette> = {
  eva: {
    primary: '#7dd3fc', // crisp OLED sky-cyan
    glow: 'rgba(56, 189, 248, 0.42)',
    visorBg: '#0b0e14',
    visorBorder: 'rgba(125, 211, 252, 0.28)',
    roundness: 0.44,
    aspectScaleX: 1,
    aspectScaleY: 1,
  },
  engineer: {
    primary: '#34d399', // crisp emerald terminal
    glow: 'rgba(16, 185, 129, 0.38)',
    visorBg: '#09120f',
    visorBorder: 'rgba(52, 211, 153, 0.28)',
    roundness: 0.26,
    aspectScaleX: 1.08,
    aspectScaleY: 0.92,
  },
  researcher: {
    primary: '#a78bfa', // soft violet lens
    glow: 'rgba(167, 139, 250, 0.4)',
    visorBg: '#0e0b16',
    visorBorder: 'rgba(167, 139, 250, 0.28)',
    roundness: 0.48,
    aspectScaleX: 0.96,
    aspectScaleY: 1.08,
  },
  auditor: {
    primary: '#fbbf24', // precision amber scanner
    glow: 'rgba(251, 191, 36, 0.36)',
    visorBg: '#141008',
    visorBorder: 'rgba(251, 191, 36, 0.3)',
    roundness: 0.2,
    aspectScaleX: 1.12,
    aspectScaleY: 0.84,
  },
  bot: {
    primary: '#22d3ee', // focused cyan-teal micro-bot
    glow: 'rgba(34, 211, 238, 0.38)',
    visorBg: '#091114',
    visorBorder: 'rgba(34, 211, 238, 0.28)',
    roundness: 0.34,
    aspectScaleX: 1.02,
    aspectScaleY: 0.96,
  },
}

export const EYE_EXPRESSION_LABELS: Record<EyeExpression, string> = {
  idle: 'Ready',
  wake: 'Awake',
  listening: 'Listening',
  thinking: 'Thinking',
  working: 'Working',
  speaking: 'Speaking',
  happy: 'Approved',
  curious: 'Asking',
  sleeping: 'Sleeping',
  error: 'Alert',
}

export interface DeriveEvaExpressionInput {
  sleepMode?: boolean
  voiceActive?: boolean
  voiceAgentState?: string
  isSpeaking?: boolean
  isThinking?: boolean
  isWorking?: boolean
  hasError?: boolean
  pendingPermissionCount?: number
  transientMood?: string | null
}

const VALID_EXPRESSIONS = new Set<EyeExpression>([
  'idle',
  'wake',
  'listening',
  'thinking',
  'working',
  'speaking',
  'happy',
  'curious',
  'sleeping',
  'error',
])

export function isValidEyeExpression(value: string | null | undefined): value is EyeExpression {
  return Boolean(value && VALID_EXPRESSIONS.has(value as EyeExpression))
}

/**
 * Deterministic priority resolver mapping Eva's live voice, wake ear, mission execution,
 * permission prompts, and transient control-bus moods into one of 10 Mochi/Coucou eye states.
 */
export function deriveEvaEyeExpression(input: DeriveEvaExpressionInput): EyeExpression {
  if (input.hasError || input.voiceAgentState === 'error') return 'error'
  if ((input.pendingPermissionCount ?? 0) > 0) return 'curious'
  if (isValidEyeExpression(input.transientMood)) {
    return input.transientMood
  }
  if (input.sleepMode && !input.voiceActive) return 'sleeping'
  if (input.isSpeaking || input.voiceAgentState === 'speaking') return 'speaking'
  if (input.isWorking || input.voiceAgentState === 'working' || input.voiceAgentState === 'tool') return 'working'
  if (input.isThinking || input.voiceAgentState === 'thinking' || input.voiceAgentState === 'connecting') {
    return 'thinking'
  }
  if (input.voiceActive || input.voiceAgentState === 'listening') return 'listening'
  return 'idle'
}

/**
 * Picks a distinct Mochi/Coucou visual archetype for each AI employee, subagent, or bot
 * based on kind, department, and role keywords.
 */
export function pickEmployeeEyeArchetype(
  kind: string,
  department?: string,
  role?: string,
  name?: string
): EyeArchetype {
  const hay = `${kind} ${department ?? ''} ${role ?? ''} ${name ?? ''}`.toLowerCase()
  if (hay.includes('eva') && hay.includes('lead')) return 'eva'
  if (hay.includes('qa') || hay.includes('audit') || hay.includes('security') || hay.includes('verify')) {
    return 'auditor'
  }
  if (hay.includes('research') || hay.includes('docs') || hay.includes('analyst') || hay.includes('intel')) {
    return 'researcher'
  }
  if (kind === 'bot' || hay.includes('bot') || hay.includes('automation')) {
    return 'bot'
  }
  if (
    hay.includes('engineer') ||
    hay.includes('build') ||
    hay.includes('code') ||
    hay.includes('dev') ||
    hay.includes('architect')
  ) {
    return 'engineer'
  }
  return 'eva'
}

export interface EyeGeometrySpec {
  leftScaleX: number
  leftScaleY: number
  rightScaleX: number
  rightScaleY: number
  offsetX: number
  offsetY: number
  leftTiltDeg: number
  rightTiltDeg: number
  mode: 'normal' | 'happy-arc' | 'sleep-line' | 'error-x' | 'working-visor'
  colorOverride?: string
}

/**
 * Computes per-eye procedural geometry (Mochi / Coucou inspired) for a given expression.
 * `amplitude` (0..1) subtly dilates eyes during listening/speaking.
 */
export function getEyeGeometrySpec(expression: EyeExpression, amplitude = 0): EyeGeometrySpec {
  const amp = Math.max(0, Math.min(1, amplitude))

  switch (expression) {
    case 'wake':
      return {
        leftScaleX: 1.12,
        leftScaleY: 1.18,
        rightScaleX: 1.12,
        rightScaleY: 1.18,
        offsetX: 0,
        offsetY: -1.5,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'normal',
      }
    case 'listening':
      return {
        leftScaleX: 1.06 + amp * 0.14,
        leftScaleY: 1.1 + amp * 0.16,
        rightScaleX: 1.06 + amp * 0.14,
        rightScaleY: 1.1 + amp * 0.16,
        offsetX: 0,
        offsetY: -0.5,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'normal',
        colorOverride: '#34d399',
      }
    case 'speaking':
      return {
        leftScaleX: 1.05 + amp * 0.12,
        leftScaleY: 0.92 + amp * 0.22,
        rightScaleX: 1.05 + amp * 0.12,
        rightScaleY: 0.92 + amp * 0.22,
        offsetX: 0,
        offsetY: -0.5 - amp * 1.2,
        leftTiltDeg: -3,
        rightTiltDeg: 3,
        mode: 'normal',
      }
    case 'thinking':
      return {
        leftScaleX: 0.95,
        leftScaleY: 0.88,
        rightScaleX: 0.95,
        rightScaleY: 0.88,
        offsetX: 3.5,
        offsetY: -3.2,
        leftTiltDeg: -4,
        rightTiltDeg: -4,
        mode: 'normal',
        colorOverride: '#c084fc',
      }
    case 'working':
      return {
        leftScaleX: 1.14,
        leftScaleY: 0.64,
        rightScaleX: 1.14,
        rightScaleY: 0.64,
        offsetX: 0,
        offsetY: 0.5,
        leftTiltDeg: 6,
        rightTiltDeg: -6,
        mode: 'working-visor',
        colorOverride: '#38bdf8',
      }
    case 'happy':
      return {
        leftScaleX: 1.08,
        leftScaleY: 0.9,
        rightScaleX: 1.08,
        rightScaleY: 0.9,
        offsetX: 0,
        offsetY: -0.5,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'happy-arc',
        colorOverride: '#34d399',
      }
    case 'curious':
      return {
        leftScaleX: 1.14,
        leftScaleY: 1.16,
        rightScaleX: 0.88,
        rightScaleY: 0.82,
        offsetX: 1.2,
        offsetY: -1,
        leftTiltDeg: -6,
        rightTiltDeg: 6,
        mode: 'normal',
        colorOverride: '#fbbf24',
      }
    case 'sleeping':
      return {
        leftScaleX: 1.05,
        leftScaleY: 0.16,
        rightScaleX: 1.05,
        rightScaleY: 0.16,
        offsetX: 0,
        offsetY: 2.5,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'sleep-line',
        colorOverride: '#818cf8',
      }
    case 'error':
      return {
        leftScaleX: 1,
        leftScaleY: 1,
        rightScaleX: 1,
        rightScaleY: 1,
        offsetX: 0,
        offsetY: 0,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'error-x',
        colorOverride: '#f87171',
      }
    case 'idle':
    default:
      return {
        leftScaleX: 1,
        leftScaleY: 1,
        rightScaleX: 1,
        rightScaleY: 1,
        offsetX: 0,
        offsetY: 0,
        leftTiltDeg: 0,
        rightTiltDeg: 0,
        mode: 'normal',
      }
  }
}
