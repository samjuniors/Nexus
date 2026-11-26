import type WebSocket from 'ws'
import { reasoningChain, type ReasoningChain } from '@/lib/agent/reasoning-chain'
import { brainTrace, type BrainTraceEvent } from '@/lib/agent/brain-trace'
import { selfHealManager, type SelfHealSession } from '@/lib/agent/self-heal'
import type { TerminalEntry, TerminalSessionSnapshot } from '@/lib/agent/terminal-types'
import type { VoiceStageCard } from '@/lib/agent/voice-stage-types'

export type ControlSplitMode =
  | 'reasoning'
  | 'self_heal'
  | 'browser'
  | 'terminal'
  | 'mobile'
  | 'permissions'
  | 'devices'
  | 'identity'
  | 'org'
  | 'artifacts'
  | 'tools'
  | 'automations'
  | 'brain'
  | 'google_workspace'

export type ControlUiCommand =
  | { command: 'navigate_tab'; tab: string }
  | {
      command: 'open_split'
      mode: ControlSplitMode
      title?: string
      url?: string
    }
  | { command: 'close_split' }
  | { command: 'set_layout_mode'; mode: 'standard' | 'focus' }
  | { command: 'toggle_sidebar'; collapsed?: boolean }
  | { command: 'open_gbrain_graph' }
  | { command: 'open_popup'; id: string; title: string; body: string; kind?: 'info' | 'action' | 'preview'; actions?: { label: string; tab?: string; splitMode?: string; url?: string }[] }
  | { command: 'close_popup'; id?: string }
  | { command: 'click_target'; selector?: string; label?: string }
  | { command: 'set_theme'; theme: 'light' | 'dark' }
  | { command: 'refresh_state'; scopes?: string[] }

export interface BrowserElementHint {
  index: number
  tag: string
  text: string
  selector: string
  x: number
  y: number
}

export interface BrowserFramePayload {
  active: boolean
  url: string
  title: string
  imageBase64: string
  width: number
  height: number
  loading: boolean
  cursorX: number | null
  cursorY: number | null
  lastAction: string
  elements: BrowserElementHint[]
  /** When playing YouTube/media, streams a live playable embed inside the Live Browser split panel */
  mediaEmbedUrl?: string | null
  mediaTitle?: string | null
  mediaVideoId?: string | null
  updatedAt: string
}

export interface DesktopFramePayload {
  active: boolean
  deviceId: string
  deviceName: string
  platform: string
  windowTitle: string
  imageBase64: string
  width: number
  height: number
  lastAction: string
  updatedAt: string
}

export type AutomationSessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'takeover'
  | 'completed'
  | 'error'

export interface AutomationSessionActionLog {
  id: string
  step: number
  label: string
  detail?: string
  status: 'running' | 'done' | 'paused' | 'blocked' | 'error'
  ts: string
}

export interface AutomationSessionSnapshot {
  sessionId: string | null
  target: 'browser' | 'windows' | 'hybrid'
  status: AutomationSessionStatus
  goal: string
  currentStep: string
  stepIndex: number
  totalSteps: number
  canTakeOver: boolean
  actionLog: AutomationSessionActionLog[]
  updatedAt: string
}

export interface MobileElementHint {
  id: string
  label: string
  kind: 'app' | 'toggle' | 'button' | 'input' | 'item' | 'link'
  x: number
  y: number
}

export interface MobileFramePayload {
  active: boolean
  mode: 'live_emulator' | 'adb_bridge'
  deviceId: string | null
  deviceName: string
  platform: 'android' | 'ios'
  osVersion: string
  battery: number
  timeLabel: string
  width: number
  height: number
  currentApp: string
  appTitle: string
  url: string
  chromeTitle: string
  chromeSnippet: string
  notificationShadeOpen: boolean
  recentsOpen: boolean
  quickSettings: {
    wifi: boolean
    bluetooth: boolean
    dnd: boolean
    airplane: boolean
    flashlight: boolean
  }
  activeThreadId: string | null
  threads: {
    id: string
    contact: string
    preview: string
    time: string
    unread: boolean
    messages: { from: 'them' | 'me'; text: string; time: string }[]
  }[]
  notes: { id: string; title: string; body: string; updatedAt: string }[]
  dialerNumber: string
  callState: 'idle' | 'calling'
  notifications: { id: string; app: string; title: string; body: string; time: string }[]
  elements: MobileElementHint[]
  touchX: number | null
  touchY: number | null
  swipeVector: { fromX: number; fromY: number; toX: number; toY: number } | null
  screenshotBase64: string | null
  lastAction: string
  actionLog: { id: string; action: string; detail: string; ts: string }[]
  updatedAt: string
}

