import fs from 'node:fs/promises'
import { lstatSync, realpathSync } from 'node:fs'
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
  phase: 'diagnose' | 'brain' | 'snapshot' | 'patch' | 'verify' | 'rollback' | 'complete' | 'error'
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

export interface SelfHealBrainContext {
  recalledCount: number
  coreLoaded: boolean
  recalledSummaries: string[]
  learnedLesson?: string
}

export interface SelfHealCapabilityUpgrade {
  kind: 'skill' | 'recommendation'
  name: string
  slug?: string
  description: string
  applied: boolean
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
  attemptsUsed?: number
  brainContext?: SelfHealBrainContext
  capabilityUpgrade?: SelfHealCapabilityUpgrade
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

export interface ParsedTscDiagnostic {
  file: string
  line: number
  col: number
  code: string
  message: string
}

const WORKSPACE_ROOT = process.cwd()
const SNAPSHOT_DIR = path.join(WORKSPACE_ROOT, '.nexus-snapshots')

const ALLOWED_ROOT_PREFIXES = ['src/', 'brain/', 'public/', 'prisma/']
const ALLOWED_ROOT_FILES = new Set(['package.json', 'next.config.ts'])
const BLOCKED_SEGMENTS = new Set(['.git', '.next', 'node_modules', '.nexus-snapshots'])
const BLOCKED_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12'])

/** Reject existing symlink/junction components below the canonical workspace root. */
function traversesSymlinkOrJunction(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return true
  let rootReal: string
  try {
    const rootStat = lstatSync(resolvedRoot)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return true
    rootReal = realpathSync.native(resolvedRoot)
  } catch {
    return true
  }
  let current = resolvedRoot
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) return true
      const actual = realpathSync.native(current)
      const rel = path.relative(rootReal, actual)
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      return true
    }
  }
  return false
}

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
  const ext = path.posix.extname(baseName)
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Protected binary or key file cannot be modified: "${clean}"`)
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
  if (traversesSymlinkOrJunction(WORKSPACE_ROOT, abs)) {
    throw new Error('Path traverses a symbolic link or junction: ' + relPath)
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
      brainContext: s.brainContext
        ? { ...s.brainContext, recalledSummaries: [...s.brainContext.recalledSummaries] }
        : undefined,
      capabilityUpgrade: s.capabilityUpgrade ? { ...s.capabilityUpgrade } : undefined,
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
      if (depth > 4 || results.length >= 240) return
      const entries = await fs.readdir(dirAbs, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (BLOCKED_SEGMENTS.has(entry.name) || entry.name.startsWith('.')) continue
        const nextRel = `${relBase}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(path.join(dirAbs, entry.name), nextRel, depth + 1)
        } else {
          results.push(nextRel)
        }
        if (results.length >= 240) break
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
          '-rni',
          '--exclude-dir=node_modules',
          '--exclude-dir=.next',
          '--exclude-dir=.git',
          '-F',
          '--',
          query,
          searchRoot,
        ],
        { cwd: WORKSPACE_ROOT, timeout: 10_000, maxBuffer: 512 * 1024 }
      )
      const lines = stdout.split('\n').filter(Boolean).slice(0, 60)
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

/**
 * Parses `tsc --noEmit` output into structured file/line diagnostics so Eva can
 * jump directly to broken lines instead of reading only the top of a file.
 */
export function parseTscDiagnostics(output: string): ParsedTscDiagnostic[] {
  const results: ParsedTscDiagnostic[] = []
  const re = /^((?:src|brain|prisma)\/[^\s(:]+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(output)) !== null) {
    results.push({
      file: match[1],
      line: Number(match[2]),
      col: Number(match[3]),
      code: match[4],
      message: match[5].trim(),
    })
  }
  return results
}

