/* eslint-disable @typescript-eslint/no-require-imports */
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
} = require('electron')
const { execFile } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const { configureScreenVision } = require('./screen-vision-permissions.cjs')
const { configureMediaPermissions } = require('./media-permissions.cjs')

const APP_URL = process.env.NEXUS_APP_URL || 'http://localhost:3000'
const TRUSTED_ORIGIN = new URL(APP_URL).origin
let mainWindow = null
let textInjectionApproved = false

function safeOrigin(value) {
  try { return new URL(value).origin } catch { return null }
}

function isTrustedSender(event) {
  const win = mainWindow
  return Boolean(win && !win.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    safeOrigin(event.senderFrame?.url) === TRUSTED_ORIGIN &&
    safeOrigin(win.webContents.getURL()) === TRUSTED_ORIGIN)
}

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

  // SamjuniorsOS security port: native session media consent and a separate
  // screen/window source picker. Never silently select the first screen.
  configureMediaPermissions({
    targetSession: mainWindow.webContents.session,
    getWindow: () => mainWindow,
    dialog,
    origin: TRUSTED_ORIGIN,
  })
  configureScreenVision({
    targetSession: mainWindow.webContents.session,
    getWindow: () => mainWindow,
    desktopCapturer,
    dialog,
    origin: TRUSTED_ORIGIN,
  })

  mainWindow.loadURL(APP_URL)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (safeOrigin(url) !== TRUSTED_ORIGIN) event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    textInjectionApproved = false
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

ipcMain.handle('nexus:get-desktop-info', (event) => isTrustedSender(event) ? ({
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  hostname: os.hostname(),
  appUrl: APP_URL,
  alwaysOnTop: mainWindow ? mainWindow.isAlwaysOnTop() : false,
  shortcuts: SHORTCUTS,
}) : null)

ipcMain.handle('nexus:toggle-always-on-top', (event) => {
  if (!isTrustedSender(event)) return false
  if (!mainWindow) return false
  const next = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(next, 'floating')
  return next
})

ipcMain.handle('nexus:open-external', async (event, url) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted renderer' }
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url)
    return { ok: true }
  }
  return { ok: false, error: 'Only http/https URLs are permitted' }
})

ipcMain.handle('nexus:capture-screen', async (event) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted renderer' }
  const win = mainWindow
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Eva Screen Awareness',
    message: 'Capture a snapshot of your primary screen?',
    detail: 'This snapshot can contain passwords, notifications, and private messages. Capture only when you intend to share the screen with Eva.',
    buttons: ['Cancel', 'Capture once'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).catch(() => ({ response: 0 }))
  if (choice.response !== 1 || !isTrustedSender(event) || win !== mainWindow) {
    return { ok: false, error: 'Screen capture was not approved' }
  }
  try {
    return await capturePrimaryScreenFrame()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('nexus:inject-text', async (event, text) => {
  if (!isTrustedSender(event)) return { ok: false, error: 'Untrusted renderer' }
  if (typeof text !== 'string' || !text.trim() || text.length > 100000) {
    return { ok: false, error: 'Text is empty' }
  }
  if (!textInjectionApproved) {
    const win = mainWindow
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Eva Quick Dictation',
      message: 'Allow Eva to paste dictated text into other apps for this session?',
      detail: 'Use only when you are actively dictating. Text may be pasted into whichever app has focus.',
      buttons: ['Not now', 'Allow for this session'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).catch(() => ({ response: 0 }))
    if (choice.response !== 1 || !isTrustedSender(event) || win !== mainWindow) {
      return { ok: false, error: 'Text injection was not approved' }
    }
    textInjectionApproved = true
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
    focusMainWindow()
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Eva Screen Awareness',
      message: 'Capture the primary screen once?',
      detail: 'The snapshot can include passwords, messages and notifications. Cancel to avoid capturing.',
      buttons: ['Cancel', 'Capture once'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).catch(() => ({ response: 0 }))
    if (choice.response !== 1 || win !== mainWindow || win.isDestroyed()) return
    const capture = await capturePrimaryScreenFrame().catch(() => ({ ok: false }))
    if (win === mainWindow && !win.isDestroyed()) {
      win.webContents.send('nexus:hotkey-screen-awareness', capture)
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