export interface PermissionRequestPayload {
  requestId: string
  actionHash: string
  capability: string
  title: string
  description: string
  actionSummary: string
  actor: string
  details?: string
  automationId?: string | null
  runId?: string | null
  createdAt: string
  expiresAt?: string
}

export type PermissionDecision = 'always' | 'once' | 'deny' | 'timeout'

export interface CursorEventPayload {
  visible: boolean
  x?: number
  y?: number
  selector?: string
  label?: string
  clicking?: boolean
  actor?: string
}

export interface DeviceCommandResult {
  ok: boolean
  output: string
  error?: string
}

interface PendingPermission {
  request: PermissionRequestPayload
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingDeviceCommand {
  deviceId: string
  resolve: (res: DeviceCommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

interface ConnectedDeviceSocket {
  deviceId: string
  name: string
  platform: string
  capabilities: string[]
  ws: WebSocket
  connectedAt: string
}

class NexusControlBus {
  private uiClients = new Set<WebSocket>()
  private deviceSockets = new Map<string, ConnectedDeviceSocket>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private resolvingPermissions = new Set<string>()
  private pendingDeviceCommands = new Map<string, PendingDeviceCommand>()
  private latestBrowserFrame: BrowserFramePayload | null = null
  private latestDesktopFrame: DesktopFramePayload | null = null
  private latestMobileFrame: MobileFramePayload | null = null
  private latestAutomationSession: AutomationSessionSnapshot | null = null
  private latestTerminalSnapshot: TerminalSessionSnapshot | null = null
  private latestVoiceStageCard: VoiceStageCard | null = null

  constructor() {
    reasoningChain.subscribe((event) => {
      if (event.type === 'update') {
        this.broadcastReasoningUpdate(event.chain)
      } else {
        this.broadcast({ type: 'reasoning:clear' })
      }
    })
    brainTrace.subscribe((event) => {
      if (event.type === 'trace') {
        this.broadcastBrainTrace(event.item)
      } else {
        this.broadcast({ type: 'brain:trace_clear' })
      }
    })
    selfHealManager.subscribe((session) => {
      this.broadcastSelfHealUpdate(session)
    })
  }

  registerUiClient(ws: WebSocket) {
    this.uiClients.add(ws)
    // Initial sync: send latest browser/desktop/mobile frames, automation session, active permission prompts, online device IDs, reasoning chains, brain traces, and self-heal sessions
    this.safeSend(ws, {
      type: 'control:init',
      browserFrame: this.latestBrowserFrame,
      desktopFrame: this.latestDesktopFrame,
      mobileFrame: this.latestMobileFrame,
      automationSession: this.latestAutomationSession,
      terminalSnapshot: this.latestTerminalSnapshot,
      voiceStageCard: this.latestVoiceStageCard,
      pendingPermissions: Array.from(this.pendingPermissions.values()).map((p) => p.request),
      onlineDeviceIds: Array.from(this.deviceSockets.keys()),
      reasoningChains: reasoningChain.listChains(20),
      brainTraces: brainTrace.list(20),
      selfHealSessions: selfHealManager.listSessions(15),
    })

    ws.on('close', () => {
      this.uiClients.delete(ws)
    })
    ws.on('error', () => {
      this.uiClients.delete(ws)
    })
  }

  hasUiClients(): boolean {
    for (const ws of this.uiClients) {
      if (ws.readyState === 1) return true
    }
    return false
  }

  private safeSend(ws: WebSocket, payload: unknown) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(payload))
      } catch {
        /* ignore closed socket */
      }
    }
  }

  broadcast(payload: unknown) {
    for (const ws of this.uiClients) {
      this.safeSend(ws, payload)
    }
  }

  broadcastUiCommand(cmd: ControlUiCommand) {
    this.broadcast({ type: 'ui:command', ...cmd })
  }

  broadcastCursor(payload: CursorEventPayload) {
    this.broadcast({ type: 'cursor:update', ...payload })
  }

  broadcastEvaMood(mood: string, note?: string, durationMs = 2400) {
    this.broadcast({ type: 'eva:mood', mood, note, durationMs })
  }

  broadcastBrowserFrame(frame: BrowserFramePayload) {
    this.latestBrowserFrame = frame.active ? frame : null
    this.broadcast({ type: 'browser:frame', frame })
  }

  broadcastDesktopFrame(frame: DesktopFramePayload) {
    this.latestDesktopFrame = frame.active ? frame : null
    this.broadcast({ type: 'desktop:frame', frame })
  }

  broadcastAutomationSession(session: AutomationSessionSnapshot) {
    this.latestAutomationSession = session
    this.broadcast({ type: 'automation:session', session })
  }

  broadcastTerminalSnapshot(snapshot: TerminalSessionSnapshot) {
    this.latestTerminalSnapshot = snapshot
    this.broadcast({ type: 'terminal:snapshot', snapshot })
  }

  broadcastTerminalEntry(entry: TerminalEntry, snapshot: TerminalSessionSnapshot) {
    this.latestTerminalSnapshot = snapshot
    this.broadcast({ type: 'terminal:entry', entry, snapshot })
  }

  broadcastMobileFrame(frame: MobileFramePayload) {
    this.latestMobileFrame = frame.active ? frame : null
    this.broadcast({ type: 'mobile:frame', frame })
  }

  broadcastReasoningUpdate(chain: ReasoningChain) {
    this.broadcast({ type: 'reasoning:update', chain })
  }

  broadcastBrainTrace(item: BrainTraceEvent) {
    this.broadcast({ type: 'brain:trace', item })
  }

  broadcastSelfHealUpdate(session: SelfHealSession) {
    this.broadcast({ type: 'self_heal:update', session })
  }

  broadcastVoiceStagePresent(card: VoiceStageCard) {
    this.latestVoiceStageCard = card
    this.broadcast({ type: 'voice_stage:present', card })
  }

  broadcastVoiceStageDismiss(id?: string) {
    if (!id || this.latestVoiceStageCard?.id === id) {
      this.latestVoiceStageCard = null
    }
    this.broadcast({ type: 'voice_stage:dismiss', id: id ?? null })
  }

  getLatestVoiceStageCard(): VoiceStageCard | null {
    return this.latestVoiceStageCard
  }

  getLatestBrowserFrame(): BrowserFramePayload | null {
    return this.latestBrowserFrame
  }

  getLatestDesktopFrame(): DesktopFramePayload | null {
    return this.latestDesktopFrame
  }

  getLatestAutomationSession(): AutomationSessionSnapshot | null {
    return this.latestAutomationSession
  }

  getLatestMobileFrame(): MobileFramePayload | null {
    return this.latestMobileFrame
  }

  getPendingPermissions(): PermissionRequestPayload[] {
    return Array.from(this.pendingPermissions.values()).map((p) => p.request)
  }

  waitForPermission(request: PermissionRequestPayload, timeoutMs = 45_000): Promise<PermissionDecision> {
    const expiresAt = request.expiresAt ?? new Date(Date.now() + timeoutMs).toISOString()
    const payload: PermissionRequestPayload = { ...request, expiresAt }
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.resolvingPermissions.delete(payload.requestId)
        if (this.pendingPermissions.delete(payload.requestId)) {
          this.broadcast({
            type: 'permission:resolved',
            requestId: payload.requestId,
            decision: 'timeout',
            capability: payload.capability,
          })
          resolve('timeout')
        }
      }, timeoutMs)

      this.pendingPermissions.set(payload.requestId, { request: payload, resolve, timer })
      this.broadcast({ type: 'permission:request', request: payload })
    })
  }

  getPendingPermission(requestId: string): PermissionRequestPayload | null {
    return this.pendingPermissions.get(requestId)?.request ?? null
  }

  hasLiveOrResolvingPermission(requestId: string): boolean {
    return this.pendingPermissions.has(requestId) || this.resolvingPermissions.has(requestId)
  }

  /** Atomically claims an unexpired pending permission for single-flight audit & resolution. */
  beginPermissionResolution(requestId: string, actionHash: string): PermissionRequestPayload | null {
    const entry = this.pendingPermissions.get(requestId)
    if (!entry || this.resolvingPermissions.has(requestId)) return null
    if (!/^[a-f0-9]{64}$/.test(actionHash) || entry.request.actionHash !== actionHash) return null
    if (entry.request.expiresAt) {
      const expiresMs = Date.parse(entry.request.expiresAt)
      if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
        clearTimeout(entry.timer)
        this.pendingPermissions.delete(requestId)
        this.broadcast({
          type: 'permission:resolved',
          requestId,
          decision: 'timeout',
          capability: entry.request.capability,
        })
        entry.resolve('timeout')
        return null
      }
    }
    this.resolvingPermissions.add(requestId)
    return entry.request
  }

  abortPermissionResolution(requestId: string) {
    this.resolvingPermissions.delete(requestId)
  }

  resolvePermission(requestId: string, decision: PermissionDecision, actionHash: string): PermissionRequestPayload | null {
    const entry = this.pendingPermissions.get(requestId)
    this.resolvingPermissions.delete(requestId)
    if (!entry || !/^[a-f0-9]{64}$/.test(actionHash) || entry.request.actionHash !== actionHash) return null
    clearTimeout(entry.timer)
    this.pendingPermissions.delete(requestId)
    this.broadcast({
      type: 'permission:resolved',
      requestId,
      decision,
      capability: entry.request.capability,
    })
    entry.resolve(decision)
    return entry.request
  }

  // ---- Local OS Companion Device Bridge ----
  registerDevice(info: ConnectedDeviceSocket) {
    const prev = this.deviceSockets.get(info.deviceId)
    if (prev && prev.ws !== info.ws) {
      try {
        prev.ws.close(1000, 'Replaced by newer connection')
      } catch {
        /* ignore */
      }
    }
    this.deviceSockets.set(info.deviceId, info)
    this.broadcastDeviceStatus()
  }

  unregisterDevice(deviceId: string, ws?: WebSocket) {
    const cur = this.deviceSockets.get(deviceId)
    if (!cur) return
    if (ws && cur.ws !== ws) return
    this.deviceSockets.delete(deviceId)
    if (!ws) {
      // Explicit revocation (no socket parameter): terminate the live connection immediately.
      try {
        if (typeof cur.ws.terminate === 'function') cur.ws.terminate()
        else cur.ws.close(4003, 'Device pairing revoked')
      } catch {
        /* ignore closed socket */
      }
    }
    // Reject any in-flight commands for this device
    for (const [cmdId, pending] of this.pendingDeviceCommands.entries()) {
      if (pending.deviceId === deviceId) {
        clearTimeout(pending.timer)
        this.pendingDeviceCommands.delete(cmdId)
        pending.resolve({ ok: false, output: '', error: 'Connected device disconnected before completing command.' })
      }
    }
    this.broadcastDeviceStatus()
  }

  isDeviceOnline(deviceId: string): boolean {
    if (deviceId === 'local_host' || deviceId === 'host') return true
    const s = this.deviceSockets.get(deviceId)
    return Boolean(s && s.ws.readyState === 1)
  }

  getOnlineDeviceIds(): string[] {
    const online = Array.from(this.deviceSockets.keys()).filter((id) => this.isDeviceOnline(id))
    if (!online.includes('local_host')) {
      online.unshift('local_host')
    }
    return online
  }

  broadcastDeviceStatus() {
    this.broadcast({
      type: 'device:status',
      onlineDeviceIds: this.getOnlineDeviceIds(),
    })
  }

  pushAllowlistToDevices(payload: {
    folders: { id: string; label: string; path: string; accessMode: string; enabled: boolean }[]
    apps: { id: string; name: string; executable: string; policy: string }[]
  }) {
    for (const sock of this.deviceSockets.values()) {
      if (sock.platform === 'android' || sock.platform === 'ios') continue
      this.safeSend(sock.ws, {
        type: 'allowlist:sync',
        folders: payload.folders,
        apps: payload.apps,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  async sendDeviceCommand(
    deviceId: string,
    action: string,
    args: Record<string, unknown>,
    timeoutMs = 20_000
  ): Promise<DeviceCommandResult> {
    if (deviceId === 'local_host' || deviceId === 'host') {
      const { executeLocalDeviceCommand } = await import('@/lib/agent/host-device-executor')
      return executeLocalDeviceCommand(action, args, timeoutMs)
    }

    const sock = this.deviceSockets.get(deviceId)
    if (!sock || sock.ws.readyState !== 1) {
      return Promise.resolve({
        ok: false,
        output: '',
        error: 'Target device is currently offline. Pair and run the Nexus Companion Bridge on that computer.',
      })
    }

    if (action === 'batch_rename' || !sock.capabilities.includes(action)) {
      return Promise.resolve({ ok: false, output: '', error: 'Command not authorized for this paired device capability set.' })
    }

    const commandId = `devcmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    return new Promise<DeviceCommandResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingDeviceCommands.delete(commandId)) {
          resolve({ ok: false, output: '', error: 'Device command timed out after 20s.' })
        }
      }, timeoutMs)

      this.pendingDeviceCommands.set(commandId, { deviceId, resolve, timer })
      this.safeSend(sock.ws, {
        type: 'device:exec',
        commandId,
        action,
        args,
      })
    })
  }

  resolveDeviceCommand(commandId: string, result: DeviceCommandResult, deviceId: string, socket: WebSocket) {
    const entry = this.pendingDeviceCommands.get(commandId)
    // A paired device must not claim another device's command ID, including after reconnect.
    if (!entry || entry.deviceId !== deviceId || this.deviceSockets.get(deviceId)?.ws !== socket) return
    clearTimeout(entry.timer)
    this.pendingDeviceCommands.delete(commandId)
    entry.resolve(result)
  }
}

const g = globalThis as unknown as { __nexusControlBus?: NexusControlBus }
export const controlBus = g.__nexusControlBus ?? new NexusControlBus()
g.__nexusControlBus = controlBus