const STOP_WORDS = new Set([
  'error', 'typeerror', 'referenceerror', 'syntaxerror', 'cannot', 'reading', 'undefined',
  'properties', 'property', 'issue', 'issues', 'related', 'failed', 'failing', 'failure',
  'broken', 'working', 'please', 'should', 'would', 'could', 'about', 'there', 'their',
  'where', 'which', 'something', 'anything', 'nothing', 'smart', 'smarter', 'agent',
  'agentic', 'solution', 'button', 'screen', 'using', 'while', 'after', 'before', 'still',
  'needs', 'doesn', 'unable', 'check', 'build', 'app', 'code', 'make', 'more', 'with',
  'from', 'that', 'this', 'have', 'been', 'into', 'when', 'what', 'only', 'also', 'just',
])

/**
 * Extracts high-signal technical terms & identifiers from a bug report or stack trace,
 * filtering out generic English stop words that cause noisy or empty grep matches.
 */
export function extractSearchTerms(text: string, viewName?: string): string[] {
  const ranked: string[] = []
  const seen = new Set<string>()
  const push = (term: string) => {
    const clean = term.trim()
    const key = clean.toLowerCase()
    if (clean.length < 3 || STOP_WORDS.has(key) || seen.has(key)) return
    seen.add(key)
    ranked.push(clean)
  }

  if (viewName) push(viewName)

  // Prefer camelCase / PascalCase / snake_case / kebab-case code identifiers first
  const codeTokens = text.match(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[a-zA-Z]+_[a-zA-Z0-9_]+|[a-z]+-[a-z0-9-]+)\b/g) ?? []
  for (const tok of codeTokens) push(tok)

  // Next, domain nouns/verbs (length >= 4)
  const words = text.match(/\b[A-Za-z][A-Za-z0-9]{3,}\b/g) ?? []
  for (const w of words) push(w)

  return ranked.slice(0, 6)
}

/**
 * Resilient, `$`-safe search/replace matcher:
 * 1. Exact substring match (preferred)
 * 2. LF/CRLF normalized match
 * 3. Unique whitespace-trimmed line-block match (tolerant of minor indentation/trailing space drift)
 * Uses index slicing instead of `String.prototype.replace` so `$&`, `$1`, `$'` in code never corrupt output.
 */
