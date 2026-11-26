import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { controlBus } from '@/lib/agent/control-bus'
import { listConnectedDevices } from '@/lib/agent/device-bridge'
import type {
  TerminalEntry,
  TerminalShellKind,
  TerminalSessionSnapshot,
  TerminalTarget,
} from '@/lib/agent/terminal-types'

const MAX_ENTRIES = 260
const DEFAULT_TIMEOUT_MS = 45_000
const CWD_MARKER = '__NEXUS_CWD_MARKER_9f2a__:'

const HARD_BLOCKED_PATTERNS: RegExp[] = [
  /(^|[;&|]\s*)rm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(\s|$)/i,
  /(^|[;&|]\s*)mkfs(\.\w+)?\b/i,
  /(^|[;&|]\s*)dd\s+if=/i,
  /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)\b/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/,
  /format-volume\b/i,
  /remove-item\s+.*-recurse\s+.*c:\\(\s|$)/i,
]

function detectBinary(cmd: string): string | null {
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(checker, [cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    }).trim()
    const first = out.split(/\r?\n/)[0]?.trim()
    return first || null
  } catch {
    return null
  }
}

export function detectHostShells(): {
  available: TerminalShellKind[]
  binaries: Partial<Record<TerminalShellKind, string>>
  defaultShell: TerminalShellKind
} {
  const binaries: Partial<Record<TerminalShellKind, string>> = {}
  const available: TerminalShellKind[] = []

  if (process.platform === 'win32') {
    const pwsh = detectBinary('pwsh.exe') || detectBinary('pwsh')
    const ps = detectBinary('powershell.exe') || 'powershell.exe'
    if (pwsh) {
      binaries.pwsh = pwsh
      available.push('pwsh')
    }
    binaries.powershell = ps
    available.push('powershell')
    const bash = detectBinary('bash.exe') || detectBinary('bash')
    if (bash) {
      binaries.bash = bash
      available.push('bash')
    }
    return { available, binaries, defaultShell: pwsh ? 'pwsh' : 'powershell' }
  }

  const pwsh = detectBinary('pwsh')
  if (pwsh) {
    binaries.pwsh = pwsh
    available.push('pwsh')
  }
  const bash = detectBinary('bash')
  if (bash) {
    binaries.bash = bash
    available.push('bash')
  }
  const sh = detectBinary('sh') || '/bin/sh'
  binaries.sh = sh
  available.push('sh')

  return {
    available,
    binaries,
    defaultShell: bash ? 'bash' : pwsh ? 'pwsh' : 'sh',
  }
}

export function isCommandBlocked(command: string): string | null {
  const clean = command.trim()
  if (!clean) return 'Command is empty.'
  for (const rx of HARD_BLOCKED_PATTERNS) {
    if (rx.test(clean)) {
      return 'Blocked by system safety guard (destructive OS-level disk/shutdown command).'
    }
  }
  return null
}

/**
 * Splits out the internal CWD marker appended to real shell commands so the user sees
 * pure command output while the terminal accurately tracks `cd` / `Set-Location`.
 */
export function extractCwdFromOutput(raw: string): { cleanOutput: string; nextCwd: string | null } {
  const idx = raw.lastIndexOf(CWD_MARKER)
  if (idx === -1) return { cleanOutput: raw, nextCwd: null }
  const before = raw.slice(0, idx).replace(/\r?\n$/, '')
  const after = raw.slice(idx + CWD_MARKER.length).trim()
  const nextLine = after.split(/\r?\n/)[0]?.trim() || null
  return { cleanOutput: before, nextCwd: nextLine }
}

class RealTerminalManager {
  private sessionId = `term_${Date.now().toString(36)}`
  private hostShellInfo = detectHostShells()
  private target: TerminalTarget = 'host'
  private deviceId: string | null = null
  private deviceName: string | null = null
  private shell: TerminalShellKind
  private hostCwd: string = process.cwd()
  private remoteCwdByDevice = new Map<string, string>()
  private running = false
  private runningCommand: string | null = null
  private activeChild: ChildProcess | null = null
  private entries: TerminalEntry[] = []

  constructor() {
    this.shell = this.hostShellInfo.defaultShell
    this.pushSystemNotice(
      `Real ${this.shell} terminal ready on ${os.hostname()} (${process.platform}). This computer is automatically connected with full native access.`
    )
  }

