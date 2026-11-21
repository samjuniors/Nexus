/**
 * Offline-only Nexus SQLite disaster-recovery snapshot.
 *
 * Adapted conceptually from SamjuniorsOS scripts/backup-restore.ts.
 * Intentionally does NOT perform restore, delete existing data, or create a
 * misleading online hot-backup. Stop the Nexus process and checkpoint SQLite
 * before using. No credentials or user data are ever added to Git.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'ascii')
const MANIFEST_VERSION = 1

async function sha256File(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

async function regularNonSymlink(file) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing non-regular or symlink file')
  return stat
}

async function noWalOrShm(source) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      await fs.lstat(source + suffix)
      throw new Error('SQLite sidecar ' + suffix + ' detected. Shut down and checkpoint the database before an offline backup.')
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
    }
  }
}

export async function createOfflineSqliteBackup({ dbPath, backupDir, acknowledgeOffline = false }) {
  if (!acknowledgeOffline) throw new Error('Explicit offline acknowledgement required')
  if (!dbPath || !backupDir) throw new Error('Provide explicit dbPath and backupDir')
  const source = path.resolve(dbPath)
  const output = path.resolve(backupDir)
  if (source === output || output.startsWith(source + path.sep)) throw new Error('Backup destination cannot be under database file')
  const sourceStat = await regularNonSymlink(source)
  if (sourceStat.size < SQLITE_HEADER.length) throw new Error('Source is too small to be a SQLite database')
  const handle = await fs.open(source, 'r')
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length)
    await handle.read(header, 0, header.length, 0)
    if (!header.equals(SQLITE_HEADER)) throw new Error('Source is not a SQLite database')
  } finally { await handle.close() }
  await noWalOrShm(source)
  await fs.mkdir(output, { recursive: true, mode: 0o700 })
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(5).toString('hex')
  const backupName = 'nexus-offline-' + id + '.sqlite'
  const backupPath = path.join(output, backupName)
  const temporary = backupPath + '.part'
  try {
    await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    const after = await regularNonSymlink(source)
    await noWalOrShm(source)
    if (sourceStat.size !== after.size || sourceStat.mtimeMs !== after.mtimeMs || sourceStat.ino !== after.ino) {
      throw new Error('Source database changed during backup: discard this snapshot')
    }
    const sourceHash = await sha256File(source)
    const copyHash = await sha256File(temporary)
    if (sourceHash !== copyHash) throw new Error('Source and backup checksums differ')
    await fs.rename(temporary, backupPath)
    const manifest = {
      manifestVersion: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      kind: 'offline-prisma-sqlite',
      sourceFileName: path.basename(source),
      backupFileName: backupName,
      byteCount: after.size,
      sha256: copyHash,
      onlineConsistent: false,
    }
    await fs.writeFile(backupPath + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return { backupPath, manifestPath: backupPath + '.manifest.json', manifest }
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function verifyOfflineSqliteBackup(manifestPath) {
  const manifestFile = path.resolve(manifestPath)
  await regularNonSymlink(manifestFile)
  const obj = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  if (obj.manifestVersion !== MANIFEST_VERSION ||
      typeof obj.backupFileName !== 'string' ||
      path.basename(obj.backupFileName) !== obj.backupFileName ||
      !/^nexus-offline-[a-zA-Z0-9-]+\.sqlite$/.test(obj.backupFileName) ||
      !/^[a-f0-9]{64}$/.test(String(obj.sha256)) ||
      !Number.isSafeInteger(obj.byteCount) || obj.byteCount < SQLITE_HEADER.length) {
    throw new Error('Backup manifest is invalid')
  }
  const file = path.join(path.dirname(manifestFile), obj.backupFileName)
  const stat = await regularNonSymlink(file)
  if (stat.size !== obj.byteCount || await sha256File(file) !== obj.sha256) {
    throw new Error('Backup integrity verification failed')
  }
  return { ok: true, file, sha256: obj.sha256, size: stat.size }
}

async function cli() {
  const args = process.argv.slice(2)
  const get = (name) => args[args.indexOf(name) + 1]
  if (args[0] === 'backup') {
    if (!args.includes('--ack-offline') || !args.includes('--db') || !args.includes('--out')) {
      throw new Error('Usage: node scripts/offline-backup.mjs backup --db /explicit/path/db.sqlite --out /private/backups --ack-offline')
    }
    const result = await createOfflineSqliteBackup({
      dbPath: get('--db'), backupDir: get('--out'), acknowledgeOffline: true,
    })
    console.log(JSON.stringify(result, null, 2))
  } else if (args[0] === 'verify') {
    if (!args.includes('--manifest')) throw new Error('Usage: node scripts/offline-backup.mjs verify --manifest /path/to/backup.manifest.json')
    console.log(JSON.stringify(await verifyOfflineSqliteBackup(get('--manifest')), null, 2))
  } else {
    throw new Error('Only offline backup and read-only verify are supported; restore is intentionally not implemented')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  cli().catch(error => { console.error(String(error?.message || error)); process.exitCode = 1 })
}
