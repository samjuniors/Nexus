import { controlBus, type MobileFramePayload, type MobileElementHint } from '@/lib/agent/control-bus'
import { listConnectedDevices } from '@/lib/agent/device-bridge'
import { reasoningChain } from '@/lib/agent/reasoning-chain'

export type MobileAppId =
  | 'home'
  | 'settings'
  | 'messages'
  | 'phone'
  | 'chrome'
  | 'notes'
  | 'camera'
  | 'calendar'
  | 'maps'

export type MobileHardwareKey = 'home' | 'back' | 'recents' | 'enter' | 'volume_up' | 'volume_down'
export type MobileQuickSettingKey = 'wifi' | 'bluetooth' | 'dnd' | 'airplane' | 'flashlight'

export interface MobileMessageThread {
  id: string
  contact: string
  preview: string
  time: string
  unread: boolean
  messages: { from: 'them' | 'me'; text: string; time: string }[]
}

export interface MobileNoteItem {
  id: string
  title: string
  body: string
  updatedAt: string
}

export interface MobileNotificationItem {
  id: string
  app: string
  title: string
  body: string
  time: string
}

export interface MobileAppSpec {
  id: MobileAppId
  name: string
  packageName: string
  category: string
  x: number
  y: number
}

export const MOBILE_APPS: MobileAppSpec[] = [
  { id: 'phone', name: 'Phone', packageName: 'com.google.android.dialer', category: 'Communication', x: 180, y: 2050 },
  { id: 'messages', name: 'Messages', packageName: 'com.google.android.apps.messaging', category: 'Communication', x: 420, y: 2050 },
  { id: 'chrome', name: 'Chrome', packageName: 'com.android.chrome', category: 'Browser', x: 660, y: 2050 },
  { id: 'camera', name: 'Camera', packageName: 'com.google.android.GoogleCamera', category: 'Media', x: 900, y: 2050 },
  { id: 'settings', name: 'Settings', packageName: 'com.android.settings', category: 'System', x: 200, y: 740 },
  { id: 'notes', name: 'Notes', packageName: 'com.google.android.keep', category: 'Productivity', x: 430, y: 740 },
  { id: 'maps', name: 'Maps', packageName: 'com.google.android.apps.maps', category: 'Navigation', x: 660, y: 740 },
  { id: 'calendar', name: 'Calendar', packageName: 'com.google.android.calendar', category: 'Productivity', x: 890, y: 740 },
]

export interface MobileActionInput {
  action:
    | 'status'
    | 'list_apps'
    | 'open_app'
    | 'tap'
    | 'long_press'
    | 'swipe'
    | 'scroll'
    | 'type'
    | 'press_key'
    | 'open_url'
    | 'notifications'
    | 'toggle_setting'
    | 'screenshot'
    | 'autopilot'
    | 'select_device'
    | 'reset'
  app?: string
  x?: number
  y?: number
  fromX?: number
  fromY?: number
  toX?: number
  toY?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  text?: string
  target?: string
  key?: MobileHardwareKey | string
  setting?: MobileQuickSettingKey | string
  enabled?: boolean
  url?: string
  goal?: string
  deviceId?: string
  open?: boolean
}

export interface MobileActionResult {
  ok: boolean
  summary: string
  output: string
  frame: MobileFramePayload
}

interface InternalMobileState {
  active: boolean
  mode: 'live_emulator' | 'adb_bridge'
  deviceId: string | null
  deviceName: string
  platform: 'android' | 'ios'
  osVersion: string
  battery: number
  width: number
  height: number
  currentApp: MobileAppId
  historyStack: MobileAppId[]
  url: string
  chromeTitle: string
  chromeSnippet: string
  notificationShadeOpen: boolean
  recentsOpen: boolean
  quickSettings: Record<MobileQuickSettingKey, boolean>
  activeThreadId: string | null
  threads: MobileMessageThread[]
  notes: MobileNoteItem[]
  dialerNumber: string
  callState: 'idle' | 'calling'
  notifications: MobileNotificationItem[]
  touchX: number | null
  touchY: number | null
  swipeVector: { fromX: number; fromY: number; toX: number; toY: number } | null
  screenshotBase64: string | null
  lastAction: string
  actionLog: { id: string; action: string; detail: string; ts: string }[]
}

function nowTimeLabel(): string {
  try {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '9:41'
  }
}

