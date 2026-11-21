import test from 'node:test'
import assert from 'node:assert/strict'
import {
  automationSession,
  evaluateAppPolicy,
  evaluateFolderAccess,
  normalizeFolderPath,
} from './computer-control'

test('normalizeFolderPath normalizes Windows and POSIX slashes cleanly', () => {
  assert.equal(normalizeFolderPath('C:/Users/Sumit/Downloads/'), 'C:\\Users\\Sumit\\Downloads')
  assert.equal(normalizeFolderPath('%USERPROFILE%/Documents/'), '%USERPROFILE%\\Documents')
  assert.equal(normalizeFolderPath('/Users/sumit/Desktop/'), '/Users/sumit/Desktop')
})

test('evaluateFolderAccess enforces allowlist, read-only vs read_write, and blocks traversal/prefix spoofing', () => {
  const folders = [
    {
      id: 'f1',
      label: 'Downloads',
      path: 'C:\\Users\\Sumit\\Downloads',
      accessMode: 'read_write' as const,
      enabled: true,
    },
    {
      id: 'f2',
      label: 'Pictures',
      path: 'C:\\Users\\Sumit\\Pictures',
      accessMode: 'read' as const,
      enabled: true,
    },
    {
      id: 'f3',
      label: 'Paused Desktop',
      path: 'C:\\Users\\Sumit\\Desktop',
      accessMode: 'read_write' as const,
      enabled: false,
    },
  ]

  // Allowed read & write inside read_write folder
  assert.equal(evaluateFolderAccess('C:\\Users\\Sumit\\Downloads\\invoice.pdf', 'read', folders).allowed, true)
  assert.equal(evaluateFolderAccess('C:\\Users\\Sumit\\Downloads\\out\\summary.txt', 'write', folders).allowed, true)

  // Read allowed, write blocked on read-only folder
  assert.equal(evaluateFolderAccess('C:\\Users\\Sumit\\Pictures\\jacket.jpg', 'read', folders).allowed, true)
  const roWrite = evaluateFolderAccess('C:\\Users\\Sumit\\Pictures\\jacket.jpg', 'write', folders)
  assert.equal(roWrite.allowed, false)
  assert.match(roWrite.reason, /Read-Only/i)

  // Disabled folder blocked
  assert.equal(evaluateFolderAccess('C:\\Users\\Sumit\\Desktop\\notes.txt', 'read', folders).allowed, false)

  // Prefix spoofing blocked ("DownloadsBackup" != "Downloads")
  assert.equal(evaluateFolderAccess('C:\\Users\\Sumit\\DownloadsBackup\\secret.txt', 'read', folders).allowed, false)

  // Path traversal blocked
  const traversal = evaluateFolderAccess('C:\\Users\\Sumit\\Downloads\\..\\..\\Windows\\System32\\cmd.exe', 'read', folders)
  assert.equal(traversal.allowed, false)
  assert.match(traversal.reason, /traversal/i)
})

test('evaluateAppPolicy matches executables with or without .exe and defaults unlisted apps to ask', () => {
  const apps = [
    { name: 'Google Chrome', executable: 'chrome.exe', policy: 'always' as const },
    { name: 'Blender', executable: 'blender.exe', policy: 'ask' as const },
    { name: 'PowerShell', executable: 'powershell.exe', policy: 'deny' as const },
  ]

  assert.equal(evaluateAppPolicy('chrome.exe', apps).policy, 'always')
  assert.equal(evaluateAppPolicy('chrome', apps).policy, 'always')
  assert.equal(evaluateAppPolicy('Google Chrome', apps).policy, 'always')
  assert.equal(evaluateAppPolicy('blender', apps).policy, 'ask')
  assert.equal(evaluateAppPolicy('C:\\Windows\\System32\\powershell.exe', apps).policy, 'deny')
  assert.equal(evaluateAppPolicy('unknown_installer.exe', apps).policy, 'ask')
})

test('automationSession pause suspends waitIfPausedOrTakeover until resume, and stop aborts cleanly', async () => {
  automationSession.startSession({ target: 'browser', goal: 'Test pause/resume', totalSteps: 3 })
  assert.equal(automationSession.getSnapshot().status, 'running')

  automationSession.pause()
  assert.equal(automationSession.getSnapshot().status, 'paused')

  let resumed = false
  const waiter = automationSession.waitIfPausedOrTakeover().then((ok) => {
    resumed = true
    return ok
  })

  await new Promise((r) => setTimeout(r, 25))
  assert.equal(resumed, false)

  automationSession.resume()
  const okAfterResume = await waiter
  assert.equal(resumed, true)
  assert.equal(okAfterResume, true)
  assert.equal(automationSession.getSnapshot().status, 'running')

  automationSession.pause()
  const stopWaiter = automationSession.waitIfPausedOrTakeover()
  automationSession.stop('Test completed')
  const okAfterStop = await stopWaiter
  assert.equal(okAfterStop, false)
  assert.equal(automationSession.getSnapshot().status, 'idle')
})
