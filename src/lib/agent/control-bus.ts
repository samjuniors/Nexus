import type WebSocket from 'ws'
import { reasoningChain, type ReasoningChain } from '@/lib/agent/reasoning-chain'
import { brainTrace, type BrainTraceEvent } from '@/lib/agent/brain-trace'
import { selfHealManager, type SelfHealSession } from '@/lib/agent/self-heal'

export type ControlSplitMode =
  | 'reasoning'
  | 'self_heal'
  | 'browser'
  | 'permissions'
  | 'devices'
  | 'identity'
  | 'org'
  | 'artifacts'
  | 'tools'
  | 'automations'
  | 'brain'

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

export interface PermissionRequestPayload {
  requestId: string
  capability: string
  title: string
  description: string
  actionSummary: string
  actor: string
  details?: string
  createdAt: string
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
  private pendingDeviceCommands = new Map<string, PendingDeviceCommand>()
  private latestBrowserFrame: BrowserFramePayload | null = null

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
    // Initial sync: send latest browser frame, any active permission prompts, online device IDs, reasoning chains, brain traces, and self-heal sessions
    this.safeSend(ws, {
      type: 'control:init',
      browserFrame: this.latestBrowserFrame,
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

  broadcastReasoningUpdate(chain: ReasoningChain) {
    this.broadcast({ type: 'reasoning:update', chain })
  }

  broadcastBrainTrace(item: BrainTraceEvent) {
    this.broadcast({ type: 'brain:trace', item })
  }

  broadcastSelfHealUpdate(session: SelfHealSession) {
    this.broadcast({ type: 'self_heal:update', session })
  }

  getLatestBrowserFrame(): BrowserFramePayload | null {
    return this.latestBrowserFrame
  }

  getPendingPermissions(): PermissionRequestPayload[] {
    return Array.from(this.pendingPermissions.values()).map((p) => p.request)
  }

  waitForPermission(request: PermissionRequestPayload, timeoutMs = 45_000): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingPermissions.delete(request.requestId)) {
          this.broadcast({
            type: 'permission:resolved',
            requestId: request.requestId,
            decision: 'timeout',
            capability: request.capability,
          })
          resolve('timeout')
        }
      }, timeoutMs)

      this.pendingPermissions.set(request.requestId, { request, resolve, timer })
      this.broadcast({ type: 'permission:request', request })
    })
  }

  resolvePermission(requestId: string, decision: PermissionDecision): PermissionRequestPayload | null {
    const entry = this.pendingPermissions.get(requestId)
    if (!entry) return null
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
    const s = this.deviceSockets.get(deviceId)
    return Boolean(s && s.ws.readyState === 1)
  }

  getOnlineDeviceIds(): string[] {
    return Array.from(this.deviceSockets.keys()).filter((id) => this.isDeviceOnline(id))
  }

  broadcastDeviceStatus() {
    this.broadcast({
      type: 'device:status',
      onlineDeviceIds: this.getOnlineDeviceIds(),
    })
  }

  sendDeviceCommand(
    deviceId: string,
    action: string,
    args: Record<string, unknown>,
    timeoutMs = 20_000
  ): Promise<DeviceCommandResult> {
    const sock = this.deviceSockets.get(deviceId)
    if (!sock || sock.ws.readyState !== 1) {
      return Promise.resolve({
        ok: false,
        output: '',
        error: 'Target device is currently offline. Pair and run the Nexus Companion Bridge on that computer.',
      })
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

  resolveDeviceCommand(commandId: string, result: DeviceCommandResult) {
    const entry = this.pendingDeviceCommands.get(commandId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pendingDeviceCommands.delete(commandId)
    entry.resolve(result)
  }
}

const g = globalThis as unknown as { __nexusControlBus?: NexusControlBus }
export const controlBus = g.__nexusControlBus ?? new NexusControlBus()
g.__nexusControlBus = controlBus
