import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chatText, extractJson } from '@/lib/agent/zai'
import { reasoningChain } from '@/lib/agent/reasoning-chain'

const execFileAsync = promisify(execFile)

export type SelfHealStatus =
  | 'diagnosing'
  | 'patching'
  | 'verifying'
  | 'verified'
  | 'rolled_back'
  | 'failed'

export type SelfHealTrigger =
  | 'user_request'
  | 'error_boundary'
  | 'runtime_error'
  | 'agent_tool'

export interface SelfHealPatchFile {
  path: string
  mode: 'replace' | 'write'
  addedLines: number
  removedLines: number
  diff: string
  summary: string
}

export interface SelfHealStep {
  id: string
  phase: 'diagnose' | 'snapshot' | 'patch' | 'verify' | 'rollback' | 'complete' | 'error'
  label: string
  detail?: string
  timestamp: string
}

export interface SelfHealVerification {
  ok: boolean
  command: string
  output: string
  durationMs: number
  checkedAt: string
}

export interface SelfHealSession {
  id: string
  trigger: SelfHealTrigger
  title: string
  errorContext?: string
  status: SelfHealStatus
  steps: SelfHealStep[]
  patches: SelfHealPatchFile[]
  verification: SelfHealVerification | null
  snapshotId: string | null
  canRollback: boolean
  rolledBackAt?: string
  summary?: string
  createdAt: string
  updatedAt: string
}

interface SnapshotEntry {
  relPath: string
  existed: boolean
  content: string | null
}

interface SnapshotRecord {
  snapshotId: string
  sessionId: string
  createdAt: string
  files: SnapshotEntry[]
}

export interface SelfHealEditInput {
  path: string
  mode: 'replace' | 'write'
  target?: string
  replacement?: string
  content?: string
  summary?: string
}

const WORKSPACE_ROOT = process.cwd()
const SNAPSHOT_DIR = path.join(WORKSPACE_ROOT, '.nexus-snapshots')

const ALLOWED_ROOT_PREFIXES = ['src/', 'brain/', 'public/', 'prisma/']
const ALLOWED_ROOT_FILES = new Set(['package.json', 'next.config.ts'])
const BLOCKED_SEGMENTS = new Set(['.git', '.next', 'node_modules', '.nexus-snapshots'])

/** Validates and resolves a workspace-relative path with strict guardrails against traversal or secrets. */
export function resolveSafeAppPath(relPath: string): { abs: string; rel: string } {
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean.includes('..') || clean.includes('\0')) {
    throw new Error(`Invalid or unsafe path: "${relPath}"`)
  }
  const baseName = path.posix.basename(clean).toLowerCase()
  if (baseName === '.env' || baseName.startsWith('.env.')) {
    throw new Error(`Protected environment file cannot be modified: "${clean}"`)
  }
  const parts = clean.split('/')
  if (parts.some((p) => BLOCKED_SEGMENTS.has(p))) {
    throw new Error(`Protected directory cannot be accessed: "${clean}"`)
  }
  const allowed =
    ALLOWED_ROOT_FILES.has(clean) ||
    ALLOWED_ROOT_PREFIXES.some((prefix) => clean.startsWith(prefix))
  if (!allowed) {
    throw new Error(
      `Self-healing edits are scoped to app source directories (${ALLOWED_ROOT_PREFIXES.join(', ')}) and package.json/next.config.ts. Refused: "${clean}"`
    )
  }
  const abs = path.resolve(WORKSPACE_ROOT, clean)
  if (!abs.startsWith(WORKSPACE_ROOT + path.sep) && abs !== WORKSPACE_ROOT) {
    throw new Error(`Path escapes workspace root: "${relPath}"`)
  }
  return { abs, rel: clean }
}

