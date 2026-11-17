import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded, DEFAULT_SKILLS } from '@/lib/agent/seed'

export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  )
}

function snake(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'tool'
  )
}

function err(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** SSRF guard: only public https URLs may be fetched. */
function assertPublicHttpsUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Invalid URL')
  }
  if (u.protocol !== 'https:') throw new Error('Only https:// URLs are supported')
  const h = u.hostname.toLowerCase()
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.includes(':') ||
    !h.includes('.')
  ) {
    throw new Error('Private or internal hosts are not allowed')
  }
  return u
}

async function fetchJson(
  url: string,
  opts: { timeoutMs?: number; maxSize?: number; accept?: string } = {}
): Promise<unknown> {
  const { timeoutMs = 9000, maxSize = 512_000, accept = 'application/json' } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept, 'User-Agent': 'nexus-agent-marketplace' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Upstream responded ${res.status}`)
    const text = await res.text()
    if (text.length > maxSize) throw new Error('Response too large')
    return JSON.parse(text) as unknown
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Manifest normalization & type detection
// ---------------------------------------------------------------------------

interface PluginManifest {
  name: string
  description: string
  icon: string
  category: string
  config: { type: 'llm' | 'http'; instructions: string; endpoint: string; inputHint: string }
}

interface SkillManifest {
  name: string
  description: string
  icon: string
  category: string
  prompt: string
}

interface McpManifest {
  name: string
  description: string
  tools: { name: string; description: string }[]
}

type ManifestType = 'plugin' | 'skill' | 'mcp'

function normalizePlugin(o: Record<string, unknown>): PluginManifest {
  const cfgRaw = isObj(o.config) ? o.config : {}
  const endpoint = typeof cfgRaw.endpoint === 'string' ? cfgRaw.endpoint : ''
  const instructions = typeof cfgRaw.instructions === 'string' ? cfgRaw.instructions : ''
  const type: 'llm' | 'http' = cfgRaw.type === 'http' || (endpoint !== '' && instructions === '') ? 'http' : 'llm'
  return {
    name: String(o.name ?? o.displayName ?? 'Unnamed plugin').slice(0, 80),
    description: String(o.description ?? 'Plugin installed from a remote manifest.').slice(0, 300),
    icon: String(o.icon ?? 'puzzle').slice(0, 30),
    category: String(o.category ?? 'custom').slice(0, 40),
    config: {
      type,
      instructions: instructions.slice(0, 2000),
      endpoint: endpoint.slice(0, 500),
      inputHint: String(cfgRaw.inputHint ?? '{"input": string}').slice(0, 200),
    },
  }
}

function normalizeSkill(o: Record<string, unknown>): SkillManifest {
  return {
    name: String(o.name ?? o.displayName ?? 'Unnamed skill').slice(0, 80),
    description: String(o.description ?? 'Skill installed from a remote manifest.').slice(0, 300),
    icon: String(o.icon ?? 'sparkles').slice(0, 30),
    category: String(o.category ?? 'custom').slice(0, 40),
    prompt: String(o.prompt ?? '').slice(0, 4000),
  }
}

function normalizeMcp(o: Record<string, unknown>): McpManifest {
  const tools = (Array.isArray(o.tools) ? o.tools : [])
    .filter((t): t is Record<string, unknown> => isObj(t) && typeof t.name === 'string' && t.name.trim() !== '')
    .slice(0, 10)
    .map((t) => ({
      name: String(t.name).slice(0, 60),
      description: String(t.description ?? '').slice(0, 400),
    }))
  return {
    name: String(o.name ?? o.displayName ?? 'Unnamed MCP server').slice(0, 80),
    description: String(o.description ?? 'MCP server installed from a remote manifest.').slice(0, 300),
    tools,
  }
}

/** Detect manifest type from a parsed JSON object. */
function detectManifest(
  o: unknown
):
  | { type: ManifestType; payload: PluginManifest | SkillManifest | McpManifest }
  | { type: 'package'; payload: Record<string, unknown> }
  | null {
  if (!isObj(o)) return null
  const config = o.config
  if (
    isObj(config) &&
    (typeof config.type === 'string' || typeof config.instructions === 'string' || typeof config.endpoint === 'string')
  ) {
    return { type: 'plugin', payload: normalizePlugin(o) }
  }
  if (typeof o.prompt === 'string' && o.prompt.trim() !== '') {
    return { type: 'skill', payload: normalizeSkill(o) }
  }
  if (Array.isArray(o.tools) && o.tools.length > 0 && isObj(o.tools[0])) {
    return { type: 'mcp', payload: normalizeMcp(o) }
  }
  if (typeof o.name === 'string' && typeof o.version === 'string') {
    return { type: 'package', payload: o }
  }
  return null
}

// ---------------------------------------------------------------------------
// Smithery registry (real MCP marketplace: registry.smithery.ai)
// ---------------------------------------------------------------------------

interface SmitheryServer {
  qualifiedName: string
  displayName: string
  description: string
  iconUrl: string | null
  verified: boolean
  useCount: number
  homepage: string | null
}

let smitheryCache: { at: number; servers: SmitheryServer[] } | null = null

async function fetchSmitheryList(): Promise<SmitheryServer[]> {
  if (smitheryCache && Date.now() - smitheryCache.at < 5 * 60 * 1000) {
    return smitheryCache.servers
  }
  const servers: SmitheryServer[] = []
  // pull two pages; the registry's own q= filter is unreliable, we filter locally
  for (const page of [1, 2]) {
    try {
      const data = (await fetchJson(`https://registry.smithery.ai/servers?page=${page}&pageSize=40`)) as {
        servers?: Record<string, unknown>[]
      }
      for (const s of data.servers ?? []) {
        if (!isObj(s) || typeof s.qualifiedName !== 'string') continue
        if (s.unlisted === true || s.inactive === true) continue
        servers.push({
          qualifiedName: s.qualifiedName,
          displayName: typeof s.displayName === 'string' ? s.displayName : s.qualifiedName,
          description: typeof s.description === 'string' ? s.description : '',
          iconUrl: typeof s.iconUrl === 'string' ? s.iconUrl : null,
          verified: s.verified === true,
          useCount: typeof s.useCount === 'number' ? s.useCount : 0,
          homepage: typeof s.homepage === 'string' ? s.homepage : null,
        })
      }
    } catch {
      break
    }
  }
  if (servers.length > 0) smitheryCache = { at: Date.now(), servers }
  return servers
}

