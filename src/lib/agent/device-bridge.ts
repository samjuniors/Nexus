import crypto from 'crypto'
import type { IncomingMessage } from 'http'
import type WebSocket from 'ws'
import { db } from '@/lib/db'
import { controlBus } from '@/lib/agent/control-bus'
import { listAllowedDesktopApps, listConnectedFolders } from '@/lib/agent/computer-control'
import { terminalManager } from '@/lib/agent/terminal-manager'

export interface ConnectedDeviceDTO {
  id: string
  name: string
  platform: string
  status: 'online' | 'offline'
  capabilities: string[]
  lastSeenAt: string | null
  createdAt: string
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function listConnectedDevices(): Promise<ConnectedDeviceDTO[]> {
  const rows = await db.connectedDevice.findMany({ orderBy: { createdAt: 'desc' } })
  const onlineIds = new Set(controlBus.getOnlineDeviceIds())
  return rows.map((r) => {
    let capabilities: string[] = []
    try {
      const parsed = JSON.parse(r.capabilitiesJson) as unknown
      if (Array.isArray(parsed)) capabilities = parsed.map(String)
    } catch {
      capabilities = []
    }
    return {
      id: r.id,
      name: r.name,
      platform: r.platform,
      status: onlineIds.has(r.id) ? 'online' : 'offline',
      capabilities,
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    }
  })
}

const MOBILE_CAPABILITIES = [
  'android_tap',
  'android_swipe',
  'android_type',
  'android_press_key',
  'android_open_app',
  'android_open_url',
  'android_screenshot',
  'android_notifications',
]

export const DESKTOP_CAPABILITIES = [
  'open_url',
  'open_app',
  'shell',
  'powershell',
  'system_info',
  'screen_capture',
  'window_list',
  'focus_window',
  'ui_click',
  'ui_type',
  'ui_hotkey',
  'paste_text',
  'list_folder',
  'read_file',
  'write_file',
  'move_file',
  'batch_rename',
]

export async function createPairedDevice(name: string, platform = 'macos'): Promise<{
  device: ConnectedDeviceDTO
  pairingToken: string
}> {
  const cleanName = name.trim().slice(0, 60) || (platform === 'android' ? 'Android Phone' : platform === 'ios' ? 'iPhone' : 'My Computer')
  if (!['macos', 'windows', 'linux', 'android', 'ios'].includes(platform)) {
    throw new Error('Device pairing requires a supported and explicit platform')
  }
  const cleanPlatform = platform
  const isMobile = cleanPlatform === 'android' || cleanPlatform === 'ios'
  const capabilities = isMobile ? MOBILE_CAPABILITIES : DESKTOP_CAPABILITIES
  const pairingToken = `nxs_${crypto.randomBytes(20).toString('hex')}`
  const tokenHash = hashToken(pairingToken)

  const row = await db.connectedDevice.create({
    data: {
      name: cleanName,
      platform: cleanPlatform,
      tokenHash,
      status: 'offline',
      capabilitiesJson: JSON.stringify(capabilities),
    },
  })

  return {
    device: {
      id: row.id,
      name: row.name,
      platform: row.platform,
      status: 'offline',
      capabilities,
      lastSeenAt: null,
      createdAt: new Date(row.createdAt).toISOString(),
    },
    pairingToken,
  }
}

export async function revokeDevice(id: string): Promise<boolean> {
  controlBus.unregisterDevice(id)
  try {
    await db.connectedDevice.delete({ where: { id } })
    return true
  } catch {
    return false
  }
}

export async function handleDeviceBridgeSocket(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!token) {
    ws.close(4001, 'Missing pairing token')
    return
  }

  const tokenHash = hashToken(token)
  const device = await db.connectedDevice.findUnique({ where: { tokenHash } })
  if (!device) {
    ws.close(4003, 'Invalid or revoked device pairing token')
    return
  }

