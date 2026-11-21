'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  CornerDownLeft,
  Laptop,
  Link2,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { TerminalShellKind } from '@/lib/agent/terminal-types'
import { cn } from '@/lib/utils'

const WINDOWS_QUICK_COMMANDS: { label: string; cmd: string }[] = [
  { label: 'System Info', cmd: 'Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, CSName' },
  { label: 'Top Processes', cmd: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 Name, Id, CPU' },
  { label: 'Network', cmd: 'Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress' },
  { label: 'Installed CLI', cmd: 'node -v; git --version; $PSVersionTable.PSVersion.ToString()' },
]

const HOST_QUICK_COMMANDS: { label: string; cmd: string }[] = [
  { label: 'Host Info', cmd: 'uname -a && node -v' },
  { label: 'List Files', cmd: 'ls -la' },
  { label: 'Git Status', cmd: 'git status -s' },
  { label: 'Disk & CWD', cmd: 'pwd && df -h .' },
]

export function TerminalPanel() {
  const snapshot = useEvaControl((s) => s.terminalSnapshot)
  const terminalBusy = useEvaControl((s) => s.terminalBusy)
  const devices = useEvaControl((s) => s.devices)
  const refreshTerminal = useEvaControl((s) => s.refreshTerminal)
  const refreshDevices = useEvaControl((s) => s.refreshDevices)
  const runTerminalCommand = useEvaControl((s) => s.runTerminalCommand)
  const setTerminalTarget = useEvaControl((s) => s.setTerminalTarget)
  const interruptTerminal = useEvaControl((s) => s.interruptTerminal)
  const clearTerminal = useEvaControl((s) => s.clearTerminal)
  const pairWindowsFromTerminal = useEvaControl((s) => s.pairWindowsFromTerminal)
  const openSplit = useEvaControl((s) => s.openSplit)

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [pairing, setPairing] = useState(false)
  const [pairName, setPairName] = useState('My Windows PC')
  const [pairOpen, setPairOpen] = useState(false)
  const [pairCmd, setPairCmd] = useState<string | null>(null)
  const [pairToken, setPairToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const desktopDevices = useMemo(
    () => devices.filter((d) => d.platform !== 'android' && d.platform !== 'ios'),
    [devices]
  )
  const onlineWindowsDevices = useMemo(
    () => desktopDevices.filter((d) => d.status === 'online'),
    [desktopDevices]
  )

  useEffect(() => {
    void refreshTerminal()
    void refreshDevices()
  }, [refreshTerminal, refreshDevices])

  const entryCount = snapshot?.entries.length ?? 0
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entryCount, snapshot?.running])

  const isWindowsTarget = snapshot?.target === 'windows_pc'
  const isRunning = Boolean(snapshot?.running || terminalBusy)
  const availableHostShells = snapshot?.availableHostShells ?? ['bash', 'sh']
  const quickCommands = isWindowsTarget ? WINDOWS_QUICK_COMMANDS : HOST_QUICK_COMMANDS

  const handleRun = async (explicitCmd?: string) => {
    const cmd = (explicitCmd ?? input).trim()
    if (!cmd || isRunning) return
    if (!explicitCmd) setInput('')
    setHistory((prev) => [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 60))
    setHistoryIdx(-1)
    await runTerminalCommand({
      command: cmd,
      target: snapshot?.target ?? 'host',
      deviceId: snapshot?.deviceId ?? null,
      shell: snapshot?.shell,
    })
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleRun()
      return
    }
    if (e.key === 'c' && e.ctrlKey && isRunning) {
      e.preventDefault()
      void interruptTerminal()
      return
    }
    if (e.key === 'ArrowUp') {
      if (history.length === 0) return
      e.preventDefault()
      const next = Math.min(history.length - 1, historyIdx + 1)
      setHistoryIdx(next)
      setInput(history[next] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      if (historyIdx < 0) return
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(next)
      setInput(next < 0 ? '' : (history[next] ?? ''))
    }
  }

  const handleGeneratePair = async () => {
    setPairing(true)
    const res = await pairWindowsFromTerminal(pairName.trim() || 'Windows PC', 'windows')
    setPairing(false)
    if (res.ok && res.powershellCommand) {
      setPairCmd(res.powershellCommand)
      setPairToken(res.pairingToken ?? null)
    }
  }

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const promptPrefix = isWindowsTarget
    ? `PS ${snapshot?.cwd ?? '%USERPROFILE%'}>`
    : `${snapshot?.cwd ? snapshot.cwd.split('/').slice(-2).join('/') : '~'} $`

  return (
    <div className="flex h-full min-h-0 flex-col bg-dc-deep text-foreground">
      {/* Top Toolbar: Target Switcher, Shell Picker, Pair Windows PC, Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dc-border bg-dc-panel px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-md border border-dc-border bg-dc-deep p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => void setTerminalTarget({ target: 'host' })}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 font-medium transition-colors',
                !isWindowsTarget
                  ? 'bg-dc-surface text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Terminal className="h-3 w-3" />
              <span>Host ({snapshot?.hostPlatform ?? 'linux'})</span>
            </button>

            {onlineWindowsDevices.length > 0 ? (
              onlineWindowsDevices.map((dev) => {
                const active = isWindowsTarget && snapshot?.deviceId === dev.id
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() =>
                      void setTerminalTarget({
                        target: 'windows_pc',
                        deviceId: dev.id,
                        shell: 'powershell',
                      })
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium transition-colors',
                      active
                        ? 'bg-dc-blue/15 text-dc-blue'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-dc-green" />
                    <Laptop className="h-3 w-3" />
                    <span className="max-w-[120px] truncate">{dev.name}</span>
                  </button>
                )
              })
            ) : (
              <button
                type="button"
                onClick={() => setPairOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-dc-blue transition-colors hover:bg-dc-blue/10"
              >
                <Laptop className="h-3 w-3" />
                <span>Pair Windows PowerShell</span>
              </button>
            )}
          </div>

          {!isWindowsTarget && availableHostShells.length > 1 && (
            <select
              aria-label="Host shell binary"
              value={snapshot?.shell ?? 'bash'}
              onChange={(e) =>
                void setTerminalTarget({
                  target: 'host',
                  shell: e.target.value as TerminalShellKind,
                })
              }
              className="h-7 rounded-md border border-dc-border bg-dc-deep px-2 font-mono text-[11px] text-foreground outline-none focus:border-dc-blue/60"
            >
              {availableHostShells.map((sh) => (
                <option key={sh} value={sh}>
                  {sh}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPairOpen((v) => !v)}
            title="Pair a Windows PC via PowerShell"
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors',
              pairOpen
                ? 'border-dc-blue/50 bg-dc-blue/15 text-dc-blue'
                : 'border-dc-border bg-dc-card text-muted-foreground hover:bg-dc-surface hover:text-foreground'
            )}
          >
            <Link2 className="h-3 w-3" />
            <span>Pair PC</span>
          </button>

          {isRunning && (
            <button
              type="button"
              onClick={() => void interruptTerminal()}
              title="Interrupt running command (Ctrl+C)"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-dc-red/40 bg-dc-red/15 px-2 text-[11px] font-medium text-dc-red transition-colors hover:bg-dc-red/25"
            >
              <Square className="h-3 w-3" />
              <span>Stop</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void refreshTerminal()
              void refreshDevices()
            }}
            title="Refresh terminal & paired devices"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-dc-border bg-dc-card text-muted-foreground transition-colors hover:bg-dc-surface hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => void clearTerminal()}
            title="Clear console output"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-dc-border bg-dc-card text-muted-foreground transition-colors hover:bg-dc-surface hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Real Binary & Working Directory Metadata Strip */}
      <div className="flex items-center justify-between gap-2 border-b border-dc-border/80 bg-dc-deep px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              isRunning ? 'animate-pulse bg-dc-amber' : isWindowsTarget ? 'bg-dc-blue' : 'bg-dc-green'
            )}
          />
          <span className="shrink-0 font-semibold text-foreground">
            {isWindowsTarget ? 'powershell.exe' : (snapshot?.shellBinary ?? 'bash')}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate text-muted-foreground" title={snapshot?.cwd ?? ''}>
            {snapshot?.cwd ?? '...'}
          </span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/80">
          {isRunning
            ? `Running: ${snapshot?.runningCommand?.slice(0, 32) ?? '...'}`
            : isWindowsTarget
              ? 'Real Windows PowerShell'
              : 'Real OS Shell'}
        </span>
      </div>

      {/* Inline Windows PowerShell Pairing Drawer */}
      {pairOpen && (
        <div className="border-b border-dc-blue/25 bg-dc-panel px-3 py-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-foreground">
                Pair a Real Windows PC via PowerShell
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Mint a pairing token and run the 1-line command in your Windows PowerShell (Node.js 22+). Once connected, both you and Eva execute real native Windows PowerShell commands right here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPairOpen(false)}
              aria-label="Close pairing helper"
              className="rounded p-1 text-muted-foreground hover:bg-dc-surface hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={pairName}
              onChange={(e) => setPairName(e.target.value)}
              placeholder="Windows PC name"
              className="h-8 min-w-[160px] flex-1 rounded-md border border-dc-border bg-dc-deep px-2.5 text-xs text-foreground outline-none focus:border-dc-blue"
            />
            <button
              type="button"
              disabled={pairing}
              onClick={() => void handleGeneratePair()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              <span>Generate PowerShell Command</span>
            </button>
            <button
              type="button"
              onClick={() => openSplit('devices', 'Devices')}
              className="inline-flex h-8 items-center rounded-md border border-dc-border px-2.5 text-[11px] text-foreground/85 hover:bg-dc-surface"
            >
              Manage Devices
            </button>
          </div>

          {pairCmd && (
            <div className="mt-2.5 rounded-md border border-dc-border bg-dc-deep p-2.5">
              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Run in Windows PowerShell</span>
                <button
                  type="button"
                  onClick={() => handleCopy(pairCmd)}
                  className="inline-flex items-center gap-1 rounded border border-dc-border bg-dc-card px-2 py-0.5 text-[11px] normal-case text-foreground hover:bg-dc-surface"
                >
                  {copied ? <Check className="h-3 w-3 text-dc-green" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? 'Copied' : 'Copy command'}</span>
                </button>
              </div>
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-dc-blue">
                {pairCmd}
              </pre>
              {pairToken && (
                <div className="mt-1.5 text-[10px] text-muted-foreground">
                  Token issued ({pairToken.slice(0, 12)}…). Keep it private; revoke anytime in Devices.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live Streaming Console Output */}
      <div
        ref={viewportRef}
        onClick={() => inputRef.current?.focus()}
        className="nice-scroll min-h-0 flex-1 cursor-text overflow-y-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed"
      >
        {!snapshot || snapshot.entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Terminal buffer cleared. Type a real command below or ask Eva to run PowerShell / terminal tasks.
          </div>
        ) : (
          <div className="space-y-1.5">
            {snapshot.entries.map((entry) => {
              if (entry.kind === 'command') {
                const isEva = entry.actor === 'eva'
                const cmdPrefix = entry.shell === 'powershell' || entry.shell === 'pwsh' ? 'PS>' : '$'
                return (
                  <div
                    key={entry.id}
                    className="mt-2.5 flex items-baseline gap-2 border-t border-dc-border/60 pt-2 first:mt-0 first:border-t-0 first:pt-0"
                  >
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        isEva
                          ? 'bg-dc-blue/15 text-dc-blue'
                          : 'bg-dc-surface text-foreground/85'
                      )}
                    >
                      {isEva ? 'eva' : 'you'}
                    </span>
                    <span className="shrink-0 text-dc-green">{cmdPrefix}</span>
                    <span className="break-all font-semibold text-foreground">{entry.text}</span>
                  </div>
                )
              }

              if (entry.kind === 'stderr') {
                return (
                  <pre
                    key={entry.id}
                    className="whitespace-pre-wrap break-words pl-1 text-dc-red"
                  >
                    {entry.text}
                  </pre>
                )
              }

              if (entry.kind === 'system') {
                return (
                  <pre
                    key={entry.id}
                    className="whitespace-pre-wrap break-words rounded border border-dc-border/80 bg-dc-card/70 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                  >
                    {entry.text}
                  </pre>
                )
              }

              return (
                <pre
                  key={entry.id}
                  className="whitespace-pre-wrap break-words pl-1 text-foreground/90"
                >
                  {entry.text}
                </pre>
              )
            })}

            {isRunning && (
              <div className="flex items-center gap-2 pt-1 text-[11px] text-dc-amber">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Executing real process…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Real Starter Commands */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-dc-border/70 bg-dc-deep px-3 py-1.5">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Quick:
        </span>
        {quickCommands.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={isRunning}
            onClick={() => void handleRun(q.cmd)}
            title={q.cmd}
            className="shrink-0 rounded border border-dc-border bg-dc-card px-2 py-0.5 font-mono text-[11px] text-foreground/85 transition-colors hover:border-dc-blue/40 hover:bg-dc-surface hover:text-foreground disabled:opacity-40"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Interactive Real Shell Prompt Input */}
      <div className="flex items-center gap-2 border-t border-dc-border bg-dc-panel px-3 py-2">
        <span
          className={cn(
            'max-w-[160px] shrink-0 truncate font-mono text-xs font-semibold',
            isWindowsTarget ? 'text-dc-blue' : 'text-dc-green'
          )}
          title={snapshot?.cwd ?? ''}
        >
          {promptPrefix}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={
            isWindowsTarget
              ? 'Enter real Windows PowerShell command (e.g. Get-Process, dir, winget)…'
              : `Enter real ${snapshot?.shell ?? 'bash'} command (e.g. ls -la, git status, node -v)…`
          }
          aria-label="Terminal command input"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/70 outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={isRunning || !input.trim()}
          onClick={() => void handleRun()}
          aria-label="Run command"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-35"
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CornerDownLeft className="h-3 w-3" />
          )}
          <span>Run</span>
        </button>
      </div>
    </div>
  )
}