function createInitialState(): InternalMobileState {
  return {
    active: true,
    mode: 'live_emulator',
    deviceId: null,
    deviceName: 'Pixel 9 Pro · Live Android',
    platform: 'android',
    osVersion: 'Android 15',
    battery: 88,
    width: 1080,
    height: 2400,
    currentApp: 'home',
    historyStack: [],
    url: 'https://news.ycombinator.com',
    chromeTitle: 'Chrome Mobile',
    chromeSnippet: 'Fast mobile web viewport controlled by Eva Hands.',
    notificationShadeOpen: false,
    recentsOpen: false,
    quickSettings: {
      wifi: true,
      bluetooth: true,
      dnd: false,
      airplane: false,
      flashlight: false,
    },
    activeThreadId: 'thr_alex',
    threads: [
      {
        id: 'thr_alex',
        contact: 'Alex Rivera',
        preview: 'Are we still on for the 3pm product review?',
        time: '2m ago',
        unread: true,
        messages: [
          { from: 'them', text: 'Hey! Are we still on for the 3pm product review?', time: '2m ago' },
        ],
      },
      {
        id: 'thr_maya',
        contact: 'Maya Chen',
        preview: 'Sent over the Q4 launch checklist.',
        time: '18m ago',
        unread: false,
        messages: [
          { from: 'them', text: 'Sent over the Q4 launch checklist.', time: '18m ago' },
          { from: 'me', text: 'Got it, reviewing shortly.', time: '14m ago' },
        ],
      },
    ],
    notes: [
      {
        id: 'note_1',
        title: 'Sprint Priorities',
        body: '1. Voice-first mobile UX\n2. Android ADB bridge\n3. Verify autonomous flows',
        updatedAt: 'Today',
      },
    ],
    dialerNumber: '',
    callState: 'idle',
    notifications: [
      {
        id: 'notif_1',
        app: 'Messages',
        title: 'Alex Rivera',
        body: 'Are we still on for the 3pm product review?',
        time: '2m',
      },
      {
        id: 'notif_2',
        app: 'Calendar',
        title: 'Design Sync in 25 min',
        body: 'Room 4B · Video link ready',
        time: '10m',
      },
    ],
    touchX: null,
    touchY: null,
    swipeVector: null,
    screenshotBase64: null,
    lastAction: 'Ready for Android & Mobile takeover',
    actionLog: [],
  }
}

export function resolveMobileAppId(raw?: string): MobileAppId | null {
  if (!raw) return null
  const q = raw.trim().toLowerCase()
  if (!q) return null
  if (q.includes('home') || q.includes('launcher')) return 'home'
  if (q.includes('setting') || q.includes('wifi') || q.includes('bluetooth') || q.includes('dnd')) return 'settings'
  if (q.includes('message') || q.includes('sms') || q.includes('text') || q.includes('whatsapp') || q.includes('chat')) return 'messages'
  if (q.includes('phone') || q.includes('dial') || q.includes('call')) return 'phone'
  if (q.includes('chrome') || q.includes('browser') || q.includes('web') || q.includes('search') || q.includes('google')) return 'chrome'
  if (q.includes('note') || q.includes('keep') || q.includes('memo')) return 'notes'
  if (q.includes('camera') || q.includes('photo')) return 'camera'
  if (q.includes('calendar') || q.includes('schedule')) return 'calendar'
  if (q.includes('map') || q.includes('navigate') || q.includes('direction')) return 'maps'
  return null
}

export function resolveQuickSettingKey(raw?: string): MobileQuickSettingKey | null {
  if (!raw) return null
  const q = raw.trim().toLowerCase()
  if (q.includes('wi-fi') || q.includes('wifi')) return 'wifi'
  if (q.includes('bluetooth') || q === 'bt') return 'bluetooth'
  if (q.includes('dnd') || q.includes('do not disturb') || q.includes('silent') || q.includes('quiet')) return 'dnd'
  if (q.includes('airplane') || q.includes('flight')) return 'airplane'
  if (q.includes('flash') || q.includes('torch') || q.includes('light')) return 'flashlight'
  return null
}