  const platformParam = (url.searchParams.get('platform') ?? device.platform).trim() || device.platform
  if (platformParam !== device.platform) {
    // Never allow an Android pairing token to declare itself a desktop shell device.
    ws.close(4003, 'Device platform does not match its pairing record')
    return
  }
  const capabilities =
    platformParam === 'android' || platformParam === 'ios'
      ? MOBILE_CAPABILITIES
      : DESKTOP_CAPABILITIES

  await db.connectedDevice.update({
    where: { id: device.id },
    data: {
      status: 'online',
      platform: platformParam,
      lastSeenAt: new Date(),
      capabilitiesJson: JSON.stringify(capabilities),
    },
  })

  controlBus.registerDevice({
    deviceId: device.id,
    name: device.name,
    platform: platformParam,
    capabilities,
    ws,
    connectedAt: new Date().toISOString(),
  })

  ws.send(JSON.stringify({ type: 'bridge:welcome', deviceId: device.id, name: device.name }))

  // Immediately push current Connected Folders & Allowed Desktop Apps allowlist to desktop bridges
  if (platformParam !== 'android' && platformParam !== 'ios') {
    void Promise.all([listConnectedFolders(), listAllowedDesktopApps()])
      .then(([folders, apps]) => {
        if (ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              type: 'allowlist:sync',
              folders: folders.map((f) => ({
                id: f.id,
                label: f.label,
                path: f.path,
                accessMode: f.accessMode,
                enabled: f.enabled,
              })),
              apps: apps.map((a) => ({
                id: a.id,
                name: a.name,
                executable: a.executable,
                policy: a.policy,
              })),
              updatedAt: new Date().toISOString(),
            })
          )
        }
      })
      .catch(() => {})
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string
        commandId?: string
        ok?: boolean
        output?: string
        error?: string
        imageBase64?: string
        width?: number
        height?: number
        windowTitle?: string
        lastAction?: string
        stream?: 'stdout' | 'stderr'
        text?: string
      }
      if (msg.type === 'device:result' && msg.commandId) {
        controlBus.resolveDeviceCommand(msg.commandId, {
          ok: Boolean(msg.ok),
          output: String(msg.output ?? ''),
          error: msg.error ? String(msg.error) : undefined,
        }, device.id, ws)
      } else if (msg.type === 'terminal:chunk' && typeof msg.text === 'string') {
        terminalManager.appendRemoteChunk({
          deviceId: device.id,
          deviceName: device.name,
          stream: msg.stream === 'stderr' ? 'stderr' : 'stdout',
          text: msg.text,
        })
      } else if (msg.type === 'desktop:frame' && typeof msg.imageBase64 === 'string') {
        controlBus.broadcastDesktopFrame({
          active: true,
          deviceId: device.id,
          deviceName: device.name,
          platform: platformParam,
          windowTitle: String(msg.windowTitle ?? device.name),
          imageBase64: msg.imageBase64,
          width: Number(msg.width ?? 1280),
          height: Number(msg.height ?? 720),
          lastAction: String(msg.lastAction ?? 'Live Windows desktop capture'),
          updatedAt: new Date().toISOString(),
        })
      } else if (msg.type === 'bridge:ping') {
        ws.send(JSON.stringify({ type: 'bridge:pong', ts: Date.now() }))
        void db.connectedDevice
          .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
          .catch(() => {})
      }
    } catch {
      /* ignore malformed frames */
    }
  })

  const cleanup = () => {
    controlBus.unregisterDevice(device.id, ws)
    void db.connectedDevice
      .update({ where: { id: device.id }, data: { status: 'offline', lastSeenAt: new Date() } })
      .catch(() => {})
  }

  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

/**
 * Generates an inspectable standalone Node.js (v22+ native WebSocket) Local OS Companion Bridge script.
 * Users can run this once on their Mac/Windows/Linux computer to pair it with Eva.
 */
