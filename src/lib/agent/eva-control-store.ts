'use client'

import { create } from 'zustand'
import type {
  AutomationSessionSnapshot,
  BrowserFramePayload,
  CursorEventPayload,
  DesktopFramePayload,
  MobileFramePayload,
  PermissionDecision,
  PermissionRequestPayload,
} from '@/lib/agent/control-bus'
import type {
  AllowedDesktopAppDTO,
  AppAllowPolicy,
  ConnectedFolderDTO,
  FolderAccessMode,
} from '@/lib/agent/computer-control-types'
import type {
  CapabilityKey,
  PermissionAuditDTO,
  PermissionGrantDTO,
  PermissionPolicy,
} from '@/lib/agent/permissions'
import type { ConnectedDeviceDTO } from '@/lib/agent/device-bridge'
import type {
  TerminalSessionSnapshot,
  TerminalShellKind,
  TerminalTarget,
} from '@/lib/agent/terminal-types'
import type { VoiceStageCard } from '@/lib/agent/voice-stage-types'
import type { OutfitSelection } from '@/lib/coucou/wardrobe'
import type { ReasoningChain } from '@/lib/agent/reasoning-chain'
import type { BrainTraceEvent } from '@/lib/agent/brain-trace'
import type { BrainContextPack } from '@/lib/agent/brain-context-packs'
import type {
  SelfHealSession,
  SelfHealTrigger,
  SelfHealVerification,
} from '@/lib/agent/self-heal'
import type { GBrainCategoryId } from '@/lib/agent/gbrain-categories'
import type { EvaEmotionId } from '@/lib/agent/eva-emotions'
import type { HandTrackingAction } from '@/lib/agent/hand-tracking'
import {
  persistCaptionStyle,
  readSavedCaptionStyle,
  type CaptionAnimationStyle,
} from '@/lib/agent/caption-animation'
import {
  persistVisualizerStyle,
  readSavedVisualizerStyle,
  type VoiceVisualizerStyle,
} from '@/lib/agent/voice-visualizer'
import {
  persistMobileVoiceFirst,
  readSavedMobileVoiceFirst,
} from '@/lib/agent/responsive-layout'

export interface RuntimeErrorAlert {
  message: string
  stack?: string
  source?: string
  timestamp: string
}

export interface AgentIdentityDTO {
  address: string
  provider: 'mail.tm' | 'custom'
  displayName: string
  createdAt: string
}

export interface AgentInboxMessageDTO {
  id: string
  from: string
  subject: string
  intro: string
  seen: boolean
  createdAt: string
}

export interface AgentInboxDetailDTO {
  id: string
  from: string
  subject: string
  text: string
  createdAt: string
  codes: string[]
  links: string[]
}

export type LayoutMode = 'standard' | 'focus'

export type SplitMode =
  | 'reasoning'
  | 'self_heal'
  | 'browser'
  | 'terminal'
  | 'mobile'
  | 'identity'
  | 'permissions'
  | 'devices'
  | 'org'
  | 'artifacts'
  | 'tools'
  | 'automations'
  | 'brain'
  | 'google_workspace'

export interface ScreenHudCapturedFrame {
  dataUrl: string
  base64: string
  mimeType: string
  name?: string
}

export interface EvaDynamicPopupItem {
  id: string
  title: string
  body: string
  kind: 'info' | 'action' | 'preview'
  actions?: { label: string; tab?: string; splitMode?: string; url?: string }[]
  createdAt: number
}

export interface LiveCursorState {
  visible: boolean
  x: number
  y: number
  selector?: string
  label?: string
  clicking: boolean
  actor: string
  updatedAt: number
}

function readSavedOutfit(): OutfitSelection {
  if (typeof window === 'undefined') return 'auto'
  try {
    const v = window.localStorage.getItem('nexus-coucou-outfit')
    if (v) return v as OutfitSelection
  } catch {
    /* ignore storage errors */
  }
  return 'auto'
}

function readSavedSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem('nexus-sidebar-collapsed') === '1'
  } catch {
    return false
  }
}

