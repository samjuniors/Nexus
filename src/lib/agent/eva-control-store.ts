'use client'

import { create } from 'zustand'
import type {
  BrowserFramePayload,
  CursorEventPayload,
  PermissionDecision,
  PermissionRequestPayload,
} from '@/lib/agent/control-bus'
import type {
  CapabilityKey,
  PermissionAuditDTO,
  PermissionGrantDTO,
  PermissionPolicy,
} from '@/lib/agent/permissions'
import type { ConnectedDeviceDTO } from '@/lib/agent/device-bridge'
import type { OutfitSelection } from '@/lib/coucou/wardrobe'
import type { ReasoningChain } from '@/lib/agent/reasoning-chain'

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
  | 'browser'
  | 'identity'
  | 'permissions'
  | 'devices'
  | 'org'
  | 'artifacts'
  | 'tools'
  | 'automations'
  | 'brain'

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
  cursor: LiveCursorState
  pendingPermissions: PermissionRequestPayload[]
  grants: PermissionGrantDTO[]
  auditLog: PermissionAuditDTO[]
  devices: ConnectedDeviceDTO[]
  onlineDeviceIds: string[]
  popups: EvaDynamicPopupItem[]
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

  setControlConnected: (connected: boolean) => void
  setLayoutMode: (mode: LayoutMode) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
  setGbrainGraphOpen: (open: boolean) => void
  openSplit: (mode: SplitMode, title?: string) => void
  closeSplit: () => void
  setBrowserFrame: (frame: BrowserFramePayload | null) => void
  updateCursor: (payload: CursorEventPayload) => void
  hideCursor: () => void
  pushPendingPermission: (req: PermissionRequestPayload) => void
  setPendingPermissions: (reqs: PermissionRequestPayload[]) => void
  removePendingPermission: (requestId: string) => void
  pushPopup: (popup: Omit<EvaDynamicPopupItem, 'createdAt'>) => void
  dismissPopup: (id?: string) => void
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

  refreshPermissions: () => Promise<void>
  respondPermission: (requestId: string, decision: Exclude<PermissionDecision, 'timeout'>) => Promise<void>
  updateGrantPolicy: (capability: CapabilityKey, policy: PermissionPolicy) => Promise<void>
  refreshDevices: () => Promise<void>
  pairDevice: (name: string, platform: string) => Promise<{ pairingToken: string; device: ConnectedDeviceDTO } | null>
  revokeDevice: (id: string) => Promise<void>
  browserAction: (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
  refreshIdentity: () => Promise<void>
  provisionIdentity: (opts?: { forceNew?: boolean; preferredLocal?: string }) => Promise<AgentIdentityDTO | null>
  saveCustomIdentity: (address: string, displayName?: string) => Promise<AgentIdentityDTO | null>
  readIdentityMessage: (messageId: string) => Promise<AgentInboxDetailDTO | null>
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

  setGbrainGraphOpen: (open) => set({ gbrainGraphOpen: open }),

  openSplit: (mode, title) =>
    set({
      splitOpen: true,
      splitMode: mode,
      splitTitle: title ?? null,
    }),

  closeSplit: () => set({ splitOpen: false }),

  setBrowserFrame: (frame) => set({ browserFrame: frame && frame.active ? frame : null }),

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
}))
