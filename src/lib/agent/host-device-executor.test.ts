import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import {
  LOCAL_HOST_DEVICE_ID,
  getLocalHostDevice,
  listConnectedDevices,
  revokeDevice,
} from '@/lib/agent/device-bridge'
import { controlBus } from '@/lib/agent/control-bus'
import { executeLocalDeviceCommand } from '@/lib/agent/host-device-executor'
import { detectHostShells } from '@/lib/agent/terminal-manager'

describe('Local Host Automatic Connection & Executor', () => {
  it('identifies local host device as online with desktop capabilities', () => {
    const host = getLocalHostDevice()
    assert.equal(host.id, LOCAL_HOST_DEVICE_ID)
    assert.equal(host.status, 'online')
    assert.equal(host.name, `${os.hostname()} (This PC)`)
    assert.ok(host.capabilities.includes('powershell'))
    assert.ok(host.capabilities.includes('screen_capture'))
    assert.ok(host.capabilities.includes('system_info'))
  })

  it('includes local host in listConnectedDevices by default', async () => {
    const devices = await listConnectedDevices()
    assert.ok(devices.length >= 1)
    const host = devices.find((d) => d.id === LOCAL_HOST_DEVICE_ID)
    assert.ok(host, 'local_host must be present in connected devices list')
    assert.equal(host.status, 'online')
  })

  it('controlBus recognizes local host as always online', () => {
    assert.equal(controlBus.isDeviceOnline('local_host'), true)
    assert.equal(controlBus.isDeviceOnline('host'), true)
    const onlineIds = controlBus.getOnlineDeviceIds()
    assert.ok(onlineIds.includes('local_host'))
  })

  it('prevents revoking the local host device', async () => {
    const revoked = await revokeDevice(LOCAL_HOST_DEVICE_ID)
    assert.equal(revoked, false, 'Local host device must never be revocable')
  })

  it('executes system_info directly on local host via controlBus', async () => {
    const res = await controlBus.sendDeviceCommand('local_host', 'system_info', {})
    assert.equal(res.ok, true)
    assert.ok(res.output.length > 0)
    const parsed = JSON.parse(res.output) as { hostname?: string; cpus?: number; platform?: string }
    assert.equal(parsed.hostname, os.hostname())
    assert.ok(typeof parsed.cpus === 'number' && parsed.cpus > 0)
  })

  it('executes real shell/PowerShell script on local host', async () => {
    const shellRes = await executeLocalDeviceCommand('shell', {
      command: 'echo NEXUS_LOCAL_TEST_OK',
    })
    assert.equal(shellRes.ok, true)
    assert.match(shellRes.output, /NEXUS_LOCAL_TEST_OK/)

    const { available } = detectHostShells()
    const psRes = await executeLocalDeviceCommand('powershell', {
      script: 'Write-Output "NEXUS_LOCAL_TEST_OK"',
    })
    if (available.includes('powershell') || available.includes('pwsh')) {
      assert.equal(psRes.ok, true)
      assert.match(psRes.output, /NEXUS_LOCAL_TEST_OK/)
    } else {
      assert.equal(psRes.ok, false)
    }
  })

  it('rejects path traversal or unconfigured folder paths for folder operations', async () => {
    const res = await executeLocalDeviceCommand('read_file', {
      path: '..\\..\\..\\Windows\\System32\\cmd.exe',
    })
    assert.equal(res.ok, false)
    assert.ok(res.error)
  })

  it('rejects denied desktop applications and unsafe URLs', async () => {
    const { addAllowedDesktopApp, deleteAllowedDesktopApp } = await import('@/lib/agent/computer-control')
    const denied = await addAllowedDesktopApp({
      name: 'Blocked Test App',
      executable: 'blocked_test_malware.exe',
      policy: 'deny',
    })
    try {
      const res = await executeLocalDeviceCommand('open_app', {
        app: 'blocked_test_malware.exe',
      })
      assert.equal(res.ok, false)
      assert.match(res.error ?? '', /Deny/i)

      const badUrl = await executeLocalDeviceCommand('open_url', {
        url: 'file:///C:/Windows/System32/calc.exe',
      })
      assert.equal(badUrl.ok, false)
      assert.match(badUrl.error ?? '', /http/i)

      const injApp = await executeLocalDeviceCommand('open_app', {
        app: 'notepad.exe & calc.exe',
      })
      assert.equal(injApp.ok, false)
    } finally {
      await deleteAllowedDesktopApp(denied.id)
    }
  })

  it('blocks symlink and Windows junction escapes in Connected Folders on host', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const { addConnectedFolder, deleteConnectedFolder } = await import('@/lib/agent/computer-control')
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-host-guard-'))
    const allowed = path.join(tempDir, 'allowed')
    const outside = path.join(tempDir, 'outside')
    const link = path.join(allowed, 'escape')
    await fs.mkdir(allowed, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    const folder = await addConnectedFolder({
      label: 'Host Test Folder',
      path: allowed,
      accessMode: 'read_write',
    })
    try {
      const readEscape = await executeLocalDeviceCommand('read_file', {
        path: path.join(link, 'secret.txt'),
      })
      assert.equal(readEscape.ok, false)
      const writeEscape = await executeLocalDeviceCommand('write_file', {
        path: path.join(link, 'pwn.txt'),
        content: 'blocked',
      })
      assert.equal(writeEscape.ok, false)
      await assert.rejects(fs.access(path.join(outside, 'pwn.txt')))
      const listing = await executeLocalDeviceCommand('list_folder', { path: allowed })
      assert.equal(listing.ok, true)
      const items = (JSON.parse(listing.output) as { items: { name: string }[] }).items
      assert.equal(items.some((i) => i.name === 'escape'), false)
    } finally {
      await deleteConnectedFolder(folder.id)
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
