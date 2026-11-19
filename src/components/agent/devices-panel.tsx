'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, Laptop, MonitorSmartphone, Pin, Plus, Terminal, Trash2 } from 'lucide-react'
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
  const refreshDevices = useEvaControl((s) => s.refreshDevices)
  const pairDevice = useEvaControl((s) => s.pairDevice)
  const revokeDevice = useEvaControl((s) => s.revokeDevice)

  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux'>('macos')
  const [pairing, setPairing] = useState(false)
  const [freshToken, setFreshToken] = useState<{ deviceName: string; token: string } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  const desktopBridge =
    typeof window !== 'undefined'
      ? (window as unknown as { nexusDesktop?: NexusDesktopBridge }).nexusDesktop
      : undefined
  const isElectron = Boolean(desktopBridge?.isElectron)

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  const wsOrigin = origin.replace(/^http/, 'ws')

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = name.trim() || 'My Computer'
    setPairing(true)
    try {
      const res = await pairDevice(clean, platform)
      if (res) {
        setFreshToken({ deviceName: res.device.name, token: res.pairingToken })
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

  const oneLineCommand = freshToken
    ? `curl -fsSL "${origin}/api/devices/runner" -o nexus-companion.mjs && NEXUS_WS_URL="${wsOrigin}/api/device-bridge" NEXUS_DEVICE_TOKEN="${freshToken.token}" node nexus-companion.mjs`
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
            <h2 className="text-sm font-semibold">Connected Computers &amp; Desktop</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Manage your computer from the deployed Web app (via Local OS Companion Bridge) or run the native Electron Desktop App.
          </p>
        </div>
        <a
          href="/api/devices/runner"
          download="nexus-companion.mjs"
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[10.5px] text-secondary-foreground hover:bg-accent"
        >
          <Download className="h-3 w-3" />
          Runner
        </a>
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
              Launch Nexus as a native macOS, Windows, or Linux desktop app pointing at this Web deployment, with global hotkey (<kbd className="font-mono">⌘⇧E</kbd>), always-on-top Eva companion, and screen/camera eyes.
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
          Pair Local Machine (Web Companion Bridge)
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. MacBook Pro"
            aria-label="Computer name"
            className="h-8 min-w-36 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-emerald-400/60"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'macos' | 'windows' | 'linux')}
            aria-label="Operating system platform"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none"
          >
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
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
            Run this once in your computer&apos;s terminal (requires Node 22+). Save this token now — it is hashed on the server.
          </p>
          <pre className="nice-scroll overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-foreground">
            {oneLineCommand}
          </pre>
        </div>
      )}

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
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {dev.platform} · {dev.status}
                    {dev.lastSeenAt && ` · seen ${new Date(dev.lastSeenAt).toLocaleTimeString()}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeDevice(dev.id)}
                  aria-label={`Revoke ${dev.name}`}
                  title="Revoke device token"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
