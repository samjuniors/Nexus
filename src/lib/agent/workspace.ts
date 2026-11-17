import { promises as fs } from 'fs'
import path from 'path'

export const WORKSPACE_DIR = path.join(process.cwd(), 'agent-workspace')

export async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })
}

/** Resolve a name to a safe absolute path inside the workspace (no traversal). */
export function safeWorkspacePath(name: string): string | null {
  if (!name || typeof name !== 'string') return null
  const cleaned = name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
  if (cleaned.length === 0) return null
  const abs = path.join(WORKSPACE_DIR, ...cleaned)
  if (!abs.startsWith(WORKSPACE_DIR)) return null
  return abs
}

export async function saveWorkspaceFile(name: string, data: Buffer): Promise<string | null> {
  await ensureWorkspace()
  const abs = safeWorkspacePath(name)
  if (!abs) return null
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, data)
  return name
}

export async function listWorkspaceFiles(): Promise<string[]> {
  await ensureWorkspace()
  const out: string[] = []
  async function walk(dir: string, prefix: string, depth: number) {
    if (depth > 2 || out.length > 120) return
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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
