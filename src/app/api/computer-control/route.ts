import { NextResponse } from 'next/server'
import { controlBus } from '@/lib/agent/control-bus'
import { requireCapabilityPermission } from '@/lib/agent/permissions'
import { verifyActionHash } from '@/lib/agent/action-binding'
import {
  addAllowedDesktopApp,
  addConnectedFolder,
  automationSession,
  DEFAULT_WINDOWS_FOLDER_PRESETS,
  deleteAllowedDesktopApp,
  deleteConnectedFolder,
  evaluateAppPolicy,
  evaluateFolderAccess,
  listAllowedDesktopApps,
  listConnectedFolders,
  updateAllowedDesktopApp,
  updateConnectedFolder,
  type AppAllowPolicy,
  type FolderAccessMode,
} from '@/lib/agent/computer-control'
import { DESKTOP_CAPABILITIES, getLocalHostDevice, listConnectedDevices } from '@/lib/agent/device-bridge'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [folders, apps] = await Promise.all([
      listConnectedFolders(),
      listAllowedDesktopApps(),
    ])
    return NextResponse.json({
      folders,
      apps,
      session: automationSession.getSnapshot(),
      desktopFrame: controlBus.getLatestDesktopFrame(),
      browserFrame: controlBus.getLatestBrowserFrame(),
      folderPresets: DEFAULT_WINDOWS_FOLDER_PRESETS,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load computer control state' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '').trim()

    // ---- Connected Folders CRUD ----
    if (action === 'add_folder') {
      const folder = await addConnectedFolder({
        label: String(body.label ?? ''),
        path: String(body.path ?? ''),
        platform:
          body.platform === 'macos' || body.platform === 'linux' ? body.platform : 'windows',
        accessMode: body.accessMode === 'read_write' ? 'read_write' : 'read',
      })
      return NextResponse.json({ ok: true, folder, folders: await listConnectedFolders() })
    }

    if (action === 'update_folder') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'Missing folder id' }, { status: 400 })
      const folder = await updateConnectedFolder(id, {
        ...(body.label !== undefined ? { label: String(body.label) } : {}),
        ...(body.accessMode !== undefined
          ? { accessMode: (body.accessMode === 'read_write' ? 'read_write' : 'read') as FolderAccessMode }
          : {}),
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
      })
      return NextResponse.json({ ok: true, folder, folders: await listConnectedFolders() })
    }

    if (action === 'delete_folder') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'Missing folder id' }, { status: 400 })
      await deleteConnectedFolder(id)
      return NextResponse.json({ ok: true, folders: await listConnectedFolders() })
    }

    // ---- Allowed Desktop Apps CRUD ----
    if (action === 'add_app') {
      const app = await addAllowedDesktopApp({
        name: String(body.name ?? ''),
        executable: String(body.executable ?? ''),
        platform:
          body.platform === 'macos' || body.platform === 'linux' ? body.platform : 'windows',
        policy: (body.policy === 'always' || body.policy === 'deny' ? body.policy : 'ask') as AppAllowPolicy,
        category: (['browser', 'creative', 'dev', 'system', 'productivity'].includes(String(body.category))
          ? String(body.category)
          : 'productivity') as 'browser' | 'creative' | 'dev' | 'system' | 'productivity',
      })
      return NextResponse.json({ ok: true, app, apps: await listAllowedDesktopApps() })
    }

    if (action === 'update_app') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'Missing app id' }, { status: 400 })
      const app = await updateAllowedDesktopApp(id, {
        ...(body.policy !== undefined
          ? { policy: (body.policy === 'always' || body.policy === 'deny' ? body.policy : 'ask') as AppAllowPolicy }
          : {}),
        ...(body.name !== undefined ? { name: String(body.name) } : {}),
      })
      return NextResponse.json({ ok: true, app, apps: await listAllowedDesktopApps() })
    }

    if (action === 'delete_app') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'Missing app id' }, { status: 400 })
      await deleteAllowedDesktopApp(id)
      return NextResponse.json({ ok: true, apps: await listAllowedDesktopApps() })
    }

    // ---- Automation Session Live Controls (Pause / Resume / Takeover / Stop) ----
    if (action === 'pause') {
      return NextResponse.json({ ok: true, session: automationSession.pause() })
    }
    if (action === 'resume') {
      return NextResponse.json({ ok: true, session: automationSession.resume() })
    }
    if (action === 'takeover') {
      return NextResponse.json({ ok: true, session: automationSession.enterTakeover() })
    }
    if (action === 'release_takeover') {
      return NextResponse.json({ ok: true, session: automationSession.resume() })
    }
    if (action === 'stop') {
      return NextResponse.json({ ok: true, session: automationSession.stop('Stopped from workspace controls') })
    }

    // ---- Live Windows Companion Bridge Quick Actions ----
    if (action === 'capture_windows_screen' || action === 'windows_action') {
      const requested = action === 'windows_action' ? String(body.bridgeAction ?? '').trim() : 'screen_capture'
      if (!DESKTOP_CAPABILITIES.includes(requested)) {
        return NextResponse.json({ ok: false, error: 'Unsupported desktop command' }, { status: 400 })
      }
      // A UI request is not an authorization. Require the server-side owner
      // capability gate before interacting with a paired desktop computer.
      const actionBinding = { actionName: 'desktop.' + requested, target: String(body.deviceId ?? 'auto'), payload: body }
      const permission = await requireCapabilityPermission({
        capability: 'desktop_bridge',
        actionSummary: 'Paired desktop action: ' + requested,
        actor: 'Nexus owner',
        ...actionBinding,
      })
      if (!permission.allowed || !verifyActionHash(permission.actionHash, actionBinding)) {
        return NextResponse.json({ ok: false, error: permission.reason || 'Desktop control denied' }, { status: 403 })
      }
      if (requested === 'shell' || requested === 'powershell') {
        const shellPermission = await requireCapabilityPermission({
          capability: 'workspace_shell',
          actionSummary: 'Execute a command on the paired desktop',
          actor: 'Nexus owner',
          ...actionBinding,
        })
        if (!shellPermission.allowed || !verifyActionHash(shellPermission.actionHash, actionBinding)) {
          return NextResponse.json({ ok: false, error: shellPermission.reason || 'Remote shell denied' }, { status: 403 })
        }
      }
      const devices = await listConnectedDevices()
      const onlineDesktop =
        devices.find(
          (d) =>
            d.status === 'online' &&
            d.platform !== 'android' &&
            d.platform !== 'ios' &&
            (!body.deviceId || d.id === String(body.deviceId) || (String(body.deviceId) === 'host' && d.id === 'local_host'))
        ) ?? getLocalHostDevice()

      if (action === 'capture_windows_screen') {
        const res = await controlBus.sendDeviceCommand(onlineDesktop.id, 'screen_capture', {
          label: 'Captured live Windows screen',
        })
        return NextResponse.json({
          ok: res.ok,
          output: res.output,
          error: res.error,
          desktopFrame: controlBus.getLatestDesktopFrame(),
        })
      }

      const bridgeAction = String(body.bridgeAction ?? '')
      const bridgeArgs = (body.bridgeArgs && typeof body.bridgeArgs === 'object'
        ? body.bridgeArgs
        : {}) as Record<string, unknown>

      // Enforce Connected Folder & App Allowlist server-side before dispatching!
      if (['list_folder', 'read_file', 'write_file', 'move_file', 'batch_rename'].includes(bridgeAction)) {
        const folders = await listConnectedFolders()
        if (bridgeAction === 'batch_rename') {
          // Batch rename uses a variable set of paths: defer until per-path validation is proven.
          return NextResponse.json({ ok: false, error: 'Batch rename requires individual path authorization and is temporarily disabled.' }, { status: 403 })
        }
        const targetPath = String(bridgeArgs.path ?? bridgeArgs.from ?? '')
        const op = bridgeAction === 'write_file' || bridgeAction === 'move_file' ? 'write' : 'read'
        const guard = evaluateFolderAccess(targetPath, op, folders)
        if (!guard.allowed) {
          return NextResponse.json({ ok: false, error: guard.reason }, { status: 403 })
        }
        if (bridgeAction === 'move_file') {
          // Validate both sides, not merely the original file location.
          const destination = String(bridgeArgs.to ?? bridgeArgs.destination ?? '')
          const dest = evaluateFolderAccess(destination, 'write', folders)
          if (!dest.allowed) {
            return NextResponse.json({ ok: false, error: dest.reason }, { status: 403 })
          }
        }
      }

      if (bridgeAction === 'open_app') {
        const apps = await listAllowedDesktopApps()
        const evalRes = evaluateAppPolicy(String(bridgeArgs.app ?? ''), apps)
        if (evalRes.policy === 'deny') {
          return NextResponse.json(
            { ok: false, error: `Blocked: "${String(bridgeArgs.app ?? '')}" is denied in Allowed Desktop Apps.` },
            { status: 403 }
          )
        }
      }

      const res = await controlBus.sendDeviceCommand(onlineDesktop.id, bridgeAction, bridgeArgs)
      return NextResponse.json({
        ok: res.ok,
        output: res.output,
        error: res.error,
        desktopFrame: controlBus.getLatestDesktopFrame(),
      })
    }

    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Computer control request failed' },
      { status: 500 }
    )
  }
}