function readSavedAutoVoiceFocus(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const v = window.localStorage.getItem('nexus-auto-voice-focus')
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

interface EvaControlState {
  controlConnected: boolean
  layoutMode: LayoutMode
  sidebarCollapsed: boolean
  gbrainGraphOpen: boolean
  splitOpen: boolean
  splitMode: SplitMode
  splitTitle: string | null
  browserFrame: BrowserFramePayload | null
  browserBusy: boolean
  desktopFrame: DesktopFramePayload | null
  automationSession: AutomationSessionSnapshot | null
  terminalSnapshot: TerminalSessionSnapshot | null
  terminalBusy: boolean
  connectedFolders: ConnectedFolderDTO[]
  allowedApps: AllowedDesktopAppDTO[]
  computerControlBusy: boolean
  screenHudOpen: boolean
  screenHudTab: 'screen' | 'dictation'
  screenHudCapturedFrame: ScreenHudCapturedFrame | null
  mobileFrame: MobileFramePayload | null
  mobileBusy: boolean
  cursor: LiveCursorState
  pendingPermissions: PermissionRequestPayload[]
  grants: PermissionGrantDTO[]
  auditLog: PermissionAuditDTO[]
  devices: ConnectedDeviceDTO[]
  onlineDeviceIds: string[]
  popups: EvaDynamicPopupItem[]
  voiceStageCard: VoiceStageCard | null
  transientMood: string | null
  transientMoodNote: string | null
  dockMinimized: boolean
  coucouOutfit: OutfitSelection
  coucouDancing: boolean
  agentIdentity: AgentIdentityDTO | null
  agentInbox: AgentInboxMessageDTO[]
  identityBusy: boolean
  identityError: string | null
  reasoningChains: ReasoningChain[]
  activeReasoningChainId: string | null
  reasoningBusy: boolean
  gbrainInitialPanel: 'none' | 'audit' | 'packs'
  brainTraces: BrainTraceEvent[]
  contextPacks: BrainContextPack[]
  activePackEntityIds: string[]
  activePackNames: string[]
  contextPacksBusy: boolean
  selfHealSessions: SelfHealSession[]
  activeSelfHealId: string | null
  selfHealBusy: boolean
  selfHealVerifyResult: SelfHealVerification | null
  selfHealError: string | null
  runtimeErrorAlert: RuntimeErrorAlert | null
  settingsOpen: boolean
  companionResetSeq: number
  autoVoiceFocus: boolean
  mobileVoiceFirst: boolean
  mobileDrawerOpen: boolean

  setControlConnected: (connected: boolean) => void
  setLayoutMode: (mode: LayoutMode) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
  setSettingsOpen: (open: boolean) => void
  resetCompanionPosition: () => void
  setAutoVoiceFocus: (enabled: boolean) => void
  setMobileVoiceFirst: (enabled: boolean) => void
  setMobileDrawerOpen: (open: boolean) => void
  setGbrainGraphOpen: (open: boolean, initialPanel?: 'none' | 'audit' | 'packs') => void
  openSplit: (mode: SplitMode, title?: string) => void
  closeSplit: () => void
  setBrowserFrame: (frame: BrowserFramePayload | null) => void
  setDesktopFrame: (frame: DesktopFramePayload | null) => void
  setAutomationSession: (session: AutomationSessionSnapshot | null) => void
  setTerminalSnapshot: (snapshot: TerminalSessionSnapshot | null) => void
  refreshTerminal: () => Promise<void>
  runTerminalCommand: (input: {
    command: string
    target?: TerminalTarget | 'auto'
    deviceId?: string | null
    shell?: TerminalShellKind
    cwd?: string
  }) => Promise<{ ok: boolean; exitCode?: number; output?: string; error?: string }>
  setTerminalTarget: (input: {
    target: TerminalTarget
    deviceId?: string | null
    shell?: TerminalShellKind
  }) => Promise<void>
  interruptTerminal: () => Promise<void>
  clearTerminal: () => Promise<void>
  pairWindowsFromTerminal: (deviceName?: string, platform?: 'windows' | 'macos' | 'linux') => Promise<{
    ok: boolean
    device?: ConnectedDeviceDTO
    pairingToken?: string
    powershellCommand?: string
    error?: string
  }>
  setMobileFrame: (frame: MobileFramePayload | null) => void
  openScreenHud: (tab: 'screen' | 'dictation', capturedFrame?: ScreenHudCapturedFrame | null) => void
  closeScreenHud: () => void
  refreshComputerControl: () => Promise<void>
  addConnectedFolder: (input: {
    label: string
    path: string
    platform?: 'windows' | 'macos' | 'linux'
    accessMode?: FolderAccessMode
  }) => Promise<{ ok: boolean; error?: string }>
  updateConnectedFolder: (
    id: string,
    patch: { label?: string; accessMode?: FolderAccessMode; enabled?: boolean }
  ) => Promise<void>
  deleteConnectedFolder: (id: string) => Promise<void>
  addAllowedApp: (input: {
    name: string
    executable: string
    platform?: 'windows' | 'macos' | 'linux'
    policy?: AppAllowPolicy
    category?: AllowedDesktopAppDTO['category']
  }) => Promise<{ ok: boolean; error?: string }>
  updateAllowedApp: (id: string, patch: { policy?: AppAllowPolicy; name?: string }) => Promise<void>
  deleteAllowedApp: (id: string) => Promise<void>
  controlAutomationSession: (
    action: 'pause' | 'resume' | 'takeover' | 'release_takeover' | 'stop'
  ) => Promise<void>
  captureWindowsScreen: (deviceId?: string) => Promise<{
    ok: boolean
    error?: string
    desktopFrame?: DesktopFramePayload | null
  }>
  windowsBridgeAction: (
    bridgeAction: string,
    bridgeArgs?: Record<string, unknown>,
    deviceId?: string
  ) => Promise<{ ok: boolean; output?: string; error?: string }>
  updateCursor: (payload: CursorEventPayload) => void
  hideCursor: () => void
  pushPendingPermission: (req: PermissionRequestPayload) => void
  setPendingPermissions: (reqs: PermissionRequestPayload[]) => void
  removePendingPermission: (requestId: string) => void
  pushPopup: (popup: Omit<EvaDynamicPopupItem, 'createdAt'>) => void
  dismissPopup: (id?: string) => void
  setVoiceStageCard: (card: VoiceStageCard | null) => void
  dismissVoiceStageCard: (id?: string) => void
  toggleVoiceStageCardPinned: () => void
  setTransientMood: (mood: string | null, note?: string | null) => void
  setOnlineDeviceIds: (ids: string[]) => void
  setDockMinimized: (minimized: boolean) => void
  setCoucouOutfit: (outfit: OutfitSelection) => void
  setCoucouDancing: (dancing: boolean) => void
  setReasoningChains: (chains: ReasoningChain[]) => void
  upsertReasoningChain: (chain: ReasoningChain) => void
  selectReasoningChain: (chainId: string | null) => void
  openReasoningForChain: (chainId?: string | null) => void
  refreshReasoningChains: () => Promise<void>
  clearReasoningChains: () => Promise<void>
  setBrainTraces: (traces: BrainTraceEvent[]) => void
  pushBrainTrace: (trace: BrainTraceEvent) => void
  refreshBrainTraces: () => Promise<void>
  clearBrainTraces: () => Promise<void>
  refreshContextPacks: () => Promise<void>
  toggleContextPack: (packId: string, active?: boolean) => Promise<void>
  createContextPack: (input: {
    name: string
    description?: string
    categories?: GBrainCategoryId[]
    entityIds?: string[]
    active?: boolean
  }) => Promise<BrainContextPack | null>
  deleteContextPack: (packId: string) => Promise<void>
  setSelfHealSessions: (sessions: SelfHealSession[]) => void
  upsertSelfHealSession: (session: SelfHealSession) => void
  selectSelfHealSession: (sessionId: string | null) => void
  refreshSelfHealSessions: () => Promise<void>
  runBuildVerify: (testFile?: string) => Promise<SelfHealVerification | null>
  triggerAutoHeal: (input: {
    errorMessage: string
    stack?: string
    viewName?: string
    targetFileHint?: string
    trigger?: SelfHealTrigger
  }) => Promise<{ ok: boolean; error?: string; session?: SelfHealSession }>
  rollbackSelfHeal: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
  setRuntimeErrorAlert: (alert: RuntimeErrorAlert | null) => void
  dismissRuntimeErrorAlert: () => void

  refreshPermissions: () => Promise<void>
  respondPermission: (requestId: string, decision: Exclude<PermissionDecision, 'timeout'>) => Promise<void>
  updateGrantPolicy: (capability: CapabilityKey, policy: PermissionPolicy) => Promise<void>
  refreshDevices: () => Promise<void>
  pairDevice: (name: string, platform: string) => Promise<{ pairingToken: string; device: ConnectedDeviceDTO } | null>
  revokeDevice: (id: string) => Promise<void>
  browserAction: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  mobileAction: (body: Record<string, unknown>) => Promise<{ ok: boolean; summary?: string; error?: string }>
  refreshIdentity: () => Promise<void>
  provisionIdentity: (opts?: { forceNew?: boolean; preferredLocal?: string }) => Promise<AgentIdentityDTO | null>
  saveCustomIdentity: (address: string, displayName?: string) => Promise<AgentIdentityDTO | null>
  readIdentityMessage: (messageId: string) => Promise<AgentInboxDetailDTO | null>
  manualEmotion: EvaEmotionId | null
  setManualEmotion: (emotion: EvaEmotionId | null) => void
  captionsEnabled: boolean
  setCaptionsEnabled: (enabled: boolean) => void
  captionAnimationStyle: CaptionAnimationStyle
  setCaptionAnimationStyle: (style: CaptionAnimationStyle) => void
  voiceVisualizerStyle: VoiceVisualizerStyle
  setVoiceVisualizerStyle: (style: VoiceVisualizerStyle) => void
  previewHandAction: HandTrackingAction | null
  setPreviewHandAction: (action: HandTrackingAction | null) => void
}

export const useEvaControl = create<EvaControlState>((set, get) => ({
  controlConnected: false,
  layoutMode: 'standard',
  sidebarCollapsed: readSavedSidebarCollapsed(),
  gbrainGraphOpen: false,
  splitOpen: false,
  splitMode: 'browser',
  splitTitle: null,
  browserFrame: null,
  browserBusy: false,
  desktopFrame: null,
  automationSession: null,
  terminalSnapshot: null,
  terminalBusy: false,
  connectedFolders: [],
  allowedApps: [],
  computerControlBusy: false,
  screenHudOpen: false,
  screenHudTab: 'screen',
  screenHudCapturedFrame: null,
  mobileFrame: null,
  mobileBusy: false,
  cursor: {
    visible: false,
    x: 420,
    y: 260,
    clicking: false,
    actor: 'Eva',
    updatedAt: 0,
  },
  pendingPermissions: [],
  grants: [],
  auditLog: [],
  devices: [],
  onlineDeviceIds: [],
  popups: [],
  voiceStageCard: null,
  transientMood: null,
  transientMoodNote: null,
  dockMinimized: false,
  coucouOutfit: readSavedOutfit(),
  coucouDancing: false,
  agentIdentity: null,
  agentInbox: [],
  identityBusy: false,
  identityError: null,
  reasoningChains: [],
  activeReasoningChainId: null,
  reasoningBusy: false,
  gbrainInitialPanel: 'none',
  brainTraces: [],
  contextPacks: [],
  activePackEntityIds: [],
  activePackNames: [],
  contextPacksBusy: false,
  selfHealSessions: [],
  activeSelfHealId: null,
  selfHealBusy: false,
  selfHealVerifyResult: null,
  selfHealError: null,
  runtimeErrorAlert: null,
  settingsOpen: false,
  companionResetSeq: 0,
  autoVoiceFocus: readSavedAutoVoiceFocus(),
  mobileVoiceFirst: readSavedMobileVoiceFirst(),
  mobileDrawerOpen: false,
  manualEmotion: null,
  captionsEnabled: true,

  setControlConnected: (connected) => set({ controlConnected: connected }),

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setSidebarCollapsed: (collapsed) => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('nexus-sidebar-collapsed', collapsed ? '1' : '0')
      }
    } catch {
      /* ignore */
    }
    set({ sidebarCollapsed: collapsed })
  },

  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed
    get().setSidebarCollapsed(next)
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  resetCompanionPosition: () => set((s) => ({ companionResetSeq: s.companionResetSeq + 1 })),

  setAutoVoiceFocus: (enabled) => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('nexus-auto-voice-focus', enabled ? '1' : '0')
      }
    } catch {
      /* ignore */
    }
    set({ autoVoiceFocus: enabled })
  },

  setMobileVoiceFirst: (enabled) => {
    persistMobileVoiceFirst(enabled)
    set({ mobileVoiceFirst: enabled })
  },

  setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),

  setManualEmotion: (emotion) => set({ manualEmotion: emotion }),

  setCaptionsEnabled: (enabled) => set({ captionsEnabled: enabled }),

  setGbrainGraphOpen: (open, initialPanel) =>
    set({
      gbrainGraphOpen: open,
      gbrainInitialPanel: open ? (initialPanel ?? 'none') : 'none',
    }),

  openSplit: (mode, title) =>
    set({
      splitOpen: true,
      splitMode: mode,
      splitTitle: title ?? null,
    }),

  closeSplit: () => set({ splitOpen: false }),

  setBrowserFrame: (frame) => set({ browserFrame: frame && frame.active ? frame : null }),

  setDesktopFrame: (frame) => set({ desktopFrame: frame && frame.active ? frame : null }),

  setAutomationSession: (session) => set({ automationSession: session }),

  setTerminalSnapshot: (snapshot) => set({ terminalSnapshot: snapshot }),

  refreshTerminal: async () => {
    try {
      const res = await fetch('/api/terminal', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSessionSnapshot }
      if (data.ok && data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
    } catch {
      /* ignore transient fetch errors */
    }
  },

  runTerminalCommand: async (input) => {
    set({ terminalBusy: true })
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'exec', ...input }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        exitCode?: number
        output?: string
        error?: string
        snapshot?: TerminalSessionSnapshot
      }
      if (data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
      return {
        ok: Boolean(data.ok),
        exitCode: data.exitCode,
        output: data.output,
        error: data.error,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ terminalBusy: false })
    }
  },

  setTerminalTarget: async (input) => {
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_target', ...input }),
      })
      const data = (await res.json()) as { ok?: boolean; snapshot?: TerminalSessionSnapshot }
      if (data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
    } catch {
      /* ignore */
    }
  },

  interruptTerminal: async () => {
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'interrupt' }),
      })
      const data = (await res.json()) as { snapshot?: TerminalSessionSnapshot }
      if (data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
    } catch {
      /* ignore */
    }
  },

  clearTerminal: async () => {
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      })
      const data = (await res.json()) as { snapshot?: TerminalSessionSnapshot }
      if (data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
    } catch {
      /* ignore */
    }
  },

  pairWindowsFromTerminal: async (deviceName = 'Windows PC', platform = 'windows') => {
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pair_windows', deviceName, platform }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        device?: ConnectedDeviceDTO
        pairingToken?: string
        powershellCommand?: string
        snapshot?: TerminalSessionSnapshot
        error?: string
      }
      if (data.snapshot) {
        set({ terminalSnapshot: data.snapshot })
      }
      if (data.ok) {
        void get().refreshDevices()
      }
      return {
        ok: Boolean(data.ok),
        device: data.device,
        pairingToken: data.pairingToken,
        powershellCommand: data.powershellCommand,
        error: data.error,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  setMobileFrame: (frame) => set({ mobileFrame: frame && frame.active ? frame : null }),

  openScreenHud: (tab, capturedFrame) =>
    set((s) => ({
      screenHudOpen: true,
      screenHudTab: tab,
      screenHudCapturedFrame: capturedFrame !== undefined ? capturedFrame : s.screenHudCapturedFrame,
    })),

  closeScreenHud: () => set({ screenHudOpen: false }),

  refreshComputerControl: async () => {
    try {
      const res = await fetch('/api/computer-control', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        folders?: ConnectedFolderDTO[]
        apps?: AllowedDesktopAppDTO[]
        session?: AutomationSessionSnapshot | null
        desktopFrame?: DesktopFramePayload | null
        browserFrame?: BrowserFramePayload | null
      }
      set((s) => ({
        connectedFolders: Array.isArray(data.folders) ? data.folders : s.connectedFolders,
        allowedApps: Array.isArray(data.apps) ? data.apps : s.allowedApps,
        automationSession: data.session ?? s.automationSession,
        desktopFrame: data.desktopFrame && data.desktopFrame.active ? data.desktopFrame : s.desktopFrame,
        browserFrame: data.browserFrame && data.browserFrame.active ? data.browserFrame : s.browserFrame,
      }))
    } catch {
      /* ignore transient fetch errors */
    }
  },

  addConnectedFolder: async (input) => {
    set({ computerControlBusy: true })
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_folder', ...input }),
      })
      const data = (await res.json()) as { ok?: boolean; folders?: ConnectedFolderDTO[]; error?: string }
      if (data.ok && Array.isArray(data.folders)) {
        set({ connectedFolders: data.folders })
        return { ok: true }
      }
      return { ok: false, error: data.error || 'Failed to add folder' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ computerControlBusy: false })
    }
  },

  updateConnectedFolder: async (id, patch) => {
    set((s) => ({
      connectedFolders: s.connectedFolders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_folder', id, ...patch }),
      })
      const data = (await res.json()) as { ok?: boolean; folders?: ConnectedFolderDTO[] }
      if (data.ok && Array.isArray(data.folders)) {
        set({ connectedFolders: data.folders })
      }
    } catch {
      void get().refreshComputerControl()
    }
  },

  deleteConnectedFolder: async (id) => {
    set((s) => ({
      connectedFolders: s.connectedFolders.filter((f) => f.id !== id),
    }))
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', id }),
      })
      const data = (await res.json()) as { ok?: boolean; folders?: ConnectedFolderDTO[] }
      if (data.ok && Array.isArray(data.folders)) {
        set({ connectedFolders: data.folders })
      }
    } catch {
      void get().refreshComputerControl()
    }
  },

  addAllowedApp: async (input) => {
    set({ computerControlBusy: true })
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_app', ...input }),
      })
      const data = (await res.json()) as { ok?: boolean; apps?: AllowedDesktopAppDTO[]; error?: string }
      if (data.ok && Array.isArray(data.apps)) {
        set({ allowedApps: data.apps })
        return { ok: true }
      }
      return { ok: false, error: data.error || 'Failed to add app' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ computerControlBusy: false })
    }
  },

  updateAllowedApp: async (id, patch) => {
    set((s) => ({
      allowedApps: s.allowedApps.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }))
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_app', id, ...patch }),
      })
      const data = (await res.json()) as { ok?: boolean; apps?: AllowedDesktopAppDTO[] }
      if (data.ok && Array.isArray(data.apps)) {
        set({ allowedApps: data.apps })
      }
    } catch {
      void get().refreshComputerControl()
    }
  },

  deleteAllowedApp: async (id) => {
    set((s) => ({
      allowedApps: s.allowedApps.filter((a) => a.id !== id),
    }))
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_app', id }),
      })
      const data = (await res.json()) as { ok?: boolean; apps?: AllowedDesktopAppDTO[] }
      if (data.ok && Array.isArray(data.apps)) {
        set({ allowedApps: data.apps })
      }
    } catch {
      void get().refreshComputerControl()
    }
  },

  controlAutomationSession: async (action) => {
    set({ computerControlBusy: true })
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json()) as { ok?: boolean; session?: AutomationSessionSnapshot }
      if (data.ok && data.session) {
        set({ automationSession: data.session })
      }
    } catch {
      /* ignore */
    } finally {
      set({ computerControlBusy: false })
    }
  },

  captureWindowsScreen: async (deviceId) => {
    set({ computerControlBusy: true })
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'capture_windows_screen', deviceId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        desktopFrame?: DesktopFramePayload | null
      }
      if (data.desktopFrame && data.desktopFrame.active) {
        set({ desktopFrame: data.desktopFrame })
      }
      return { ok: Boolean(data.ok), error: data.error, desktopFrame: data.desktopFrame }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ computerControlBusy: false })
    }
  },

  windowsBridgeAction: async (bridgeAction, bridgeArgs = {}, deviceId) => {
    set({ computerControlBusy: true })
    try {
      const res = await fetch('/api/computer-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'windows_action', bridgeAction, bridgeArgs, deviceId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        output?: string
        error?: string
        desktopFrame?: DesktopFramePayload | null
      }
      if (data.desktopFrame && data.desktopFrame.active) {
        set({ desktopFrame: data.desktopFrame })
      }
      return { ok: Boolean(data.ok), output: data.output, error: data.error }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ computerControlBusy: false })
    }
  },

  updateCursor: (payload) =>
    set((s) => ({
      cursor: {
        visible: payload.visible,
        x: typeof payload.x === 'number' ? payload.x : s.cursor.x,
        y: typeof payload.y === 'number' ? payload.y : s.cursor.y,
        selector: payload.selector,
        label: payload.label ?? s.cursor.label,
        clicking: Boolean(payload.clicking),
        actor: payload.actor || 'Eva',
        updatedAt: Date.now(),
      },
    })),

  hideCursor: () =>
    set((s) => ({
      cursor: { ...s.cursor, visible: false, clicking: false },
    })),

  pushPendingPermission: (req) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.some((p) => p.requestId === req.requestId)
        ? s.pendingPermissions
        : [...s.pendingPermissions, req],
    })),

  setPendingPermissions: (reqs) => set({ pendingPermissions: reqs }),

  removePendingPermission: (requestId) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter((p) => p.requestId !== requestId),
    })),

  pushPopup: (popup) =>
    set((s) => ({
      popups: [
        ...s.popups.filter((p) => p.id !== popup.id),
        { ...popup, createdAt: Date.now() },
      ].slice(-4),
    })),

  dismissPopup: (id) =>
    set((s) => ({
      popups: id ? s.popups.filter((p) => p.id !== id) : [],
    })),

  setVoiceStageCard: (card) => set({ voiceStageCard: card }),

  dismissVoiceStageCard: (id) =>
    set((s) => {
      if (!s.voiceStageCard) return s
      if (id && s.voiceStageCard.id !== id) return s
      return { voiceStageCard: null }
    }),

  toggleVoiceStageCardPinned: () =>
    set((s) => {
      if (!s.voiceStageCard) return s
      return {
        voiceStageCard: {
          ...s.voiceStageCard,
          pinned: !s.voiceStageCard.pinned,
        },
      }
    }),

  setTransientMood: (mood, note) =>
    set({
      transientMood: mood,
      transientMoodNote: note ?? null,
    }),

  setOnlineDeviceIds: (ids) =>
    set((s) => {
      const online = new Set(ids)
      return {
        onlineDeviceIds: ids,
        devices: s.devices.map((d) => ({
          ...d,
          status: online.has(d.id) ? 'online' : 'offline',
        })),
      }
    }),

  setDockMinimized: (minimized) => set({ dockMinimized: minimized }),

  refreshPermissions: async () => {
    try {
      const res = await fetch('/api/permissions', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        ok?: boolean
        grants?: PermissionGrantDTO[]
        audit?: PermissionAuditDTO[]
        pending?: PermissionRequestPayload[]
      }
      if (data.ok) {
        set({
          grants: data.grants ?? [],
          auditLog: data.audit ?? [],
          ...(Array.isArray(data.pending) ? { pendingPermissions: data.pending } : {}),
        })
      }
    } catch {
      /* ignore transient fetch errors */
    }
  },

  respondPermission: async (requestId, decision) => {
    // Optimistically remove from active queue
    get().removePendingPermission(requestId)
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respond', requestId, decision }),
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        grants?: PermissionGrantDTO[]
        audit?: PermissionAuditDTO[]
      }
      if (data.grants || data.audit) {
        set({
          ...(data.grants ? { grants: data.grants } : {}),
          ...(data.audit ? { auditLog: data.audit } : {}),
        })
      }
    } catch {
      /* ignore */
    }
  },

  updateGrantPolicy: async (capability, policy) => {
    // Optimistic update
    set((s) => ({
      grants: s.grants.map((g) => (g.capability === capability ? { ...g, policy } : g)),
    }))
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability, policy }),
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        grants?: PermissionGrantDTO[]
        audit?: PermissionAuditDTO[]
      }
      if (data.grants || data.audit) {
        set({
          ...(data.grants ? { grants: data.grants } : {}),
          ...(data.audit ? { auditLog: data.audit } : {}),
        })
      }
    } catch {
      void get().refreshPermissions()
    }
  },

  refreshDevices: async () => {
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; devices?: ConnectedDeviceDTO[] }
      if (data.ok && Array.isArray(data.devices)) {
        set({
          devices: data.devices,
          onlineDeviceIds: data.devices.filter((d) => d.status === 'online').map((d) => d.id),
        })
      }
    } catch {
      /* ignore */
    }
  },

  pairDevice: async (name, platform) => {
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, platform }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as {
        ok?: boolean
        device?: ConnectedDeviceDTO
        pairingToken?: string
        devices?: ConnectedDeviceDTO[]
      }
      if (data.ok && data.device && data.pairingToken) {
        set({ devices: data.devices ?? get().devices })
        return { device: data.device, pairingToken: data.pairingToken }
      }
      return null
    } catch {
      return null
    }
  },

  revokeDevice: async (id) => {
    try {
      const res = await fetch(`/api/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; devices?: ConnectedDeviceDTO[] }
      if (data.ok && Array.isArray(data.devices)) {
        set({ devices: data.devices })
      }
    } catch {
      /* ignore */
    }
  },

  browserAction: async (body) => {
    set({ browserBusy: true })
    try {
      const res = await fetch('/api/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        frame?: BrowserFramePayload | null
      }
      if ('frame' in data) {
        set({ browserFrame: data.frame && data.frame.active ? data.frame : null })
      }
      return { ok: Boolean(data.ok), error: data.error }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ browserBusy: false })
    }
  },

  mobileAction: async (body) => {
    set({ mobileBusy: true })
    try {
      const res = await fetch('/api/mobile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as {
        ok?: boolean
        summary?: string
        error?: string
        frame?: MobileFramePayload | null
      }
      if ('frame' in data) {
        set({ mobileFrame: data.frame && data.frame.active ? data.frame : null })
      }
      return { ok: Boolean(data.ok), summary: data.summary, error: data.error }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      set({ mobileBusy: false })
    }
  },

  setCoucouOutfit: (outfit) => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('nexus-coucou-outfit', outfit)
      }
    } catch {
      /* ignore storage errors */
    }
    set({ coucouOutfit: outfit })
  },

  setCoucouDancing: (dancing) => set({ coucouDancing: dancing }),

  refreshIdentity: async () => {
    set({ identityBusy: true, identityError: null })
    try {
      const res = await fetch('/api/identity', { cache: 'no-store' })
      const data = (await res.json()) as {
        ok?: boolean
        identity?: AgentIdentityDTO | null
        messages?: AgentInboxMessageDTO[]
        error?: string
      }
      if (data.ok) {
        set({
          agentIdentity: data.identity ?? null,
          agentInbox: Array.isArray(data.messages) ? data.messages : [],
          identityError: null,
        })
      } else {
        set({ identityError: data.error ?? 'Failed to load Eva identity' })
      }
    } catch (e) {
      set({ identityError: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ identityBusy: false })
    }
  },

  provisionIdentity: async (opts) => {
    set({ identityBusy: true, identityError: null })
    try {
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: opts?.forceNew ? 'reset' : 'provision',
          preferredLocal: opts?.preferredLocal,
          forceNew: Boolean(opts?.forceNew),
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        identity?: AgentIdentityDTO | null
        error?: string
      }
      if (data.ok && data.identity) {
        set({ agentIdentity: data.identity, agentInbox: [], identityError: null })
        return data.identity
      }
      set({ identityError: data.error ?? 'Failed to provision autonomous email' })
      return null
    } catch (e) {
      set({ identityError: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      set({ identityBusy: false })
    }
  },

  saveCustomIdentity: async (address, displayName) => {
    set({ identityBusy: true, identityError: null })
    try {
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'custom', address, displayName }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        identity?: AgentIdentityDTO | null
        error?: string
      }
      if (data.ok && data.identity) {
        set({ agentIdentity: data.identity, agentInbox: [], identityError: null })
        return data.identity
      }
      set({ identityError: data.error ?? 'Failed to save custom email' })
      return null
    } catch (e) {
      set({ identityError: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      set({ identityBusy: false })
    }
  },

  readIdentityMessage: async (messageId) => {
    try {
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', messageId }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: AgentInboxDetailDTO }
      return data.ok && data.message ? data.message : null
    } catch {
      return null
    }
  },

  setReasoningChains: (chains) =>
    set((s) => ({
      reasoningChains: chains,
      activeReasoningChainId:
        s.activeReasoningChainId && chains.some((c) => c.id === s.activeReasoningChainId)
          ? s.activeReasoningChainId
          : (chains[0]?.id ?? null),
    })),

  upsertReasoningChain: (chain) =>
    set((s) => {
      const existing = s.reasoningChains.filter((c) => c.id !== chain.id)
      const next = [chain, ...existing].slice(0, 40)
      return {
        reasoningChains: next,
        activeReasoningChainId:
          chain.status === 'active' || !s.activeReasoningChainId ? chain.id : s.activeReasoningChainId,
      }
    }),

  selectReasoningChain: (chainId) => set({ activeReasoningChainId: chainId }),

  openReasoningForChain: (chainId) =>
    set((s) => ({
      splitOpen: true,
      splitMode: 'reasoning',
      splitTitle: 'Reasoning Chain',
      activeReasoningChainId: chainId ?? s.activeReasoningChainId ?? s.reasoningChains[0]?.id ?? null,
    })),

  refreshReasoningChains: async () => {
    set({ reasoningBusy: true })
    try {
      const res = await fetch('/api/reasoning?limit=25', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; chains?: ReasoningChain[] }
      if (data.ok && Array.isArray(data.chains)) {
        get().setReasoningChains(data.chains)
      }
    } catch {
      /* ignore transient fetch errors */
    } finally {
      set({ reasoningBusy: false })
    }
  },

  clearReasoningChains: async () => {
    set({ reasoningBusy: true })
    try {
      await fetch('/api/reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      })
      set({ reasoningChains: [], activeReasoningChainId: null })
    } catch {
      /* ignore */
    } finally {
      set({ reasoningBusy: false })
    }
  },

  setBrainTraces: (traces) => set({ brainTraces: traces.slice(0, 40) }),

  pushBrainTrace: (trace) =>
    set((s) => ({
      brainTraces: [trace, ...s.brainTraces.filter((t) => t.id !== trace.id)].slice(0, 40),
    })),

  refreshBrainTraces: async () => {
    try {
      const res = await fetch('/api/brain/trace?limit=25', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; traces?: BrainTraceEvent[] }
      if (data.ok && Array.isArray(data.traces)) {
        set({ brainTraces: data.traces })
      }
    } catch {
      /* ignore */
    }
  },

  clearBrainTraces: async () => {
    try {
      await fetch('/api/brain/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      })
      set({ brainTraces: [] })
    } catch {
      /* ignore */
    }
  },

  refreshContextPacks: async () => {
    set({ contextPacksBusy: true })
    try {
      const res = await fetch('/api/brain/context-packs', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        ok?: boolean
        packs?: BrainContextPack[]
        activeSummary?: {
          activePackNames?: string[]
          entityIds?: string[]
        }
      }
      if (data.ok && Array.isArray(data.packs)) {
        set({
          contextPacks: data.packs,
          activePackEntityIds: data.activeSummary?.entityIds ?? [],
          activePackNames: data.activeSummary?.activePackNames ?? [],
        })
      }
    } catch {
      /* ignore */
    } finally {
      set({ contextPacksBusy: false })
    }
  },

  toggleContextPack: async (packId, active) => {
    set({ contextPacksBusy: true })
    try {
      const res = await fetch('/api/brain/context-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', packId, active }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        packs?: BrainContextPack[]
        activeSummary?: {
          activePackNames?: string[]
          entityIds?: string[]
        }
      }
      if (data.ok && Array.isArray(data.packs)) {
        set({
          contextPacks: data.packs,
          activePackEntityIds: data.activeSummary?.entityIds ?? [],
          activePackNames: data.activeSummary?.activePackNames ?? [],
        })
      }
    } catch {
      /* ignore */
    } finally {
      set({ contextPacksBusy: false })
    }
  },

  createContextPack: async (input) => {
    set({ contextPacksBusy: true })
    try {
      const res = await fetch('/api/brain/context-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...input }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        pack?: BrainContextPack
        packs?: BrainContextPack[]
        activeSummary?: {
          activePackNames?: string[]
          entityIds?: string[]
        }
      }
      if (data.ok && Array.isArray(data.packs)) {
        set({
          contextPacks: data.packs,
          activePackEntityIds: data.activeSummary?.entityIds ?? [],
          activePackNames: data.activeSummary?.activePackNames ?? [],
        })
        return data.pack ?? null
      }
      return null
    } catch {
      return null
    } finally {
      set({ contextPacksBusy: false })
    }
  },

  deleteContextPack: async (packId) => {
    set({ contextPacksBusy: true })
    try {
      const res = await fetch('/api/brain/context-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', packId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        packs?: BrainContextPack[]
        activeSummary?: {
          activePackNames?: string[]
          entityIds?: string[]
        }
      }
      if (data.ok && Array.isArray(data.packs)) {
        set({
          contextPacks: data.packs,
          activePackEntityIds: data.activeSummary?.entityIds ?? [],
          activePackNames: data.activeSummary?.activePackNames ?? [],
        })
      }
    } catch {
      /* ignore */
    } finally {
      set({ contextPacksBusy: false })
    }
  },

  setSelfHealSessions: (sessions) =>
    set((s) => ({
      selfHealSessions: sessions,
      activeSelfHealId:
        s.activeSelfHealId && sessions.some((x) => x.id === s.activeSelfHealId)
          ? s.activeSelfHealId
          : (sessions[0]?.id ?? null),
    })),

  upsertSelfHealSession: (session) =>
    set((s) => {
      const rest = s.selfHealSessions.filter((x) => x.id !== session.id)
      const next = [session, ...rest].slice(0, 30)
      return {
        selfHealSessions: next,
        activeSelfHealId:
          session.status === 'diagnosing' ||
          session.status === 'patching' ||
          session.status === 'verifying' ||
          !s.activeSelfHealId
            ? session.id
            : s.activeSelfHealId,
      }
    }),

  selectSelfHealSession: (sessionId) => set({ activeSelfHealId: sessionId }),

  refreshSelfHealSessions: async () => {
    try {
      const res = await fetch('/api/self-heal?limit=20', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { ok?: boolean; sessions?: SelfHealSession[] }
      if (data.ok && Array.isArray(data.sessions)) {
        get().setSelfHealSessions(data.sessions)
      }
    } catch {
      /* ignore */
    }
  },

  runBuildVerify: async (testFile) => {
    set({ selfHealBusy: true, selfHealError: null })
    try {
      const res = await fetch('/api/self-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', testFile }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        verification?: SelfHealVerification
        error?: string
      }
      if (data.verification) {
        set({ selfHealVerifyResult: data.verification, selfHealError: null })
        return data.verification
      }
      set({ selfHealError: data.error ?? 'Build verification failed' })
      return null
    } catch (e) {
      set({ selfHealError: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      set({ selfHealBusy: false })
    }
  },

  triggerAutoHeal: async (input) => {
    set({
      selfHealBusy: true,
      selfHealError: null,
      splitOpen: true,
      splitMode: 'self_heal',
      splitTitle: 'Self-Heal Studio',
      runtimeErrorAlert: null,
    })
    try {
      const res = await fetch('/api/self-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auto_heal',
          trigger: input.trigger ?? 'user_request',
          errorMessage: input.errorMessage,
          stack: input.stack,
          viewName: input.viewName,
          targetFileHint: input.targetFileHint,
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        message?: string
        session?: SelfHealSession
        verification?: SelfHealVerification
      }
      if (data.verification) {
        set({ selfHealVerifyResult: data.verification })
      }
      if (data.session) {
        get().upsertSelfHealSession(data.session)
        set({ activeSelfHealId: data.session.id })
        if (data.session.verification) {
          set({ selfHealVerifyResult: data.session.verification })
        }
      }
      const errText = data.error ?? (!data.ok ? data.message : undefined)
      if (!data.ok && errText) {
        set({ selfHealError: errText })
      }
      void get().refreshSelfHealSessions()
      return { ok: Boolean(data.ok), error: errText, session: data.session }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ selfHealError: msg })
      return { ok: false, error: msg }
    } finally {
      set({ selfHealBusy: false })
    }
  },

  rollbackSelfHeal: async (sessionId) => {
    set({ selfHealBusy: true, selfHealError: null })
    try {
      const res = await fetch('/api/self-heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', sessionId }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        session?: SelfHealSession
      }
      if (data.session) {
        get().upsertSelfHealSession(data.session)
      }
      if (!data.ok && data.error) {
        set({ selfHealError: data.error })
      }
      return { ok: Boolean(data.ok), error: data.error }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ selfHealError: msg })
      return { ok: false, error: msg }
    } finally {
      set({ selfHealBusy: false })
    }
  },

  setRuntimeErrorAlert: (alert) => set({ runtimeErrorAlert: alert }),
  dismissRuntimeErrorAlert: () => set({ runtimeErrorAlert: null }),
  previewHandAction: null,
  setPreviewHandAction: (action) =>
    set((s) => ({ previewHandAction: s.previewHandAction === action ? null : action })),
  captionAnimationStyle: readSavedCaptionStyle(),
  setCaptionAnimationStyle: (style) => {
    persistCaptionStyle(style)
    set({ captionAnimationStyle: style })
  },
  voiceVisualizerStyle: readSavedVisualizerStyle(),
  setVoiceVisualizerStyle: (style) => {
    persistVisualizerStyle(style)
    set({ voiceVisualizerStyle: style })
  },
}))
