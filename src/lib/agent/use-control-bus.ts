'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useApp } from '@/lib/agent/store'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import type { Tab } from '@/lib/agent/client'
import type {
  AutomationSessionSnapshot,
  BrowserFramePayload,
  CursorEventPayload,
  DesktopFramePayload,
  MobileFramePayload,
  PermissionRequestPayload,
} from '@/lib/agent/control-bus'
import type { ReasoningChain } from '@/lib/agent/reasoning-chain'
import type { BrainTraceEvent } from '@/lib/agent/brain-trace'
import type { SelfHealSession } from '@/lib/agent/self-heal'
import type { TerminalSessionSnapshot } from '@/lib/agent/terminal-types'
import type { VoiceStageCard } from '@/lib/agent/voice-stage-types'

const VALID_TABS = new Set<Tab>([
  'agent',
  'org',
  'automations',
  'brain',
  'artifacts',
  'marketplace',
  'plugins',
  'skills',
  'tools',
  'mcps',
  'memory',
])

const VALID_SPLIT_MODES = new Set<SplitMode>([
  'reasoning',
  'self_heal',
  'browser',
  'terminal',
  'mobile',
  'identity',
  'permissions',
  'devices',
  'org',
  'artifacts',
  'tools',
  'automations',
  'brain',
  'google_workspace',
])

function findClickableTarget(selector?: string, label?: string): HTMLElement | null {
  if (selector) {
    try {
      const el = document.querySelector<HTMLElement>(selector)
      if (el) return el
    } catch {
      /* invalid CSS selector, fall through to label lookup */
    }
  }
  if (label) {
    const targetLower = label.trim().toLowerCase()
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, a, [role="button"], [data-eva-target]')
    )
    const exact = candidates.find(
      (el) =>
        (el.textContent ?? '').trim().toLowerCase() === targetLower ||
        (el.getAttribute('aria-label') ?? '').trim().toLowerCase() === targetLower ||
        (el.getAttribute('data-eva-target') ?? '').trim().toLowerCase() === targetLower
    )
    if (exact) return exact
    const partial = candidates.find(
      (el) =>
        (el.textContent ?? '').trim().toLowerCase().includes(targetLower) ||
        (el.getAttribute('aria-label') ?? '').trim().toLowerCase().includes(targetLower)
    )
    if (partial) return partial
  }
  return null
}

/**
 * Maintains a persistent WebSocket connection to `/api/control` so Eva (and her subagents)
 * can drive the app UI, split-screen panels, live browser frames, animated AI cursor,
 * interactive permission popups, and connected device statuses in real time.
 */
