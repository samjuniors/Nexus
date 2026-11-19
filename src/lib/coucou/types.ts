import type { EyeArchetype, EyeExpression } from '@/lib/agent/mochi-eyes'
import type { OutfitSelection } from './wardrobe'

export type BotStateName =
  | 'idle'
  | 'working'
  | 'thinking'
  | 'searching'
  | 'approval'
  | 'question'
  | 'error'
  | 'finished'
  | 'ratelimit'
  | 'sleeping'
  | 'dizzy'

export type BotEmoteName =
  | 'love'
  | 'surprised'
  | 'proud'
  | 'wink'
  | 'yawn'
  | 'happy'
  | 'annoyed'

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case 'working':
      return '#3B9EFF'
    case 'thinking':
      return '#A78BFA'
    case 'searching':
      return '#6366F1'
    case 'approval':
      return '#F5A524'
    case 'error':
      return '#F4505E'
    case 'finished':
      return '#34D399'
    case 'ratelimit':
      return '#F59E0B'
    default:
      return '#FFFFFF'
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case 'idle':
    case 'sleeping':
      return 0.15
    case 'dizzy':
      return 0
    default:
      return 0.65
  }
}

export const COUCOU_STATE_LABELS: Record<BotStateName, string> = {
  idle: 'Ready',
  working: 'Working',
  thinking: 'Thinking',
  searching: 'Searching',
  approval: 'Needs Approval',
  question: 'Listening',
  error: 'Alert',
  finished: 'Done',
  ratelimit: 'Rate Limit',
  sleeping: 'Sleeping',
  dizzy: 'Dizzy',
}

/**
 * Maps NEXUS Eva expression states directly into authentic Coucou BotEngine states.
 */
export function mapEvaExpressionToCoucouState(expr: EyeExpression): BotStateName {
  switch (expr) {
    case 'working':
      return 'working'
    case 'thinking':
      return 'thinking'
    case 'listening':
      return 'question'
    case 'speaking':
      return 'finished'
    case 'curious':
      return 'approval'
    case 'happy':
      return 'finished'
    case 'wake':
      return 'idle'
    case 'sleeping':
      return 'sleeping'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'idle'
  }
}

export interface CoucouAgentPreset {
  archetype: EyeArchetype
  bodyColor: string
  defaultOutfit: OutfitSelection
}

export const COUCOU_ARCHETYPE_PRESETS: Record<EyeArchetype, CoucouAgentPreset> = {
  eva: {
    archetype: 'eva',
    bodyColor: '#EEF2FF', // classic warm alabaster Coucou Mochi
    defaultOutfit: 'auto',
  },
  engineer: {
    archetype: 'engineer',
    bodyColor: '#34D399', // emerald builder bot
    defaultOutfit: 'roundGlasses',
  },
  researcher: {
    archetype: 'researcher',
    bodyColor: '#A78BFA', // violet research bot
    defaultOutfit: 'beanie',
  },
  auditor: {
    archetype: 'auditor',
    bodyColor: '#F5A524', // amber QA & security verifier
    defaultOutfit: 'sunglasses',
  },
  bot: {
    archetype: 'bot',
    bodyColor: '#38BDF8', // sky-cyan automation mini-bot
    defaultOutfit: 'none',
  },
}

export function getCoucouPreset(archetype: EyeArchetype): CoucouAgentPreset {
  return COUCOU_ARCHETYPE_PRESETS[archetype] ?? COUCOU_ARCHETYPE_PRESETS.eva
}