/** Summarize a JSON-schema arg spec into a compact hint. */
function argsHint(schema: unknown): string {
  if (!isObj(schema) || !isObj(schema.properties)) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(schema.properties).slice(0, 8)) {
    parts.push(isObj(v) && typeof v.type === 'string' ? `"${k}": ${v.type}` : `"${k}"`)
  }
  const required = Array.isArray(schema.required) ? ` (required: ${schema.required.join(', ')})` : ''
  return parts.length > 0 ? `Args: {${parts.join(', ')}}${required}` : ''
}

async function fetchSmitheryDetail(qualifiedName: string) {
  const data = (await fetchJson(
    `https://registry.smithery.ai/servers/${encodeURIComponent(qualifiedName)}`
  )) as Record<string, unknown>
  const rawTools = Array.isArray(data.tools) ? data.tools : []
  const tools = rawTools
    .filter((t): t is Record<string, unknown> => isObj(t) && typeof t.name === 'string')
    .slice(0, 8)
    .map((t) => {
      const name = typeof t.name === 'string' ? t.name : 'tool'
      const desc = String(t.description ?? '').slice(0, 400)
      const hint = argsHint(t.inputSchema)
      return { name: snake(name), description: hint !== '' ? `${desc} ${hint}` : desc }
    })
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName : qualifiedName,
    description: typeof data.description === 'string' ? data.description : '',
    iconUrl: typeof data.iconUrl === 'string' ? data.iconUrl : null,
    homepage: typeof data.homepage === 'string' ? data.homepage : null,
    deploymentUrl: typeof data.deploymentUrl === 'string' ? data.deploymentUrl : null,
    tools,
  }
}

// ---------------------------------------------------------------------------
// npm registry search (registry.npmjs.org)
// ---------------------------------------------------------------------------

