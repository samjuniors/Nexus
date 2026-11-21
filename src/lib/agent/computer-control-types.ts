export type FolderAccessMode = 'read' | 'read_write'
export type AppAllowPolicy = 'always' | 'ask' | 'deny'

export interface ConnectedFolderDTO {
  id: string
  label: string
  path: string
  platform: 'windows' | 'macos' | 'linux'
  accessMode: FolderAccessMode
  enabled: boolean
  lastAccessedAt: string | null
  createdAt: string
}

export interface AllowedDesktopAppDTO {
  id: string
  name: string
  executable: string
  platform: 'windows' | 'macos' | 'linux'
  policy: AppAllowPolicy
  category: 'browser' | 'creative' | 'dev' | 'system' | 'productivity'
  lastUsedAt: string | null
  createdAt: string
}

export const DEFAULT_WINDOWS_FOLDER_PRESETS: {
  label: string
  path: string
  accessMode: FolderAccessMode
}[] = [
  { label: 'Downloads', path: '%USERPROFILE%\\Downloads', accessMode: 'read_write' },
  { label: 'Desktop', path: '%USERPROFILE%\\Desktop', accessMode: 'read' },
  { label: 'Documents', path: '%USERPROFILE%\\Documents', accessMode: 'read_write' },
  { label: 'Pictures', path: '%USERPROFILE%\\Pictures', accessMode: 'read' },
]

export const DEFAULT_WINDOWS_APP_PRESETS: {
  name: string
  executable: string
  policy: AppAllowPolicy
  category: AllowedDesktopAppDTO['category']
}[] = [
  { name: 'Google Chrome', executable: 'chrome.exe', policy: 'always', category: 'browser' },
  { name: 'Microsoft Edge', executable: 'msedge.exe', policy: 'always', category: 'browser' },
  { name: 'File Explorer', executable: 'explorer.exe', policy: 'always', category: 'system' },
  { name: 'VS Code', executable: 'code.exe', policy: 'always', category: 'dev' },
  { name: 'Notepad', executable: 'notepad.exe', policy: 'always', category: 'productivity' },
  { name: 'Blender', executable: 'blender.exe', policy: 'ask', category: 'creative' },
  { name: 'Adobe Photoshop', executable: 'photoshop.exe', policy: 'ask', category: 'creative' },
  { name: 'PowerShell', executable: 'powershell.exe', policy: 'ask', category: 'system' },
]
