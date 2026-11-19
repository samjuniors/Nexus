'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useApp } from '@/lib/agent/store'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import type { Tab } from '@/lib/agent/client'
import type {
  BrowserFramePayload,
  CursorEventPayload,
  PermissionRequestPayload,
} from '@/lib/agent/control-bus'
import type { ReasoningChain } from '@/lib/agent/reasoning-chain'

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
  'browser',
  'identity',
  'permissions',
  'devices',
  'org',
  'artifacts',
  'tools',
  'automations',
  'brain',
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

    // Initial hydration of grants, paired devices, and recent reasoning chains
    void useEvaControl.getState().refreshPermissions()
    void useEvaControl.getState().refreshDevices()
    void useEvaControl.getState().refreshReasoningChains()

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
        if (Array.isArray(msg.pendingPermissions)) {
          ctrl.setPendingPermissions(msg.pendingPermissions as PermissionRequestPayload[])
        }
        if (Array.isArray(msg.onlineDeviceIds)) {
          ctrl.setOnlineDeviceIds(msg.onlineDeviceIds.map(String))
        }
        if (Array.isArray(msg.reasoningChains)) {
          ctrl.setReasoningChains(msg.reasoningChains as ReasoningChain[])
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

      if (type === 'browser:frame') {
        const frame = (msg.frame ?? null) as BrowserFramePayload | null
        ctrl.setBrowserFrame(frame)
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
            if (mode === 'identity') void ctrl.refreshIdentity()
            if (mode === 'reasoning') void ctrl.refreshReasoningChains()
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
          return
        }

        if (command === 'close_popup') {
          ctrl.dismissPopup(typeof msg.id === 'string' ? msg.id : undefined)
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
