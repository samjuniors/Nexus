export type TerminalShellKind = 'powershell' | 'pwsh' | 'bash' | 'sh'
export type TerminalTarget = 'host' | 'windows_pc'

export interface TerminalEntry {
  id: string
  ts: string
  kind: 'command' | 'stdout' | 'stderr' | 'system'
  text: string
  actor: 'user' | 'eva' | 'system'
  shell: TerminalShellKind
  target: TerminalTarget
  targetLabel: string
  cwd: string
  exitCode?: number | null
  durationMs?: number
}

export interface TerminalSessionSnapshot {
  sessionId: string
  target: TerminalTarget
  deviceId: string | null
  deviceName: string | null
  shell: TerminalShellKind
  shellBinary: string
  hostPlatform: string
  availableHostShells: TerminalShellKind[]
  cwd: string
  running: boolean
  runningCommand: string | null
  entries: TerminalEntry[]
  updatedAt: string
}
