import { NextResponse } from 'next/server'
import { terminalManager } from '@/lib/agent/terminal-manager'
import { requireCapabilityPermission } from '@/lib/agent/permissions'
import {
  buildPowerShellPairCommand,
  createPairedDevice,
  listConnectedDevices,
} from '@/lib/agent/device-bridge'
import type { TerminalShellKind, TerminalTarget } from '@/lib/agent/terminal-types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const devices = await listConnectedDevices()
    const desktopDevices = devices.filter(
      (d) => d.platform !== 'android' && d.platform !== 'ios'
    )
    return NextResponse.json({
      ok: true,
      snapshot: terminalManager.getSnapshot(),
      desktopDevices,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string
      command?: string
      target?: TerminalTarget | 'auto'
      deviceId?: string | null
      shell?: TerminalShellKind
      cwd?: string
      timeoutMs?: number
      deviceName?: string
      platform?: string
    }

    const action = String(body.action ?? 'exec').trim()

    if (action === 'clear') {
      const snapshot = terminalManager.clear()
      return NextResponse.json({ ok: true, snapshot })
    }

    if (action === 'interrupt') {
      const res = terminalManager.interrupt()
      return NextResponse.json({ ...res, snapshot: terminalManager.getSnapshot() })
    }

    if (action === 'set_target') {
      const target: TerminalTarget = body.target === 'windows_pc' ? 'windows_pc' : 'host'
      const snapshot = await terminalManager.setTarget({
        target,
        deviceId: body.deviceId ?? null,
        shell: body.shell,
      })
      return NextResponse.json({ ok: true, snapshot })
    }

    if (action === 'pair_windows') {
      const permission = await requireCapabilityPermission({ capability: 'desktop_bridge', actionSummary: 'Pair a Windows computer for terminal access', actor: 'Nexus owner' })
      if (!permission.allowed) return NextResponse.json({ ok: false, error: permission.reason || 'Desktop pairing was denied' }, { status: 403 })
      const url = new URL(request.url)
      const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
      const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
      const host = fwdHost || request.headers.get('host')?.trim() || url.host
      const proto = fwdProto ? `${fwdProto}:` : url.protocol
      const origin = `${proto}//${host}`
      const name = (body.deviceName ?? 'Windows PC').trim() || 'Windows PC'
      const platform = body.platform === 'macos' || body.platform === 'linux' ? body.platform : 'windows'
      const { device, pairingToken } = await createPairedDevice(name, platform)
      const powershellCommand = buildPowerShellPairCommand(origin, pairingToken)
      terminalManager.pushSystemNotice(
        `Created pairing token for "${device.name}" (${device.platform}). Run this in your Windows PowerShell to connect live:\n${powershellCommand}`
      )
      return NextResponse.json({
        ok: true,
        device,
        pairingToken,
        powershellCommand,
        snapshot: terminalManager.getSnapshot(),
      })
    }

    if (action === 'exec') {
      const approval = await requireCapabilityPermission({ capability: 'workspace_shell', actionSummary: 'Execute a terminal command', actor: 'Nexus owner' })
      if (!approval.allowed) return NextResponse.json({ ok: false, error: approval.reason || 'Terminal command denied' }, { status: 403 })
      if (body.target === 'windows_pc') {
        const remote = await requireCapabilityPermission({ capability: 'desktop_bridge', actionSummary: 'Execute a command on a paired desktop', actor: 'Nexus owner' })
        if (!remote.allowed) return NextResponse.json({ ok: false, error: remote.reason || 'Remote desktop command denied' }, { status: 403 })
      }
      const command = String(body.command ?? '').trim()
      if (!command) {
        return NextResponse.json({ ok: false, error: 'Command is required.' }, { status: 400 })
      }
      const res = await terminalManager.execute({
        command,
        actor: 'user',
        target: body.target ?? 'auto',
        deviceId: body.deviceId ?? null,
        shell: body.shell,
        cwd: body.cwd,
        timeoutMs: body.timeoutMs,
      })
      return NextResponse.json({
        ...res,
        snapshot: terminalManager.getSnapshot(),
      })
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
