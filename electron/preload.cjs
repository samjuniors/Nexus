const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexusDesktop', {
  isElectron: true,
  platform: process.platform,
  getDesktopInfo: () => ipcRenderer.invoke('nexus:get-desktop-info'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('nexus:toggle-always-on-top'),
  openExternal: (url) => ipcRenderer.invoke('nexus:open-external', url),
  captureScreen: () => ipcRenderer.invoke('nexus:capture-screen'),
  injectText: (text) => ipcRenderer.invoke('nexus:inject-text', text),
  onHotkeyScreenAwareness: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on('nexus:hotkey-screen-awareness', handler)
    return () => ipcRenderer.removeListener('nexus:hotkey-screen-awareness', handler)
  },
  onHotkeyDictation: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on('nexus:hotkey-dictation', handler)
    return () => ipcRenderer.removeListener('nexus:hotkey-dictation', handler)
  },
})
