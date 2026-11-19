/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexusDesktop', {
  isElectron: true,
  platform: process.platform,
  getDesktopInfo: () => ipcRenderer.invoke('nexus:get-desktop-info'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('nexus:toggle-always-on-top'),
  openExternal: (url) => ipcRenderer.invoke('nexus:open-external', url),
})