  private nextId(prefix = 't') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }

  private getCurrentCwd(): string {
    if (this.target === 'windows_pc' && this.deviceId) {
      return this.remoteCwdByDevice.get(this.deviceId) ?? '%USERPROFILE%'
    }
    return this.hostCwd
  }

  private getTargetLabel(): string {
    if (this.target === 'windows_pc') {
      return this.deviceName ? `${this.deviceName} · PowerShell` : 'Windows PC · PowerShell'
    }
    return `${os.hostname()} · ${this.shell}`
  }

  private getShellBinary(): string {
    if (this.target === 'windows_pc') return 'powershell.exe'
    return this.hostShellInfo.binaries[this.shell] ?? this.shell
  }

  getSnapshot(): TerminalSessionSnapshot {
    return {
      sessionId: this.sessionId,
      target: this.target,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      shell: this.target === 'windows_pc' ? 'powershell' : this.shell,
      shellBinary: this.getShellBinary(),
      hostPlatform: process.platform,
      availableHostShells: [...this.hostShellInfo.available],
      cwd: this.getCurrentCwd(),
      running: this.running,
      runningCommand: this.runningCommand,
      entries: [...this.entries],
      updatedAt: new Date().toISOString(),
    }
  }

  private emitSnapshot() {
    controlBus.broadcastTerminalSnapshot(this.getSnapshot())
  }

  private pushEntry(entry: TerminalEntry) {
    this.entries = [...this.entries.slice(-(MAX_ENTRIES - 1)), entry]
    controlBus.broadcastTerminalEntry(entry, this.getSnapshot())
  }

  pushSystemNotice(text: string) {
    this.pushEntry({
      id: this.nextId('sys'),
      ts: new Date().toISOString(),
      kind: 'system',
      text,
      actor: 'system',
      shell: this.target === 'windows_pc' ? 'powershell' : this.shell,
      target: this.target,
      targetLabel: this.getTargetLabel(),
      cwd: this.getCurrentCwd(),
    })
  }

  /**
   * Appends live stdout/stderr chunks streamed from a connected Windows Companion Bridge.
   */
  appendRemoteChunk(params: {
    deviceId: string
    deviceName: string
    stream: 'stdout' | 'stderr'
    text: string
  }) {
    if (!params.text) return
    const cleaned = params.text.includes(CWD_MARKER)
      ? extractCwdFromOutput(params.text).cleanOutput
      : params.text
    if (!cleaned) return
    this.pushEntry({
      id: this.nextId('rc'),
      ts: new Date().toISOString(),
      kind: params.stream,
      text: cleaned,
      actor: 'system',
      shell: 'powershell',
      target: 'windows_pc',
      targetLabel: `${params.deviceName} · PowerShell`,
      cwd: this.remoteCwdByDevice.get(params.deviceId) ?? '%USERPROFILE%',
    })
  }

  async setTarget(opts: {
    target: TerminalTarget
    deviceId?: string | null
    shell?: TerminalShellKind
  }): Promise<TerminalSessionSnapshot> {
    if (opts.target === 'windows_pc') {
      const devices = await listConnectedDevices()
      const winDev =
        (opts.deviceId ? devices.find((d) => d.id === opts.deviceId) : null) ??
        devices.find((d) => d.status === 'online' && d.platform === 'windows') ??
        devices.find((d) => d.status === 'online' && d.platform !== 'android' && d.platform !== 'ios')

      if (winDev) {
        this.target = 'windows_pc'
        this.deviceId = winDev.id
        this.deviceName = winDev.name
        this.shell = 'powershell'
        this.pushSystemNotice(`Switched terminal target to ${winDev.name} (Windows PowerShell).`)
        return this.getSnapshot()
      }
      this.target = 'host'
      this.deviceId = null
      this.deviceName = null
      this.emitSnapshot()
      return this.getSnapshot()
    }

    this.target = 'host'
    this.deviceId = null
    this.deviceName = null
    if (opts.shell && this.hostShellInfo.available.includes(opts.shell)) {
      this.shell = opts.shell
    } else if (!this.hostShellInfo.available.includes(this.shell)) {
      this.shell = this.hostShellInfo.defaultShell
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  clear(): TerminalSessionSnapshot {
    this.entries = []
    this.emitSnapshot()
    return this.getSnapshot()
  }

  interrupt(): { ok: boolean; message: string } {
    if (!this.activeChild) {
      return { ok: false, message: 'No active host shell process is running.' }
    }
    try {
      this.activeChild.kill('SIGINT')
      setTimeout(() => {
        try {
          this.activeChild?.kill('SIGKILL')
        } catch {
          /* already exited */
        }
      }, 800)
      this.pushSystemNotice('^C Interrupt signal sent to active process.')
      return { ok: true, message: 'Sent SIGINT to active process.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Executes a real OS shell or Windows PowerShell command, streaming stdout/stderr live.
   */
  async execute(params: {
    command: string
    actor: 'user' | 'eva'
    target?: TerminalTarget | 'auto'
    deviceId?: string | null
    shell?: TerminalShellKind
    cwd?: string
    timeoutMs?: number
  }): Promise<{
    ok: boolean
    exitCode: number
    stdout: string
    stderr: string
    output: string
    cwd: string
    target: TerminalTarget
    shell: TerminalShellKind
    targetLabel: string
    durationMs: number
    error?: string
  }> {
    const command = params.command.trim()
    const blockedReason = isCommandBlocked(command)
    if (blockedReason) {
      return {
        ok: false,
        exitCode: 126,
        stdout: '',
        stderr: blockedReason,
        output: blockedReason,
        cwd: this.getCurrentCwd(),
        target: this.target,
        shell: this.shell,
        targetLabel: this.getTargetLabel(),
        durationMs: 0,
        error: blockedReason,
      }
    }

    if (this.running) {
      const msg = `Another command is currently running ("${this.runningCommand ?? ''}"). Interrupt it first or wait for completion.`
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: msg,
        output: msg,
        cwd: this.getCurrentCwd(),
        target: this.target,
        shell: this.shell,
        targetLabel: this.getTargetLabel(),
        durationMs: 0,
        error: msg,
      }
    }

    // Resolve target
    const devices = await listConnectedDevices()
    const remoteDesktop =
      (params.deviceId && params.deviceId !== 'local_host'
        ? devices.find((d) => d.id === params.deviceId && d.status === 'online')
        : null) ??
      devices.find((d) => d.id !== 'local_host' && d.status === 'online' && d.platform === 'windows') ??
      devices.find((d) => d.id !== 'local_host' && d.status === 'online' && d.platform !== 'android' && d.platform !== 'ios')

    let resolvedTarget: TerminalTarget = this.target
    if (params.target === 'windows_pc') {
      resolvedTarget = remoteDesktop ? 'windows_pc' : 'host'
    } else if (params.target === 'host') {
      resolvedTarget = 'host'
    } else if (params.target === 'auto') {
      if ((params.shell === 'powershell' || params.shell === 'pwsh') && remoteDesktop) {
        resolvedTarget = 'windows_pc'
      } else {
        resolvedTarget = this.target === 'windows_pc' && remoteDesktop ? 'windows_pc' : 'host'
      }
    }

    // ---- Path A: Connected Windows PC Real PowerShell via Companion Bridge ----
    if (resolvedTarget === 'windows_pc' && remoteDesktop) {
      this.target = 'windows_pc'
      this.deviceId = remoteDesktop.id
      this.deviceName = remoteDesktop.name
      const activeCwd = params.cwd?.trim() || this.remoteCwdByDevice.get(remoteDesktop.id) || ''
      const targetLabel = `${remoteDesktop.name} · PowerShell`
      const startTime = Date.now()

      this.running = true
      this.runningCommand = command
      this.pushEntry({
        id: this.nextId('cmd'),
        ts: new Date().toISOString(),
        kind: 'command',
        text: command,
        actor: params.actor,
        shell: 'powershell',
        target: 'windows_pc',
        targetLabel,
        cwd: activeCwd || '%USERPROFILE%',
      })

      try {
        const res = await controlBus.sendDeviceCommand(
          remoteDesktop.id,
          'powershell',
          {
            script: command,
            cwd: activeCwd || undefined,
            timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          },
          (params.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 5000
        )
        const durationMs = Date.now() - startTime
        let stdout = res.output || ''
        let stderr = res.error || ''
        let exitCode = res.ok ? 0 : 1
        let nextCwd = activeCwd || '%USERPROFILE%'

        let alreadyStreamed = false
        try {
          const parsed = JSON.parse(res.output) as {
            stdout?: string
            stderr?: string
            exitCode?: number
            cwd?: string
            streamed?: boolean
          }
          if (parsed && typeof parsed === 'object' && ('stdout' in parsed || 'exitCode' in parsed)) {
            stdout = String(parsed.stdout ?? '')
            stderr = String(parsed.stderr ?? res.error ?? '')
            exitCode = typeof parsed.exitCode === 'number' ? parsed.exitCode : res.ok ? 0 : 1
            alreadyStreamed = Boolean(parsed.streamed)
            if (typeof parsed.cwd === 'string' && parsed.cwd.trim()) {
              nextCwd = parsed.cwd.trim()
              this.remoteCwdByDevice.set(remoteDesktop.id, nextCwd)
            }
          }
        } catch {
          /* plain text output from older bridge */
        }

        // If bridge didn't stream chunks individually, emit the final output cleanly
        const combinedOut = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
        if (!alreadyStreamed && stdout.trim()) {
          this.pushEntry({
            id: this.nextId('out'),
            ts: new Date().toISOString(),
            kind: 'stdout',
            text: stdout.replace(/\r?\n$/, ''),
            actor: params.actor,
            shell: 'powershell',
            target: 'windows_pc',
            targetLabel,
            cwd: nextCwd,
            exitCode,
            durationMs,
          })
        }
        if (!alreadyStreamed && stderr.trim()) {
          this.pushEntry({
            id: this.nextId('err'),
            ts: new Date().toISOString(),
            kind: 'stderr',
            text: stderr.replace(/\r?\n$/, ''),
            actor: params.actor,
            shell: 'powershell',
            target: 'windows_pc',
            targetLabel,
            cwd: nextCwd,
            exitCode,
            durationMs,
          })
        }
        if ((!stdout.trim() && !stderr.trim()) || exitCode !== 0) {
          this.pushEntry({
            id: this.nextId('sys'),
            ts: new Date().toISOString(),
            kind: 'system',
            text: `PowerShell exited with code ${exitCode} (${durationMs}ms).`,
            actor: params.actor,
            shell: 'powershell',
            target: 'windows_pc',
            targetLabel,
            cwd: nextCwd,
            exitCode,
            durationMs,
          })
        }

        return {
          ok: exitCode === 0,
          exitCode,
          stdout,
          stderr,
          output: combinedOut || `(exit ${exitCode})`,
          cwd: nextCwd,
          target: 'windows_pc',
          shell: 'powershell',
          targetLabel,
          durationMs,
          ...(exitCode !== 0 && stderr ? { error: stderr } : {}),
        }
      } finally {
        this.running = false
        this.runningCommand = null
        this.emitSnapshot()
      }
    }

    // ---- Path B: Real Host OS Shell (bash / sh / pwsh / powershell.exe) ----
    this.target = 'host'
    this.deviceId = null
    this.deviceName = null
    const chosenShell: TerminalShellKind =
      params.shell && this.hostShellInfo.available.includes(params.shell)
        ? params.shell
        : (params.target === 'windows_pc' || this.hostShellInfo.defaultShell === 'powershell' || process.platform === 'win32') &&
            this.hostShellInfo.available.includes('powershell')
          ? 'powershell'
          : this.hostShellInfo.available.includes(this.shell)
            ? this.shell
            : this.hostShellInfo.defaultShell
    this.shell = chosenShell
    const shellBinary = this.hostShellInfo.binaries[chosenShell] ?? chosenShell
    const execCwd = params.cwd?.trim() ? path.resolve(this.hostCwd, params.cwd.trim()) : this.hostCwd
    const targetLabel =
      chosenShell === 'powershell' || chosenShell === 'pwsh'
        ? `${os.hostname()} (Windows Host) · ${chosenShell}`
        : `${os.hostname()} · ${chosenShell}`
    const timeoutMs = Math.min(120_000, Math.max(2000, params.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    const startTime = Date.now()

    this.running = true
    this.runningCommand = command
    this.pushEntry({
      id: this.nextId('cmd'),
      ts: new Date().toISOString(),
      kind: 'command',
      text: command,
      actor: params.actor,
      shell: chosenShell,
      target: 'host',
      targetLabel,
      cwd: execCwd,
    })

    const isPowerShell = chosenShell === 'powershell' || chosenShell === 'pwsh'
    let spawnArgs: string[]
    if (isPowerShell) {
      // Flush PowerShell formatting buffers (e.g. Format-Table from pwd/Get-ChildItem) synchronously
      // via Out-Default before emitting the CWD marker and exiting.
      const wrapped = [
        '$ProgressPreference = "SilentlyContinue"',
        '& {',
        command,
        '} | Out-Default',
        '$__nxs_code = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
        `Write-Output ("${CWD_MARKER}" + (Get-Location).Path)`,
        'exit $__nxs_code',
      ].join('\n')
      const encoded = Buffer.from(wrapped, 'utf16le').toString('base64')
      spawnArgs = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
    } else {
      const wrapped = `${command}\n__nxs_ec=$?\nprintf "\\n${CWD_MARKER}%s\\n" "$PWD"\nexit $__nxs_ec`
      spawnArgs = ['-c', wrapped]
    }

    try {
      const result = await new Promise<{
        exitCode: number
        stdout: string
        stderr: string
        timedOut: boolean
      }>((resolve) => {
        const child = spawn(shellBinary, spawnArgs, {
          cwd: execCwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            FORCE_COLOR: '0',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.activeChild = child

        let rawStdout = ''
        let rawStderr = ''
        let timedOut = false

        const timer = setTimeout(() => {
          timedOut = true
          try {
            child.kill('SIGTERM')
            setTimeout(() => {
              try {
                child.kill('SIGKILL')
              } catch {
                /* ignore */
              }
            }, 600)
          } catch {
            /* ignore */
          }
        }, timeoutMs)

        child.stdout?.on('data', (buf: Buffer) => {
          const text = buf.toString('utf8')
          if (rawStdout.length < 64_000) rawStdout += text
          const visible = text.includes(CWD_MARKER)
            ? extractCwdFromOutput(text).cleanOutput
            : text
          if (visible.replace(/^\r?\n$/, '').length > 0) {
            this.pushEntry({
              id: this.nextId('out'),
              ts: new Date().toISOString(),
              kind: 'stdout',
              text: visible.replace(/\r?\n$/, ''),
              actor: params.actor,
              shell: chosenShell,
              target: 'host',
              targetLabel,
              cwd: this.hostCwd,
            })
          }
        })

        child.stderr?.on('data', (buf: Buffer) => {
          const text = buf.toString('utf8')
          if (rawStderr.length < 32_000) rawStderr += text
          if (text.trim().length > 0) {
            this.pushEntry({
              id: this.nextId('err'),
              ts: new Date().toISOString(),
              kind: 'stderr',
              text: text.replace(/\r?\n$/, ''),
              actor: params.actor,
              shell: chosenShell,
              target: 'host',
              targetLabel,
              cwd: this.hostCwd,
            })
          }
        })

        child.on('error', (err) => {
          clearTimeout(timer)
          this.activeChild = null
          resolve({ exitCode: 127, stdout: rawStdout, stderr: err.message, timedOut: false })
        })

        child.on('close', (code) => {
          clearTimeout(timer)
          this.activeChild = null
          resolve({
            exitCode: timedOut ? 124 : (code ?? 0),
            stdout: rawStdout,
            stderr: rawStderr,
            timedOut,
          })
        })
      })

      const durationMs = Date.now() - startTime
      const { cleanOutput, nextCwd } = extractCwdFromOutput(result.stdout)
      if (nextCwd && nextCwd.length > 0) {
        this.hostCwd = nextCwd
      }

      if (result.timedOut) {
        this.pushEntry({
          id: this.nextId('err'),
          ts: new Date().toISOString(),
          kind: 'stderr',
          text: `Command timed out after ${Math.round(timeoutMs / 1000)}s.`,
          actor: params.actor,
          shell: chosenShell,
          target: 'host',
          targetLabel,
          cwd: this.hostCwd,
          exitCode: 124,
          durationMs,
        })
      } else if (!cleanOutput.trim() && !result.stderr.trim()) {
        this.pushEntry({
          id: this.nextId('sys'),
          ts: new Date().toISOString(),
          kind: 'system',
          text: `Exited with code ${result.exitCode} (${durationMs}ms).`,
          actor: params.actor,
          shell: chosenShell,
          target: 'host',
          targetLabel,
          cwd: this.hostCwd,
          exitCode: result.exitCode,
          durationMs,
        })
      } else if (result.exitCode !== 0) {
        this.pushEntry({
          id: this.nextId('sys'),
          ts: new Date().toISOString(),
          kind: 'system',
          text: `Process exited with code ${result.exitCode} (${durationMs}ms).`,
          actor: params.actor,
          shell: chosenShell,
          target: 'host',
          targetLabel,
          cwd: this.hostCwd,
          exitCode: result.exitCode,
          durationMs,
        })
      }

      const combined = [cleanOutput.trim(), result.stderr.trim()].filter(Boolean).join('\n')
      return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: cleanOutput,
        stderr: result.stderr,
        output: combined || `(exit ${result.exitCode})`,
        cwd: this.hostCwd,
        target: 'host',
        shell: chosenShell,
        targetLabel,
        durationMs,
        ...(result.exitCode !== 0 && result.stderr ? { error: result.stderr.trim() } : {}),
      }
    } finally {
      this.running = false
      this.runningCommand = null
      this.activeChild = null
      this.emitSnapshot()
    }
  }
}

const g = globalThis as unknown as { __nexusTerminalManager?: RealTerminalManager }
export const terminalManager = g.__nexusTerminalManager ?? new RealTerminalManager()
g.__nexusTerminalManager = terminalManager
