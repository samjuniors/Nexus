'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, FolderCheck, Laptop, Monitor, MonitorSmartphone, Pin, Plus, Shield, Smartphone, Terminal, Trash2 } from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

interface NexusDesktopBridge {
  isElectron?: boolean
  platform?: string
  toggleAlwaysOnTop?: () => Promise<boolean>
  getDesktopInfo?: () => Promise<{ hostname?: string; alwaysOnTop?: boolean; appUrl?: string }>
}

/**
 * Connected Devices panel — unified Web + Electron Desktop control.
 * Supports both the token-paired Local OS Companion Bridge (for deployed Web apps)
 * and the native Electron Desktop Shell (`/electron`).
 */
export function DevicesPanel() {
  const devices = useEvaControl((s) => s.devices)
  const connectedFolders = useEvaControl((s) => s.connectedFolders)
  const allowedApps = useEvaControl((s) => s.allowedApps)
  const computerBusy = useEvaControl((s) => s.computerControlBusy)
  const refreshDevices = useEvaControl((s) => s.refreshDevices)
  const refreshComputerControl = useEvaControl((s) => s.refreshComputerControl)
  const pairDevice = useEvaControl((s) => s.pairDevice)
  const revokeDevice = useEvaControl((s) => s.revokeDevice)
  const openSplit = useEvaControl((s) => s.openSplit)
  const captureWindowsScreen = useEvaControl((s) => s.captureWindowsScreen)

  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux' | 'android' | 'ios'>('windows')
  const [pairing, setPairing] = useState(false)
  const [freshToken, setFreshToken] = useState<{
    deviceName: string
    token: string
    platform: 'macos' | 'windows' | 'linux' | 'android' | 'ios'
  } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)

  useEffect(() => {
    void refreshDevices()
    void refreshComputerControl()
  }, [refreshDevices, refreshComputerControl])

  const desktopBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { nexusDesktop?: NexusDesktopBridge }).nexusDesktop
      : undefined
  const isElectron = Boolean(desktopBridge?.isElectron)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  const wsOrigin = origin.replace(/^http/, 'ws')

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean =
      name.trim() ||
      (platform === 'android' ? 'My Android Phone' : platform === 'ios' ? 'My iPhone' : 'My Computer')
    setPairing(true)
    try {
      const res = await pairDevice(clean, platform)
      if (res) {
        setFreshToken({ deviceName: res.device.name, token: res.pairingToken, platform })
        setName('')
      }
    } finally {
      setPairing(false)
    }
  }

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1800)
  }

  const isFreshMobile = freshToken?.platform === 'android' || freshToken?.platform === 'ios'
  const isFreshWindows = freshToken?.platform === 'windows'
  const oneLineCommand = freshToken
    ? isFreshMobile
      ? `curl -fsSL "${origin}/api/devices/mobile-runner" -o nexus-android-bridge.mjs && NEXUS_WS_URL="${wsOrigin}/api/device-bridge" NEXUS_DEVICE_TOKEN="${freshToken.token}" node nexus-android-bridge.mjs`
      : `curl -fsSL "${origin}/api/devices/runner" -o nexus-companion.mjs && NEXUS_WS_URL="${wsOrigin}/api/device-bridge" NEXUS_DEVICE_TOKEN="${freshToken.token}" node nexus-companion.mjs`
    : ''
  const windowsPsCommand = freshToken
    ? `Invoke-WebRequest "${origin}/api/devices/runner" -OutFile nexus-companion.mjs; $env:NEXUS_WS_URL="${wsOrigin}/api/device-bridge"; $env:NEXUS_DEVICE_TOKEN="${freshToken.token}"; node nexus-companion.mjs`
    : ''

  const electronCommand = `cd electron && npm install && NEXUS_APP_URL="${origin}" npm start`

  const handleTogglePin = async () => {
    if (!desktopBridge?.toggleAlwaysOnTop) return
    const next = await desktopBridge.toggleAlwaysOnTop()
    setAlwaysOnTop(next)
  }

  return (
    <div data-devices-panel="1" className="nice-scroll flex h-full min-h-0 flex-col overflow-y-auto bg-background p-4 pb-28">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold">Connected Computers &amp; Phones</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Manage your computer or Android phone from the deployed Web app via companion bridges, or run the native Electron Desktop App.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => openSplit('mobile', 'Android & Mobile Control')}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2 py-1 font-mono text-[10.5px] text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            <Smartphone className="h-3 w-3" />
            Mobile Takeover
          </button>
          <a
            href="/api/devices/mobile-runner"
            download="nexus-android-bridge.mjs"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[10.5px] text-secondary-foreground hover:bg-accent"
          >
            <Download className="h-3 w-3" />
            ADB Bridge
          </a>
          <a
            href="/api/devices/runner"
            download="nexus-companion.mjs"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[10.5px] text-secondary-foreground hover:bg-accent"
          >
            <Download className="h-3 w-3" />
            Desktop Runner
          </a>
        </div>
      </div>

      {/* Native Electron Desktop App Card */}
      <div
        data-electron-desktop-card="1"
        className="mt-3 space-y-2.5 rounded-lg border border-border bg-card/50 p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <MonitorSmartphone className="h-3.5 w-3.5 text-sky-500" />
              Electron Desktop Shell
              {isElectron && (
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                  · Running Native
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Launch Nexus as a native Windows, macOS, or Linux overlay with global hotkeys (<kbd className="font-mono">Alt+Space</kbd> Screen Awareness, <kbd className="font-mono">Alt+Shift+D</kbd> Quick Dictation, <kbd className="font-mono">Ctrl+Shift+E</kbd> Eva Focus).
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {isElectron && (
              <button
                type="button"
                onClick={() => void handleTogglePin()}
                className={cn(
                  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                  alwaysOnTop
                    ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                )}
              >
                <Pin className="h-3 w-3" />
                {alwaysOnTop ? 'Pinned' : 'Pin Top'}
              </button>
            )}
            <a
              href="/api/devices/electron"
              download="nexus-electron-config.json"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 font-mono text-[10.5px] text-foreground hover:bg-muted"
            >
              <Download className="h-3 w-3" />
              Config
            </a>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <code className="nice-scroll overflow-x-auto font-mono text-[10.5px] text-foreground">
            {electronCommand}
          </code>
          <button
            type="button"
            onClick={() => copyText('electron', electronCommand)}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] hover:bg-muted"
          >
            {copiedKey === 'electron' ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copiedKey === 'electron' ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Pair new computer form (Web -> Local Machine Bridge) */}
      <form
        onSubmit={handlePair}
        className="mt-3 space-y-2.5 rounded-lg border border-border bg-card/40 p-3"
      >
        <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          Pair Computer or Android Phone (Companion Bridge)
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              platform === 'android'
                ? 'e.g. Pixel 9 Pro'
                : platform === 'ios'
                  ? 'e.g. iPhone 16'
                  : platform === 'windows'
                    ? 'e.g. Windows Workstation'
                    : 'e.g. MacBook Pro'
            }
            aria-label="Device name"
            className="h-8 min-w-36 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-emerald-400/60"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'macos' | 'windows' | 'linux' | 'android' | 'ios')}
            aria-label="Device platform"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none"
          >
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
            <option value="android">Android (ADB)</option>
            <option value="ios">iOS</option>
          </select>
          <button
            type="submit"
            disabled={pairing}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Pair
          </button>
        </div>
      </form>

      {/* One-time pairing token & copyable launch command */}
      {freshToken && (
        <div
          data-pairing-token-card="1"
          className="mt-3 space-y-2 rounded-lg border border-emerald-500/35 bg-emerald-500/8 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
              <Terminal className="h-3.5 w-3.5" />
              Paired: {freshToken.deviceName}
            </span>
            <button
              type="button"
              onClick={() => copyText('cmd', oneLineCommand)}
              className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10.5px] hover:bg-accent"
            >
              {copiedKey === 'cmd' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copiedKey === 'cmd' ? 'Copied' : 'Copy Command'}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {isFreshMobile
              ? 'Run this on a host with ADB + USB or Wireless Debugging enabled (requires Node 22+ and adb). Save this token now — it is hashed on the server.'
              : isFreshWindows
                ? 'Run in Windows PowerShell (requires Node 22+). Your Connected Folders and Allowed Apps policies sync automatically on connect.'
                : "Run this once in your computer's terminal (requires Node 22+). Save this token now — it is hashed on the server."}
          </p>
          {isFreshWindows && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Windows PowerShell
                </span>
                <button
                  type="button"
                  onClick={() => copyText('ps', windowsPsCommand)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] hover:bg-accent"
                >
                  {copiedKey === 'ps' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copiedKey === 'ps' ? 'Copied' : 'Copy PowerShell'}
                </button>
              </div>
              <pre className="nice-scroll overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-foreground">
                {windowsPsCommand}
              </pre>
            </div>
          )}
          <div className="space-y-1">
            {isFreshWindows && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Bash / Git Bash / macOS / Linux
              </span>
            )}
            <pre className="nice-scroll overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-foreground">
              {oneLineCommand}
            </pre>
          </div>
        </div>
      )}

      {/* Synced Connected Folders & Allowed Apps Summary Strip */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <FolderCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span className="font-mono tabular-nums text-foreground">
            {connectedFolders.filter((f) => f.enabled).length} folders
          </span>
          <span>·</span>
          <span className="font-mono tabular-nums text-foreground">
            {allowedApps.filter((a) => a.policy === 'always').length} auto-allowed apps
          </span>
          <span>synced to Windows bridges</span>
        </div>
        <button
          type="button"
          onClick={() => openSplit('permissions', 'Permissions & Access Controls')}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <Shield className="h-3 w-3" />
          Manage Allowlists
        </button>
      </div>

      {/* Paired devices list */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          <span>Paired Devices</span>
          <span className="tabular-nums">{devices.length}</span>
        </div>

        {devices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
            No computers paired yet. Eva can still control the Live Split Browser and this entire workspace without pairing a desktop computer.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
            {devices.map((dev) => (
              <div key={dev.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        dev.status === 'online' ? 'bg-emerald-400 pulse-dot' : 'bg-muted-foreground/40'
                      )}
                    />
                    <span className="truncate text-xs font-semibold text-foreground">{dev.name}</span>
                    {dev.id === 'local_host' && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                        Host PC
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {dev.platform} · {dev.status}
                    {dev.lastSeenAt && ` · seen ${new Date(dev.lastSeenAt).toLocaleTimeString()}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {dev.status === 'online' && dev.platform !== 'android' && dev.platform !== 'ios' && (
                    <button
                      type="button"
                      disabled={computerBusy}
                      onClick={async () => {
                        await captureWindowsScreen(dev.id)
                        openSplit('browser', `${dev.name} Live Workspace`)
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 font-mono text-[10.5px] text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-40 dark:text-emerald-300"
                    >
                      <Monitor className="h-3 w-3" />
                      Capture Screen
                    </button>
                  )}
                  {dev.id !== 'local_host' && (
                    <button
                      type="button"
                      onClick={() => void revokeDevice(dev.id)}
                      aria-label={`Revoke ${dev.name}`}
                      title="Revoke device token"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
