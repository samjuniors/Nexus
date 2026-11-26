import fs, { lstatSync, realpathSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { controlBus, type DeviceCommandResult } from '@/lib/agent/control-bus'
import {
  evaluateAppPolicy,
  listAllowedDesktopApps,
  listConnectedFolders,
  type ConnectedFolderDTO,
} from '@/lib/agent/computer-control'
import { terminalManager } from '@/lib/agent/terminal-manager'

const IS_WINDOWS = process.platform === 'win32'
const IS_MACOS = process.platform === 'darwin'

function expandEnvPath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') return ''
  let expanded = rawPath.trim().replace(/^["']|["']$/g, '')
  if (expanded.startsWith('~')) {
    expanded = path.join(os.homedir(), expanded.slice(1))
  }
  expanded = expanded.replace(/%([^%]+)%/g, (_m, key: string) => {
    const upper = key.toUpperCase()
    if (upper === 'USERPROFILE' || upper === 'HOME') return os.homedir()
    return process.env[key] || ''
  })
  return path.resolve(expanded)
}

function resolvePathWithoutLinks(inputPath: string): string | null {
  if (!inputPath) return null
  const absolute = path.resolve(inputPath)
  const parsed = path.parse(absolute)
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)
  let cursor = parsed.root
  let missing = false
  for (let i = 0; i < parts.length; i += 1) {
    cursor = path.join(cursor, parts[i])
    if (missing) continue
    let stat: fs.Stats
    try {
      stat = lstatSync(cursor)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        missing = true
        continue
      }
      return null
    }
    if (stat.isSymbolicLink()) return null
    if (i < parts.length - 1 && !stat.isDirectory()) return null
    try {
      const realPath = path.resolve(realpathSync.native(cursor))
      const currentPath = path.resolve(cursor)
      if (IS_WINDOWS ? realPath.toLowerCase() !== currentPath.toLowerCase() : realPath !== currentPath) {
        return null
      }
    } catch {
      return null
    }
  }
  return path.resolve(cursor)
}

function isWithinFolder(rootPath: string, candidatePath: string): boolean {
  const normRoot = IS_WINDOWS ? rootPath.toLowerCase() : rootPath
  const normCand = IS_WINDOWS ? candidatePath.toLowerCase() : candidatePath
  const relative = path.relative(normRoot, normCand)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}

function checkHostFolderGuard(
  targetPath: string,
  operation: 'read' | 'write',
  folders: Pick<ConnectedFolderDTO, 'id' | 'label' | 'path' | 'accessMode' | 'enabled'>[]
): { ok: true; resolvedPath: string; folder: Pick<ConnectedFolderDTO, 'id' | 'label' | 'path' | 'accessMode' | 'enabled'> } | { ok: false; error: string } {
  if (!targetPath || !targetPath.trim()) {
    return { ok: false, error: 'Target path is required.' }
  }
  if (targetPath.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(targetPath)) {
    return { ok: false, error: 'Path traversal (..) is blocked by Connected Folders guard.' }
  }
  const safeTarget = resolvePathWithoutLinks(expandEnvPath(targetPath))
  if (!safeTarget) {
    return { ok: false, error: 'Blocked: symbolic links and junctions are not permitted in Connected Folders paths.' }
  }
  const enabled = folders.filter((f) => f && f.enabled)
  if (enabled.length === 0) {
    return { ok: false, error: 'No Connected Folders are enabled in Permissions > Connected Folders.' }
  }
  for (const folder of enabled) {
    const safeRoot = resolvePathWithoutLinks(expandEnvPath(folder.path))
    if (!safeRoot) continue
    try {
      if (!fs.statSync(safeRoot).isDirectory()) continue
    } catch {
      continue
    }
    if (isWithinFolder(safeRoot, safeTarget)) {
      if (operation === 'write' && folder.accessMode !== 'read_write') {
        return {
          ok: false,
          error: `Connected folder "${folder.label}" is set to Read-Only. Switch it to Read & Write in Permissions to allow edits.`,
        }
      }
      return { ok: true, resolvedPath: safeTarget, folder }
    }
  }
  return {
    ok: false,
    error: `Path "${targetPath}" is outside your Connected Folders allowlist. Add its parent folder in Permissions > Connected Folders.`,
  }
}

