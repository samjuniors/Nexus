import { promises as fs, lstatSync, realpathSync } from 'fs'
import path from 'path'

export const WORKSPACE_DIR = path.resolve(process.cwd(), 'agent-workspace')

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

/** Reject symlinks/junctions in every existing component below the workspace root. */
function hasUnsafeExistingComponent(abs: string): boolean {
  const root = path.resolve(WORKSPACE_DIR)
  if (!isWithin(root, abs)) return true
  let rootReal: string
  try {
    const rootStat = lstatSync(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return true
    rootReal = realpathSync.native(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return true
  }

  const relative = path.relative(root, abs)
  let current = root
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) return true
      const actual = realpathSync.native(current)
      if (!isWithin(rootReal, actual)) return true
      if (current !== abs && !stat.isDirectory()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      return true
    }
  }
  return false
}

export async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })
  if (hasUnsafeExistingComponent(WORKSPACE_DIR)) {
    throw new Error('Workspace root must not be a symbolic link or junction.')
  }
}

/** Resolve a name to a safe absolute path inside the workspace (no traversal or symlink components). */
export function safeWorkspacePath(name: string): string | null {
  if (!name || typeof name !== 'string') return null
  const cleaned = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
  if (cleaned.length === 0) return null
  const root = path.resolve(WORKSPACE_DIR)
  const abs = path.resolve(root, ...cleaned)
  if (!isWithin(root, abs) || hasUnsafeExistingComponent(abs)) return null
  return abs
}

export async function saveWorkspaceFile(name: string, data: Buffer): Promise<string | null> {
  await ensureWorkspace()
  let abs = safeWorkspacePath(name)
  if (!abs) return null
  await fs.mkdir(path.dirname(abs), { recursive: true })
  // Re-check after directory creation so pre-existing junctions/symlinks cannot redirect writes.
  abs = safeWorkspacePath(name)
  if (!abs) return null
  await fs.writeFile(abs, data, 'utf8')
  return name
}

export async function listWorkspaceFiles(): Promise<string[]> {
  await ensureWorkspace()
  const out: string[] = []
  async function walk(dir: string, prefix: string, depth: number) {
    if (depth > 2 || out.length > 120) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      out.push(rel)
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel, depth + 1)
    }
  }
  await walk(WORKSPACE_DIR, '', 0)
  return out
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
}

export function mimeFor(name: string): string {
  return MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}
