import { promises as fs, type Dirent } from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { mimeFor, safeWorkspacePath, WORKSPACE_DIR } from '@/lib/agent/workspace'

export const runtime = 'nodejs'

interface ArtifactEntry {
  name: string
  kind: 'image' | 'audio' | 'document' | 'data' | 'text'
  mime: string
  size: number
  sizeLabel: string
  createdAt: string
  url: string
}

function kindFor(mime: string): ArtifactEntry['kind'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'document'
  if (['application/json', 'text/csv', 'application/json; charset=utf-8'].includes(mime)) return 'data'
  return 'text'
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** GET ?list=1 — list every artifact in the workspace (newest first). */
async function listArtifacts() {
  async function walk(dir: string, prefix: string, depth: number): Promise<ArtifactEntry[]> {
    if (depth > 3) return []
    let entries: Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: ArtifactEntry[] = []
    for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      if (e.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        out.push(...(await walk(abs, rel, depth + 1)))
        continue
      }
      try {
        const st = await fs.stat(abs)
        const mime = mimeFor(e.name)
        out.push({
          name: rel,
          kind: kindFor(mime),
          mime,
          size: st.size,
          sizeLabel: fmtSize(st.size),
          createdAt: new Date(st.mtime).toISOString(),
          url: `/api/files?name=${encodeURIComponent(rel)}`,
        })
      } catch {
        /* unreadable — skip */
      }
    }
    return out
  }
  await fs.mkdir(WORKSPACE_DIR, { recursive: true })
  const all = await walk(WORKSPACE_DIR, '', 0)
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return all
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')

    // artifact listing
    if (searchParams.get('list')) {
      const artifacts = await listArtifacts()
      return NextResponse.json({ ok: true, artifacts })
    }

    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
    const abs = safeWorkspacePath(name)
    if (!abs) return NextResponse.json({ ok: false, error: 'Invalid file name' }, { status: 400 })
    try {
      const data = await fs.readFile(abs)
      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': mimeFor(name),
          'Cache-Control': 'public, max-age=3600',
        },
      })
    } catch {
      return NextResponse.json({ ok: false, error: 'File not found' }, { status: 404 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

/** DELETE ?name=... — remove one artifact from the workspace. */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')
    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
    const abs = safeWorkspacePath(name)
    if (!abs) return NextResponse.json({ ok: false, error: 'Invalid file name' }, { status: 400 })
    try {
      await fs.unlink(abs)
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ ok: false, error: 'File not found' }, { status: 404 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
