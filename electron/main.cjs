/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  session,
  shell,
} = require('electron')
const { execFile } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const APP_URL = process.env.NEXUS_APP_URL || 'http://localhost:3000'
let mainWindow = null

const SHORTCUTS = {
  summon: 'CommandOrControl+Shift+E',
  screenAwareness: 'Alt+Space',
  dictation: 'Alt+Shift+D',
}

async function capturePrimaryScreenFrame() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1440, height: 900 },
  })
  if (!sources.length) {
    return { ok: false, error: 'No desktop screen source available' }
  }
  const primary = sources[0]
  const dataUrl = primary.thumbnail.toDataURL()
  const base64 = dataUrl.replace(/^data:image\/[a-z+]+;base64,/, '')
  return {
    ok: true,
    name: primary.name,
    mimeType: 'image/png',
    base64,
    dataUrl,
  }
}

function pasteIntoPreviousWindowsApp(text) {
  return new Promise((resolve) => {
    clipboard.writeText(text)
    if (process.platform === 'win32') {
      if (mainWindow && mainWindow.isFocused()) {
        mainWindow.blur()
      }
      const ps = 'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait("^v")'
      const encoded = Buffer.from(ps, 'utf16le').toString('base64')
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 6000 }, (err) => {
        resolve({ ok: !err, pasted: !err, copied: true, error: err ? err.message : undefined })
      })
      return
    }
    resolve({ ok: true, pasted: false, copied: true })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'Nexus Agent OS — Eva Desktop',
    backgroundColor: '#09090b',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Grant camera, microphone, and screen capture for Eva Voice + Camera/Screen Eyes
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set(['media', 'audioCapture', 'mediaKeySystem', 'display-capture', 'notifications'])
    callback(allowed.has(permission))
  })

  // Enable getDisplayMedia() inside Electron to capture desktop screens & browser windows
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      if (sources.length > 0) {
        callback({ video: sources[0] })
      } else {
        callback({})
      }
    } catch {
      callback({})
    }
  })

  mainWindow.loadURL(APP_URL)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function focusMainWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

ipcMain.handle('nexus:get-desktop-info', () => ({
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  hostname: os.hostname(),
  appUrl: APP_URL,
  alwaysOnTop: mainWindow ? mainWindow.isAlwaysOnTop() : false,
  shortcuts: SHORTCUTS,
}))

ipcMain.handle('nexus:toggle-always-on-top', () => {
  if (!mainWindow) return false
  const next = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(next, 'floating')
  return next
})

ipcMain.handle('nexus:open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url)
    return { ok: true }
  }
  return { ok: false, error: 'Only http/https URLs are permitted' }
})

ipcMain.handle('nexus:capture-screen', async () => {
  try {
    return await capturePrimaryScreenFrame()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('nexus:inject-text', async (_event, text) => {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'Text is empty' }
  }
  return pasteIntoPreviousWindowsApp(text)
})

app.whenReady().then(() => {
  createWindow()

  // Global hotkey to summon/focus Eva Desktop from anywhere on the OS
  globalShortcut.register(SHORTCUTS.summon, () => {
    focusMainWindow()
  })

  // Windows Alt+Space (macOS Option+Space): capture active screen & open Screen Awareness HUD
  globalShortcut.register(SHORTCUTS.screenAwareness, async () => {
    const capture = await capturePrimaryScreenFrame().catch(() => ({ ok: false }))
    focusMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('nexus:hotkey-screen-awareness', capture)
    }
  })

  // Global Quick Dictation hotkey: dictate clean formatted text into any active Windows app
  globalShortcut.register(SHORTCUTS.dictation, () => {
    focusMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('nexus:hotkey-dictation', { ts: Date.now() })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
