import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureWorkspace, listWorkspaceFiles, safeWorkspacePath, saveWorkspaceFile, WORKSPACE_DIR } from './workspace'

describe('Workspace filesystem boundary', () => {
  it('rejects reads and writes through directory symlinks/junctions and omits them from listings', async () => {
    await ensureWorkspace()
    const fixture = path.join(process.cwd(), '__workspace_outside_' + Date.now())
    const linkName = '__workspace_link_' + Date.now()
    const link = path.join(WORKSPACE_DIR, linkName)
    await fs.mkdir(fixture, { recursive: true })
    await fs.writeFile(path.join(fixture, 'sentinel.txt'), 'outside')
    try {
      await fs.symlink(fixture, link, process.platform === 'win32' ? 'junction' : 'dir')
      assert.equal(safeWorkspacePath(linkName + '/sentinel.txt'), null)
      assert.equal(await saveWorkspaceFile(linkName + '/write.txt', Buffer.from('blocked')), null)
      const entries = await listWorkspaceFiles()
      assert.equal(entries.some((entry) => entry.startsWith(linkName)), false)
      await assert.rejects(fs.access(path.join(fixture, 'write.txt')))
    } finally {
      await fs.rm(link, { recursive: true, force: true })
      await fs.rm(fixture, { recursive: true, force: true })
    }
  })
})