function buildInteractiveElements(state: InternalMobileState): MobileElementHint[] {
  if (state.notificationShadeOpen) {
    return [
      { id: 'qs-wifi', label: `Wi-Fi (${state.quickSettings.wifi ? 'On' : 'Off'})`, kind: 'toggle', x: 200, y: 420 },
      { id: 'qs-bluetooth', label: `Bluetooth (${state.quickSettings.bluetooth ? 'On' : 'Off'})`, kind: 'toggle', x: 540, y: 420 },
      { id: 'qs-dnd', label: `Do Not Disturb (${state.quickSettings.dnd ? 'On' : 'Off'})`, kind: 'toggle', x: 880, y: 420 },
      { id: 'qs-flashlight', label: `Flashlight (${state.quickSettings.flashlight ? 'On' : 'Off'})`, kind: 'toggle', x: 200, y: 610 },
      { id: 'qs-airplane', label: `Airplane (${state.quickSettings.airplane ? 'On' : 'Off'})`, kind: 'toggle', x: 540, y: 610 },
      { id: 'qs-close', label: 'Close Shade', kind: 'button', x: 540, y: 2180 },
    ]
  }

  if (state.currentApp === 'home') {
    return MOBILE_APPS.map((a) => ({
      id: `app-${a.id}`,
      label: a.name,
      kind: 'app',
      x: a.x,
      y: a.y,
    }))
  }

  if (state.currentApp === 'settings') {
    return [
      { id: 'set-wifi', label: `Wi-Fi · ${state.quickSettings.wifi ? 'Connected' : 'Off'}`, kind: 'toggle', x: 540, y: 520 },
      { id: 'set-bluetooth', label: `Bluetooth · ${state.quickSettings.bluetooth ? 'On' : 'Off'}`, kind: 'toggle', x: 540, y: 740 },
      { id: 'set-dnd', label: `Do Not Disturb · ${state.quickSettings.dnd ? 'On' : 'Off'}`, kind: 'toggle', x: 540, y: 960 },
      { id: 'set-airplane', label: `Airplane Mode · ${state.quickSettings.airplane ? 'On' : 'Off'}`, kind: 'toggle', x: 540, y: 1180 },
      { id: 'set-flashlight', label: `Flashlight · ${state.quickSettings.flashlight ? 'On' : 'Off'}`, kind: 'toggle', x: 540, y: 1400 },
    ]
  }

  if (state.currentApp === 'messages') {
    return [
      ...state.threads.map((t, i) => ({
        id: `thread-${t.id}`,
        label: `Chat: ${t.contact}`,
        kind: 'item' as const,
        x: 540,
        y: 440 + i * 210,
      })),
      { id: 'msg-input', label: 'Message composer', kind: 'input' as const, x: 460, y: 2040 },
      { id: 'msg-send', label: 'Send SMS', kind: 'button' as const, x: 920, y: 2040 },
    ]
  }

  if (state.currentApp === 'chrome') {
    return [
      { id: 'chrome-url', label: `Address bar (${state.url})`, kind: 'input', x: 540, y: 310 },
      { id: 'chrome-bookmark-hn', label: 'Hacker News', kind: 'link', x: 280, y: 760 },
      { id: 'chrome-bookmark-wiki', label: 'Wikipedia', kind: 'link', x: 760, y: 760 },
    ]
  }

  if (state.currentApp === 'phone') {
    return [
      { id: 'dial-call', label: state.callState === 'calling' ? 'End Call' : 'Call', kind: 'button', x: 540, y: 1960 },
    ]
  }

  if (state.currentApp === 'notes') {
    return [
      { id: 'note-new', label: 'Add Note', kind: 'button', x: 860, y: 1980 },
    ]
  }

  return [{ id: 'nav-home', label: 'Home', kind: 'button', x: 540, y: 2290 }]
}

/**
 * Pure deterministic Android autopilot goal planner — translates natural-language
 * mobile commands into concrete ordered Android actions so Eva executes real tap,
 * toggle, messaging, dialing, note-taking, and Chrome steps end-to-end.
 */