/** Generates a compact, readable unified diff between before and after file contents. */
export function buildUnifiedDiff(relPath: string, before: string, after: string): {
  diff: string
  addedLines: number
  removedLines: number
} {
  const a = before.split('\n')
  const b = after.split('\n')

  // Find common prefix and suffix for clean surgical hunk extraction
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const removedSlice = a.slice(prefix, a.length - suffix)
  const addedSlice = b.slice(prefix, b.length - suffix)

  if (removedSlice.length === 0 && addedSlice.length === 0) {
    return { diff: `--- a/${relPath}\n+++ b/${relPath}\n(no changes)`, addedLines: 0, removedLines: 0 }
  }

  const ctxBeforeStart = Math.max(0, prefix - 3)
  const ctxBefore = a.slice(ctxBeforeStart, prefix)
  const ctxAfter = a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + 3))

  const oldStart = ctxBeforeStart + 1
  const oldCount = ctxBefore.length + removedSlice.length + ctxAfter.length
  const newCount = ctxBefore.length + addedSlice.length + ctxAfter.length

  const lines: string[] = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`,
    ...ctxBefore.map((l) => ` ${l}`),
    ...removedSlice.slice(0, 60).map((l) => `-${l}`),
    ...(removedSlice.length > 60 ? [`-... (${removedSlice.length - 60} more removed lines)`] : []),
    ...addedSlice.slice(0, 60).map((l) => `+${l}`),
    ...(addedSlice.length > 60 ? [`+... (${addedSlice.length - 60} more added lines)`] : []),
    ...ctxAfter.map((l) => ` ${l}`),
  ]

  return {
    diff: lines.join('\n'),
    addedLines: addedSlice.length,
    removedLines: removedSlice.length,
  }
}

type SelfHealListener = (session: SelfHealSession) => void

class SelfHealManager {
  private sessions = new Map<string, SelfHealSession>()
  private snapshots = new Map<string, SnapshotRecord>()
  private listeners = new Set<SelfHealListener>()

  subscribe(listener: SelfHealListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(session: SelfHealSession) {
    const clone = this.clone(session)
    for (const listener of this.listeners) {
      try {
        listener(clone)
      } catch {
        /* ignore subscriber error */
      }
    }
  }

  private clone(s: SelfHealSession): SelfHealSession {
    return {
      ...s,
      steps: s.steps.map((st) => ({ ...st })),
      patches: s.patches.map((p) => ({ ...p })),
      verification: s.verification ? { ...s.verification } : null,
    }
  }

  listSessions(limit = 20): SelfHealSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => this.clone(s))
  }

  getSession(id: string): SelfHealSession | null {
    const s = this.sessions.get(id)
    return s ? this.clone(s) : null
  }

  createSession(input: {
    trigger: SelfHealTrigger
    title: string
    errorContext?: string
  }): SelfHealSession {
    const now = new Date().toISOString()
    const id = `heal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const session: SelfHealSession = {
      id,
      trigger: input.trigger,
      title: input.title.slice(0, 140),
      errorContext: input.errorContext?.slice(0, 2000),
      status: 'diagnosing',
      steps: [
        {
          id: `st_${Date.now().toString(36)}`,
          phase: 'diagnose',
          label: 'Diagnosing issue and inspecting source files',
          detail: input.errorContext?.slice(0, 240),
          timestamp: now,
        },
      ],
      patches: [],
      verification: null,
      snapshotId: null,
      canRollback: false,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(id, session)
    // Trim bounded history to 30 sessions
    if (this.sessions.size > 30) {
      const oldest = Array.from(this.sessions.values()).sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt)
      )[0]
      if (oldest) this.sessions.delete(oldest.id)
    }
    this.emit(session)
    return this.clone(session)
  }

  appendStep(
    sessionId: string,
    step: Omit<SelfHealStep, 'id' | 'timestamp'>,
    nextStatus?: SelfHealStatus
  ) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const now = new Date().toISOString()
    session.steps.push({
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      ...step,
      timestamp: now,
    })
    if (nextStatus) session.status = nextStatus
    session.updatedAt = now
    this.emit(session)
  }

  updateSession(sessionId: string, patch: Partial<SelfHealSession>) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    Object.assign(session, patch, { updatedAt: new Date().toISOString() })
    this.emit(session)
  }

  async saveSnapshot(sessionId: string, relPaths: string[]): Promise<SnapshotRecord> {
    const snapshotId = `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const files: SnapshotEntry[] = []
    for (const relPath of Array.from(new Set(relPaths))) {
      const { abs, rel } = resolveSafeAppPath(relPath)
      try {
        const content = await fs.readFile(abs, 'utf8')
        files.push({ relPath: rel, existed: true, content })
      } catch {
        files.push({ relPath: rel, existed: false, content: null })
      }
    }

    const record: SnapshotRecord = {
      snapshotId,
      sessionId,
      createdAt: new Date().toISOString(),
      files,
    }
    this.snapshots.set(snapshotId, record)

    try {
      await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
      await fs.writeFile(
        path.join(SNAPSHOT_DIR, `${snapshotId}.json`),
        JSON.stringify(record, null, 2),
        'utf8'
      )
    } catch {
      /* in-memory snapshot remains authoritative if disk snapshot dir is readonly */
    }
    return record
  }

  async loadSnapshot(snapshotId: string): Promise<SnapshotRecord | null> {
    const mem = this.snapshots.get(snapshotId)
    if (mem) return mem
    try {
      const raw = await fs.readFile(path.join(SNAPSHOT_DIR, `${snapshotId}.json`), 'utf8')
      const parsed = JSON.parse(raw) as SnapshotRecord
      this.snapshots.set(snapshotId, parsed)
      return parsed
    } catch {
      return null
    }
  }

  async restoreSnapshot(snapshotId: string): Promise<{ restored: string[]; deleted: string[] }> {
    const record = await this.loadSnapshot(snapshotId)
    if (!record) throw new Error(`Snapshot "${snapshotId}" not found`)

    const restored: string[] = []
    const deleted: string[] = []
    for (const entry of record.files) {
      const { abs, rel } = resolveSafeAppPath(entry.relPath)
      if (entry.existed && entry.content !== null) {
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, entry.content, 'utf8')
        restored.push(rel)
      } else {
        await fs.unlink(abs).catch(() => undefined)
        deleted.push(rel)
      }
    }
    return { restored, deleted }
  }
}

const g = globalThis as unknown as { __nexusSelfHeal?: SelfHealManager }
export const selfHealManager = g.__nexusSelfHeal ?? new SelfHealManager()
g.__nexusSelfHeal = selfHealManager

/** Read-only source inspection for Eva (list files, search symbols/text, or read numbered lines). */
export async function inspectAppCode(input: {
  mode: 'list' | 'search' | 'read'
  path?: string
  query?: string
  startLine?: number
  endLine?: number
}): Promise<{ ok: boolean; output: string }> {
  if (input.mode === 'list') {
    const target = input.path ? resolveSafeAppPath(input.path) : { abs: path.join(WORKSPACE_ROOT, 'src'), rel: 'src' }
    const results: string[] = []
    const walk = async (dirAbs: string, relBase: string, depth: number) => {
      if (depth > 3 || results.length >= 120) return
      const entries = await fs.readdir(dirAbs, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (BLOCKED_SEGMENTS.has(entry.name) || entry.name.startsWith('.')) continue
        const nextRel = `${relBase}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(path.join(dirAbs, entry.name), nextRel, depth + 1)
        } else {
          results.push(nextRel)
        }
        if (results.length >= 120) break
      }
    }
    await walk(target.abs, target.rel, 0)
    return {
      ok: true,
      output: results.length > 0 ? results.join('\n') : `(no files found under ${target.rel})`,
    }
  }

  if (input.mode === 'search') {
    const query = (input.query ?? '').trim()
    if (!query) return { ok: false, output: 'Error: search query is required.' }
    const searchRoot = input.path ? resolveSafeAppPath(input.path).rel : 'src'
    try {
      const { stdout } = await execFileAsync(
        'grep',
        [
          '-rn',
          '--exclude-dir=node_modules',
          '--exclude-dir=.next',
          '--exclude-dir=.git',
          '-F',
          query,
          searchRoot,
        ],
        { cwd: WORKSPACE_ROOT, timeout: 10_000, maxBuffer: 512 * 1024 }
      )
      const lines = stdout.split('\n').filter(Boolean).slice(0, 50)
      return {
        ok: true,
        output: lines.length > 0 ? lines.join('\n') : `No matches found for "${query}" in ${searchRoot}.`,
      }
    } catch (e) {
      const err = e as { code?: number; stdout?: string; message?: string }
      if (err.code === 1) {
        return { ok: true, output: `No matches found for "${query}" in ${searchRoot}.` }
      }
      return { ok: false, output: err.message || 'Search failed' }
    }
  }

  // mode === 'read'
  if (!input.path) return { ok: false, output: 'Error: path is required for mode="read".' }
  const { abs, rel } = resolveSafeAppPath(input.path)
  const raw = await fs.readFile(abs, 'utf8')
  const allLines = raw.split('\n')
  const start = Math.max(1, input.startLine ?? 1)
  const end = Math.min(allLines.length, input.endLine ?? Math.min(allLines.length, start + 199))
  const numbered = allLines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join('\n')
  return {
    ok: true,
    output: `File: ${rel} (lines ${start}-${end} of ${allLines.length})\n${numbered}`,
  }
}