async function npmSearch(query: string) {
  const text = query.trim() || 'mcp-server'
  const data = (await fetchJson(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=24`
  )) as { objects?: { package?: Record<string, unknown>; downloads?: number }[] }
  return (data.objects ?? [])
    .filter(
      (o): o is { package: Record<string, unknown>; downloads?: number } =>
        isObj(o?.package) && typeof o.package.name === 'string'
    )
    .map((o) => {
      const p = o.package
      const name = typeof p.name === 'string' ? p.name : ''
      const keywords = Array.isArray(p.keywords) ? p.keywords.filter((k): k is string => typeof k === 'string') : []
      return {
        name,
        description: typeof p.description === 'string' ? p.description : '',
        version: typeof p.version === 'string' ? p.version : '',
        keywords,
        downloads: o.downloads ?? 0,
        isMcp:
          name.includes('mcp') ||
          keywords.some((k) => k.includes('mcp') || k === 'model-context-protocol'),
      }
    })
}

// ---------------------------------------------------------------------------
// GitHub resolution (raw.githubusercontent.com + best-effort api.github.com)
// ---------------------------------------------------------------------------

const MANIFEST_PATHS = [
  'plugin.json',
  'nexus-plugin.json',
  '.nexus/plugin.json',
  'skill.json',
  'nexus-skill.json',
  'mcp.json',
  'nexus-mcp.json',
  'package.json',
]

function safeSegments(p: string): string | null {
  const segs = p.split('/').filter(Boolean)
  if (segs.some((s) => !/^[A-Za-z0-9._-]+$/.test(s) || s === '.' || s === '..')) return null
  return segs.join('/')
}

async function rawExists(owner: string, repo: string, branch: string, path: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, {
        method: 'HEAD',
        signal: controller.signal,
      })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

async function fetchRawJson(owner: string, repo: string, branch: string, path: string): Promise<unknown | null> {
  try {
    return await fetchJson(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`)
  } catch {
    return null
  }
}

/** Fetch a raw text file (SKILL.md, HTML listings) — null on any failure. */
async function fetchRawText(url: string, timeoutMs = 9000, maxSize = 400_000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
      if (!res.ok) return null
      const text = await res.text()
      if (text.length > maxSize) return null
      return text
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Agent Skills format (SKILL.md — the skills.sh / anthropics/skills standard)
// ---------------------------------------------------------------------------

/**
 * Extract a scalar value from simple YAML frontmatter, supporting single-line
 * values and block scalars (`>`, `|`, `>-`, `|-` — the styles the agent-skills
 * spec uses for long descriptions).
 */
function yamlScalar(meta: string, key: string): string {
  const m = meta.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
  if (!m) return ''
  let value = m[1].trim()
  if (/^(>|\|)[+-]?$/.test(value)) {
    const lines = meta.split('\n')
    const idx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l))
    const collected: string[] = []
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (l === '') continue
      if (/^\s+/.test(l)) collected.push(l.trim())
      else break
    }
    value = collected.join(' ')
  }
  return value.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Parse a SKILL.md file: YAML frontmatter (name, description) + markdown body
 * that becomes the skill prompt.
 */
function parseSkillMd(text: string, fallbackName: string): SkillManifest | null {
  let name = fallbackName
  let description = ''
  let body = text
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fm) {
    name = yamlScalar(fm[1], 'name').slice(0, 80) || fallbackName
    description = yamlScalar(fm[1], 'description')
    body = text.slice(fm[0].length)
  }
  body = body.trim()
  if (body === '' && description === '') return null
  if (description === '') {
    const para = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('['))
    description = para ? para.replace(/[*_`>]/g, '').slice(0, 200) : `Agent skill ${name}`
  }
  const prompt =
    body !== ''
      ? body.slice(0, 4000)
      : `Apply the "${name}" skill when relevant. ${description}`
  return {
    name: name || fallbackName,
    description: description.slice(0, 300),
    icon: 'sparkles',
    category: 'agent-skill',
    prompt,
  }
}

/**
 * Discover sub-skill directories of a multi-skill repo by scraping the public
 * GitHub tree page for skills/ (works without API authentication).
 */
async function discoverSkillDirs(owner: string, repo: string, branch: string): Promise<string[]> {
  const html = await fetchRawText(`https://github.com/${owner}/${repo}/tree/${branch}/skills`, 8000, 1_500_000)
  if (!html) return []
  const re = new RegExp(`href="/${owner}/${repo}/tree/${branch}/skills/([A-Za-z0-9._-]+)"`, 'g')
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== '.' && m[1] !== '..') names.add(m[1])
  }
  return [...names].slice(0, 8)
}

interface FoundManifest {
  type: ManifestType
  path: string
  payload: PluginManifest | SkillManifest | McpManifest
}

