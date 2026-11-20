export type HapticStyle = 'selection' | 'light' | 'medium' | 'success' | 'warning'

export type PlatformRuntimeKind =
  | 'android-apk'
  | 'electron-desktop'
  | 'pwa-standalone'
  | 'web-browser'

export type NativeListenerState =
  | 'idle'
  | 'armed'
  | 'listening'
  | 'awaiting-permission'

export type NativeConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export interface NativeServiceState {
  listenerState: NativeListenerState
  connectionState: NativeConnectionState
  wakePhrase: string
  engine: string
  lastHeartbeatMs: number
  audioLevel: number
  nativeWakeSupported: boolean
}

export interface NativeWakeEvent {
  matchedPhrase: string
  trailingCommand: string
  transcript: string
  timestamp: number
  source: string
}

export interface AndroidBridgeRaw {
  getPlatformInfo?: () => string
  haptic?: (style: string) => void
  startVoiceService?: (statusText: string) => void
  stopVoiceService?: () => void
  startNativeWakeListener?: (wakePhrase: string, serverUrl: string) => void
  pauseNativeWakeListener?: (statusText: string) => void
  stopNativeWakeListener?: () => void
  getNativeServiceState?: () => string
  openServerPicker?: () => void
  setSystemBarsTheme?: (isDark: boolean) => void
  showToast?: (message: string) => void
  openExternalUrl?: (url: string) => boolean
}

export interface PlatformInfo {
  runtime: PlatformRuntimeKind
  label: string
  isAndroidApk: boolean
  isElectronDesktop: boolean
  isStandalonePwa: boolean
  nativeWakeSupported?: boolean
  serverUrl?: string
  deviceModel?: string
  appVersion?: string
  sdkInt?: number
}

interface BackHandlerEntry {
  id: number
  priority: number
  handler: () => boolean
}

declare global {
  interface Window {
    NexusAndroid?: AndroidBridgeRaw
    nexusDesktop?: {
      isElectron?: boolean
      platform?: string
      getDesktopInfo?: () => Promise<Record<string, unknown>>
      toggleAlwaysOnTop?: () => Promise<boolean>
      openExternal?: (url: string) => Promise<{ ok: boolean }>
    }
    __nexusAndroidHandleBack?: () => boolean
    __nexusAndroidStopVoice?: () => void
    __nexusAndroidOnWakeDetected?: (payload: string | Partial<NativeWakeEvent>) => void
    __nexusAndroidOnServiceState?: (state: string | Partial<NativeServiceState>) => void
  }
}

const backStack: BackHandlerEntry[] = []
let nextBackHandlerId = 1
let voiceStopListener: (() => void) | null = null
const wakeListeners = new Set<(event: NativeWakeEvent) => void>()
const serviceStateListeners = new Set<(state: NativeServiceState) => void>()
let bufferedWakeEvent: NativeWakeEvent | null = null
let latestServiceState: NativeServiceState | null = null

const WEB_VIBRATE_PATTERNS: Record<HapticStyle, number | number[]> = {
  selection: 10,
  light: 16,
  medium: 26,
  success: [16, 36, 20],
  warning: [28, 36, 28],
}

export function getAndroidBridge(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): AndroidBridgeRaw | null {
  if (!win) return null
  return win.NexusAndroid ?? null
}

export function hasNativeWakeListener(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  const android = getAndroidBridge(win)
  return Boolean(android?.startNativeWakeListener && android?.pauseNativeWakeListener)
}