export function buildCompanionRunnerScript(origin: string): string {
  const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/api/device-bridge'
  return `#!/usr/bin/env node
/**
 * Nexus Agent OS — Windows & Desktop Companion Bridge v2
 * Connects your Windows / macOS / Linux PC to Eva over an authenticated WebSocket.
 *
 * Security Guardrails enforced locally on your machine:
 * - Connected Folders Allowlist: Only explicitly enabled folders can be listed, read, or written.
 * - Read-Only vs Read & Write enforcement + strict path traversal (..) blocking.
 * - Per-App Allowlist: Apps marked "deny" are rejected locally before spawning.
 * - Native Windows PowerShell / Win32 screen capture, window focus, UI click/type, and dictation paste.
 *
 * Usage (Windows PowerShell):
 *   $env:NEXUS_DEVICE_TOKEN="<YOUR_TOKEN>"; node nexus-companion.mjs
 * Usage (Bash / CMD):
 *   node nexus-companion.mjs --token <YOUR_PAIRING_TOKEN>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const tokenIdx = process.argv.indexOf('--token');
const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : process.env.NEXUS_DEVICE_TOKEN;
if (!token) {
  console.error('Missing token. Run: node nexus-companion.mjs --token <YOUR_PAIRING_TOKEN>');
  process.exit(1);
}

const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const endpoint = '${wsUrl}?token=' + encodeURIComponent(token) + '&platform=' + platform;

let syncedFolders = [];
let syncedApps = [];

function expandEnvPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let expanded = rawPath.trim();
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }
  expanded = expanded.replace(/%([^%]+)%/g, (_m, key) => {
    if (key.toUpperCase() === 'USERPROFILE' || key.toUpperCase() === 'HOME') return os.homedir();
    return process.env[key] || '';
  });
  return path.resolve(expanded);
}

// Resolve existing components with lstat before realpath so links and Windows junctions are rejected.
function resolvePathWithoutLinks(inputPath) {
  const absolute = path.resolve(inputPath);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  let missing = false;
  for (let i = 0; i < parts.length; i += 1) {
    cursor = path.join(cursor, parts[i]);
    if (missing) continue;
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (err) {
      if (err && err.code === 'ENOENT') { missing = true; continue; }
      return null;
    }
    if (stat.isSymbolicLink()) return null;
    if (i < parts.length - 1 && !stat.isDirectory()) return null;
    try {
      const realPath = path.resolve(fs.realpathSync.native(cursor));
      const currentPath = path.resolve(cursor);
      if (platform === 'windows' ? realPath.toLowerCase() !== currentPath.toLowerCase() : realPath !== currentPath) return null;
    } catch { return null; }
  }
  return path.resolve(cursor);
}

function isWithinFolder(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function checkFolderGuard(targetPath, needWrite = false) {
  if (!targetPath || typeof targetPath !== 'string') return { ok: false, error: 'Target path is required.' };
  if (/(^|[\\\\/])\\.\\.([\\\\/]|$)/.test(targetPath)) return { ok: false, error: 'Blocked: path traversal (..) is not permitted.' };
  const safeTarget = resolvePathWithoutLinks(expandEnvPath(targetPath));
  if (!safeTarget) return { ok: false, error: 'Blocked: symbolic links and junctions are not permitted in Connected Folders paths.' };
  const enabled = syncedFolders.filter((f) => f && f.enabled);
  if (enabled.length === 0) return { ok: false, error: 'No Connected Folders are enabled in Permissions > Connected Folders.' };
  for (const folder of enabled) {
    const safeRoot = resolvePathWithoutLinks(expandEnvPath(folder.path));
    if (!safeRoot) continue;
    try { if (!fs.statSync(safeRoot).isDirectory()) continue; } catch { continue; }
    if (isWithinFolder(safeRoot, safeTarget)) {
      if (needWrite && folder.accessMode !== 'read_write') return { ok: false, error: 'Blocked: folder "' + folder.label + '" is Read-Only.' };
      return { ok: true, resolvedPath: safeTarget, resolvedRoot: safeRoot, folder };
    }
  }
  return { ok: false, error: 'Blocked: path is outside your enabled Connected Folders allowlist.' };
}

function checkAppGuard(appName) {
  const clean = String(appName || '').trim().toLowerCase();
  if (!clean) return { ok: false, error: 'Application name is required.' };
  const match = syncedApps.find((a) => {
    const exe = String(a.executable || '').toLowerCase();
    const nm = String(a.name || '').toLowerCase();
    return clean === exe || clean === exe.replace(/\\.exe$/i, '') || clean === nm;
  });
  if (match && match.policy === 'deny') {
    return { ok: false, error: 'Blocked locally: "' + match.name + '" is set to Deny in Allowed Apps.' };
  }
  return { ok: true, match };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, output: String(stdout || ''), error: String(stderr || err.message) });
      resolve({ ok: true, output: String(stdout || stderr || 'Done').trim() });
    });
  });
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
}

async function captureWindowsScreen() {
  if (platform !== 'windows') {
    return { ok: false, output: '', error: 'Native screen_capture requires Windows PowerShell on this bridge.' };
  }
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)',
    '$ms = New-Object System.IO.MemoryStream',
    '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)',
    '$g.Dispose(); $bmp.Dispose()',
    '$b64 = [Convert]::ToBase64String($ms.ToArray())',
    '$ms.Dispose()',
    'Write-Output ("W=" + $bounds.Width + ";H=" + $bounds.Height + ";B64=" + $b64)',
  ].join('\\n');
  const res = await runPowerShell(ps);
  if (!res.ok) return res;
  const match = /W=(\\d+);H=(\\d+);B64=([A-Za-z0-9+/=]+)/.exec(res.output);
  if (!match) return { ok: false, output: '', error: 'Could not decode screen capture frame.' };
  return {
    ok: true,
    output: JSON.stringify({
      width: Number(match[1]),
      height: Number(match[2]),
      imageBase64: 'data:image/jpeg;base64,' + match[3],
    }),
    frame: {
      width: Number(match[1]),
      height: Number(match[2]),
      imageBase64: 'data:image/jpeg;base64,' + match[3],
    },
  };
}

async function executeAction(action, args = {}, ws) {
  if (action === 'system_info') {
    return {
      ok: true,
      output: JSON.stringify({
        hostname: os.hostname(),
        platform,
        release: os.release(),
        arch: os.arch(),
        homedir: os.homedir(),
        cpus: os.cpus().length,
        freeMemMB: Math.round(os.freemem() / 1048576),
        connectedFolders: syncedFolders.filter((f) => f.enabled).length,
        allowedApps: syncedApps.filter((a) => a.policy !== 'deny').length,
      }, null, 2),
    };
  }

  if (action === 'screen_capture') {
    const cap = await captureWindowsScreen();
    if (cap.ok && cap.frame && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'desktop:frame',
        imageBase64: cap.frame.imageBase64,
        width: cap.frame.width,
        height: cap.frame.height,
        windowTitle: os.hostname() + ' · Windows Desktop',
        lastAction: args.label || 'Captured Windows desktop preview',
      }));
    }
    return { ok: cap.ok, output: cap.output, error: cap.error };
  }

  if (action === 'window_list') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'window_list is supported on Windows.' };
    const ps = 'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json -Compress';
    return runPowerShell(ps);
  }

  if (action === 'focus_window' && typeof args.title === 'string') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'focus_window is supported on Windows.' };
    const safeTitle = args.title.replace(/'/g, "''");
    const ps = [
      '$wshell = New-Object -ComObject WScript.Shell',
      '$ok = $wshell.AppActivate(' + "'" + safeTitle + "'" + ')',
      'Write-Output $ok',
    ].join('\\n');
    return runPowerShell(ps);
  }

  if (action === 'ui_click') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'ui_click is supported on Windows.' };
    const x = Math.round(Number(args.x ?? 0));
    const y = Math.round(Number(args.y ?? 0));
    const ps = [
      'Add-Type -MemberDefinition "[DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);" -Name Win32Mouse -Namespace Nexus',
      '[Nexus.Win32Mouse]::SetCursorPos(' + x + ', ' + y + ') | Out-Null',
      'Start-Sleep -Milliseconds 40',
      '[Nexus.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
      '[Nexus.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)',
      'Write-Output "Clicked (' + x + ',' + y + ')"',
    ].join('\\n');
    const res = await runPowerShell(ps);
    if (res.ok) await executeAction('screen_capture', { label: 'Clicked (' + x + ',' + y + ')' }, ws);
    return res;
  }

  if (action === 'ui_type' && typeof args.text === 'string') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'ui_type is supported on Windows.' };
    const escaped = args.text.replace(/[+^%~(){}\\[\\]]/g, '{$&}').replace(/'/g, "''");
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '[System.Windows.Forms.SendKeys]::SendWait(' + "'" + escaped + "'" + ')',
      'Write-Output "Typed text"',
    ].join('\\n');
    return runPowerShell(ps);
  }

  if (action === 'paste_text' && typeof args.text === 'string') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'paste_text is supported on Windows.' };
    const safe = args.text.replace(/'/g, "''");
    const ps = [
      'Set-Clipboard -Value ' + "'" + safe + "'",
      'Add-Type -AssemblyName System.Windows.Forms',
      'Start-Sleep -Milliseconds 60',
      '[System.Windows.Forms.SendKeys]::SendWait("^v")',
      'Write-Output "Pasted clean text into active window"',
    ].join('\\n');
    return runPowerShell(ps);
  }

  if (action === 'ui_hotkey' && typeof args.keys === 'string') {
    if (platform !== 'windows') return { ok: false, output: '', error: 'ui_hotkey is supported on Windows.' };
    const safe = args.keys.replace(/'/g, "''");
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '[System.Windows.Forms.SendKeys]::SendWait(' + "'" + safe + "'" + ')',
      'Write-Output "Sent hotkey"',
    ].join('\\n');
    return runPowerShell(ps);
  }

  if (action === 'list_folder' && typeof args.path === 'string') {
    const guard = checkFolderGuard(args.path, false);
    if (!guard.ok) return { ok: false, output: '', error: guard.error };
    try {
      const finalGuard = checkFolderGuard(args.path, false);
      if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error };
      const entries = fs.readdirSync(finalGuard.resolvedPath, { withFileTypes: true }).filter((entry) => !entry.isSymbolicLink()).slice(0, 120);
      const items = entries.map((e) => {
        const full = path.join(finalGuard.resolvedPath, e.name);
        const childGuard = checkFolderGuard(full, false);
        if (!childGuard.ok) return null;
        let size = 0;
        let mtime = null;
        try {
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) return null;
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch { return null; }
        return { name: e.name, kind: e.isDirectory() ? 'dir' : 'file', path: full, size, mtime };
      }).filter(Boolean);
      return { ok: true, output: JSON.stringify({ folder: finalGuard.resolvedPath, items }, null, 2) };
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (action === 'read_file' && typeof args.path === 'string') {
    const guard = checkFolderGuard(args.path, false);
    if (!guard.ok) return { ok: false, output: '', error: guard.error };
    try {
      const finalGuard = checkFolderGuard(args.path, false);
      if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error };
      const ext = path.extname(finalGuard.resolvedPath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const buf = fs.readFileSync(finalGuard.resolvedPath);
        if (buf.length > 4 * 1024 * 1024) return { ok: false, output: '', error: 'Image exceeds 4MB bridge transfer limit.' };
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return { ok: true, output: JSON.stringify({ path: finalGuard.resolvedPath, mimeType: mime, base64: buf.toString('base64') }) };
      }
      const content = fs.readFileSync(finalGuard.resolvedPath, 'utf8').slice(0, 32000);
      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (action === 'write_file' && typeof args.path === 'string' && typeof args.content === 'string') {
    const guard = checkFolderGuard(args.path, true);
    if (!guard.ok) return { ok: false, output: '', error: guard.error };
    try {
      fs.mkdirSync(path.dirname(guard.resolvedPath), { recursive: true });
      const finalGuard = checkFolderGuard(args.path, true);
      if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error };
      try {
        if (fs.lstatSync(finalGuard.resolvedPath).isSymbolicLink()) return { ok: false, output: '', error: 'Blocked: symbolic link or junction target is not permitted.' };
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
      fs.writeFileSync(finalGuard.resolvedPath, args.content, 'utf8');
      return { ok: true, output: 'Saved file: ' + finalGuard.resolvedPath };
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (action === 'move_file' && typeof args.from === 'string' && typeof args.to === 'string') {
    const gFrom = checkFolderGuard(args.from, true);
    if (!gFrom.ok) return { ok: false, output: '', error: 'Source: ' + gFrom.error };
    const gTo = checkFolderGuard(args.to, true);
    if (!gTo.ok) return { ok: false, output: '', error: 'Destination: ' + gTo.error };
    try {
      fs.mkdirSync(path.dirname(gTo.resolvedPath), { recursive: true });
      const finalFrom = checkFolderGuard(args.from, true);
      if (!finalFrom.ok) return { ok: false, output: '', error: 'Source: ' + finalFrom.error };
      const finalTo = checkFolderGuard(args.to, true);
      if (!finalTo.ok) return { ok: false, output: '', error: 'Destination: ' + finalTo.error };
      fs.renameSync(finalFrom.resolvedPath, finalTo.resolvedPath);
      return { ok: true, output: 'Moved to: ' + finalTo.resolvedPath };
    } catch (err) {
      return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (action === 'open_url' && typeof args.url === 'string') {
    if (platform === 'macos') return run('open', [args.url]);
    if (platform === 'windows') return run('cmd', ['/c', 'start', '', args.url]);
    return run('xdg-open', [args.url]);
  }

  if (action === 'open_app' && typeof args.app === 'string') {
    const appGuard = checkAppGuard(args.app);
    if (!appGuard.ok) return { ok: false, output: '', error: appGuard.error };
    if (platform === 'macos') return run('open', ['-a', args.app]);
    if (platform === 'windows') return run('cmd', ['/c', 'start', '', args.app]);
    return run(args.app, []);
  }

  if (action === 'powershell' && typeof args.script === 'string') {
    const marker = '__NEXUS_CWD_MARKER_9f2a__:';
    const psBin = platform === 'windows' ? 'powershell.exe' : 'pwsh';
    const workDir = typeof args.cwd === 'string' && args.cwd.trim() ? expandEnvPath(args.cwd) : os.homedir();
    const timeoutMs = Math.min(120000, Math.max(3000, Number(args.timeoutMs || 45000)));
    const wrapped = [
      args.script,
      '$__nxs_code = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
      'Write-Output ("' + marker + '" + (Get-Location).Path)',
      'exit $__nxs_code',
    ].join('\\n');
    const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
    return new Promise((resolve) => {
      const child = spawn(psBin, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        cwd: fs.existsSync(workDir) ? workDir : os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let streamed = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 600);
      }, timeoutMs);

      child.stdout.on('data', (buf) => {
        const text = buf.toString('utf8');
        if (stdout.length < 64000) stdout += text;
        const idx = text.lastIndexOf(marker);
        const visible = idx !== -1 ? text.slice(0, idx).replace(/\\r?\\n$/, '') : text;
        if (visible && ws && ws.readyState === 1) {
          streamed = true;
          ws.send(JSON.stringify({ type: 'terminal:chunk', stream: 'stdout', text: visible }));
        }
      });

      child.stderr.on('data', (buf) => {
        const text = buf.toString('utf8');
        if (stderr.length < 32000) stderr += text;
        if (text.trim() && ws && ws.readyState === 1) {
          streamed = true;
          ws.send(JSON.stringify({ type: 'terminal:chunk', stream: 'stderr', text }));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, output: '', error: err.message });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const idx = stdout.lastIndexOf(marker);
        let cleanOut = stdout;
        let nextCwd = workDir;
        if (idx !== -1) {
          cleanOut = stdout.slice(0, idx).replace(/\\r?\\n$/, '');
          const after = stdout.slice(idx + marker.length).trim().split(/\\r?\\n/)[0];
          if (after) nextCwd = after.trim();
        }
        const exitCode = timedOut ? 124 : (typeof code === 'number' ? code : 0);
        resolve({
          ok: exitCode === 0,
          output: JSON.stringify({
            stdout: cleanOut,
            stderr: timedOut ? (stderr + '\\nCommand timed out.').trim() : stderr,
            exitCode,
            cwd: nextCwd,
            streamed,
          }),
          ...(exitCode !== 0 && stderr ? { error: stderr.trim() } : {}),
        });
      });
    });
  }

  if (action === 'shell' && typeof args.command === 'string') {
    const parts = args.command.match(/"[^"]*"|'[^']*'|\\S+/g)?.map((s) => s.replace(/^['"]|['"]$/g, '')) ?? [];
    if (!parts.length) return { ok: false, output: '', error: 'Empty command' };
    return run(parts[0], parts.slice(1));
  }

  return { ok: false, output: '', error: 'Unsupported action: ' + action };
}

function connect() {
  console.log('[Nexus Bridge] Connecting to', endpoint.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(endpoint);
  let pingTimer;
  ws.addEventListener('open', () => {
    console.log('[Nexus Bridge] Connected to Eva (' + platform + '). Waiting for allowlist sync...');
    pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'bridge:ping' }));
    }, 20000);
  });
  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'allowlist:sync') {
        syncedFolders = Array.isArray(msg.folders) ? msg.folders : [];
        syncedApps = Array.isArray(msg.apps) ? msg.apps : [];
        console.log('[Nexus Bridge] Allowlist synced:', syncedFolders.filter((f) => f.enabled).length, 'folders,', syncedApps.length, 'app policies');
        return;
      }
      if (msg.type === 'device:exec' && msg.commandId) {
        console.log('[Nexus Bridge] Executing:', msg.action);
        const res = await executeAction(msg.action, msg.args, ws);
        ws.send(JSON.stringify({ type: 'device:result', commandId: msg.commandId, ...res }));
      }
    } catch (e) {
      console.error('[Nexus Bridge] Message error:', e);
    }
  });
  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log('[Nexus Bridge] Disconnected — reconnecting in 4s...');
    setTimeout(connect, 4000);
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

connect();
`
}

