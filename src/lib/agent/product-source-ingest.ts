import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProductSource } from '@/lib/agent/company-types'

const MAX_WEBSITE_BYTES = 250_000
const MAX_DOC_CHARS = 24_000
const MAX_SUMMARY_CHARS = 900
const MAX_LOCAL_FILE_BYTES = 8_192

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
])

export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip) return true
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) {
    return true
  }
  if (lower.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(lower.slice(7))
  }
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return net.isIP(ip) === 0
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function validateExternalWebsiteUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = rawUrl.trim()
  if (!trimmed) return { ok: false, error: 'Website URL is required' }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Invalid URL format. Include https:// or http://' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http:// and https:// URLs are allowed' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials inside URLs are not allowed' }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { ok: false, error: 'Private, loopback, or metadata hostnames are blocked for security' }
  }

  if (net.isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname)) {
    return { ok: false, error: 'Private or loopback IP addresses are blocked for security' }
  }

  return { ok: true, url: parsed }
}

/**
 * Validates and DNS-resolves an external HTTP(S) URL before server-side fetch
 * to prevent SSRF and DNS rebinding attacks against loopback, LAN, or metadata IPs.
 */
export async function resolvePublicExternalUrl(rawUrl: string): Promise<URL> {
  const validation = validateExternalWebsiteUrl(rawUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  const url = validation.url
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(hostname) === 0) {
    const addresses = await dns.lookup(hostname, { all: true })
    if (!addresses.length) {
      throw new Error('Could not resolve external host')
    }
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        throw new Error('Resolved destination points to a private or blocked network address')
      }
    }
  }
  return url
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

const MAX_EXTERNAL_REDIRECTS = 3

/**
 * Fetches an external HTTP(S) URL while validating every redirect hop against
 * SSRF rules. Non-GET/HEAD requests fail closed on any 3xx redirect.
 */
export async function fetchPublicExternalUrl(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = MAX_EXTERNAL_REDIRECTS
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  let currentUrl = await resolvePublicExternalUrl(rawUrl).catch((err) => {
    throw new SsrfBlockedError(err instanceof Error ? err.message : String(err))
  })

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(currentUrl.toString(), {
      ...init,
      redirect: 'manual',
    })

    if (res.status < 300 || res.status >= 400) {
      return res
    }

    await res.body?.cancel().catch(() => {})

    if (method !== 'GET' && method !== 'HEAD') {
      throw new SsrfBlockedError(`Redirects are blocked for ${method} external requests`)
    }

    if (hop >= maxRedirects) {
      throw new SsrfBlockedError('Too many redirects while fetching external URL')
    }

    const location = res.headers.get('location')
    if (!location) {
      throw new SsrfBlockedError('Redirect response missing Location header')
    }

    let nextRaw: string
    try {
      nextRaw = new URL(location, currentUrl).toString()
    } catch {
      throw new SsrfBlockedError('Invalid redirect Location URL')
    }

    currentUrl = await resolvePublicExternalUrl(nextRaw).catch((err) => {
      throw new SsrfBlockedError(err instanceof Error ? err.message : String(err))
    })
  }

  throw new SsrfBlockedError('Too many redirects while fetching external URL')
}