/** Runs TypeScript typecheck (and optional targeted test file) to verify app health. */
export async function verifyAppBuild(opts?: {
  testFile?: string
}): Promise<SelfHealVerification> {
  const started = Date.now()
  const tscBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsc')
  let command = 'npx tsc --noEmit'

  try {
    const { stdout, stderr } = await execFileAsync(tscBin, ['--noEmit'], {
      cwd: WORKSPACE_ROOT,
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
    })
    let combined = [stdout, stderr].filter(Boolean).join('\n').trim()

    if (opts?.testFile) {
      const { rel } = resolveSafeAppPath(opts.testFile)
      command = `tsc --noEmit && tsx --test ${rel}`
      const tsxBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsx')
      const testRes = await execFileAsync(tsxBin, ['--test', rel], {
        cwd: WORKSPACE_ROOT,
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      })
      combined = [combined, testRes.stdout, testRes.stderr].filter(Boolean).join('\n').trim()
    }

    return {
      ok: true,
      command,
      output: combined || 'TypeScript typecheck passed with 0 errors.',
      durationMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    const out = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim()
    return {
      ok: false,
      command,
      output: out.slice(0, 3500) || 'Verification failed.',
      durationMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }
  }
}

/**
 * Snapshot-first atomic patch engine:
 * 1. Validates all paths against guardrails
 * 2. Saves immutable pre-patch snapshot of every file
 * 3. Applies surgical search/replace or full writes
 * 4. Generates clean unified diffs
 * 5. Runs `tsc --noEmit` verification (auto-rolling back on failure if requested)
 */
export async function applySelfHealPatch(input: {
  sessionId?: string
  trigger?: SelfHealTrigger
  title: string
  errorContext?: string
  edits: SelfHealEditInput[]
  verify?: boolean
  autoRollbackOnFail?: boolean
  testFile?: string
}): Promise<{
  ok: boolean
  session: SelfHealSession
  error?: string
}> {
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error('At least one file edit is required.')
  }

  // Validate all target paths upfront before touching disk
  const resolvedPaths = input.edits.map((e) => resolveSafeAppPath(e.path))

  const session =
    input.sessionId && selfHealManager.getSession(input.sessionId)
      ? selfHealManager.getSession(input.sessionId)!
      : selfHealManager.createSession({
          trigger: input.trigger ?? 'agent_tool',
          title: input.title,
          errorContext: input.errorContext,
        })

  const snapshot = await selfHealManager.saveSnapshot(
    session.id,
    resolvedPaths.map((r) => r.rel)
  )
  selfHealManager.updateSession(session.id, {
    snapshotId: snapshot.snapshotId,
    canRollback: true,
  })
  selfHealManager.appendStep(
    session.id,
    {
      phase: 'snapshot',
      label: `Saved pre-patch snapshot (${snapshot.files.length} file${snapshot.files.length === 1 ? '' : 's'})`,
      detail: snapshot.files.map((f) => f.relPath).join(', '),
    },
    'patching'
  )

  const appliedPatches: SelfHealPatchFile[] = []

  try {
    for (let i = 0; i < input.edits.length; i++) {
      const edit = input.edits[i]
      const { abs, rel } = resolvedPaths[i]
      let before = ''
      try {
        before = await fs.readFile(abs, 'utf8')
      } catch {
        before = ''
      }

      let after = before
      if (edit.mode === 'replace') {
        if (!edit.target) {
          throw new Error(`Edit for "${rel}" in replace mode requires a non-empty target snippet.`)
        }
        if (!before.includes(edit.target)) {
          throw new Error(
            `Target snippet not found in "${rel}". Read the exact lines first before patching.`
          )
        }
        after = before.replace(edit.target, edit.replacement ?? '')
      } else {
        if (typeof edit.content !== 'string') {
          throw new Error(`Edit for "${rel}" in write mode requires content.`)
        }
        after = edit.content
      }

      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, after, 'utf8')

      const { diff, addedLines, removedLines } = buildUnifiedDiff(rel, before, after)
      appliedPatches.push({
        path: rel,
        mode: edit.mode,
        addedLines,
        removedLines,
        diff,
        summary: edit.summary || `${edit.mode === 'replace' ? 'Patched' : 'Updated'} ${rel}`,
      })
    }
  } catch (err) {
    // Restore immediately if any edit fails mid-batch
    await selfHealManager.restoreSnapshot(snapshot.snapshotId).catch(() => undefined)
    const message = err instanceof Error ? err.message : String(err)
    selfHealManager.updateSession(session.id, {
      canRollback: false,
      summary: `Patch aborted and snapshot restored: ${message}`,
    })
    selfHealManager.appendStep(
      session.id,
      {
        phase: 'error',
        label: 'Patch aborted — original files preserved',
        detail: message,
      },
      'failed'
    )
    return { ok: false, session: selfHealManager.getSession(session.id)!, error: message }
  }

  selfHealManager.updateSession(session.id, { patches: appliedPatches })
  selfHealManager.appendStep(
    session.id,
    {
      phase: 'patch',
      label: `Applied surgical patch to ${appliedPatches.length} file${appliedPatches.length === 1 ? '' : 's'}`,
      detail: appliedPatches.map((p) => `${p.path} (+${p.addedLines}/-${p.removedLines})`).join(', '),
    },
    input.verify === false ? 'verified' : 'verifying'
  )

  if (input.verify === false) {
    selfHealManager.updateSession(session.id, {
      summary: `Applied ${appliedPatches.length} patch(es) with snapshot rollback available.`,
    })
    return { ok: true, session: selfHealManager.getSession(session.id)! }
  }

  const verification = await verifyAppBuild({ testFile: input.testFile })
  selfHealManager.updateSession(session.id, { verification })

  if (verification.ok) {
    selfHealManager.appendStep(
      session.id,
      {
        phase: 'complete',
        label: `Verification passed (${verification.durationMs}ms)`,
        detail: verification.output.slice(0, 260),
      },
      'verified'
    )
    selfHealManager.updateSession(session.id, {
      summary: `Verified fix across ${appliedPatches.length} file(s) (${verification.durationMs}ms). Snapshot ready for 1-click rollback.`,
    })
    return { ok: true, session: selfHealManager.getSession(session.id)! }
  }

  // Verification failed -> auto-rollback if enabled (default true) so the app never stays broken
  if (input.autoRollbackOnFail !== false) {
    await selfHealManager.restoreSnapshot(snapshot.snapshotId).catch(() => undefined)
    selfHealManager.updateSession(session.id, {
      canRollback: false,
      rolledBackAt: new Date().toISOString(),
      summary: 'Verification failed — automatically rolled back to clean pre-patch snapshot.',
    })
    selfHealManager.appendStep(
      session.id,
      {
        phase: 'rollback',
        label: 'Verification failed — auto-rolled back snapshot',
        detail: verification.output.slice(0, 320),
      },
      'rolled_back'
    )
    return {
      ok: false,
      session: selfHealManager.getSession(session.id)!,
      error: `TypeScript verification failed and snapshot was automatically restored:\n${verification.output.slice(0, 1200)}`,
    }
  }

  selfHealManager.appendStep(
    session.id,
    {
      phase: 'error',
      label: 'Verification failed (snapshot retained for manual rollback)',
      detail: verification.output.slice(0, 320),
    },
    'failed'
  )
  return {
    ok: false,
    session: selfHealManager.getSession(session.id)!,
    error: verification.output.slice(0, 1200),
  }
}