function runCommand(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<{
  ok: boolean
  output: string
  error?: string
}> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout ?? 15_000,
        maxBuffer: 16 * 1024 * 1024,
        cwd: opts.cwd,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({
            ok: false,
            output: String(stdout || ''),
            error: String(stderr || err.message),
          })
        }
        resolve({ ok: true, output: String(stdout || stderr || 'Done').trim() })
      }
    )
  })
}

function runPowerShellScript(script: string, timeoutMs = 20_000): Promise<{
  ok: boolean
  output: string
  error?: string
}> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const psBin = IS_WINDOWS ? 'powershell.exe' : 'pwsh'
  return runCommand(psBin, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    timeout: timeoutMs,
  })
}

async function captureLocalScreen(): Promise<{
  ok: boolean
  output: string
  error?: string
  frame?: { width: number; height: number; imageBase64: string }
}> {
  if (!IS_WINDOWS) {
    return {
      ok: false,
      output: '',
      error: 'Native screen capture currently requires Windows host.',
    }
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
  ].join('\n')

  const res = await runPowerShellScript(ps, 15_000)
  if (!res.ok) return res

  const match = /W=(\d+);H=(\d+);B64=([A-Za-z0-9+/=]+)/.exec(res.output)
  if (!match) {
    return { ok: false, output: '', error: 'Could not decode screen capture frame.' }
  }

  const width = Number(match[1])
  const height = Number(match[2])
  const imageBase64 = `data:image/jpeg;base64,${match[3]}`

  return {
    ok: true,
    output: JSON.stringify({ width, height, imageBase64 }),
    frame: { width, height, imageBase64 },
  }
}

/**
 * Executes a device command directly on the host computer (Windows / macOS / Linux)
 * without requiring any external companion bridge connection.
 */