function stripHtmlToReadableText(html: string): { title: string; description: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()

  const title = (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  const description = (descMatch?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 320)
  return {
    title,
    description,
    text: cleaned.slice(0, 6_000),
  }
}

/**
 * Safely fetches a public website URL for product context ingestion.
 * Blocks SSRF (private IPs, loopback, metadata endpoints) and enforces byte + timeout ceilings.
 */
export async function ingestWebsiteSource(rawUrl: string, customLabel?: string): Promise<ProductSource> {
  const now = new Date().toISOString()
  const validation = validateExternalWebsiteUrl(rawUrl)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  const url = validation.url

  // DNS resolution check to prevent DNS rebinding to private/metadata IPs
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(hostname) === 0) {
    try {
      const addresses = await dns.lookup(hostname, { all: true })
      for (const addr of addresses) {
        if (isPrivateOrReservedIp(addr.address)) {
          throw new Error('Resolved destination points to a private or blocked network address')
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('blocked network address')) {
        throw err
      }
      // If DNS fails offline, record source gracefully with error note instead of crashing attach flow
      return {
        id: `src_${randomUUID().slice(0, 8)}`,
        type: 'website',
        label: customLabel?.trim() || url.hostname,
        uriOrPath: url.toString(),
        summary: `Saved website reference (${url.hostname}). Live fetch was unreachable at attach time.`,
        content: `Website URL: ${url.toString()}`,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Unable to resolve website host',
        ingestedAt: now,
      }
    }
  }

  try {
    const res = await fetchPublicExternalUrl(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'NexusCompanyOS/1.0 (Product Context Reader)',
        Accept: 'text/html, text/plain, application/json;q=0.9',
      },
      signal: AbortSignal.timeout(8_000),
    })

    if (!res.ok) {
      return {
        id: `src_${randomUUID().slice(0, 8)}`,
        type: 'website',
        label: customLabel?.trim() || url.hostname,
        uriOrPath: url.toString(),
        summary: `Saved website reference (${url.hostname}). Server responded HTTP ${res.status}.`,
        content: `Website URL: ${url.toString()}`,
        status: 'error',
        errorMessage: `HTTP ${res.status}`,
        ingestedAt: now,
      }
    }

    const rawText = (await res.text()).slice(0, MAX_WEBSITE_BYTES)
    const contentType = res.headers.get('content-type') ?? ''
    let title = url.hostname
    let description = ''
    let extracted = ''

    if (contentType.includes('html') || rawText.includes('<html') || rawText.includes('<body')) {
      const parsed = stripHtmlToReadableText(rawText)
      title = parsed.title || url.hostname
      description = parsed.description
      extracted = parsed.text
    } else {
      extracted = rawText.replace(/\s+/g, ' ').trim().slice(0, 6_000)
    }

    const summaryParts = [
      title ? `Title: ${title}` : '',
      description ? `Meta: ${description}` : '',
      extracted ? extracted.slice(0, 480) : '',
    ].filter(Boolean)

    return {
      id: `src_${randomUUID().slice(0, 8)}`,
      type: 'website',
      label: customLabel?.trim() || title.slice(0, 80) || url.hostname,
      uriOrPath: url.toString(),
      summary: summaryParts.join(' · ').slice(0, MAX_SUMMARY_CHARS),
      content: extracted.slice(0, MAX_DOC_CHARS),
      status: 'ready',
      ingestedAt: now,
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw err
    }
    return {
      id: `src_${randomUUID().slice(0, 8)}`,
      type: 'website',
      label: customLabel?.trim() || url.hostname,
      uriOrPath: url.toString(),
      summary: `Saved website reference (${url.hostname}). Live snapshot could not be downloaded.`,
      content: `Website URL: ${url.toString()}`,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Website fetch timed out',
      ingestedAt: now,
    }
  }
}

export function buildDocumentSource(input: {
  label: string
  content: string
  uriOrPath?: string
}): ProductSource {
  const now = new Date().toISOString()
  const cleanContent = input.content.trim().slice(0, MAX_DOC_CHARS)
  if (!cleanContent) {
    throw new Error('Document content cannot be empty')
  }
  const cleanLabel = input.label.trim().slice(0, 90) || 'Product Document'
  const firstLines = cleanContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ')

  return {
    id: `src_${randomUUID().slice(0, 8)}`,
    type: 'document',
    label: cleanLabel,
    uriOrPath: input.uriOrPath?.trim().slice(0, 200) || cleanLabel,
    summary: firstLines.slice(0, MAX_SUMMARY_CHARS),
    content: cleanContent,
    status: 'ready',
    ingestedAt: now,
  }
}

/**
 * Attaches either a public Git/GitHub repository URL OR a strictly workspace-confined local folder path.
 * Blocks path traversal (..), absolute paths outside workspace, and symlink escapes.
 */