/**
 * Normalizes a Cloud HTTPS URL, Wi-Fi LAN IP, or USB ADB host into a valid base server URL.
 * Mirrors ServerPrefs.normalizeUrl() in the native Android APK.
 */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  const explicitSchemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (explicitSchemeMatch && !/^https?$/i.test(explicitSchemeMatch[1])) {
    return ''
  }

  let candidate = trimmed
  if (!explicitSchemeMatch) {
    const lower = trimmed.toLowerCase()
    const isLocal =
      lower.startsWith('localhost') ||
      lower.startsWith('127.') ||
      lower.startsWith('10.') ||
      lower.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower) ||
      lower.endsWith('.local') ||
      lower.includes(':3000')
    candidate = `${isLocal ? 'http' : 'https'}://${trimmed}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    if (!parsed.hostname) return ''
    return candidate.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function detectPlatformInfo(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): PlatformInfo {
  if (!win) {
    return {
      runtime: 'web-browser',
      label: 'Web Browser',
      isAndroidApk: false,
      isElectronDesktop: false,
      isStandalonePwa: false,
    }
  }

  const android = getAndroidBridge(win)
  if (android) {
    let parsed: Record<string, unknown> = {}
    try {
      const raw = android.getPlatformInfo?.()
      if (raw) parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    return {
      runtime: 'android-apk',
      label: 'Android APK',
      isAndroidApk: true,
      isElectronDesktop: false,
      isStandalonePwa: false,
      nativeWakeSupported:
        Boolean(parsed.nativeWakeSupported) || hasNativeWakeListener(win),
      serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : undefined,
      deviceModel: typeof parsed.model === 'string' ? parsed.model : undefined,
      appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : undefined,
      sdkInt: typeof parsed.sdkInt === 'number' ? parsed.sdkInt : undefined,
    }
  }

  if (win.nexusDesktop?.isElectron) {
    return {
      runtime: 'electron-desktop',
      label: 'Desktop App',
      isAndroidApk: false,
      isElectronDesktop: true,
      isStandalonePwa: false,
    }
  }

  const standaloneMedia =
    typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches
  const iosStandalone = Boolean((win.navigator as Navigator & { standalone?: boolean })?.standalone)
  if (standaloneMedia || iosStandalone) {
    return {
      runtime: 'pwa-standalone',
      label: 'Installed App (PWA)',
      isAndroidApk: false,
      isElectronDesktop: false,
      isStandalonePwa: true,
    }
  }

  return {
    runtime: 'web-browser',
    label: 'Web Browser',
    isAndroidApk: false,
    isElectronDesktop: false,
    isStandalonePwa: false,
  }
}

/**
 * Triggers a crisp Material 3 tactile pulse via the native Kotlin Android bridge,
 * gracefully falling back to navigator.vibrate() on compatible mobile browsers.
 */
export function triggerHaptic(
  style: HapticStyle = 'selection',
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  if (!win) return false
  const android = getAndroidBridge(win)
  if (android?.haptic) {
    try {
      android.haptic(style)
      return true
    } catch {
      return false
    }
  }

  const nav = win.navigator
  if (nav && typeof nav.vibrate === 'function') {
    try {
      return Boolean(nav.vibrate(WEB_VIBRATE_PATTERNS[style]))
    } catch {
      return false
    }
  }
  return false
}

export function syncForegroundVoice(
  active: boolean,
  statusText = 'Eva Live Voice is listening',
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): void {
  const android = getAndroidBridge(win)
  if (!android) return
  try {
    if (active) {
      android.startVoiceService?.(statusText)
    } else {
      android.stopVoiceService?.()
    }
  } catch {
    // Non-fatal in case Android WebView bridge is tearing down
  }
}

export function startNativeWakeListener(
  wakePhrase = 'Hey Eva',
  serverUrl = typeof window !== 'undefined' ? window.location.origin : '',
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  const android = getAndroidBridge(win)
  if (!android?.startNativeWakeListener) return false
  try {
    android.startNativeWakeListener(wakePhrase, serverUrl)
    return true
  } catch {
    return false
  }
}

export function pauseNativeWakeListener(
  statusText = 'Eva is listening live…',
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  const android = getAndroidBridge(win)
  if (!android?.pauseNativeWakeListener) return false
  try {
    android.pauseNativeWakeListener(statusText)
    return true
  } catch {
    return false
  }
}

export function stopNativeWakeListener(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  const android = getAndroidBridge(win)
  if (!android) return false
  try {
    if (android.stopNativeWakeListener) {
      android.stopNativeWakeListener()
    } else {
      android.stopVoiceService?.()
    }
    return true
  } catch {
    return false
  }
}

function parseNativeServiceState(
  raw: string | Partial<NativeServiceState> | null | undefined
): NativeServiceState | null {
  if (!raw) return null
  try {
    const obj: Partial<NativeServiceState> =
      typeof raw === 'string' ? (JSON.parse(raw) as Partial<NativeServiceState>) : raw
    const listenerState: NativeListenerState =
      obj.listenerState === 'armed' ||
      obj.listenerState === 'listening' ||
      obj.listenerState === 'awaiting-permission'
        ? obj.listenerState
        : 'idle'
    const connectionState: NativeConnectionState =
      obj.connectionState === 'connected' || obj.connectionState === 'reconnecting'
        ? obj.connectionState
        : 'disconnected'
    return {
      listenerState,
      connectionState,
      wakePhrase: typeof obj.wakePhrase === 'string' && obj.wakePhrase.trim() ? obj.wakePhrase : 'Hey Eva',
      engine: typeof obj.engine === 'string' ? obj.engine : 'android-speech',
      lastHeartbeatMs: typeof obj.lastHeartbeatMs === 'number' ? obj.lastHeartbeatMs : 0,
      audioLevel: typeof obj.audioLevel === 'number' ? obj.audioLevel : 0,
      nativeWakeSupported: obj.nativeWakeSupported !== false,
    }
  } catch {
    return null
  }
}

function parseNativeWakeEvent(
  raw: string | Partial<NativeWakeEvent> | null | undefined
): NativeWakeEvent | null {
  if (!raw) return null
  try {
    const obj: Partial<NativeWakeEvent> =
      typeof raw === 'string' ? (JSON.parse(raw) as Partial<NativeWakeEvent>) : raw
    return {
      matchedPhrase:
        typeof obj.matchedPhrase === 'string' && obj.matchedPhrase.trim()
          ? obj.matchedPhrase.trim()
          : 'Hey Eva',
      trailingCommand: typeof obj.trailingCommand === 'string' ? obj.trailingCommand.trim() : '',
      transcript: typeof obj.transcript === 'string' ? obj.transcript.trim() : '',
      timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now(),
      source: typeof obj.source === 'string' ? obj.source : 'android-foreground-service',
    }
  } catch {
    return null
  }
}

export function getNativeServiceState(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): NativeServiceState | null {
  const android = getAndroidBridge(win)
  if (!android?.getNativeServiceState) return latestServiceState
  try {
    const parsed = parseNativeServiceState(android.getNativeServiceState())
    if (parsed) latestServiceState = parsed
    return parsed
  } catch {
    return latestServiceState
  }
}

/**
 * Subscribes to native "Hey Eva" wake events broadcast from EvaVoiceForegroundService -> MainActivity.
 * Immediately replays any buffered wake event that arrived before the WebView mounted React hooks.
 */
export function onAndroidWakeDetected(
  listener: (event: NativeWakeEvent) => void,
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): () => void {
  wakeListeners.add(listener)
  ensureGlobalAndroidHooks(win)
  if (bufferedWakeEvent) {
    const queued = bufferedWakeEvent
    bufferedWakeEvent = null
    try {
      listener(queued)
    } catch {
      // Ignore subscriber error
    }
  }
  return () => {
    wakeListeners.delete(listener)
  }
}

export function onAndroidServiceStateChange(
  listener: (state: NativeServiceState) => void,
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): () => void {
  serviceStateListeners.add(listener)
  ensureGlobalAndroidHooks(win)
  const current = getNativeServiceState(win)
  if (current) {
    try {
      listener(current)
    } catch {
      // Ignore
    }
  }
  return () => {
    serviceStateListeners.delete(listener)
  }
}

export function syncSystemBarsTheme(
  isDark: boolean,
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): void {
  const android = getAndroidBridge(win)
  if (!android?.setSystemBarsTheme) return
  try {
    android.setSystemBarsTheme(isDark)
  } catch {
    // Ignore
  }
}

export function openAndroidServerPicker(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  const android = getAndroidBridge(win)
  if (!android?.openServerPicker) return false
  try {
    triggerHaptic('light', win)
    android.openServerPicker()
    return true
  } catch {
    return false
  }
}

/**
 * Registers a back-gesture handler with numeric priority (higher priority runs first).
 * Returns an unsubscribe cleanup function.
 */
export function registerBackHandler(handler: () => boolean, priority = 0): () => void {
  const id = nextBackHandlerId++
  backStack.push({ id, priority, handler })
  ensureGlobalAndroidHooks()
  return () => {
    const idx = backStack.findIndex((entry) => entry.id === id)
    if (idx !== -1) backStack.splice(idx, 1)
  }
}

export function dispatchAndroidBack(): boolean {
  // Higher priority first; for equal priority, LIFO (most recently opened surface first)
  const ordered = [...backStack].sort((a, b) => b.priority - a.priority || b.id - a.id)
  for (const entry of ordered) {
    try {
      if (entry.handler()) {
        triggerHaptic('selection')
        return true
      }
    } catch {
      // Continue unwinding remaining handlers
    }
  }
  return false
}

export function setAndroidVoiceStopListener(listener: (() => void) | null): void {
  voiceStopListener = listener
  ensureGlobalAndroidHooks()
}

export function ensureGlobalAndroidHooks(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): void {
  if (!win) return
  win.__nexusAndroidHandleBack = () => dispatchAndroidBack()
  win.__nexusAndroidStopVoice = () => {
    voiceStopListener?.()
  }
  win.__nexusAndroidOnWakeDetected = (rawPayload) => {
    const event = parseNativeWakeEvent(rawPayload)
    if (!event) return
    triggerHaptic('success', win)
    if (wakeListeners.size === 0) {
      bufferedWakeEvent = event
      return
    }
    for (const listener of wakeListeners) {
      try {
        listener(event)
      } catch {
        // Continue delivering to other listeners
      }
    }
  }
  win.__nexusAndroidOnServiceState = (rawState) => {
    const parsed = parseNativeServiceState(rawState)
    if (!parsed) return
    latestServiceState = parsed
    for (const listener of serviceStateListeners) {
      try {
        listener(parsed)
      } catch {
        // Ignore
      }
    }
  }
}

export function __resetBackHandlersForTest(): void {
  backStack.length = 0
  voiceStopListener = null
  wakeListeners.clear()
  serviceStateListeners.clear()
  bufferedWakeEvent = null
  latestServiceState = null
}