interface GitHubResolution {
  repo: { owner: string; name: string; branch: string; url: string; description: string }
  found: FoundManifest[]
  fallback: { type: 'skill' | 'mcp'; payload: SkillManifest | McpManifest; reason: string } | null
}

async function resolveGithub(inputUrl: string): Promise<GitHubResolution> {
  let url = inputUrl.trim().replace(/\.git$/, '').replace(/\/$/, '')
  if (!/^https?:\/\//.test(url)) url = `https://github.com/${url}`
  const u = assertPublicHttpsUrl(url)

  let owner = ''
  let repo = ''
  let branch = ''
  let basePath = ''

  if (u.hostname === 'raw.githubusercontent.com') {
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length < 4) throw new Error('Expected raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>')
    ;[owner, repo, branch] = segs
    basePath = segs.slice(3).join('/')
  } else if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length < 2) throw new Error('Expected github.com/<owner>/<repo>')
    ;[owner, repo] = segs
    if (segs[2] === 'blob' || segs[2] === 'tree') {
      if (segs.length < 4) throw new Error('Missing branch in URL')
      branch = segs[3]
      basePath = segs.slice(4).join('/')
    }
  } else {
    throw new Error('URL must point to github.com or raw.githubusercontent.com')
  }

  const safeBase = safeSegments(basePath)
  if (safeBase === null) throw new Error('Invalid path in URL')

  // detect branch by probing README (main, then master)
  if (!branch) {
    branch = (await rawExists(owner, repo, 'main', 'README.md')) ? 'main' : 'master'
  }

  // repo description: best-effort via api.github.com, else first paragraph of README
  let description = ''
  try {
    const api = (await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, { timeoutMs: 5000 })) as Record<string, unknown>
    if (typeof api.description === 'string') description = api.description
  } catch {
    /* rate-limited or offline — ignore */
  }
  if (!description) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      let text = ''
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`, {
          signal: controller.signal,
        })
        if (res.ok) text = await res.text()
      } finally {
        clearTimeout(timer)
      }
      const para = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l !== '' && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('[') && l.length > 30)
      if (para) description = para.replace(/[*_`>]/g, '').slice(0, 200)
    } catch {
      /* ignore */
    }
  }
  if (!description) description = `GitHub repository ${owner}/${repo}`

  const result: GitHubResolution = {
    repo: { owner, name: repo, branch, url: `https://github.com/${owner}/${repo}`, description },
    found: [],
    fallback: null,
  }

  // collect recognized manifests
  let sawPackageJson = false
  for (const p of MANIFEST_PATHS) {
    const full = safeBase !== '' ? `${safeBase}/${p}` : p
    const json = await fetchRawJson(owner, repo, branch, full)
    if (json === null) continue
    const detected = detectManifest(json)
    if (!detected) continue
    if (detected.type === 'package') {
      sawPackageJson = true
      continue
    }
    result.found.push({ type: detected.type, path: full, payload: detected.payload })
    // our own manifest formats are authoritative — stop scanning
    if (p !== 'package.json') break
  }

  // Agent Skills format (skills.sh / anthropics/skills): SKILL.md at root or
  // skills/<name>/SKILL.md in multi-skill repositories
  if (result.found.length === 0) {
    const base = safeBase !== '' ? `${safeBase}/` : ''
    const rootMd = await fetchRawText(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${base}SKILL.md`
    )
    if (rootMd !== null) {
      const skill = parseSkillMd(rootMd, repo)
      if (skill) result.found.push({ type: 'skill', path: `${base}SKILL.md`, payload: skill })
    }
    if (result.found.length === 0) {
      const dirs = await discoverSkillDirs(owner, repo, branch)
      for (const dir of dirs) {
        const md = await fetchRawText(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${base}skills/${dir}/SKILL.md`
        )
        if (md === null) continue
        const skill = parseSkillMd(md, dir)
        if (skill) result.found.push({ type: 'skill', path: `${base}skills/${dir}/SKILL.md`, payload: skill })
        if (result.found.length >= 8) break
      }
    }
  }

  // fallback: import the repository itself as a skill (or MCP if it smells like one)
  if (result.found.length === 0) {
    let pkgDesc = description
    let pkgKeywords: string[] = []
    if (sawPackageJson) {
      const pkg = (await fetchRawJson(
        owner,
        repo,
        branch,
        safeBase !== '' ? `${safeBase}/package.json` : 'package.json'
      )) as Record<string, unknown> | null
      if (isObj(pkg)) {
        pkgDesc = typeof pkg.description === 'string' && pkg.description !== '' ? pkg.description : description
        pkgKeywords = Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : []
      }
    }
    const mcpish =
      /mcp|model.?context.?protocol/i.test(repo) ||
      /mcp|model.?context.?protocol/i.test(pkgDesc) ||
      pkgKeywords.some((k) => /mcp|model.?context.?protocol/i.test(k))
    if (mcpish) {
      result.fallback = {
        type: 'mcp',
        payload: normalizeMcp({
          name: `${repo} (GitHub)`,
          description: `MCP server imported from github.com/${owner}/${repo}. ${pkgDesc}`,
          tools: [{ name: 'run_task', description: `Perform this server's core action. ${pkgDesc}` }],
        }),
        reason: 'No plugin/skill manifest found, but this repository looks like an MCP server.',
      }
    } else {
      result.fallback = {
        type: 'skill',
        payload: normalizeSkill({
          name: repo,
          description: `Knowledge from the GitHub repository ${owner}/${repo}: ${pkgDesc}`.slice(0, 300),
          icon: 'compass',
          category: 'github',
          prompt: `You have access to knowledge from the GitHub repository ${owner}/${repo} (${branch} branch). Repository summary: ${pkgDesc}. When relevant to the task, apply this repository's concepts, conventions and best practices. Use web search to verify specifics when needed.`,
        }),
        reason: 'No plugin/skill manifest found — import the repository as a knowledge skill instead.',
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// GET actions
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'catalog'

  try {
    await ensureSeeded()

    if (action === 'catalog') {
      const [plugins, skills] = await Promise.all([
        db.plugin.findMany({ where: { installed: false }, orderBy: { name: 'asc' } }),
        db.skill.findMany({ select: { slug: true } }),
      ])
      const have = new Set(skills.map((s) => s.slug))
      return NextResponse.json({
        ok: true,
        plugins,
        skills: DEFAULT_SKILLS.filter((s) => !have.has(s.slug)),
      })
    }

    if (action === 'smithery') {
      const query = (searchParams.get('query') ?? '').trim().toLowerCase()
      const all = await fetchSmitheryList()
      const servers = query
        ? all.filter(
            (s) =>
              s.displayName.toLowerCase().includes(query) ||
              s.qualifiedName.toLowerCase().includes(query) ||
              s.description.toLowerCase().includes(query)
          )
        : all
      return NextResponse.json({ ok: true, servers: servers.slice(0, 40), total: servers.length })
    }

    if (action === 'npm') {
      const query = searchParams.get('query') ?? 'mcp-server'
      const packages = await npmSearch(query)
      return NextResponse.json({ ok: true, packages })
    }

    if (action === 'github') {
      const url = searchParams.get('url') ?? ''
      if (url.trim() === '') return err(400, 'url parameter required')
      const resolution = await resolveGithub(url)
      return NextResponse.json({ ok: true, ...resolution })
    }

    if (action === 'fetch-url') {
      const url = (searchParams.get('url') ?? '').trim()
      if (url === '') return err(400, 'url parameter required')
      assertPublicHttpsUrl(url)
      const json = await fetchJson(url)
      const detected = detectManifest(json)
      if (!detected || detected.type === 'package') {
        return err(
          422,
          'The URL returned JSON but it is not a recognized plugin / skill / MCP manifest. Expected a "config" object (plugin), a "prompt" field (skill) or a "tools" array (MCP).'
        )
      }
      return NextResponse.json({ ok: true, type: detected.type, payload: detected.payload })
    }

    return err(400, `Unknown action "${action}"`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 400 })
  }
}

// ---------------------------------------------------------------------------
// POST — install any resolved entity
// ---------------------------------------------------------------------------

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  let slug = slugify(base)
  if (await exists(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`
  return slug
}

export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      type?: string
      payload?: unknown
      origin?: {
        source?: string
        repo?: string
        path?: string
        qualifiedName?: string
        package?: string
      }
    }
    const type = body.type
    if (!type) return err(400, 'type required')

    // ---- Plugin ----
    if (type === 'plugin') {
      const p = normalizePlugin(isObj(body.payload) ? body.payload : {})
      if (p.name.trim() === '') return err(400, 'Plugin name is required')
      if (p.config.type === 'http' && p.config.endpoint === '') {
        return err(400, 'HTTP plugins require config.endpoint')
      }
      if (p.config.type === 'llm' && p.config.instructions === '') {
        return err(400, 'LLM plugins require config.instructions')
      }
      const slug = await uniqueSlug(p.name, async (s) => (await db.plugin.findUnique({ where: { slug: s } })) !== null)
      const toolSlug = `x_${slug}`
      const toolDesc = `${p.description} Args: ${p.config.inputHint}`
      const plugin = await db.plugin.create({
        data: {
          slug,
          name: p.name,
          description: p.description,
          category: p.category,
          icon: p.icon,
          source: body.origin?.source === 'github' ? 'github' : 'custom',
          installed: true,
          enabled: true,
          toolSlug,
          configJson: JSON.stringify({ ...p.config, origin: body.origin ?? null }),
        },
      })
      await db.tool.upsert({
        where: { slug: toolSlug },
        update: { name: p.name, description: toolDesc, source: `plugin:${slug}`, enabled: true },
        create: { slug: toolSlug, name: p.name, description: toolDesc, source: `plugin:${slug}`, enabled: true },
      })
      return NextResponse.json({ ok: true, kind: 'plugin', plugin })
    }

    // ---- Skill ----
    if (type === 'skill') {
      const s = normalizeSkill(isObj(body.payload) ? body.payload : {})
      if (s.name.trim() === '') return err(400, 'Skill name is required')
      if (s.prompt.trim() === '') return err(400, 'Skills require a "prompt"')
      const slug = slugify(s.name)
      const existing = await db.skill.findUnique({ where: { slug } })
      if (existing && existing.prompt === s.prompt) {
        // same skill restored (e.g. a default) — re-enable instead of duplicating
        const skill = await db.skill.update({ where: { id: existing.id }, data: { enabled: true } })
        return NextResponse.json({ ok: true, kind: 'skill', skill })
      }
      const finalSlug = existing ? `${slug}-${Date.now().toString(36).slice(-4)}` : slug
      const skill = await db.skill.create({
        data: {
          slug: finalSlug,
          name: s.name,
          description: s.description,
          category: s.category,
          icon: s.icon,
          prompt: s.prompt,
          enabled: true,
        },
      })
      return NextResponse.json({ ok: true, kind: 'skill', skill })
    }

    // ---- MCP (manifest / github / custom JSON) ----
    if (type === 'mcp') {
      const m = normalizeMcp(isObj(body.payload) ? body.payload : {})
      if (m.name.trim() === '') return err(400, 'MCP server name is required')
      if (m.tools.length === 0) return err(400, 'MCP servers need at least one tool')
      const slug = await uniqueSlug(m.name, async (s) => (await db.mcpServer.findUnique({ where: { slug: s } })) !== null)
      const toolDefs = m.tools.map((t) => ({
        slug: `${slug}.${snake(t.name)}`,
        name: t.name,
        description: t.description,
      }))
      const server = await db.mcpServer.create({
        data: {
          slug,
          name: m.name,
          description: m.description,
          status: 'connected',
          mode: 'registry',
          toolsJson: JSON.stringify(toolDefs),
          configJson: JSON.stringify({ origin: body.origin ?? null }),
          enabled: true,
        },
      })
      return NextResponse.json({ ok: true, kind: 'mcp', server })
    }

    // ---- Smithery MCP import (fetch real tools from the registry) ----
    if (type === 'smithery') {
      const qualifiedName =
        body.origin?.qualifiedName ??
        (isObj(body.payload) && typeof (body.payload as Record<string, unknown>).qualifiedName === 'string'
          ? (body.payload as Record<string, string>).qualifiedName
          : '')
      if (qualifiedName === '') return err(400, 'qualifiedName required for smithery installs')
      const detail = await fetchSmitheryDetail(qualifiedName)
      if (detail.tools.length === 0) {
        return err(422, 'This server does not publish a tool list on Smithery, so it cannot be imported.')
      }
      const slug = await uniqueSlug(detail.displayName, async (s) => (await db.mcpServer.findUnique({ where: { slug: s } })) !== null)
      const toolDefs = detail.tools.map((t) => ({
        slug: `${slug}.${t.name}`,
        name: t.name,
        description: t.description,
      }))
      const server = await db.mcpServer.create({
        data: {
          slug,
          name: `${detail.displayName} (Smithery)`,
          description: detail.description !== '' ? detail.description : `MCP server imported from the Smithery registry (${qualifiedName}).`,
          status: 'connected',
          mode: 'registry',
          toolsJson: JSON.stringify(toolDefs),
          configJson: JSON.stringify({
            origin: { source: 'smithery', qualifiedName, homepage: detail.homepage, deploymentUrl: detail.deploymentUrl },
          }),
          enabled: true,
        },
      })
      return NextResponse.json({ ok: true, kind: 'mcp', server })
    }

    // ---- npm package import (data from the npm search result; meta is best-effort) ----
    if (type === 'npm') {
      const pkgName =
        body.origin?.package ??
        (isObj(body.payload) && typeof (body.payload as Record<string, unknown>).name === 'string'
          ? (body.payload as Record<string, string>).name
          : '')
      if (pkgName === '') return err(400, 'package name required for npm installs')
      const input = isObj(body.payload) ? body.payload : {}
      const desc =
        typeof input.description === 'string' && input.description !== ''
          ? input.description
          : `npm package ${pkgName}`
      const keywords = Array.isArray(input.keywords)
        ? input.keywords.filter((k): k is string => typeof k === 'string')
        : []
      let version = typeof input.version === 'string' ? input.version : ''
      let homepage = ''
      // best-effort metadata fetch (abbreviated doc keeps it small; failures are fine)
      try {
        const meta = (await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkgName).replace('%40', '@')}`, {
          timeoutMs: 8000,
          maxSize: 2_000_000,
          accept: 'application/vnd.npm.install-v1+json',
        })) as Record<string, unknown>
        const distTags = isObj(meta['dist-tags']) ? (meta['dist-tags'] as Record<string, string>) : null
        if (distTags?.latest) version = distTags.latest
        const versions = isObj(meta.versions) ? (meta.versions as Record<string, unknown>) : null
        const latest = version !== '' && versions ? versions[version] : null
        if (isObj(latest) && typeof latest.homepage === 'string') homepage = latest.homepage
        if (keywords.length === 0 && isObj(latest) && Array.isArray(latest.keywords)) {
          keywords.push(...(latest.keywords as unknown[]).filter((k): k is string => typeof k === 'string'))
        }
      } catch {
        /* metadata optional — search result already carries the essentials */
      }

      const mcpish = /mcp|model.?context.?protocol/i.test(pkgName) || keywords.some((k) => /mcp|model.?context.?protocol/i.test(k))
      if (mcpish) {
        const displayName = pkgName.replace(/^@/, '').replace(/\//g, '-')
        const slug = await uniqueSlug(displayName, async (s) => (await db.mcpServer.findUnique({ where: { slug: s } })) !== null)
        const base = displayName.split(/[-@]/).filter(Boolean).slice(-2).join('_')
        const short = snake(base !== '' ? base : 'run_task')
        const toolDefs = [
          {
            slug: `${slug}.${short}`,
            name: short,
            description: `Run the core action of the npm MCP server package ${pkgName}. ${desc}`,
          },
        ]
        const server = await db.mcpServer.create({
          data: {
            slug,
            name: `${displayName} (npm)`,
            description: `MCP server package imported from npm. ${desc}`.slice(0, 300),
            status: 'connected',
            mode: 'registry',
            toolsJson: JSON.stringify(toolDefs),
            configJson: JSON.stringify({
              origin: { source: 'npm', package: pkgName, version, homepage },
            }),
            enabled: true,
          },
        })
        return NextResponse.json({ ok: true, kind: 'mcp', server })
      }

      // knowledge skill about a library
      const displayName = pkgName.replace(/^@/, '')
      const slug = await uniqueSlug(displayName, async (s) => (await db.skill.findUnique({ where: { slug: s } })) !== null)
      const skill = await db.skill.create({
        data: {
          slug,
          name: `${displayName} (npm)`,
          description: `Working knowledge of the npm package ${pkgName}. ${desc}`.slice(0, 300),
          category: 'library',
          icon: 'code',
          prompt: `You are working with the npm package ${pkgName} (${version !== '' ? version : 'latest'}). ${desc}${keywords.length > 0 ? ` Key concepts: ${keywords.join(', ')}.` : ''} Apply this package's APIs, conventions and best practices when relevant; verify specifics with web search when uncertain.`,
          enabled: true,
        },
      })
      return NextResponse.json({ ok: true, kind: 'skill', skill })
    }

    return err(400, `Unknown install type "${type}"`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