export function ingestRepoOrFolderSource(
  rawPathOrUrl: string,
  customLabel?: string,
  workspaceRoot = process.cwd()
): ProductSource {
  const now = new Date().toISOString()
  const trimmed = rawPathOrUrl.trim()
  if (!trimmed) {
    throw new Error('Repository URL or local folder path is required')
  }

  // Case 1: Remote Git / GitHub URL
  if (/^https?:\/\//i.test(trimmed)) {
    const check = validateExternalWebsiteUrl(trimmed)
    if (!check.ok) {
      throw new Error(check.error)
    }
    const repoLabel =
      customLabel?.trim() ||
      check.url.pathname.replace(/^\/+|\/+$/g, '').slice(0, 80) ||
      check.url.hostname

    return {
      id: `src_${randomUUID().slice(0, 8)}`,
      type: 'repo_folder',
      label: repoLabel,
      uriOrPath: check.url.toString(),
      summary: `Linked repository ${repoLabel} (${check.url.hostname}). Available to Product & Development and Eva CEO for planning.`,
      content: `Repository URL: ${check.url.toString()}\nHost: ${check.url.hostname}\nPath: ${check.url.pathname}`,
      status: 'ready',
      ingestedAt: now,
    }
  }

  // Case 2: Local workspace-confined folder path
  if (trimmed.includes('\0')) {
    throw new Error('Invalid folder path')
  }

  const rootResolved = path.resolve(workspaceRoot)
  const rootReal = fs.existsSync(rootResolved) ? fs.realpathSync(rootResolved) : rootResolved

  const candidateResolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(rootResolved, trimmed)

  const withinResolved =
    candidateResolved === rootResolved || candidateResolved.startsWith(rootResolved + path.sep)
  if (!withinResolved) {
    throw new Error('Local folder path must stay inside the authorized workspace directory')
  }

  if (!fs.existsSync(candidateResolved)) {
    throw new Error(`Folder path not found inside workspace: ${trimmed}`)
  }

  const candidateReal = fs.realpathSync(candidateResolved)
  const withinReal = candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep)
  if (!withinReal) {
    throw new Error('Symlink escape detected: target folder resolves outside authorized workspace')
  }

  const stat = fs.statSync(candidateReal)
  if (!stat.isDirectory()) {
    throw new Error('Attached local path must be a folder/directory')
  }

  const entries = fs
    .readdirSync(candidateReal, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.git') && e.name !== 'node_modules' && e.name !== '.next')
    .slice(0, 35)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))

  const notes: string[] = [
    `Workspace Folder: ${path.relative(rootReal, candidateReal) || '.'}`,
    `Top-level entries (${entries.length}): ${entries.join(', ') || '(empty)'}`,
  ]

  const pkgPath = path.join(candidateReal, 'package.json')
  if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile()) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').slice(0, MAX_LOCAL_FILE_BYTES)) as {
        name?: string
        description?: string
        scripts?: Record<string, string>
      }
      if (pkg.name) notes.push(`Package: ${pkg.name}${pkg.description ? ` — ${pkg.description}` : ''}`)
      if (pkg.scripts) notes.push(`Scripts: ${Object.keys(pkg.scripts).slice(0, 10).join(', ')}`)
    } catch {
      /* ignore malformed package.json */
    }
  }

  const readmePath = path.join(candidateReal, 'README.md')
  if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) {
    try {
      const readme = fs.readFileSync(readmePath, 'utf8').slice(0, 3_000).trim()
      if (readme) notes.push(`README Excerpt:\n${readme}`)
    } catch {
      /* ignore unreadable readme */
    }
  }

  const relPath = path.relative(rootReal, candidateReal) || '.'
  return {
    id: `src_${randomUUID().slice(0, 8)}`,
    type: 'repo_folder',
    label: customLabel?.trim() || (relPath === '.' ? 'Workspace Root' : relPath),
    uriOrPath: relPath,
    summary: notes.slice(0, 3).join(' · ').slice(0, MAX_SUMMARY_CHARS),
    content: notes.join('\n\n').slice(0, MAX_DOC_CHARS),
    status: 'ready',
    ingestedAt: now,
  }
}