export function useControlBus() {
  const { setTheme } = useTheme()
  const setThemeRef = useRef(setTheme)
  setThemeRef.current = setTheme

  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let closed = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    // Initial hydration of grants, paired devices, reasoning chains, brain context packs, traces, and self-heal sessions
    void useEvaControl.getState().refreshPermissions()
    void useEvaControl.getState().refreshDevices()
    void useEvaControl.getState().refreshComputerControl()
    void useEvaControl.getState().refreshTerminal()
    void useEvaControl.getState().refreshReasoningChains()
    void useEvaControl.getState().refreshContextPacks()
    void useEvaControl.getState().refreshBrainTraces()
    void useEvaControl.getState().refreshSelfHealSessions()

    // Listen for Electron global hotkeys (Alt+Space Screen Awareness, Alt+Shift+D Quick Dictation)
    const desktopBridge = (
      window as unknown as {
        nexusDesktop?: {
          onHotkeyScreenAwareness?: (
            cb: (payload?: {
              dataUrl?: string
              base64?: string
              mimeType?: string
              name?: string
            } | null) => void
          ) => () => void
          onHotkeyDictation?: (cb: () => void) => () => void
        }
      }
    ).nexusDesktop

    const offScreenHotkey = desktopBridge?.onHotkeyScreenAwareness?.((payload) => {
      const captured =
        payload?.dataUrl && payload?.base64
          ? {
              dataUrl: payload.dataUrl,
              base64: payload.base64,
              mimeType: payload.mimeType || 'image/jpeg',
              name: payload.name,
            }
          : null
      useEvaControl.getState().openScreenHud('screen', captured)
    })

    const offDictationHotkey = desktopBridge?.onHotkeyDictation?.(() => {
      useEvaControl.getState().openScreenHud('dictation')
    })

    // In-browser keyboard shortcuts: Alt+Shift+S (Screen Glance), Alt+Shift+D (Quick Dictation)
    const onGlobalKeyDown = (ev: KeyboardEvent) => {
      if (!ev.altKey || !ev.shiftKey) return
      const key = ev.key.toLowerCase()
      if (key === 's') {
        ev.preventDefault()
        useEvaControl.getState().openScreenHud('screen')
      } else if (key === 'd') {
        ev.preventDefault()
        useEvaControl.getState().openScreenHud('dictation')
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown)

    const ignoreRuntimeError = (text: string) =>
      !text ||
      /ResizeObserver loop|WebSocket|HMR|hot-reloader|Loading chunk|AbortError/i.test(text)

    const onWindowError = (ev: ErrorEvent) => {
      const message = ev.message || ev.error?.message || ''
      if (ignoreRuntimeError(message)) return
      useEvaControl.getState().setRuntimeErrorAlert({
        message: message.slice(0, 320),
        stack: typeof ev.error?.stack === 'string' ? ev.error.stack.slice(0, 1400) : undefined,
        source: ev.filename ? `${ev.filename}:${ev.lineno ?? 0}` : 'window.error',
        timestamp: new Date().toISOString(),
      })
    }

    const onUnhandledRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : ''
      if (ignoreRuntimeError(message)) return
      useEvaControl.getState().setRuntimeErrorAlert({
        message: message.slice(0, 320),
        stack: reason instanceof Error && reason.stack ? reason.stack.slice(0, 1400) : undefined,
        source: 'unhandledrejection',
        timestamp: new Date().toISOString(),
      })
    }

    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    const scheduleCursorHide = () => {
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current)
      cursorTimerRef.current = setTimeout(() => {
        useEvaControl.getState().hideCursor()
      }, 3400)
    }

    const handleMessage = (raw: string) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return
      }

      const type = String(msg.type ?? '')
      const ctrl = useEvaControl.getState()
      const app = useApp.getState()

      if (type === 'control:init') {
        if (msg.browserFrame) {
          ctrl.setBrowserFrame(msg.browserFrame as BrowserFramePayload)
        }
        if (msg.desktopFrame) {
          ctrl.setDesktopFrame(msg.desktopFrame as DesktopFramePayload)
        }
        if (msg.automationSession) {
          ctrl.setAutomationSession(msg.automationSession as AutomationSessionSnapshot)
        }
        if (msg.terminalSnapshot) {
          ctrl.setTerminalSnapshot(msg.terminalSnapshot as TerminalSessionSnapshot)
        }
        if (msg.voiceStageCard) {
          ctrl.setVoiceStageCard(msg.voiceStageCard as VoiceStageCard)
        }
        if (msg.mobileFrame) {
          ctrl.setMobileFrame(msg.mobileFrame as MobileFramePayload)
        }
        if (Array.isArray(msg.pendingPermissions)) {
          ctrl.setPendingPermissions(msg.pendingPermissions as PermissionRequestPayload[])
        }
        if (Array.isArray(msg.onlineDeviceIds)) {
          ctrl.setOnlineDeviceIds(msg.onlineDeviceIds.map(String))
        }
        if (Array.isArray(msg.reasoningChains)) {
          ctrl.setReasoningChains(msg.reasoningChains as ReasoningChain[])
        }
        if (Array.isArray(msg.brainTraces)) {
          ctrl.setBrainTraces(msg.brainTraces as BrainTraceEvent[])
        }
        if (Array.isArray(msg.selfHealSessions)) {
          ctrl.setSelfHealSessions(msg.selfHealSessions as SelfHealSession[])
        }
        return
      }

      if (type === 'reasoning:update' && msg.chain) {
        ctrl.upsertReasoningChain(msg.chain as ReasoningChain)
        return
      }

      if (type === 'reasoning:clear') {
        ctrl.setReasoningChains([])
        return
      }

      if (type === 'brain:trace' && msg.item) {
        ctrl.pushBrainTrace(msg.item as BrainTraceEvent)
        return
      }

      if (type === 'brain:trace_clear') {
        ctrl.setBrainTraces([])
        return
      }

      if (type === 'self_heal:update' && msg.session) {
        ctrl.upsertSelfHealSession(msg.session as SelfHealSession)
        return
      }

      if (type === 'browser:frame') {
        const frame = (msg.frame ?? null) as BrowserFramePayload | null
        ctrl.setBrowserFrame(frame)
        return
      }

      if (type === 'desktop:frame') {
        const frame = (msg.frame ?? null) as DesktopFramePayload | null
        ctrl.setDesktopFrame(frame)
        return
      }

      if (type === 'automation:session') {
        const session = (msg.session ?? null) as AutomationSessionSnapshot | null
        ctrl.setAutomationSession(session)
        return
      }

      if (type === 'terminal:snapshot' || type === 'terminal:entry') {
        if (msg.snapshot) {
          ctrl.setTerminalSnapshot(msg.snapshot as TerminalSessionSnapshot)
        }
        return
      }

      if (type === 'mobile:frame') {
        const frame = (msg.frame ?? null) as MobileFramePayload | null
        ctrl.setMobileFrame(frame)
        return
      }

      if (type === 'voice_stage:present' && msg.card) {
        ctrl.setVoiceStageCard(msg.card as VoiceStageCard)
        return
      }

      if (type === 'voice_stage:dismiss') {
        ctrl.dismissVoiceStageCard(typeof msg.id === 'string' ? msg.id : undefined)
        return
      }

      if (type === 'cursor:update') {
        const payload: CursorEventPayload = {
          visible: Boolean(msg.visible),
          x: typeof msg.x === 'number' ? msg.x : undefined,
          y: typeof msg.y === 'number' ? msg.y : undefined,
          selector: typeof msg.selector === 'string' ? msg.selector : undefined,
          label: typeof msg.label === 'string' ? msg.label : undefined,
          clicking: Boolean(msg.clicking),
          actor: typeof msg.actor === 'string' ? msg.actor : 'Eva',
        }
        ctrl.updateCursor(payload)
        if (payload.visible) scheduleCursorHide()
        return
      }

      if (type === 'eva:mood') {
        const mood = typeof msg.mood === 'string' ? msg.mood : null
        const note = typeof msg.note === 'string' ? msg.note : null
        const durationMs = typeof msg.durationMs === 'number' ? msg.durationMs : 2400
        ctrl.setTransientMood(mood, note)
        if (moodTimerRef.current) clearTimeout(moodTimerRef.current)
        if (mood) {
          moodTimerRef.current = setTimeout(() => {
            useEvaControl.getState().setTransientMood(null, null)
          }, Math.min(45_000, Math.max(800, durationMs)))
        }
        return
      }

      if (type === 'permission:request' && msg.request) {
        ctrl.pushPendingPermission(msg.request as PermissionRequestPayload)
        return
      }

      if (type === 'permission:resolved') {
        const reqId = String(msg.requestId ?? '')
        if (reqId) ctrl.removePendingPermission(reqId)
        void ctrl.refreshPermissions()
        return
      }

      if (type === 'permission:grants_updated') {
        void ctrl.refreshPermissions()
        return
      }

      if (type === 'device:status' && Array.isArray(msg.onlineDeviceIds)) {
        ctrl.setOnlineDeviceIds(msg.onlineDeviceIds.map(String))
        void ctrl.refreshDevices()
        return
      }

      if (type === 'ui:command') {
        const command = String(msg.command ?? '')

        if (command === 'navigate_tab') {
          const tab = String(msg.tab ?? '') as Tab
          if (VALID_TABS.has(tab)) {
            app.setTab(tab)
            ctrl.updateCursor({
              visible: true,
              selector: `[data-eva-target="nav-${tab}"]`,
              label: `Eva · ${tab}`,
              clicking: true,
              actor: 'Eva',
            })
            scheduleCursorHide()
          }
          return
        }

        if (command === 'open_split') {
          const mode = String(msg.mode ?? 'browser') as SplitMode
          if (VALID_SPLIT_MODES.has(mode)) {
            ctrl.openSplit(mode, typeof msg.title === 'string' ? msg.title : undefined)
            if (mode === 'permissions') void ctrl.refreshPermissions()
            if (mode === 'devices') void ctrl.refreshDevices()
            if (mode === 'terminal') void ctrl.refreshTerminal()
            if (mode === 'identity') void ctrl.refreshIdentity()
            if (mode === 'reasoning') void ctrl.refreshReasoningChains()
            if (mode === 'self_heal') void ctrl.refreshSelfHealSessions()
          }
          return
        }

        if (command === 'close_split') {
          ctrl.closeSplit()
          return
        }

        if (command === 'set_layout_mode') {
          const mode = msg.mode === 'focus' ? 'focus' : 'standard'
          ctrl.setLayoutMode(mode)
          return
        }

        if (command === 'toggle_sidebar') {
          if (typeof msg.collapsed === 'boolean') {
            ctrl.setSidebarCollapsed(msg.collapsed)
          } else {
            ctrl.toggleSidebarCollapsed()
          }
          return
        }

        if (command === 'open_gbrain_graph') {
          ctrl.setGbrainGraphOpen(true)
          return
        }

        if (command === 'open_popup') {
          const id = String(msg.id ?? `pop_${Date.now()}`)
          const title = String(msg.title ?? 'Eva Notice')
          const body = String(msg.body ?? '')
          const kind = (msg.kind === 'action' || msg.kind === 'preview' ? msg.kind : 'info') as
            | 'info'
            | 'action'
            | 'preview'
          const actions = Array.isArray(msg.actions)
            ? (msg.actions as { label: string; tab?: string; splitMode?: string; url?: string }[])
            : undefined
          ctrl.pushPopup({ id, title, body, kind, actions })
          if (ctrl.layoutMode === 'focus') {
            ctrl.setVoiceStageCard({
              id,
              kind: 'card',
              title,
              body,
              actions,
              sourceTool: 'app_control',
              createdAt: new Date().toISOString(),
            })
          }
          return
        }

        if (command === 'close_popup') {
          const id = typeof msg.id === 'string' ? msg.id : undefined
          ctrl.dismissPopup(id)
          ctrl.dismissVoiceStageCard(id)
          return
        }

        if (command === 'click_target') {
          const selector = typeof msg.selector === 'string' ? msg.selector : undefined
          const label = typeof msg.label === 'string' ? msg.label : undefined
          const target = findClickableTarget(selector, label)
          if (target) {
            const rect = target.getBoundingClientRect()
            const x = rect.left + rect.width / 2
            const y = rect.top + rect.height / 2
            ctrl.updateCursor({
              visible: true,
              x,
              y,
              label: `Eva · ${label || target.textContent?.trim().slice(0, 24) || 'click'}`,
              clicking: true,
              actor: 'Eva',
            })
            scheduleCursorHide()
            setTimeout(() => {
              target.click()
            }, 260)
          }
          return
        }

        if (command === 'set_theme') {
          const theme = msg.theme === 'light' ? 'light' : 'dark'
          setThemeRef.current(theme)
          return
        }

        if (command === 'refresh_state') {
          const scopes = Array.isArray(msg.scopes) ? msg.scopes.map(String) : ['all']
          const hasAll = scopes.includes('all')
          if (hasAll || scopes.includes('plugins')) void app.refreshPlugins()
          if (hasAll || scopes.includes('skills')) void app.refreshSkills()
          if (hasAll || scopes.includes('tools')) void app.refreshTools()
          if (hasAll || scopes.includes('mcps')) void app.refreshMcps()
          if (hasAll || scopes.includes('org')) void app.refreshOrg()
          if (hasAll || scopes.includes('artifacts')) void app.refreshArtifacts()
          if (hasAll || scopes.includes('automations')) void app.refreshAutomations()
          if (hasAll || scopes.includes('brain')) void app.refreshBrain()
          if (hasAll || scopes.includes('permissions')) void ctrl.refreshPermissions()
          if (hasAll || scopes.includes('devices')) void ctrl.refreshDevices()
          if (hasAll || scopes.includes('identity')) void ctrl.refreshIdentity()
        }
      }
    }

    const connect = () => {
      if (closed) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/api/control`
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }

      ws.onopen = () => {
        attempt = 0
        useEvaControl.getState().setControlConnected(true)
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          handleMessage(event.data)
        }
      }

      ws.onclose = () => {
        useEvaControl.getState().setControlConnected(false)
        ws = null
        if (!closed) scheduleReconnect()
      }

      ws.onerror = () => {
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
      }
    }

    const scheduleReconnect = () => {
      if (closed) return
      const delay = Math.min(12_000, 800 * Math.pow(1.6, attempt))
      attempt += 1
      reconnectTimer = setTimeout(connect, delay)
    }

    connect()

    return () => {
      closed = true
      offScreenHotkey?.()
      offDictationHotkey?.()
      window.removeEventListener('keydown', onGlobalKeyDown)
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current)
      if (moodTimerRef.current) clearTimeout(moodTimerRef.current)
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      useEvaControl.getState().setControlConnected(false)
    }
  }, [])
}