export async function executeLocalDeviceCommand(
  action: string,
  args: Record<string, unknown> = {},
  timeoutMs = 20_000
): Promise<DeviceCommandResult> {
  const normAction = action.trim().toLowerCase()

  // 1. System Info
  if (normAction === 'system_info') {
    const cpus = os.cpus()
    const folders = await listConnectedFolders()
    const apps = await listAllowedDesktopApps()
    const info = {
      hostname: os.hostname(),
      platform: IS_WINDOWS ? 'windows' : IS_MACOS ? 'macos' : 'linux',
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      homedir: os.homedir(),
      uptimeMinutes: Math.round(os.uptime() / 60),
      cpus: cpus.length,
      cpuModel: cpus[0]?.model || 'Unknown',
      freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
      connectedFoldersCount: folders.filter((f) => f.enabled).length,
      allowedAppsCount: apps.filter((a) => a.policy !== 'deny').length,
    }
    return { ok: true, output: JSON.stringify(info, null, 2) }
  }

  // 2. PowerShell / Shell execution on local host
  if (normAction === 'powershell' || normAction === 'shell') {
    const command = String(args.script || args.command || '').trim()
    if (!command) {
      return { ok: false, output: '', error: 'Command script is required.' }
    }
    const execRes = await terminalManager.execute({
      command,
      actor: 'eva',
      target: 'host',
      shell: 'powershell',
      cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
      timeoutMs,
    })
    return {
      ok: execRes.ok,
      output: execRes.output,
      error: execRes.error,
    }
  }

  // 3. Screen Capture
  if (normAction === 'screen_capture') {
    const cap = await captureLocalScreen()
    if (cap.ok && cap.frame) {
      controlBus.broadcastDesktopFrame({
        active: true,
        deviceId: 'local_host',
        deviceName: `${os.hostname()} (This PC)`,
        platform: IS_WINDOWS ? 'windows' : IS_MACOS ? 'macos' : 'linux',
        windowTitle: `${os.hostname()} · Windows Desktop`,
        imageBase64: cap.frame.imageBase64,
        width: cap.frame.width,
        height: cap.frame.height,
        lastAction: String(args.label || 'Captured Windows desktop preview'),
        updatedAt: new Date().toISOString(),
      })
    }
    return { ok: cap.ok, output: cap.output, error: cap.error }
  }

  // 4. Window List
  if (normAction === 'window_list') {
    if (!IS_WINDOWS) {
      return { ok: false, output: '', error: 'window_list is currently supported on Windows host.' }
    }
    const ps =
      'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object ProcessName, MainWindowTitle, Id | ConvertTo-Json -Compress'
    return runPowerShellScript(ps, timeoutMs)
  }

  // 5. Focus Window
  if (normAction === 'focus_window') {
    const title = String(args.title ?? '').trim()
    if (!title) return { ok: false, output: '', error: 'Window title is required.' }
    if (!IS_WINDOWS) return { ok: false, output: '', error: 'focus_window is supported on Windows host.' }
    const safeTitle = title.replace(/'/g, "''")
    const ps = [
      '$wshell = New-Object -ComObject WScript.Shell',
      `$ok = $wshell.AppActivate('${safeTitle}')`,
      'Write-Output $ok',
    ].join('\n')
    return runPowerShellScript(ps, timeoutMs)
  }

  // 6. UI Click
  if (normAction === 'ui_click') {
    if (!IS_WINDOWS) return { ok: false, output: '', error: 'ui_click is supported on Windows host.' }
    const x = Math.round(Number(args.x ?? 0))
    const y = Math.round(Number(args.y ?? 0))
    const ps = [
      'Add-Type -MemberDefinition "[DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);" -Name Win32Mouse -Namespace Nexus',
      `[Nexus.Win32Mouse]::SetCursorPos(${x}, ${y}) | Out-Null`,
      'Start-Sleep -Milliseconds 40',
      '[Nexus.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)',
      '[Nexus.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)',
      `Write-Output "Clicked (${x},${y})"`,
    ].join('\n')
    const res = await runPowerShellScript(ps, timeoutMs)
    if (res.ok) {
      void captureLocalScreen().then((cap) => {
        if (cap.ok && cap.frame) {
          controlBus.broadcastDesktopFrame({
            active: true,
            deviceId: 'local_host',
            deviceName: `${os.hostname()} (This PC)`,
            platform: 'windows',
            windowTitle: `${os.hostname()} · Windows Desktop`,
            imageBase64: cap.frame.imageBase64,
            width: cap.frame.width,
            height: cap.frame.height,
            lastAction: `Clicked (${x},${y})`,
            updatedAt: new Date().toISOString(),
          })
        }
      })
    }
    return res
  }

  // 7. UI Type
  if (normAction === 'ui_type') {
    const text = String(args.text ?? '')
    if (!text) return { ok: false, output: '', error: 'Text to type is required.' }
    if (!IS_WINDOWS) return { ok: false, output: '', error: 'ui_type is supported on Windows host.' }
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}').replace(/'/g, "''")
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `[System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
      'Write-Output "Typed text"',
    ].join('\n')
    return runPowerShellScript(ps, timeoutMs)
  }

  // 8. Paste Text
  if (normAction === 'paste_text') {
    const text = String(args.text ?? '')
    if (!text) return { ok: false, output: '', error: 'Text to paste is required.' }
    if (!IS_WINDOWS) return { ok: false, output: '', error: 'paste_text is supported on Windows host.' }
    const safe = text.replace(/'/g, "''")
    const ps = [
      `Set-Clipboard -Value '${safe}'`,
      'Add-Type -AssemblyName System.Windows.Forms',
      'Start-Sleep -Milliseconds 60',
      '[System.Windows.Forms.SendKeys]::SendWait("^v")',
      'Write-Output "Pasted clean text into active window"',
    ].join('\n')
    return runPowerShellScript(ps, timeoutMs)
  }

  // 9. UI Hotkey
  if (normAction === 'ui_hotkey') {
    const keys = String(args.keys ?? '')
    if (!keys) return { ok: false, output: '', error: 'Keys are required.' }
    if (!IS_WINDOWS) return { ok: false, output: '', error: 'ui_hotkey is supported on Windows host.' }
    const safe = keys.replace(/'/g, "''")
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `[System.Windows.Forms.SendKeys]::SendWait('${safe}')`,
      'Write-Output "Sent hotkey"',
    ].join('\n')
    return runPowerShellScript(ps, timeoutMs)
  }

  // 10. Open URL
  if (normAction === 'open_url') {
    const rawUrl = String(args.url ?? '').trim()
    if (!rawUrl) return { ok: false, output: '', error: 'URL is required.' }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      return { ok: false, output: '', error: 'Invalid URL.' }
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, output: '', error: 'Only http:// and https:// URLs are permitted.' }
    }
    const safeUrl = parsedUrl.toString()
    if (IS_WINDOWS) {
      return runPowerShellScript(`Start-Process -FilePath '${safeUrl.replace(/'/g, "''")}'`, timeoutMs)
    }
    if (IS_MACOS) return runCommand('open', [safeUrl])
    return runCommand('xdg-open', [safeUrl])
  }

  // 11. Open App
  if (normAction === 'open_app') {
    const app = String(args.app ?? '').trim()
    if (!app) return { ok: false, output: '', error: 'Application name is required.' }
    const apps = await listAllowedDesktopApps()
    const appPolicy = evaluateAppPolicy(app, apps)
    if (appPolicy.policy === 'deny') {
      return { ok: false, output: '', error: `Blocked: "${app}" is set to Deny in Allowed Desktop Apps.` }
    }
    const targetExe = appPolicy.matchedApp?.executable || app
    if (/[\r\n\0&|;<>`$^]/.test(targetExe) || /\.\.[\\/]/.test(targetExe)) {
      return { ok: false, output: '', error: 'Invalid characters in application name.' }
    }
    if (IS_WINDOWS) {
      return runPowerShellScript(`Start-Process -FilePath '${targetExe.replace(/'/g, "''")}'`, timeoutMs)
    }
    if (IS_MACOS) return runCommand('open', ['-a', targetExe])
    return runCommand(targetExe, [])
  }

  // 12. Connected Folder Operations (list_folder, read_file, write_file, move_file)
  if (['list_folder', 'read_file', 'write_file', 'move_file'].includes(normAction)) {
    const folders = await listConnectedFolders()

    if (normAction === 'list_folder') {
      const targetPath = String(args.path ?? '').trim()
      const guard = checkHostFolderGuard(targetPath, 'read', folders)
      if (!guard.ok) return { ok: false, output: '', error: guard.error }
      try {
        const finalGuard = checkHostFolderGuard(targetPath, 'read', folders)
        if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error }
        const resolved = finalGuard.resolvedPath
        const dirents = await fsPromises.readdir(resolved, { withFileTypes: true })
        const items = await Promise.all(
          dirents
            .filter((d) => !d.isSymbolicLink())
            .slice(0, 150)
            .map(async (d) => {
              const full = path.join(resolved, d.name)
              const childGuard = checkHostFolderGuard(full, 'read', folders)
              if (!childGuard.ok) return null
              try {
                const st = await fsPromises.lstat(full)
                if (st.isSymbolicLink()) return null
                return {
                  name: d.name,
                  kind: d.isDirectory() ? 'dir' : 'file',
                  path: full,
                  size: st.size,
                  mtime: st.mtime.toISOString(),
                }
              } catch {
                return null
              }
            })
        )
        return {
          ok: true,
          output: JSON.stringify({ folder: resolved, items: items.filter(Boolean) }, null, 2),
        }
      } catch (err) {
        return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (normAction === 'read_file') {
      const targetPath = String(args.path ?? '').trim()
      const guard = checkHostFolderGuard(targetPath, 'read', folders)
      if (!guard.ok) return { ok: false, output: '', error: guard.error }
      try {
        const finalGuard = checkHostFolderGuard(targetPath, 'read', folders)
        if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error }
        const resolved = finalGuard.resolvedPath
        const st = await fsPromises.lstat(resolved)
        if (st.isSymbolicLink()) {
          return { ok: false, output: '', error: 'Blocked: symbolic link target is not permitted.' }
        }
        const ext = path.extname(resolved).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          const buf = await fsPromises.readFile(resolved)
          if (buf.length > 4 * 1024 * 1024) {
            return { ok: false, output: '', error: 'Image exceeds 4MB transfer limit.' }
          }
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
          return {
            ok: true,
            output: JSON.stringify({ path: resolved, mimeType: mime, base64: buf.toString('base64') }),
          }
        }
        const content = await fsPromises.readFile(resolved, 'utf8')
        return { ok: true, output: content.slice(0, 32000) }
      } catch (err) {
        return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (normAction === 'write_file') {
      const targetPath = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      const guard = checkHostFolderGuard(targetPath, 'write', folders)
      if (!guard.ok) return { ok: false, output: '', error: guard.error }
      try {
        await fsPromises.mkdir(path.dirname(guard.resolvedPath), { recursive: true })
        const finalGuard = checkHostFolderGuard(targetPath, 'write', folders)
        if (!finalGuard.ok) return { ok: false, output: '', error: finalGuard.error }
        const resolved = finalGuard.resolvedPath
        try {
          if (lstatSync(resolved).isSymbolicLink()) {
            return { ok: false, output: '', error: 'Blocked: symbolic link or junction target is not permitted.' }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
        }
        await fsPromises.writeFile(resolved, content, 'utf8')
        return { ok: true, output: `Saved file: ${resolved}` }
      } catch (err) {
        return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (normAction === 'move_file') {
      const fromPath = String(args.from ?? '').trim()
      const toPath = String(args.to ?? '').trim()
      const gFrom = checkHostFolderGuard(fromPath, 'write', folders)
      if (!gFrom.ok) return { ok: false, output: '', error: `Source: ${gFrom.error}` }
      const gTo = checkHostFolderGuard(toPath, 'write', folders)
      if (!gTo.ok) return { ok: false, output: '', error: `Destination: ${gTo.error}` }
      try {
        await fsPromises.mkdir(path.dirname(gTo.resolvedPath), { recursive: true })
        const finalFrom = checkHostFolderGuard(fromPath, 'write', folders)
        if (!finalFrom.ok) return { ok: false, output: '', error: `Source: ${finalFrom.error}` }
        const finalTo = checkHostFolderGuard(toPath, 'write', folders)
        if (!finalTo.ok) return { ok: false, output: '', error: `Destination: ${finalTo.error}` }
        if (lstatSync(finalFrom.resolvedPath).isSymbolicLink()) {
          return { ok: false, output: '', error: 'Blocked: source is a symbolic link or junction.' }
        }
        try {
          if (lstatSync(finalTo.resolvedPath).isSymbolicLink()) {
            return { ok: false, output: '', error: 'Blocked: destination is a symbolic link or junction.' }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
        }
        await fsPromises.rename(finalFrom.resolvedPath, finalTo.resolvedPath)
        return { ok: true, output: `Moved to: ${finalTo.resolvedPath}` }
      } catch (err) {
        return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) }
      }
    }
  }

  return { ok: false, output: '', error: `Unsupported local device action: "${action}"` }
}
