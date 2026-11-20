import type { RunEventDTO } from '@/lib/agent/client'

export type HandTrackingAction =
  | 'idle'
  | 'file_read'
  | 'file_write'
  | 'terminal_run'
  | 'browser_act'
  | 'org_delegate'
  | 'tool_generic'

export interface HandTrackingMeta {
  action: HandTrackingAction
  label: string
  shortLabel: string
  verb: string
  accentHex: string
}

export const HAND_TRACKING_ACTIONS: Record<HandTrackingAction, HandTrackingMeta> = {
  idle: {
    action: 'idle',
    label: 'Standing by',
    shortLabel: 'Idle',
    verb: 'Resting',
    accentHex: '#94a3b8',
  },
  file_read: {
    action: 'file_read',
    label: 'Inspecting file',
    shortLabel: 'Read',
    verb: 'Scanning',
    accentHex: '#38bdf8',
  },
  file_write: {
    action: 'file_write',
    label: 'Editing file',
    shortLabel: 'Write',
    verb: 'Writing',
    accentHex: '#10b981',
  },
  terminal_run: {
    action: 'terminal_run',
    label: 'Running command',
    shortLabel: 'Run',
    verb: 'Executing',
    accentHex: '#f59e0b',
  },
  browser_act: {
    action: 'browser_act',
    label: 'Operating browser',
    shortLabel: 'Browse',
    verb: 'Navigating',
    accentHex: '#6366f1',
  },
  org_delegate: {
    action: 'org_delegate',
    label: 'Coordinating agents',
    shortLabel: 'Delegate',
    verb: 'Orchestrating',
    accentHex: '#ec4899',
  },
  tool_generic: {
    action: 'tool_generic',
    label: 'Running tool',
    shortLabel: 'Tool',
    verb: 'Operating',
    accentHex: '#22d3ee',
  },
}

export const HAND_TRACKING_PREVIEW_LIST: readonly HandTrackingAction[] = [
  'file_read',
  'file_write',
  'terminal_run',
  'browser_act',
  'org_delegate',
]

export interface HandTrackingState extends HandTrackingMeta {
  active: boolean
  toolName: string | null
  targetLabel: string | null
  isPreview: boolean
}

const FILE_WRITE_RE =
  /(write|patch|edit|create_file|save_file|delete_file|rename_file|rollback|artifact|self_heal_patch|apply_patch|modify|update_file)/i
const FILE_READ_RE =
  /(read_file|self_heal_read|inspect|grep|find_file|list_dir|list_file|search_file|cat|view_file|recall|brain_|memory_|gbrain|truth_audit|context_pack)/i
const TERMINAL_RE =
  /(verify|compile|build|lint|test|exec|shell|bash|terminal|command|npm|tsc|run_script|self_heal_verify)/i
const BROWSER_RE =
  /(browser|mobile_control|android|tap|swipe|phone|click|navigate|open_url|web_search|web_fetch|scrape|screenshot|dom|scroll|type_text|media|youtube)/i
const ORG_RE =
  /(subagent|delegate|paperclip|hire|org|agent|bot|skill|workflow|automation|heartbeat|ticket|company|spawn)/i

export function extractShortFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const leaf = parts[parts.length - 1] ?? trimmed
  return leaf.length > 26 ? `${leaf.slice(0, 23)}…` : leaf
}

/**
 * Deterministically maps a tool slug, event type, or step description into one of
 * the 6 physical hand-tracking choreographies for the companion SVG layer.
 */
export function classifyToolAction(
  toolOrLabel: string | null | undefined,
  extra?: { eventType?: string; filePath?: string | null }
): HandTrackingAction {
  const combined = `${toolOrLabel ?? ''} ${extra?.eventType ?? ''}`.trim()
  if (!combined) return 'idle'

  if (FILE_WRITE_RE.test(combined)) return 'file_write'
  if (FILE_READ_RE.test(combined)) return 'file_read'
  if (TERMINAL_RE.test(combined)) return 'terminal_run'
  if (BROWSER_RE.test(combined)) return 'browser_act'
  if (ORG_RE.test(combined)) return 'org_delegate'
  if (extra?.filePath) return 'file_read'
  return 'tool_generic'
}

