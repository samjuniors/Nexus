/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, session, shell } = require('electron')
const os = require('node:os')
const path = require('node:path')

const APP_URL = process.env.NEXUS_APP_URL || 'http://localhost:3000'
let mainWindow = null

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

ipcMain.handle('nexus:get-desktop-info', () => ({
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  hostname: os.hostname(),
  appUrl: APP_URL,
  alwaysOnTop: mainWindow ? mainWindow.isAlwaysOnTop() : false,
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

app.whenReady().then(() => {
  createWindow()

  // Global hotkey to summon/focus Eva Desktop from anywhere on the OS
  globalShortcut.register('CommandOrControl+Shift+E', () => {
    if (!mainWindow) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
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
