import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createOfflineSqliteBackup, verifyOfflineSqliteBackup } from './offline-backup.mjs'

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-backup-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const dbPath = path.join(dir, 'disposable.sqlite')
  // A synthetic header fixture proves guard behavior, not a real SQLite restore.
  await fs.writeFile(dbPath, Buffer.concat([
    Buffer.from('SQLite format 3\0', 'ascii'),
    Buffer.alloc(1024, 0x2c),
  ]))
  return { dir, dbPath, backupDir: path.join(dir, 'private-backups') }
}

test('does not copy the database without an explicit offline acknowledgement', async (t) => {
  const f = await fixture(t)
  await assert.rejects(() => createOfflineSqliteBackup(f), /offline acknowledgement/)
})

test('creates a private checksum-verified backup in the chosen location', async (t) => {
  const f = await fixture(t)
  const result = await createOfflineSqliteBackup({ ...f, acknowledgeOffline: true })
  assert.equal(result.manifest.kind, 'offline-prisma-sqlite')
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/)
  assert.equal((await verifyOfflineSqliteBackup(result.manifestPath)).ok, true)
  const copied = await fs.readFile(result.backupPath)
  const original = await fs.readFile(f.dbPath)
  assert.deepEqual(copied, original)
})

test('rejects WAL or transaction journal sidecars to avoid unsafe hot backups', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(f.dbPath + '-wal', 'uncheckpointed')
  await assert.rejects(() => createOfflineSqliteBackup({ ...f, acknowledgeOffline: true }), /sidecar -wal/)
})

test('rejects non-SQLite data and symbolic link source files', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(f.dbPath, 'not a database')
  await assert.rejects(() => createOfflineSqliteBackup({ ...f, acknowledgeOffline: true }), /too small|not a SQLite/)
  await fs.writeFile(f.dbPath, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(1024)]))
  const linkPath = path.join(f.dir, 'link.sqlite')
  try {
    await fs.symlink(f.dbPath, linkPath)
    await assert.rejects(() => createOfflineSqliteBackup({ ...f, dbPath: linkPath, acknowledgeOffline: true }), /symlink/)
  } catch (err) {
    if (err?.code === 'EPERM' || err?.code === 'ENOTSUP') t.diagnostic('Symlink creation unavailable on this runner')
    else throw err
  }
})

test('integrity checker rejects tampered or missing backup contents', async (t) => {
  const f = await fixture(t)
  const result = await createOfflineSqliteBackup({ ...f, acknowledgeOffline: true })
  await fs.appendFile(result.backupPath, 'tampered')
  await assert.rejects(() => verifyOfflineSqliteBackup(result.manifestPath), /integrity verification failed/)
})