/** One-click user or agent rollback for any active self-heal session snapshot. */
export async function rollbackSelfHealSession(
  sessionId: string
): Promise<{ ok: boolean; session: SelfHealSession; restored: string[]; deleted: string[] }> {
  const session = selfHealManager.getSession(sessionId)
  if (!session) throw new Error(`Self-heal session "${sessionId}" not found`)
  if (!session.snapshotId) throw new Error('This session has no snapshot to roll back.')

  const { restored, deleted } = await selfHealManager.restoreSnapshot(session.snapshotId)
  selfHealManager.updateSession(sessionId, {
    canRollback: false,
    rolledBackAt: new Date().toISOString(),
    summary: `Rolled back ${restored.length} file(s)${deleted.length > 0 ? ` and removed ${deleted.length} new file(s)` : ''}.`,
  })
  selfHealManager.appendStep(
    sessionId,
    {
      phase: 'rollback',
      label: `Restored pre-patch snapshot (${restored.length + deleted.length} file(s))`,
      detail: [...restored, ...deleted.map((d) => `removed ${d}`)].join(', '),
    },
    'rolled_back'
  )

  return { ok: true, session: selfHealManager.getSession(sessionId)!, restored, deleted }
}

/**
 * End-to-end autonomous diagnosis + repair loop triggered from Error Boundaries,
 * runtime error interceptors, or the Self-Heal split panel prompt bar.
 */