export function applyTargetReplacement(
  source: string,
  target: string,
  replacement: string
): { ok: true; after: string; strategy: 'exact' | 'crlf' | 'trimmed_lines' } | { ok: false; reason: string } {
  if (!target) {
    return { ok: false, reason: 'Target snippet is empty.' }
  }

  // Tier 1: Exact match
  const exactIdx = source.indexOf(target)
  if (exactIdx !== -1) {
    return {
      ok: true,
      after: source.slice(0, exactIdx) + replacement + source.slice(exactIdx + target.length),
      strategy: 'exact',
    }
  }

  // Tier 2: Line-ending normalized match (CRLF <-> LF)
  const usesCrlf = source.includes('\r\n')
  const normSource = source.replace(/\r\n/g, '\n')
  const normTarget = target.replace(/\r\n/g, '\n')
  const normReplacement = replacement.replace(/\r\n/g, '\n')
  const normIdx = normSource.indexOf(normTarget)
  if (normIdx !== -1) {
    const patched =
      normSource.slice(0, normIdx) + normReplacement + normSource.slice(normIdx + normTarget.length)
    return {
      ok: true,
      after: usesCrlf ? patched.replace(/\n/g, '\r\n') : patched,
      strategy: 'crlf',
    }
  }

  // Tier 3: Unique trimmed-line block match (handles indentation drift without risking wrong locations)
  const srcLines = normSource.split('\n')
  const tgtLines = normTarget.split('\n')
  // Strip leading/trailing blank lines from target block for cleaner matching
  while (tgtLines.length > 1 && tgtLines[0].trim() === '') tgtLines.shift()
  while (tgtLines.length > 1 && tgtLines[tgtLines.length - 1].trim() === '') tgtLines.pop()

  const trimmedTgt = tgtLines.map((l) => l.trim())
  if (trimmedTgt.length > 0 && trimmedTgt.some((l) => l.length > 0)) {
    const matchStarts: number[] = []
    for (let i = 0; i <= srcLines.length - trimmedTgt.length; i++) {
      let matched = true
      for (let j = 0; j < trimmedTgt.length; j++) {
        if (srcLines[i + j].trim() !== trimmedTgt[j]) {
          matched = false
          break
        }
      }
      if (matched) matchStarts.push(i)
    }

    if (matchStarts.length === 1) {
      const startLine = matchStarts[0]
      const origIndent = srcLines[startLine].match(/^[ \t]*/)?.[0] ?? ''
      const tgtIndent = tgtLines[0].match(/^[ \t]*/)?.[0] ?? ''
      const repLines = normReplacement.split('\n').map((line) => {
        if (!line.trim()) return ''
        if (tgtIndent && line.startsWith(tgtIndent)) {
          return origIndent + line.slice(tgtIndent.length)
        }
        return line
      })
      const merged = [
        ...srcLines.slice(0, startLine),
        ...repLines,
        ...srcLines.slice(startLine + trimmedTgt.length),
      ].join('\n')
      return {
        ok: true,
        after: usesCrlf ? merged.replace(/\n/g, '\r\n') : merged,
        strategy: 'trimmed_lines',
      }
    }

    if (matchStarts.length > 1) {
      return {
        ok: false,
        reason: `Target snippet matched ${matchStarts.length} locations (ambiguous). Include more surrounding lines.`,
      }
    }
  }

  return {
    ok: false,
    reason: 'Target snippet not found in file. Inspect the exact line window before patching.',
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
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    let combined = [stdout, stderr].filter(Boolean).join('\n').trim()

    if (opts?.testFile) {
      const { rel } = resolveSafeAppPath(opts.testFile)
      command = `tsc --noEmit && tsx --test ${rel}`
      const tsxBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsx')
      const testRes = await execFileAsync(tsxBin, ['--test', rel], {
        cwd: WORKSPACE_ROOT,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
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
      output: out.slice(0, 4500) || 'Verification failed.',
      durationMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }
  }
}

/**
 * Snapshot-first atomic patch engine:
 * 1. Validates all paths against guardrails
 * 2. Saves immutable pre-patch snapshot of every file
 * 3. Applies resilient, `$`-safe surgical search/replace or full writes
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
        const replaced = applyTargetReplacement(before, edit.target, edit.replacement ?? '')
        if (!replaced.ok) {
          throw new Error(`Patch target mismatch in "${rel}": ${replaced.reason}`)
        }
        after = replaced.after
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
      error: `TypeScript verification failed and snapshot was automatically restored:\n${verification.output.slice(0, 1400)}`,
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
    error: verification.output.slice(0, 1400),
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
 * Loads Portable GBrain context (Core Memory truths + relevant prior repair lessons +
 * active agent capability inventory) to make self-healing genuinely smarter over time.
 */
async function loadPortableBrainForHeal(query: string): Promise<{
  coreText: string
  recalledBlock: string
  capabilitiesBlock: string
  meta: SelfHealBrainContext
}> {
  try {
    const [{ coreMemoryBlock, gbrainStore, recordRetrievalFor }, { db }] = await Promise.all([
      import('@/lib/agent/gbrain-store'),
      import('@/lib/db'),
    ])

    const [coreText, allMemories, tools, skills] = await Promise.all([
      coreMemoryBlock().catch(() => ''),
      gbrainStore().listMemories(160).catch(() => []),
      db.tool.findMany({ where: { enabled: true }, select: { slug: true, name: true }, take: 30 }).catch(() => []),
      db.skill.findMany({ where: { enabled: true }, select: { slug: true, name: true, description: true }, take: 24 }).catch(() => []),
    ])

    const terms = extractSearchTerms(query).map((t) => t.toLowerCase())
    const scored = allMemories
      .map((m) => {
        const hay = `${m.content} ${m.truth ?? ''} ${m.type}`.toLowerCase()
        let score = m.type === 'lesson' ? 1.5 : 0
        for (const t of terms) {
          if (hay.includes(t)) score += 2
        }
        if (hay.includes('self-heal') || hay.includes('self_heal') || hay.includes('repair')) {
          score += 1
        }
        return { mem: m, score }
      })
      .filter((x) => x.score > 1)
      .sort((a, b) => b.score - a.score || b.mem.importance - a.mem.importance)
      .slice(0, 6)

    // Record retrieval attribution & light up live GBrain trace
    for (const item of scored.slice(0, 3)) {
      void recordRetrievalFor(item.mem.id, `self-heal: ${query.slice(0, 60)}`)
    }

    const recalledSummaries = scored.map(
      ({ mem }) => `[${mem.type}] ${(mem.truth || mem.content).slice(0, 140)}`
    )

    const capabilitiesBlock = [
      tools.length > 0 ? `Active Tools (${tools.length}): ${tools.map((t) => t.slug).join(', ')}` : '',
      skills.length > 0
        ? `Active Skills (${skills.length}): ${skills.map((s) => `${s.slug} (${s.name})`).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      coreText: coreText.slice(0, 1600),
      recalledBlock: recalledSummaries.join('\n'),
      capabilitiesBlock: capabilitiesBlock.slice(0, 1400),
      meta: {
        recalledCount: scored.length,
        coreLoaded: Boolean(coreText.trim()),
        recalledSummaries,
      },
    }
  } catch {
    return {
      coreText: '',
      recalledBlock: '',
      capabilitiesBlock: '',
      meta: { recalledCount: 0, coreLoaded: false, recalledSummaries: [] },
    }
  }
}

/** Saves a durable procedural repair lesson into Portable GBrain so future runs learn from it. */
async function consolidateSelfHealLesson(lesson: string): Promise<string | undefined> {
  const clean = lesson.trim().slice(0, 420)
  if (!clean) return undefined
  try {
    const { saveMemoryGbrain } = await import('@/lib/agent/gbrain-store')
    await saveMemoryGbrain({
      content: `Self-Heal Lesson: ${clean}`,
      type: 'lesson',
      kind: 'procedural',
      importance: 7,
    })
    return clean
  } catch {
    return undefined
  }
}

/** Optionally persists a safe reusable Skill capability in SQLite when Eva identifies a capability gap. */
async function applySafeSkillUpgrade(upgrade?: {
  kind?: string
  name?: string
  slug?: string
  description?: string
  prompt?: string
}): Promise<SelfHealCapabilityUpgrade | undefined> {
  if (!upgrade?.name || !upgrade?.description) return undefined
  const name = upgrade.name.trim().slice(0, 80)
  const description = upgrade.description.trim().slice(0, 220)
  if (upgrade.kind === 'skill' && upgrade.prompt && upgrade.prompt.trim().length >= 20) {
    const slug = (upgrade.slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48)
    if (slug) {
      try {
        const { db } = await import('@/lib/db')
        await db.skill.upsert({
          where: { slug },
          create: {
            slug,
            name,
            description,
            category: 'self_heal',
            icon: 'sparkles',
            prompt: upgrade.prompt.trim().slice(0, 2000),
            enabled: true,
          },
          update: {
            name,
            description,
            prompt: upgrade.prompt.trim().slice(0, 2000),
            enabled: true,
          },
        })
        return { kind: 'skill', name, slug, description, applied: true }
      } catch {
        /* fallback to recommendation */
      }
    }
  }
  return { kind: 'recommendation', name, description, applied: false }
}

/**
 * Reads focused line windows around specific line numbers (plus imports header) so Eva
 * sees the actual defective code even inside 1,500+ line files.
 */
async function readFocusedFileContext(
  relPath: string,
  focusLines: number[],
  maxChars = 7500
): Promise<string | null> {
  try {
    const { abs, rel } = resolveSafeAppPath(relPath)
    const raw = await fs.readFile(abs, 'utf8')
    const allLines = raw.split('\n')

    const windows: Array<[number, number]> = []
    if (focusLines.length === 0) {
      windows.push([1, Math.min(allLines.length, 240)])
    } else {
      // Always include top imports/types header (1..40)
      windows.push([1, Math.min(allLines.length, 40)])
      const sorted = Array.from(new Set(focusLines.filter((n) => n >= 1))).sort((a, b) => a - b)
      for (const ln of sorted.slice(0, 3)) {
        const start = Math.max(1, ln - 55)
        const end = Math.min(allLines.length, ln + 85)
        windows.push([start, end])
      }
    }

    // Merge overlapping windows cleanly
    windows.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const w of windows) {
      const last = merged[merged.length - 1]
      if (last && w[0] <= last[1] + 5) {
        last[1] = Math.max(last[1], w[1])
      } else {
        merged.push([w[0], w[1]])
      }
    }

    const sections = merged.map(([start, end]) => {
      const body = allLines
        .slice(start - 1, end)
        .map((line, i) => `${start + i}: ${line}`)
        .join('\n')
      return `// ${rel} (lines ${start}-${end} of ${allLines.length})\n${body}`
    })

    return sections.join('\n// ...\n').slice(0, maxChars)
  } catch {
    return null
  }
}

/**
 * End-to-end autonomous diagnosis + Portable Brain + multi-iteration repair loop
 * triggered from Error Boundaries, runtime error interceptors, agent tools, or Self-Heal Studio.
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
    // 1. Consult Portable GBrain (Core Memory truths + past repair lessons + active capabilities)
    const brainBundle = await loadPortableBrainForHeal(
      `${input.errorMessage} ${input.viewName ?? ''} ${input.targetFileHint ?? ''}`
    )
    selfHealManager.updateSession(session.id, { brainContext: brainBundle.meta })
    selfHealManager.appendStep(
      session.id,
      {
        phase: 'brain',
        label: `Consulted Portable GBrain (${brainBundle.meta.recalledCount} relevant memor${brainBundle.meta.recalledCount === 1 ? 'y' : 'ies'})`,
        detail:
          brainBundle.meta.recalledSummaries[0] ||
          (brainBundle.meta.coreLoaded ? 'Core identity & architecture truths loaded.' : 'Fresh diagnostic context.'),
      },
      'diagnosing'
    )

    // 2. Run baseline typecheck first to surface any real compiler diagnostics immediately
    const baselineCheck = await verifyAppBuild()
    const baselineDiags = baselineCheck.ok ? [] : parseTscDiagnostics(baselineCheck.output)

    // Track candidate files + focused line numbers per file
    const focusMap = new Map<string, number[]>()
    const addCandidate = (rawPath: string, line?: number) => {
      try {
        const { rel } = resolveSafeAppPath(rawPath)
        const existing = focusMap.get(rel) ?? []
        if (line && line > 0) existing.push(line)
        focusMap.set(rel, existing)
      } catch {
        /* ignore out-of-scope paths */
      }
    }

    if (input.targetFileHint) addCandidate(input.targetFileHint)

    // Parse file:line references from errorMessage & stack
    const combinedText = `${input.errorMessage}\n${input.stack ?? ''}`
    const pathLineRe = /\b((?:src|brain)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx))(?::(\d+))?/g
    let pm: RegExpExecArray | null
    while ((pm = pathLineRe.exec(combinedText)) !== null) {
      addCandidate(pm[1], pm[2] ? Number(pm[2]) : undefined)
    }

    // Include compiler error locations directly
    for (const d of baselineDiags.slice(0, 8)) {
      addCandidate(d.file, d.line)
    }

    // Multi-keyword intelligent search across src/ (filtering English stop words)
    const terms = extractSearchTerms(input.errorMessage, input.viewName)
    if (focusMap.size < 3 && terms.length > 0) {
      for (const term of terms.slice(0, 3)) {
        const res = await inspectAppCode({ mode: 'search', query: term })
        for (const line of res.output.split('\n').slice(0, 10)) {
          const m = line.match(/^((?:src|brain)\/[^:]+):(\d+):/)
          if (m) addCandidate(m[1], Number(m[2]))
        }
        if (focusMap.size >= 4) break
      }
    }

    // LLM-assisted File Locator pass if plain-English request yielded too few specific files
    if (focusMap.size === 0 || (!baselineDiags.length && !input.targetFileHint && focusMap.size < 2)) {
      try {
        const [srcList, brainList] = await Promise.all([
          inspectAppCode({ mode: 'list', path: 'src' }),
          inspectAppCode({ mode: 'list', path: 'brain' }),
        ])
        const allFiles = `${srcList.output}\n${brainList.output}`.slice(0, 7000)
        const locateRaw = await chatText(
          [
            {
              role: 'system',
              content:
                'You are a senior Next.js/TypeScript codebase navigator. Given a bug report or feature request and the repository file list, pick the 1 to 4 most relevant file paths to inspect. Reply ONLY with JSON: {"files":["src/..."],"keywords":["optionalSymbolToGrep"]}.',
            },
            {
              role: 'user',
              content: `REQUEST:\n${input.errorMessage}\n\nVIEW: ${input.viewName ?? '(none)'}\n\nFILES:\n${allFiles}`,
            },
          ],
          { maxTokens: 450 }
        )
        const located = extractJson<{ files?: string[]; keywords?: string[] }>(locateRaw)
        for (const f of (located?.files ?? []).slice(0, 4)) {
          addCandidate(f)
        }
        for (const kw of (located?.keywords ?? []).slice(0, 2)) {
          const res = await inspectAppCode({ mode: 'search', query: kw })
          for (const line of res.output.split('\n').slice(0, 6)) {
            const m = line.match(/^((?:src|brain)\/[^:]+):(\d+):/)
            if (m) addCandidate(m[1], Number(m[2]))
          }
        }
      } catch {
        /* non-fatal locator fallback */
      }
    }

    const buildFileContexts = async (): Promise<{ files: string[]; blocks: string[] }> => {
      const files = Array.from(focusMap.keys()).slice(0, 5)
      const blocks: string[] = []
      for (const rel of files) {
        const ctx = await readFocusedFileContext(rel, focusMap.get(rel) ?? [], 6800)
        if (ctx) blocks.push(ctx)
      }
      return { files, blocks }
    }

    let currentContexts = await buildFileContexts()

    reasoningChain.addNode(chain.id, {
      kind: 'observation',
      title: `Inspected ${currentContexts.files.length} focused file(s) & baseline typecheck (${baselineCheck.ok ? 'PASS' : `${baselineDiags.length} TS error(s)`})`,
      detail: currentContexts.files.join(', ') || baselineCheck.output.slice(0, 200),
      actor: 'Eva',
      tool: 'self_heal_code',
    })

    // 3. Multi-Iteration Autonomous Repair + Self-Correction Loop (up to 3 attempts)
    const MAX_ATTEMPTS = 3
    let lastErrorFeedback = ''
    let lastDiagnosis = ''
    let attemptsUsed = 0

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptsUsed = attempt
      selfHealManager.updateSession(session.id, { attemptsUsed })

      const rawPlan = await chatText(
        [
          {
            role: 'system',
            content: `You are Eva's Smart Autonomous Self-Healing Engineer inside Nexus Agent OS (Next.js App Router + strict TypeScript + Portable GBrain).
Your mission: diagnose the issue deeply using the Portable Brain context, active capabilities, TypeScript diagnostics, and exact line-numbered source files, then produce a minimal, surgical, type-safe repair.

CRITICAL RULES:
1. For "replace" edits, copy "target" VERBATIM from the source file lines shown (WITHOUT line-number prefixes like "42: "). Include 2–4 unique lines of surrounding context so matching is unambiguous.
2. Never introduce TypeScript errors, missing imports, or broken schema fields.
3. If the request is a capability/intelligence upgrade (not a broken code line) OR can be enhanced with a reusable Skill, you may include "capabilityUpgrade":{"kind":"skill","name":"...","slug":"...","description":"...","prompt":"detailed reusable agent instructions..."}.
4. Always provide a concise "brainLesson" summarizing the root cause & fix so Eva remembers it permanently in her Portable Brain.
5. Reply ONLY with valid JSON:
{"diagnosis":"clear root cause & solution","edits":[{"path":"src/...","mode":"replace","target":"EXACT code block without line numbers","replacement":"fixed code block","summary":"what changed"}],"capabilityUpgrade":null,"brainLesson":"concise reusable engineering lesson"}`,
          },
          {
            role: 'user',
            content: [
              `ATTEMPT: ${attempt} of ${MAX_ATTEMPTS}`,
              `ERROR / REQUEST:\n${input.errorMessage}`,
              input.stack ? `STACK:\n${input.stack.slice(0, 1600)}` : '',
              brainBundle.coreText ? `PORTABLE BRAIN CORE TRUTHS:\n${brainBundle.coreText}` : '',
              brainBundle.recalledBlock ? `RECALLED BRAIN LESSONS:\n${brainBundle.recalledBlock}` : '',
              brainBundle.capabilitiesBlock ? `ACTIVE CAPABILITIES:\n${brainBundle.capabilitiesBlock}` : '',
              `BASELINE TYPECHECK (${baselineCheck.ok ? 'PASS' : 'FAIL'}):\n${baselineCheck.output.slice(0, 1800)}`,
              lastErrorFeedback
                ? `PREVIOUS ATTEMPT FAILED — FIX THIS EXACT ERROR ON ATTEMPT ${attempt}:\n${lastErrorFeedback.slice(0, 2000)}`
                : '',
              `SOURCE FILES:\n${currentContexts.blocks.join('\n\n---\n\n') || '(no matching files found)'}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        { maxTokens: 4096, thinkingLevel: 'medium' }
      )

      const parsed = extractJson<{
        diagnosis?: string
        edits?: SelfHealEditInput[]
        capabilityUpgrade?: {
          kind?: string
          name?: string
          slug?: string
          description?: string
          prompt?: string
        } | null
        brainLesson?: string
      }>(rawPlan)

      const diagnosis = parsed?.diagnosis?.trim() || 'Diagnostic analysis completed.'
      lastDiagnosis = diagnosis
      const edits = Array.isArray(parsed?.edits)
        ? parsed.edits.filter((e) => e && typeof e.path === 'string' && (e.mode === 'replace' || e.mode === 'write'))
        : []

      // Handle no-code-edit outcomes cleanly (capability upgrade or verified diagnostic)
      if (edits.length === 0) {
        if (!baselineCheck.ok && attempt < MAX_ATTEMPTS) {
          lastErrorFeedback = `Baseline TypeScript check has ${baselineDiags.length} error(s) that must be fixed:\n${baselineCheck.output.slice(0, 1500)}`
          selfHealManager.appendStep(
            session.id,
            {
              phase: 'diagnose',
              label: `Attempt ${attempt} produced no patch — retrying with compiler diagnostics`,
              detail: diagnosis,
            },
            'diagnosing'
          )
          continue
        }

        const capUpgrade = parsed?.capabilityUpgrade
          ? await applySafeSkillUpgrade(parsed.capabilityUpgrade)
          : undefined
        const learned = await consolidateSelfHealLesson(
          parsed?.brainLesson || `${diagnosis} (codebase typecheck ${baselineCheck.ok ? 'passing' : 'needs follow-up'})`
        )

        const updatedBrain: SelfHealBrainContext = {
          ...brainBundle.meta,
          learnedLesson: learned,
        }

        const healthyOrUpgraded = baselineCheck.ok || Boolean(capUpgrade?.applied)
        selfHealManager.updateSession(session.id, {
          verification: baselineCheck,
          brainContext: updatedBrain,
          capabilityUpgrade: capUpgrade,
          attemptsUsed,
          summary: capUpgrade?.applied
            ? `${diagnosis} — Added reusable "${capUpgrade.name}" skill & saved lesson to Portable Brain.`
            : diagnosis,
        })
        selfHealManager.appendStep(
          session.id,
          {
            phase: 'complete',
            label: capUpgrade?.applied
              ? `Capability upgraded: ${capUpgrade.name}`
              : baselineCheck.ok
                ? 'Diagnostics passed — codebase verified healthy'
                : 'Diagnostic complete — manual follow-up needed',
            detail: diagnosis,
          },
          healthyOrUpgraded ? 'verified' : 'failed'
        )
        reasoningChain.completeChain(chain.id, {
          ok: healthyOrUpgraded,
          verificationDetail: diagnosis,
          actor: 'Eva',
        })
        return {
          ok: healthyOrUpgraded,
          session: selfHealManager.getSession(session.id)!,
          message: capUpgrade?.applied
            ? `${diagnosis} (Enabled new "${capUpgrade.name}" skill and saved lesson to Portable Brain.)`
            : diagnosis,
        }
      }

      reasoningChain.addNode(chain.id, {
        kind: 'decision',
        title: `Attempt ${attempt}/${MAX_ATTEMPTS}: Patching ${edits.map((e) => e.path).join(', ')}`,
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
        const capUpgrade = parsed?.capabilityUpgrade
          ? await applySafeSkillUpgrade(parsed.capabilityUpgrade)
          : undefined
        const learned = await consolidateSelfHealLesson(
          parsed?.brainLesson || `Fixed "${input.errorMessage.slice(0, 90)}" in ${edits.map((e) => e.path).join(', ')}: ${diagnosis}`
        )
        const updatedBrain: SelfHealBrainContext = {
          ...brainBundle.meta,
          learnedLesson: learned,
        }
        selfHealManager.updateSession(session.id, {
          brainContext: updatedBrain,
          capabilityUpgrade: capUpgrade,
          attemptsUsed,
          summary: `${diagnosis} — Verified across ${patchRes.session.patches.length} file(s) in ${attemptsUsed} attempt${attemptsUsed === 1 ? '' : 's'}.${learned ? ' Lesson saved to Portable Brain.' : ''}`,
        })
        if (learned) {
          selfHealManager.appendStep(session.id, {
            phase: 'brain',
            label: 'Consolidated repair lesson into Portable GBrain',
            detail: learned,
          })
        }
        reasoningChain.completeChain(chain.id, {
          ok: true,
          verificationDetail: patchRes.session.summary || 'Self-heal patch verified via TypeScript check',
          actor: 'Eva',
        })
        return {
          ok: true,
          session: selfHealManager.getSession(session.id)!,
          message: `${diagnosis} — Patch applied, verified, and saved to Portable Brain.`,
        }
      }

      // Attempt failed -> feed exact compiler or target-match error into next self-correction iteration
      lastErrorFeedback = patchRes.error || 'Patch verification failed.'
      const nextDiags = parseTscDiagnostics(lastErrorFeedback)
      for (const d of nextDiags.slice(0, 5)) {
        addCandidate(d.file, d.line)
      }
      for (const e of edits) {
        addCandidate(e.path)
      }

      if (attempt < MAX_ATTEMPTS) {
        reasoningChain.addNode(chain.id, {
          kind: 'self_correction',
          title: `Attempt ${attempt} rolled back — self-correcting on attempt ${attempt + 1}/${MAX_ATTEMPTS}`,
          detail: lastErrorFeedback.slice(0, 260),
          actor: 'Eva',
          tool: 'self_heal_code',
          correction: {
            whatFailed: lastErrorFeedback.slice(0, 180),
            pivotStrategy: `Refreshing exact line windows and revising patch on attempt ${attempt + 1}.`,
          },
        })
        selfHealManager.appendStep(
          session.id,
          {
            phase: 'diagnose',
            label: `Self-correcting (attempt ${attempt + 1}/${MAX_ATTEMPTS})`,
            detail: lastErrorFeedback.slice(0, 240),
          },
          'diagnosing'
        )
        currentContexts = await buildFileContexts()
      }
    }

    // All attempts exhausted -> leave clean rolled-back state and record failure lesson in Portable Brain
    const learnedFailure = await consolidateSelfHealLesson(
      `Self-heal attempt for "${input.errorMessage.slice(0, 80)}" rolled back after ${MAX_ATTEMPTS} attempts: ${lastErrorFeedback.slice(0, 200)}`
    )
    selfHealManager.updateSession(session.id, {
      attemptsUsed,
      brainContext: { ...brainBundle.meta, learnedLesson: learnedFailure },
      summary: `${lastDiagnosis || 'Self-heal could not verify automatically'} — Rolled back cleanly after ${attemptsUsed} attempts.`,
    })
    reasoningChain.completeChain(chain.id, {
      ok: false,
      verificationDetail: lastErrorFeedback.slice(0, 240) || 'Post-patch verification failed after retries.',
      actor: 'Eva',
    })
    return {
      ok: false,
      session: selfHealManager.getSession(session.id)!,
      message: lastErrorFeedback || 'Patch failed verification after automatic self-correction attempts and was rolled back cleanly.',
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