/**
 * Generates a real one-line Windows PowerShell command that downloads and launches
 * the Nexus Companion Bridge with the newly issued pairing token.
 */
export function buildPowerShellPairCommand(origin: string, pairingToken: string): string {
  const runnerUrl = `${origin.replace(/\/$/, '')}/api/devices/runner`
  return `irm "${runnerUrl}" -OutFile "$env:TEMP\\nexus-companion.mjs"; $env:NEXUS_DEVICE_TOKEN="${pairingToken}"; node "$env:TEMP\\nexus-companion.mjs"`
}

/**
 * Generates an inspectable standalone Node.js (v22+) Android ADB / Termux Bridge.
 * Connects a real Android device over USB or Wireless ADB (or Termux) to Eva via `/api/device-bridge`,
 * executing real tap, swipe, text input, keyevent, app launch, URL intent, and live screencap actions.
 */
export function buildAndroidBridgeScript(origin: string): string {
  const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/api/device-bridge'
  return `#!/usr/bin/env node
/**
 * Nexus Agent OS — Android & Mobile Takeover Bridge (ADB / Wireless Debugging)
 * Connects your Android phone or tablet (via USB or Wireless ADB) to Eva so she can
 * tap, swipe, type, launch apps, open URLs, and capture live screens just like Computer Use.
 *
 * Requirements: Node.js 22+ and Android platform-tools (adb) on PATH.
 * Usage: node nexus-android-bridge.mjs --token <YOUR_PAIRING_TOKEN> [--serial <ADB_SERIAL>]
 */
import { execFile } from 'node:child_process';

const tokenIdx = process.argv.indexOf('--token');
const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : process.env.NEXUS_DEVICE_TOKEN;
const serialIdx = process.argv.indexOf('--serial');
const serial = serialIdx !== -1 ? process.argv[serialIdx + 1] : process.env.ANDROID_SERIAL;

if (!token) {
  console.error('Missing token. Run: node nexus-android-bridge.mjs --token <YOUR_PAIRING_TOKEN>');
  process.exit(1);
}

const endpoint = '${wsUrl}?token=' + encodeURIComponent(token) + '&platform=android';

function adb(args, opts = {}) {
  const finalArgs = serial ? ['-s', serial, ...args] : args;
  return new Promise((resolve) => {
    execFile('adb', finalArgs, { timeout: 15000, maxBuffer: 12 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, output: '', error: String(stderr || err.message) });
      resolve({ ok: true, output: Buffer.isBuffer(stdout) ? stdout : String(stdout || '').trim() });
    });
  });
}

const KEY_CODES = {
  home: '3',
  back: '4',
  call: '5',
  endcall: '6',
  volume_up: '24',
  volume_down: '25',
  power: '26',
  enter: '66',
  recents: '187',
};

const APP_PACKAGES = {
  settings: 'com.android.settings',
  chrome: 'com.android.chrome',
  messages: 'com.google.android.apps.messaging',
  phone: 'com.google.android.dialer',
  camera: 'com.android.camera2',
  maps: 'com.google.android.apps.maps',
  calendar: 'com.google.android.calendar',
  notes: 'com.google.android.keep',
};

async function executeAndroidAction(action, args = {}) {
  if (action === 'android_tap') {
    const x = Math.round(Number(args.x ?? 540));
    const y = Math.round(Number(args.y ?? 1200));
    return adb(['shell', 'input', 'tap', String(x), String(y)]);
  }
  if (action === 'android_swipe' || action === 'android_scroll') {
    const fx = Math.round(Number(args.fromX ?? 540));
    const fy = Math.round(Number(args.fromY ?? 1600));
    const tx = Math.round(Number(args.toX ?? 540));
    const ty = Math.round(Number(args.toY ?? 600));
    return adb(['shell', 'input', 'swipe', String(fx), String(fy), String(tx), String(ty), '280']);
  }
  if (action === 'android_type' && typeof args.text === 'string') {
    const escaped = args.text.replace(/\\s+/g, '%s').replace(/["'\\\\$&;|<>()]/g, '');
    return adb(['shell', 'input', 'text', escaped]);
  }
  if (action === 'android_press_key') {
    const code = KEY_CODES[String(args.key || 'home').toLowerCase()] || '3';
    return adb(['shell', 'input', 'keyevent', code]);
  }
  if (action === 'android_open_app' && typeof args.app === 'string') {
    const pkg = APP_PACKAGES[args.app.toLowerCase()] || args.app;
    return adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  if (action === 'android_open_url' && typeof args.url === 'string') {
    return adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', args.url]);
  }
  if (action === 'android_notifications') {
    return adb(['shell', 'cmd', 'statusbar', args.open === false ? 'collapse' : 'expand-notifications']);
  }
  if (action === 'android_screenshot') {
    const res = await adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    if (!res.ok) return res;
    const b64 = Buffer.from(res.output).toString('base64');
    return { ok: true, output: 'data:image/png;base64,' + b64 };
  }
  return { ok: false, output: '', error: 'Unsupported Android action: ' + action };
}

function connect() {
  console.log('[Nexus Android Bridge] Connecting to', endpoint.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(endpoint);
  let pingTimer;
  ws.addEventListener('open', () => {
    console.log('[Nexus Android Bridge] Connected to Eva. Ready for ADB takeover.');
    pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'bridge:ping' }));
    }, 20000);
  });
  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'device:exec' && msg.commandId) {
        console.log('[Nexus Android Bridge] Executing:', msg.action, msg.args);
        const res = await executeAndroidAction(msg.action, msg.args);
        ws.send(JSON.stringify({ type: 'device:result', commandId: msg.commandId, ...res }));
      }
    } catch (e) {
      console.error('[Nexus Android Bridge] Message error:', e);
    }
  });
  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log('[Nexus Android Bridge] Disconnected — reconnecting in 4s...');
    setTimeout(connect, 4000);
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

connect();
`
}