export async function runAutonomousSelfHeal(input: {
  trigger: SelfHealTrigger
  errorMessage: string
  stack?: string
  viewName?: string
  targetFileHint?: string
}): Promise<{ ok: boolean; session: SelfHealSession; message: string }> {
  const title = input.viewName
    ? `Auto-Heal ${input.viewName}: ${input.errorMessage.slice(0, 68)}`
    : `Auto-Heal: ${input.errorMessage.slice(0, 82)}`

  const session = selfHealManager.createSession({
    trigger: input.trigger,
    title,
    errorContext: [input.errorMessage, input.stack].filter(Boolean).join('\n'),
  })

  const chain = reasoningChain.startChain({
    goal: `Self-heal app issue: ${input.errorMessage.slice(0, 140)}`,
    source: 'self_heal',
    actor: 'Eva',
  })

  try {
    // 1. Collect candidate source files from stack trace or workspace search
    const candidateFiles = new Set<string>()
    if (input.targetFileHint) {
      try {
        candidateFiles.add(resolveSafeAppPath(input.targetFileHint).rel)
      } catch {
        /* ignore invalid hint */
      }
    }

    const combinedText = `${input.errorMessage}\n${input.stack ?? ''}`
    const pathMatches = combinedText.match(/\b(?:src|brain)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx)\b/g) ?? []
    for (const m of pathMatches) {
      try {
        candidateFiles.add(resolveSafeAppPath(m).rel)
      } catch {
        /* skip */
      }
    }

    // If no direct file paths in stack, search by viewName or distinctive identifier
    if (candidateFiles.size === 0) {
      const searchHint =
        input.viewName ||
        (input.errorMessage.match(/[A-Za-z_][A-Za-z0-9_]{4,}/g) ?? []).find(
          (w) => !['Error', 'TypeError', 'Cannot', 'reading', 'undefined', 'properties'].includes(w)
        ) ||
        ''
      if (searchHint) {
        const res = await inspectAppCode({ mode: 'search', query: searchHint })
        const lines = res.output.split('\n').slice(0, 12)
        for (const l of lines) {
          const filePart = l.split(':')[0]
          if (filePart && filePart.startsWith('src/')) candidateFiles.add(filePart)
        }
      }
    }

    // Also run baseline typecheck to surface any concrete compiler diagnostics
    const baselineCheck = await verifyAppBuild()
    if (!baselineCheck.ok) {
      const tsMatches = baselineCheck.output.match(/\b(?:src|brain)\/[A-Za-z0-9_./-]+\.tsx?\b/g) ?? []
      for (const m of tsMatches.slice(0, 4)) candidateFiles.add(m)
    }

    const filesToRead = Array.from(candidateFiles).slice(0, 3)
    const fileContexts: string[] = []
    for (const rel of filesToRead) {
      try {
        const readRes = await inspectAppCode({ mode: 'read', path: rel, startLine: 1, endLine: 220 })
        fileContexts.push(readRes.output.slice(0, 6500))
      } catch {
        /* ignore unreadable */
      }
    }

    reasoningChain.addNode(chain.id, {
      kind: 'observation',
      title: `Inspected ${filesToRead.length} candidate file(s) & ran baseline typecheck`,
      detail: filesToRead.join(', ') || baselineCheck.output.slice(0, 180),
      actor: 'Eva',
      tool: 'self_heal_code',
    })

    // 2. Ask server-side LLM to synthesize a minimal, surgical search/replace patch
    const rawPlan = await chatText(
      [
        {
          role: 'system',
          content: `You are Eva's Autonomous Self-Healing Engineer inside Nexus Agent OS (Next.js App Router + strict TypeScript).
Analyze the error and the exact source files provided. Produce a minimal, surgical search/replace patch to fix the root cause without breaking existing functionality.
Reply ONLY with minified JSON:
{"diagnosis":"short root cause","edits":[{"path":"src/...","mode":"replace","target":"EXACT existing substring","replacement":"new substring","summary":"what changed"}]}
If no code edit is required (for example, the codebase already typechecks cleanly and no concrete defective lines are shown), return {"diagnosis":"...","edits":[]}.`,
        },
        {
          role: 'user',
          content: `ERROR / REQUEST:\n${input.errorMessage}\n\nSTACK:\n${(input.stack ?? '(none)').slice(0, 1600)}\n\nBASELINE TYPECHECK (${baselineCheck.ok ? 'PASS' : 'FAIL'}):\n${baselineCheck.output.slice(0, 1200)}\n\nSOURCE FILES:\n${fileContexts.join('\n\n---\n\n') || '(no matching files found)'}`,
        },
      ],
      { temperature: 0.15, maxTokens: 1600 }
    )

    const parsed = extractJson<{
      diagnosis?: string
      edits?: SelfHealEditInput[]
    }>(rawPlan)

    const diagnosis = parsed?.diagnosis || 'Diagnostic scan completed.'
    const edits = Array.isArray(parsed?.edits) ? parsed.edits : []

    if (edits.length === 0) {
      selfHealManager.updateSession(session.id, {
        verification: baselineCheck,
        summary: diagnosis,
      })
      selfHealManager.appendStep(
        session.id,
        {
          phase: 'complete',
          label: 'Diagnostic complete — no unsafe blind edit applied',
          detail: diagnosis,
        },
        baselineCheck.ok ? 'verified' : 'failed'
      )
      reasoningChain.completeChain(chain.id, {
        ok: baselineCheck.ok,
        verificationDetail: diagnosis,
        actor: 'Eva',
      })
      return {
        ok: baselineCheck.ok,
        session: selfHealManager.getSession(session.id)!,
        message: diagnosis,
      }
    }

    reasoningChain.addNode(chain.id, {
      kind: 'decision',
      title: `Applying surgical patch to ${edits.map((e) => e.path).join(', ')}`,
      detail: diagnosis,
      actor: 'Eva',
      tool: 'self_heal_code',
    })

    const patchRes = await applySelfHealPatch({
      sessionId: session.id,
      trigger: input.trigger,
      title,
      errorContext: input.errorMessage,
      edits,
      verify: true,
      autoRollbackOnFail: true,
    })

    if (patchRes.ok) {
      reasoningChain.completeChain(chain.id, {
        ok: true,
        verificationDetail: patchRes.session.summary || 'Self-heal patch verified via TypeScript check',
        actor: 'Eva',
      })
      return {
        ok: true,
        session: patchRes.session,
        message: `${diagnosis} — Patch applied and verified.`,
      }
    }

    reasoningChain.addNode(chain.id, {
      kind: 'self_correction',
      title: 'Verification failed — snapshot auto-rolled back cleanly',
      detail: patchRes.error?.slice(0, 260) || 'Post-patch TypeScript verification failed.',
      actor: 'Eva',
      tool: 'self_heal_code',
      correction: {
        whatFailed: 'Post-patch TypeScript verification failed.',
        pivotStrategy: 'Automatically restored pre-patch snapshot so app remains healthy.',
      },
    })
    reasoningChain.completeChain(chain.id, {
      ok: false,
      verificationDetail: patchRes.error?.slice(0, 240) || 'Post-patch TypeScript verification failed.',
      actor: 'Eva',
    })
    return {
      ok: false,
      session: patchRes.session,
      message: patchRes.error || 'Patch failed verification and was automatically rolled back.',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    selfHealManager.updateSession(session.id, { summary: msg })
    selfHealManager.appendStep(
      session.id,
      { phase: 'error', label: 'Self-heal encountered an error', detail: msg },
      'failed'
    )
    reasoningChain.completeChain(chain.id, {
      ok: false,
      verificationDetail: msg,
      actor: 'Eva',
    })
    return { ok: false, session: selfHealManager.getSession(session.id)!, message: msg }
  }
}