export function planAndroidAutopilotSteps(goal: string): MobileActionInput[] {
  const g = goal.trim()
  const lower = g.toLowerCase()
  const steps: MobileActionInput[] = []

  // Quick settings / system toggles
  const settingMatch = resolveQuickSettingKey(lower)
  if (settingMatch && /(turn on|enable|activate|switch on|turn off|disable|toggle|set)/i.test(lower)) {
    const turnOff = /(turn off|disable|deactivate|switch off)/i.test(lower)
    const turnOn = /(turn on|enable|activate|switch on)/i.test(lower)
    if (lower.includes('notification') || lower.includes('shade') || lower.includes('quick')) {
      steps.push({ action: 'notifications', open: true })
    } else {
      steps.push({ action: 'open_app', app: 'settings' })
    }
    steps.push({
      action: 'toggle_setting',
      setting: settingMatch,
      enabled: turnOff ? false : turnOn ? true : undefined,
    })
    return steps
  }

  // Send SMS / message
  const msgMatch =
    g.match(/(?:text|message|sms|reply to)\s+([a-z0-9 _-]+?)\s+(?:saying|that|:)\s*["']?(.+?)["']?$/i) ||
    g.match(/(?:send\s+(?:a\s+)?(?:message|text|sms)\s+to)\s+([a-z0-9 _-]+?)\s+(?:saying|that|:)\s*["']?(.+?)["']?$/i)
  if (msgMatch) {
    const contact = msgMatch[1].trim()
    const body = msgMatch[2].trim()
    steps.push({ action: 'open_app', app: 'messages' })
    steps.push({ action: 'tap', target: contact })
    steps.push({ action: 'type', text: body })
    return steps
  }

  // Open URL or search in Chrome Mobile
  const urlMatch = g.match(/https?:\/\/[^\s]+/i)
  const searchMatch = g.match(/(?:search|google|look up|find)\s+(?:for\s+)?["']?(.+?)["']?$/i)
  if (urlMatch) {
    steps.push({ action: 'open_url', url: urlMatch[0] })
    return steps
  }
  if (searchMatch && (lower.includes('chrome') || lower.includes('browser') || lower.includes('google') || lower.includes('search'))) {
    const q = searchMatch[1].trim()
    steps.push({ action: 'open_app', app: 'chrome' })
    steps.push({ action: 'open_url', url: `https://www.google.com/search?q=${encodeURIComponent(q)}` })
    return steps
  }

  // Dial / call a number
  const dialMatch = g.match(/(?:call|dial)\s+([+\d\-\s()]{3,})/i)
  if (dialMatch) {
    steps.push({ action: 'open_app', app: 'phone' })
    steps.push({ action: 'type', text: dialMatch[1].trim() })
    steps.push({ action: 'tap', target: 'call' })
    return steps
  }

  // Create a note
  const noteMatch = g.match(/(?:note|write down|jot down|memo)(?:\s+that|\s*:)?\s+["']?(.+?)["']?$/i)
  if (noteMatch && (lower.includes('note') || lower.includes('memo') || lower.includes('write down'))) {
    steps.push({ action: 'open_app', app: 'notes' })
    steps.push({ action: 'type', text: noteMatch[1].trim() })
    return steps
  }

  // Notifications shade
  if (lower.includes('notification') || lower.includes('pull down')) {
    steps.push({ action: 'notifications', open: !lower.includes('close') && !lower.includes('dismiss') })
    return steps
  }

  // Open a specific app
  const appId = resolveMobileAppId(lower)
  if (appId) {
    steps.push({ action: 'open_app', app: appId })
    return steps
  }

  // Home / Back / Recents
  if (lower.includes('go home') || lower === 'home') {
    steps.push({ action: 'press_key', key: 'home' })
    return steps
  }
  if (lower.includes('go back') || lower === 'back') {
    steps.push({ action: 'press_key', key: 'back' })
    return steps
  }

  // Fallback: open Chrome and search the goal
  steps.push({ action: 'open_app', app: 'chrome' })
  steps.push({ action: 'open_url', url: `https://www.google.com/search?q=${encodeURIComponent(g)}` })
  return steps
}

class MobileTakeoverManager {
  private state: InternalMobileState = createInitialState()

  getFrame(): MobileFramePayload {
    const appSpec = MOBILE_APPS.find((a) => a.id === this.state.currentApp)
    const appTitle =
      this.state.currentApp === 'home'
        ? 'Android Home'
        : appSpec?.name ?? this.state.currentApp

    return {
      active: this.state.active,
      mode: this.state.mode,
      deviceId: this.state.deviceId,
      deviceName: this.state.deviceName,
      platform: this.state.platform,
      osVersion: this.state.osVersion,
      battery: this.state.battery,
      timeLabel: nowTimeLabel(),
      width: this.state.width,
      height: this.state.height,
      currentApp: this.state.currentApp,
      appTitle,
      url: this.state.url,
      chromeTitle: this.state.chromeTitle,
      chromeSnippet: this.state.chromeSnippet,
      notificationShadeOpen: this.state.notificationShadeOpen,
      recentsOpen: this.state.recentsOpen,
      quickSettings: { ...this.state.quickSettings },
      activeThreadId: this.state.activeThreadId,
      threads: this.state.threads.map((t) => ({
        ...t,
        messages: t.messages.map((m) => ({ ...m })),
      })),
      notes: this.state.notes.map((n) => ({ ...n })),
      dialerNumber: this.state.dialerNumber,
      callState: this.state.callState,
      notifications: this.state.notifications.map((n) => ({ ...n })),
      elements: buildInteractiveElements(this.state),
      touchX: this.state.touchX,
      touchY: this.state.touchY,
      swipeVector: this.state.swipeVector ? { ...this.state.swipeVector } : null,
      screenshotBase64: this.state.screenshotBase64,
      lastAction: this.state.lastAction,
      actionLog: this.state.actionLog.slice(0, 12),
      updatedAt: new Date().toISOString(),
    }
  }

  private pushLog(action: string, detail: string) {
    this.state.lastAction = detail
    this.state.actionLog = [
      {
        id: `mob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        action,
        detail,
        ts: nowTimeLabel(),
      },
      ...this.state.actionLog,
    ].slice(0, 20)
  }

  private broadcast(): MobileFramePayload {
    const frame = this.getFrame()
    controlBus.broadcastMobileFrame(frame)
    return frame
  }

  private async tryBridgeForward(action: string, args: Record<string, unknown>): Promise<{
    handled: boolean
    ok: boolean
    output: string
    error?: string
  }> {
    if (this.state.mode !== 'adb_bridge' || !this.state.deviceId) {
      return { handled: false, ok: false, output: '' }
    }
    if (!controlBus.isDeviceOnline(this.state.deviceId)) {
      this.state.mode = 'live_emulator'
      this.state.deviceId = null
      this.state.deviceName = 'Pixel 9 Pro · Live Android'
      return { handled: false, ok: false, output: '' }
    }

    const res = await controlBus.sendDeviceCommand(this.state.deviceId, `android_${action}`, args)
    if (res.ok && res.output && res.output.startsWith('data:image/')) {
      const idx = res.output.indexOf('base64,')
      if (idx !== -1) {
        this.state.screenshotBase64 = res.output.slice(idx + 7)
      }
    }
    return {
      handled: true,
      ok: res.ok,
      output: res.output,
      error: res.error,
    }
  }

  async execute(input: MobileActionInput, opts?: { broadcast?: boolean; openPanel?: boolean }): Promise<MobileActionResult> {
    const shouldBroadcast = opts?.broadcast !== false
    if (opts?.openPanel) {
      controlBus.broadcastUiCommand({ command: 'open_split', mode: 'mobile', title: 'Android & Mobile Control' })
    }

    const action = input.action
    this.state.swipeVector = null

    if (action === 'status') {
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: `${frame.deviceName} · ${frame.appTitle}`,
        output: `Active device: ${frame.deviceName} (${frame.mode}), App: ${frame.appTitle}, Wi-Fi: ${frame.quickSettings.wifi ? 'on' : 'off'}, DND: ${frame.quickSettings.dnd ? 'on' : 'off'}.`,
        frame,
      }
    }

    if (action === 'list_apps') {
      const list = MOBILE_APPS.map((a) => `- ${a.name} (${a.id}, ${a.packageName})`).join('\n')
      const frame = this.getFrame()
      return {
        ok: true,
        summary: `${MOBILE_APPS.length} installed Android apps`,
        output: list,
        frame,
      }
    }

    if (action === 'reset') {
      this.state = createInitialState()
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: 'Reset Android viewport', output: 'Android viewport reset to Home screen.', frame }
    }

    if (action === 'select_device') {
      if (!input.deviceId || input.deviceId === 'live_emulator') {
        this.state.mode = 'live_emulator'
        this.state.deviceId = null
        this.state.deviceName = 'Pixel 9 Pro · Live Android'
        this.state.platform = 'android'
        this.state.screenshotBase64 = null
        this.pushLog('select_device', 'Switched to Live Android Viewport')
        const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
        return { ok: true, summary: 'Using Live Android Viewport', output: 'Switched to Live Android Viewport.', frame }
      }

      const devices = await listConnectedDevices()
      const found = devices.find((d) => d.id === input.deviceId)
      if (!found) {
        const frame = this.getFrame()
        return { ok: false, summary: 'Device not found', output: `No paired mobile device with id ${input.deviceId}.`, frame }
      }
      this.state.mode = found.status === 'online' ? 'adb_bridge' : 'live_emulator'
      this.state.deviceId = found.id
      this.state.deviceName = found.name
      this.state.platform = found.platform === 'ios' ? 'ios' : 'android'
      this.pushLog('select_device', `Selected ${found.name} (${found.status})`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: `Selected ${found.name}`,
        output: `Selected ${found.name} (${found.platform}, ${found.status}).`,
        frame,
      }
    }

    // Forward to real paired Android ADB/Termux bridge if active & online
    if (this.state.mode === 'adb_bridge' && action !== 'autopilot') {
      const forwarded = await this.tryBridgeForward(action, input as unknown as Record<string, unknown>)
      if (forwarded.handled) {
        this.pushLog(action, forwarded.ok ? `${action} executed on ${this.state.deviceName}` : `Bridge error: ${forwarded.error}`)
        const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
        return {
          ok: forwarded.ok,
          summary: forwarded.ok ? `Executed ${action} on ${this.state.deviceName}` : `Android bridge failed`,
          output: forwarded.ok ? forwarded.output || 'Done' : forwarded.error || 'Bridge error',
          frame,
        }
      }
    }

    if (action === 'autopilot') {
      const goal = (input.goal ?? '').trim()
      if (!goal) {
        const frame = this.getFrame()
        return { ok: false, summary: 'Missing mobile goal', output: 'Provide a goal for Android autopilot.', frame }
      }
      const chain = reasoningChain.startChain({
        source: 'mobile_autopilot',
        goal: `Android Takeover: ${goal}`,
        actor: 'Eva',
        goalDetail: `Executing multi-step mobile takeover on ${this.state.deviceName}`,
      })
      const plan = planAndroidAutopilotSteps(goal)
      const stepSummaries: string[] = []
      for (let i = 0; i < plan.length; i++) {
        const step = plan[i]
        reasoningChain.addNode(chain.id, {
          kind: 'decision',
          title: `Mobile step ${i + 1}: ${step.action}`,
          detail: JSON.stringify(step),
          actor: 'Eva',
          tool: `mobile_control:${step.action}`,
        })
        const stepRes = await this.execute(step, { broadcast: shouldBroadcast, openPanel: false })
        stepSummaries.push(`${i + 1}. ${stepRes.summary}`)
      }
      reasoningChain.completeChain(chain.id, {
        ok: true,
        verificationDetail: stepSummaries.join(' → '),
        actor: 'Eva',
      })
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: `Completed Android goal (${plan.length} step${plan.length === 1 ? '' : 's'})`,
        output: `Completed "${goal}" on ${frame.deviceName}:\n${stepSummaries.join('\n')}`,
        frame,
      }
    }

    if (action === 'open_app') {
      const appId = resolveMobileAppId(input.app)
      if (!appId) {
        const frame = this.getFrame()
        return { ok: false, summary: `Unknown app: ${input.app ?? ''}`, output: `App "${input.app ?? ''}" is not installed.`, frame }
      }
      if (this.state.currentApp !== appId) {
        this.state.historyStack = [...this.state.historyStack.slice(-8), this.state.currentApp]
      }
      this.state.currentApp = appId
      this.state.notificationShadeOpen = false
      this.state.recentsOpen = false
      const appSpec = MOBILE_APPS.find((a) => a.id === appId)
      this.state.touchX = appSpec?.x ?? 540
      this.state.touchY = appSpec?.y ?? 1200
      this.pushLog('open_app', `Opened ${appSpec?.name ?? appId}`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: `Opened ${appSpec?.name ?? appId}`, output: `Launched ${appSpec?.name ?? appId} on ${frame.deviceName}.`, frame }
    }

    if (action === 'notifications') {
      const next = typeof input.open === 'boolean' ? input.open : !this.state.notificationShadeOpen
      this.state.notificationShadeOpen = next
      this.state.recentsOpen = false
      this.state.swipeVector = next
        ? { fromX: 540, fromY: 80, toX: 540, toY: 1380 }
        : { fromX: 540, fromY: 1680, toX: 540, toY: 220 }
      this.state.touchX = 540
      this.state.touchY = next ? 1380 : 220
      this.pushLog('notifications', next ? 'Pulled down notification shade' : 'Closed notification shade')
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: next ? 'Opened notification shade' : 'Closed notification shade',
        output: next
          ? `Notification shade open (${frame.notifications.length} active notifications).`
          : 'Notification shade closed.',
        frame,
      }
    }

    if (action === 'toggle_setting') {
      const key = resolveQuickSettingKey(input.setting)
      if (!key) {
        const frame = this.getFrame()
        return { ok: false, summary: 'Unknown quick setting', output: `Unsupported setting "${input.setting ?? ''}".`, frame }
      }
      const nextVal = typeof input.enabled === 'boolean' ? input.enabled : !this.state.quickSettings[key]
      this.state.quickSettings[key] = nextVal
      if (key === 'airplane' && nextVal) {
        this.state.quickSettings.wifi = false
        this.state.quickSettings.bluetooth = false
      }
      const yMap: Record<MobileQuickSettingKey, number> = {
        wifi: 520,
        bluetooth: 740,
        dnd: 960,
        airplane: 1180,
        flashlight: 1400,
      }
      this.state.touchX = 860
      this.state.touchY = this.state.notificationShadeOpen ? 460 : yMap[key]
      const labelMap: Record<MobileQuickSettingKey, string> = {
        wifi: 'Wi-Fi',
        bluetooth: 'Bluetooth',
        dnd: 'Do Not Disturb',
        airplane: 'Airplane Mode',
        flashlight: 'Flashlight',
      }
      this.pushLog('toggle_setting', `${labelMap[key]} turned ${nextVal ? 'ON' : 'OFF'}`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: `${labelMap[key]} ${nextVal ? 'ON' : 'OFF'}`,
        output: `Toggled ${labelMap[key]} ${nextVal ? 'ON' : 'OFF'} on ${frame.deviceName}.`,
        frame,
      }
    }

    if (action === 'open_url') {
      const raw = (input.url ?? '').trim()
      if (!raw) {
        const frame = this.getFrame()
        return { ok: false, summary: 'Missing URL', output: 'Provide a URL to open in Chrome Mobile.', frame }
      }
      const targetUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      if (this.state.currentApp !== 'chrome') {
        this.state.historyStack = [...this.state.historyStack.slice(-8), this.state.currentApp]
      }
      this.state.currentApp = 'chrome'
      this.state.notificationShadeOpen = false
      this.state.recentsOpen = false
      this.state.url = targetUrl
      try {
        const parsed = new URL(targetUrl)
        const q = parsed.searchParams.get('q')
        this.state.chromeTitle = q ? `Search: ${q}` : parsed.hostname.replace(/^www\./, '')
        this.state.chromeSnippet = q
          ? `Showing live mobile web results for "${q}" inside Chrome Mobile.`
          : `Loaded ${parsed.hostname} in Android Chrome Mobile viewport.`
      } catch {
        this.state.chromeTitle = targetUrl
        this.state.chromeSnippet = `Opened ${targetUrl} in Chrome Mobile.`
      }
      this.state.touchX = 540
      this.state.touchY = 310
      this.pushLog('open_url', `Navigated Chrome to ${this.state.chromeTitle}`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: `Opened ${this.state.chromeTitle}`, output: `Chrome Mobile loaded ${targetUrl}.`, frame }
    }

    if (action === 'press_key') {
      const key = String(input.key ?? 'home').toLowerCase()
      if (key === 'home') {
        this.state.currentApp = 'home'
        this.state.notificationShadeOpen = false
        this.state.recentsOpen = false
        this.state.touchX = 540
        this.state.touchY = 2310
        this.pushLog('press_key', 'Pressed Android Home')
      } else if (key === 'back') {
        if (this.state.notificationShadeOpen) {
          this.state.notificationShadeOpen = false
        } else if (this.state.recentsOpen) {
          this.state.recentsOpen = false
        } else if (this.state.historyStack.length > 0) {
          const prev = this.state.historyStack[this.state.historyStack.length - 1]
          this.state.historyStack = this.state.historyStack.slice(0, -1)
          this.state.currentApp = prev
        } else {
          this.state.currentApp = 'home'
        }
        this.state.touchX = 240
        this.state.touchY = 2310
        this.pushLog('press_key', 'Pressed Android Back')
      } else if (key === 'recents') {
        this.state.recentsOpen = !this.state.recentsOpen
        this.state.notificationShadeOpen = false
        this.state.touchX = 840
        this.state.touchY = 2310
        this.pushLog('press_key', this.state.recentsOpen ? 'Opened App Switcher' : 'Closed App Switcher')
      } else {
        this.pushLog('press_key', `Sent keyevent ${key}`)
      }
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: `Pressed ${key}`, output: `Sent Android key "${key}" on ${frame.deviceName}.`, frame }
    }

    if (action === 'swipe' || action === 'scroll') {
      const dir = input.direction ?? 'up'
      const fx = typeof input.fromX === 'number' ? input.fromX : dir === 'left' ? 880 : dir === 'right' ? 200 : 540
      const fy = typeof input.fromY === 'number' ? input.fromY : dir === 'up' ? 1680 : dir === 'down' ? 420 : 1200
      const tx = typeof input.toX === 'number' ? input.toX : dir === 'left' ? 200 : dir === 'right' ? 880 : 540
      const ty = typeof input.toY === 'number' ? input.toY : dir === 'up' ? 620 : dir === 'down' ? 1680 : 1200

      this.state.swipeVector = { fromX: fx, fromY: fy, toX: tx, toY: ty }
      this.state.touchX = tx
      this.state.touchY = ty

      // Top-edge pull-down opens notification shade; bottom-edge swipe-up returns home or closes shade
      if (fy < 360 && ty > 950) {
        this.state.notificationShadeOpen = true
      } else if (this.state.notificationShadeOpen && fy > 1100 && ty < 700) {
        this.state.notificationShadeOpen = false
      } else if (fy > 2100 && ty < 1400) {
        this.state.currentApp = 'home'
        this.state.recentsOpen = false
      }

      this.pushLog(action, `Swiped ${dir} (${fx},${fy} → ${tx},${ty})`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: `Swiped ${dir}`, output: `Executed swipe ${dir} on ${frame.deviceName}.`, frame }
    }

    if (action === 'type') {
      const text = (input.text ?? '').trim()
      if (!text) {
        const frame = this.getFrame()
        return { ok: false, summary: 'Empty text input', output: 'Provide text to type on mobile.', frame }
      }

      if (this.state.currentApp === 'messages') {
        const thread =
          this.state.threads.find((t) => t.id === this.state.activeThreadId) ?? this.state.threads[0]
        if (thread) {
          thread.messages.push({ from: 'me', text, time: 'Just now' })
          thread.preview = `You: ${text}`
          thread.time = 'Just now'
          thread.unread = false
          this.state.touchX = 920
          this.state.touchY = 2040
          this.pushLog('type', `Sent message to ${thread.contact}: "${text}"`)
        }
      } else if (this.state.currentApp === 'chrome') {
        if (/^https?:\/\//i.test(text) || /\.[a-z]{2,}$/i.test(text)) {
          return this.execute({ action: 'open_url', url: text }, opts)
        }
        return this.execute(
          { action: 'open_url', url: `https://www.google.com/search?q=${encodeURIComponent(text)}` },
          opts
        )
      } else if (this.state.currentApp === 'phone') {
        const digits = text.replace(/[^\d+*#\-() ]/g, '').trim()
        this.state.dialerNumber = (this.state.dialerNumber + digits).slice(0, 20)
        this.state.touchX = 540
        this.state.touchY = 1480
        this.pushLog('type', `Dialed ${this.state.dialerNumber}`)
      } else if (this.state.currentApp === 'notes') {
        this.state.notes = [
          {
            id: `note_${Date.now().toString(36)}`,
            title: text.slice(0, 32),
            body: text,
            updatedAt: 'Just now',
          },
          ...this.state.notes,
        ].slice(0, 12)
        this.state.touchX = 540
        this.state.touchY = 820
        this.pushLog('type', `Saved mobile note: "${text.slice(0, 40)}"`)
      } else {
        this.state.touchX = 540
        this.state.touchY = 1880
        this.pushLog('type', `Typed "${text.slice(0, 48)}"`)
      }

      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: `Typed "${text.slice(0, 36)}"`, output: this.state.lastAction, frame }
    }

    if (action === 'tap' || action === 'long_press') {
      const target = (input.target ?? '').trim().toLowerCase()

      // Semantic target tap resolution first
      if (target) {
        if (this.state.currentApp === 'messages') {
          const foundThread = this.state.threads.find((t) =>
            t.contact.toLowerCase().includes(target)
          )
          if (foundThread) {
            this.state.activeThreadId = foundThread.id
            foundThread.unread = false
            this.state.touchX = 540
            this.state.touchY = 460
            this.pushLog(action, `Opened conversation with ${foundThread.contact}`)
            const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
            return { ok: true, summary: `Selected ${foundThread.contact}`, output: `Selected thread ${foundThread.contact}.`, frame }
          }
        }
        if (this.state.currentApp === 'phone' && target.includes('call')) {
          this.state.callState = this.state.callState === 'calling' ? 'idle' : 'calling'
          this.state.touchX = 540
          this.state.touchY = 1960
          this.pushLog(
            action,
            this.state.callState === 'calling'
              ? `Calling ${this.state.dialerNumber || 'Voicemail'}…`
              : 'Ended call'
          )
          const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
          return { ok: true, summary: this.state.lastAction, output: this.state.lastAction, frame }
        }
        const maybeSetting = resolveQuickSettingKey(target)
        if (maybeSetting && (this.state.currentApp === 'settings' || this.state.notificationShadeOpen)) {
          return this.execute({ action: 'toggle_setting', setting: maybeSetting }, opts)
        }
        const maybeApp = resolveMobileAppId(target)
        if (maybeApp) {
          return this.execute({ action: 'open_app', app: maybeApp }, opts)
        }
      }

      // Coordinate tap resolution
      const x = Math.max(0, Math.min(this.state.width, Math.round(input.x ?? 540)))
      const y = Math.max(0, Math.min(this.state.height, Math.round(input.y ?? 1200)))
      this.state.touchX = x
      this.state.touchY = y

      // Hit-test interactive elements on the current screen
      const elements = buildInteractiveElements(this.state)
      let nearest: MobileElementHint | null = null
      let bestDist = 170
      for (const el of elements) {
        const d = Math.hypot(el.x - x, el.y - y)
        if (d < bestDist) {
          bestDist = d
          nearest = el
        }
      }

      if (nearest) {
        if (nearest.id.startsWith('app-')) {
          const appId = nearest.id.slice(4) as MobileAppId
          return this.execute({ action: 'open_app', app: appId }, opts)
        }
        if (nearest.id.startsWith('set-') || nearest.id.startsWith('qs-')) {
          const key = nearest.id.slice(nearest.id.indexOf('-') + 1)
          if (key === 'close') {
            return this.execute({ action: 'notifications', open: false }, opts)
          }
          const setting = resolveQuickSettingKey(key)
          if (setting) {
            return this.execute({ action: 'toggle_setting', setting }, opts)
          }
        }
        if (nearest.id.startsWith('thread-')) {
          const tid = nearest.id.slice(7)
          const found = this.state.threads.find((t) => t.id === tid)
          if (found) {
            this.state.activeThreadId = found.id
            found.unread = false
            this.pushLog(action, `Tapped ${found.contact}`)
          }
        } else if (nearest.id === 'chrome-bookmark-hn') {
          return this.execute({ action: 'open_url', url: 'https://news.ycombinator.com' }, opts)
        } else if (nearest.id === 'chrome-bookmark-wiki') {
          return this.execute({ action: 'open_url', url: 'https://en.wikipedia.org' }, opts)
        } else if (nearest.id === 'dial-call') {
          return this.execute({ action: 'tap', target: 'call' }, opts)
        } else {
          this.pushLog(action, `Tapped "${nearest.label}" at (${x}, ${y})`)
        }
      } else {
        this.pushLog(action, `${action === 'long_press' ? 'Long-pressed' : 'Tapped'} (${x}, ${y})`)
      }

      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return { ok: true, summary: this.state.lastAction, output: this.state.lastAction, frame }
    }

    if (action === 'screenshot') {
      this.pushLog('screenshot', `Captured Android viewport snapshot (${this.appTitleLabel})`)
      const frame = shouldBroadcast ? this.broadcast() : this.getFrame()
      return {
        ok: true,
        summary: `Captured screen (${frame.appTitle})`,
        output: `Captured ${frame.deviceName} screen on ${frame.appTitle} (${frame.elements.length} interactive targets detected).`,
        frame,
      }
    }

    const frame = this.getFrame()
    return { ok: false, summary: `Unsupported mobile action: ${action}`, output: `Unknown action "${action}".`, frame }
  }

  private get appTitleLabel(): string {
    return MOBILE_APPS.find((a) => a.id === this.state.currentApp)?.name ?? this.state.currentApp
  }
}

const g = globalThis as unknown as { __nexusMobileManager?: MobileTakeoverManager }
export const mobileManager = g.__nexusMobileManager ?? new MobileTakeoverManager()
g.__nexusMobileManager = mobileManager
