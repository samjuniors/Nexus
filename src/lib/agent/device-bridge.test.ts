import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildCompanionRunnerScript } from './device-bridge'

describe('Companion Bridge Connected Folders filesystem boundary', () => {
  let tempDir: string
  let bridgeModule: { checkFolderGuard: (target: string, write?: boolean) => { ok: boolean; error?: string }; executeAction: (action: string, args?: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string }>; setFolders: (folders: unknown[]) => void }
  const previousToken = process.env.NEXUS_DEVICE_TOKEN

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-companion-guard-'))
    const generated = buildCompanionRunnerScript('http://127.0.0.1:3000')
    assert.match(generated, /function checkFolderGuard/)
    const testable = generated.replace(/\nconnect\(\);\s*$/, '\nglobalThis.__nexusBridgeTest = { checkFolderGuard, executeAction, setFolders(folders) { syncedFolders = folders; } };\n')
    assert.notEqual(testable, generated, 'generated bridge connect call must be replaced for isolated tests')
    const runnerPath = path.join(tempDir, 'companion-test.mjs')
    await fs.writeFile(runnerPath, testable, 'utf8')
    process.env.NEXUS_DEVICE_TOKEN = 'test-only-token'
    await import(pathToFileURL(runnerPath).href + '?test=' + Date.now())
    bridgeModule = (globalThis as typeof globalThis & { __nexusBridgeTest: typeof bridgeModule }).__nexusBridgeTest
  })

  after(async () => {
    if (previousToken === undefined) delete process.env.NEXUS_DEVICE_TOKEN
    else process.env.NEXUS_DEVICE_TOKEN = previousToken
    delete (globalThis as typeof globalThis & { __nexusBridgeTest?: unknown }).__nexusBridgeTest
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('rejects symlink and Windows junction escapes for reads and writes', async () => {
    const root = path.join(tempDir, 'allowed')
    const outside = path.join(tempDir, 'outside')
    await fs.mkdir(root, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    await fs.writeFile(path.join(outside, 'sentinel.txt'), 'outside')
    const link = path.join(root, 'escape')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    bridgeModule.setFolders([{ id: 'fixture', label: 'Fixture', path: root, enabled: true, accessMode: 'read_write' }])

    const escaped = path.join(link, 'sentinel.txt')
    assert.equal(bridgeModule.checkFolderGuard(escaped).ok, false)
    const listing = await bridgeModule.executeAction('list_folder', { path: root })
    assert.equal(listing.ok, true)
    assert.equal(JSON.parse(listing.output).items.some((item: { name: string }) => item.name === 'escape'), false)
    const read = await bridgeModule.executeAction('read_file', { path: escaped })
    assert.equal(read.ok, false)
    const write = await bridgeModule.executeAction('write_file', { path: path.join(link, 'created.txt'), content: 'blocked' })
    assert.equal(write.ok, false)
    await assert.rejects(fs.access(path.join(outside, 'created.txt')))

    const normal = path.join(root, 'inside.txt')
    const saved = await bridgeModule.executeAction('write_file', { path: normal, content: 'inside' })
    assert.equal(saved.ok, true)
    const readBack = await bridgeModule.executeAction('read_file', { path: normal })
    assert.equal(readBack.ok, true)
    assert.equal(readBack.output, 'inside')
  })

  it('rejects a Connected Folder root that is itself a junction', async () => {
    const root = path.join(tempDir, 'root-target')
    const junction = path.join(tempDir, 'root-junction')
    await fs.mkdir(root, { recursive: true })
    await fs.symlink(root, junction, process.platform === 'win32' ? 'junction' : 'dir')
    bridgeModule.setFolders([{ id: 'fixture', label: 'Fixture', path: junction, enabled: true, accessMode: 'read_write' }])
    assert.equal(bridgeModule.checkFolderGuard(path.join(junction, 'file.txt'), true).ok, false)
  })

  it('continues to enforce read-only folder policy', async () => {
    const root = path.join(tempDir, 'readonly')
    await fs.mkdir(root, { recursive: true })
    bridgeModule.setFolders([{ id: 'readonly', label: 'Read Only Fixture', path: root, enabled: true, accessMode: 'read_only' }])
    assert.equal(bridgeModule.checkFolderGuard(path.join(root, 'file.txt'), false).ok, true)
    assert.equal(bridgeModule.checkFolderGuard(path.join(root, 'file.txt'), true).ok, false)
  })
})