export interface DeriveHandTrackingInput {
  previewAction?: HandTrackingAction | null
  activeVoiceTool?: string | { tool?: string | null; args?: Record<string, unknown> } | null
  isRunning?: boolean
  latestRunEvent?: RunEventDTO | null
  selfHealBusy?: boolean
  selfHealStage?: string | null
  browserBusy?: boolean
  activeReasoningTitle?: string | null
}

/**
 * Derives the live physical hand-tracking state for Eva's companion SVG overlay
 * from active voice tools, mission run events, self-heal file operations, and
 * browser automation.
 */
export function deriveLiveHandTracking(input: DeriveHandTrackingInput): HandTrackingState {
  if (input.previewAction && input.previewAction !== 'idle') {
    const meta = HAND_TRACKING_ACTIONS[input.previewAction]
    return {
      ...meta,
      active: true,
      toolName: meta.shortLabel.toLowerCase(),
      targetLabel:
        input.previewAction === 'file_read'
          ? 'engine.ts'
          : input.previewAction === 'file_write'
            ? 'patch.diff'
            : input.previewAction === 'terminal_run'
              ? 'npm run build'
              : input.previewAction === 'browser_act'
                ? 'Live Browser'
                : 'Subagents',
      isPreview: true,
    }
  }

  const activeVoiceToolName =
    typeof input.activeVoiceTool === 'string'
      ? input.activeVoiceTool.trim()
      : typeof input.activeVoiceTool?.tool === 'string'
        ? input.activeVoiceTool.tool.trim()
        : ''

  if (activeVoiceToolName) {
    const action = classifyToolAction(activeVoiceToolName)
    const meta = HAND_TRACKING_ACTIONS[action]
    return {
      ...meta,
      active: action !== 'idle',
      toolName: activeVoiceToolName,
      targetLabel: activeVoiceToolName,
      isPreview: false,
    }
  }

  if (input.selfHealBusy) {
    const action = classifyToolAction(input.selfHealStage ?? 'self_heal_patch')
    const resolvedAction: HandTrackingAction = action === 'idle' ? 'file_write' : action
    const meta = HAND_TRACKING_ACTIONS[resolvedAction]
    return {
      ...meta,
      active: true,
      toolName: input.selfHealStage ?? 'self_heal_patch',
      targetLabel: input.selfHealStage ?? 'Self-Heal patch',
      isPreview: false,
    }
  }

  if (input.browserBusy) {
    const meta = HAND_TRACKING_ACTIONS.browser_act
    return {
      ...meta,
      active: true,
      toolName: 'browser_act',
      targetLabel: 'Live Browser',
      isPreview: false,
    }
  }

  if (input.isRunning && input.latestRunEvent) {
    const d = input.latestRunEvent.data ?? {}
    const toolName =
      (typeof d.tool === 'string' && d.tool) ||
      (typeof d.toolSlug === 'string' && d.toolSlug) ||
      (typeof d.name === 'string' && d.name) ||
      (typeof d.step === 'string' && d.step) ||
      (typeof d.title === 'string' && d.title) ||
      input.latestRunEvent.type

    const filePath =
      extractShortFileName(d.path) ||
      extractShortFileName(d.filePath) ||
      extractShortFileName(d.filename) ||
      extractShortFileName(d.file)

    const action = classifyToolAction(toolName, {
      eventType: input.latestRunEvent.type,
      filePath,
    })
    const meta = HAND_TRACKING_ACTIONS[action]
    return {
      ...meta,
      active: action !== 'idle',
      toolName,
      targetLabel: filePath ?? toolName,
      isPreview: false,
    }
  }

  if (input.isRunning) {
    const action = classifyToolAction(input.activeReasoningTitle ?? 'tool_generic')
    const resolved: HandTrackingAction = action === 'idle' ? 'tool_generic' : action
    const meta = HAND_TRACKING_ACTIONS[resolved]
    return {
      ...meta,
      active: true,
      toolName: input.activeReasoningTitle ?? 'mission_step',
      targetLabel: input.activeReasoningTitle ?? 'Executing step',
      isPreview: false,
    }
  }

  return {
    ...HAND_TRACKING_ACTIONS.idle,
    active: false,
    toolName: null,
    targetLabel: null,
    isPreview: false,
  }
}
