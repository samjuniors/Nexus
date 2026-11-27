import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import {
  fetchPublicExternalUrl,
  SsrfBlockedError,
  validateExternalWebsiteUrl,
} from '@/lib/agent/product-source-ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPOSIO_PLUGIN_SLUG = 'composio-connect'
const COMPOSIO_TOOL_SLUG = 'composio_action'
const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v3'

interface ComposioConfig {
  type: 'composio'
  apiKey?: string
  mcpUrl?: string
  userId?: string
  toolkits?: string[]
  updatedAt?: string
}

interface CustomServiceConfig {
  type?: string
  endpoint?: string
  instructions?: string
  inputHint?: string
  authHeaderName?: string
  authHeaderValue?: string
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'service'
  )
}

function maskSecret(secret: string | undefined): string | null {
  const clean = (secret ?? '').trim()
  if (!clean) return null
  if (clean.length <= 4) return '••••'
  return `••••••${clean.slice(-4)}`
}

function parseJsonSafe<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function sanitizeHeaderName(raw: string | undefined): string {
  const clean = (raw ?? '').trim()
  if (!clean) return ''
  // Restrict to safe HTTP header token characters
  return /^[a-zA-Z0-9-]+$/.test(clean) ? clean.slice(0, 64) : ''
}

async function buildConnectSnapshot() {
  await ensureSeeded()
  const [plugins, mcps] = await Promise.all([
    db.plugin.findMany({ orderBy: [{ createdAt: 'desc' }] }),
    db.mcpServer.findMany({ orderBy: [{ name: 'asc' }] }),
  ])

  const composioPlugin = plugins.find((p) => p.slug === COMPOSIO_PLUGIN_SLUG) ?? null
  const composioCfg = parseJsonSafe<ComposioConfig>(composioPlugin?.configJson, {
    type: 'composio',
  })

  const services = plugins
    .filter((p) => p.slug !== COMPOSIO_PLUGIN_SLUG && (p.source === 'connect' || p.source === 'custom'))
    .map((p) => {
      const cfg = parseJsonSafe<CustomServiceConfig>(p.configJson, {})
      return {
        id: p.id,
        kind: 'http' as const,
        slug: p.slug,
        toolSlug: p.toolSlug,
        name: p.name,
        description: p.description,
        category: p.category,
        enabled: p.enabled,
        installed: p.installed,
        endpoint: cfg.endpoint ?? '',
        instructions: cfg.instructions ?? '',
        inputHint: cfg.inputHint ?? '{"input": string}',
        authHeaderName: cfg.authHeaderName ?? '',
        hasAuthSecret: Boolean(cfg.authHeaderValue),
        authSecretMasked: maskSecret(cfg.authHeaderValue),
        usageCount: p.usageCount,
      }
    })

  const remoteMcps = mcps
    .filter((m) => m.mode !== 'builtin')
    .map((m) => {
      const cfg = parseJsonSafe<CustomServiceConfig>(m.configJson, {})
      const tools = parseJsonSafe<{ slug: string; name: string; description: string }[]>(m.toolsJson, [])
      return {
        id: m.id,
        kind: 'mcp' as const,
        slug: m.slug,
        name: m.name,
        description: m.description,
        mode: m.mode,
        status: m.status,
        enabled: m.enabled,
        endpoint: cfg.endpoint ?? '',
        authHeaderName: cfg.authHeaderName ?? '',
        hasAuthSecret: Boolean(cfg.authHeaderValue),
        authSecretMasked: maskSecret(cfg.authHeaderValue),
        tools,
        usageCount: m.usageCount,
      }
    })

  return {
    composio: {
      configured: Boolean(composioPlugin && (composioCfg.apiKey || composioCfg.mcpUrl)),
      enabled: Boolean(composioPlugin?.installed && composioPlugin?.enabled),
      hasApiKey: Boolean(composioCfg.apiKey),
      apiKeyMasked: maskSecret(composioCfg.apiKey),
      mcpUrl: composioCfg.mcpUrl ?? '',
      userId: composioCfg.userId ?? 'default',
      toolkits: Array.isArray(composioCfg.toolkits) ? composioCfg.toolkits : [],
      updatedAt: composioCfg.updatedAt ?? null,
    },
    services,
    mcps: remoteMcps,
  }
}

async function testExternalEndpoint(
  url: string,
  opts: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}
): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetchPublicExternalUrl(url, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    body: opts.body,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  return {
    ok: res.ok,
    status: res.status,
    detail: text.slice(0, 300),
  }
}

/** GET /api/connect — return masked service & Composio integration state (never raw secrets). */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to load connections' },
      { status: 500 }
    )
  }
}

/** POST /api/connect — configure Composio or manually connect/test/remove external services. */
export async function POST(req: Request) {
  try {
    await ensureSeeded()
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '').trim()

    if (action === 'save_composio') {
      const existing = await db.plugin.findUnique({ where: { slug: COMPOSIO_PLUGIN_SLUG } })
      const prevCfg = parseJsonSafe<ComposioConfig>(existing?.configJson, { type: 'composio' })

      const rawMcpUrl = typeof body.mcpUrl === 'string' ? body.mcpUrl.trim() : prevCfg.mcpUrl ?? ''
      if (rawMcpUrl) {
        const check = validateExternalWebsiteUrl(rawMcpUrl)
        if (!check.ok) {
          return NextResponse.json({ ok: false, error: check.error }, { status: 400 })
        }
      }

      const incomingKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      const apiKey = body.clearApiKey === true ? '' : incomingKey || prevCfg.apiKey || ''
      if (!apiKey && !rawMcpUrl) {
        return NextResponse.json(
          { ok: false, error: 'Provide either a Composio API key or a Composio MCP URL.' },
          { status: 400 }
        )
      }

      const userId =
        typeof body.userId === 'string' && body.userId.trim()
          ? body.userId.trim().slice(0, 80)
          : prevCfg.userId ?? 'default'

      const toolkits = Array.isArray(body.toolkits)
        ? body.toolkits.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 30)
        : typeof body.toolkits === 'string'
          ? body.toolkits
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 30)
          : prevCfg.toolkits ?? []

      const enabled = body.enabled !== false
      const nextCfg: ComposioConfig = {
        type: 'composio',
        ...(apiKey ? { apiKey } : {}),
        ...(rawMcpUrl ? { mcpUrl: rawMcpUrl } : {}),
        userId,
        toolkits,
        updatedAt: new Date().toISOString(),
      }

      await db.plugin.upsert({
        where: { slug: COMPOSIO_PLUGIN_SLUG },
        create: {
          slug: COMPOSIO_PLUGIN_SLUG,
          name: 'Composio',
          description: 'Connect 250+ external apps (Gmail, Slack, GitHub, Notion, Stripe) via Composio.',
          category: 'integrations',
          icon: 'plug',
          source: 'connect',
          installed: true,
          enabled,
          toolSlug: COMPOSIO_TOOL_SLUG,
          configJson: JSON.stringify(nextCfg),
        },
        update: {
          installed: true,
          enabled,
          toolSlug: COMPOSIO_TOOL_SLUG,
          configJson: JSON.stringify(nextCfg),
        },
      })

      if (enabled) {
        const toolkitNote = toolkits.length > 0 ? ` Configured toolkits: ${toolkits.join(', ')}.` : ''
        await db.tool.upsert({
          where: { slug: COMPOSIO_TOOL_SLUG },
          create: {
            slug: COMPOSIO_TOOL_SLUG,
            name: 'Composio Connected Apps',
            description: `List connected accounts/tools or execute external app actions via Composio.${toolkitNote}`,
            source: `plugin:${COMPOSIO_PLUGIN_SLUG}`,
            enabled: true,
          },
          update: {
            description: `List connected accounts/tools or execute external app actions via Composio.${toolkitNote}`,
            enabled: true,
          },
        })
      } else {
        await db.tool.deleteMany({
          where: { slug: COMPOSIO_TOOL_SLUG, source: `plugin:${COMPOSIO_PLUGIN_SLUG}` },
        })
      }

      return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
    }

    if (action === 'test_composio') {
      const existing = await db.plugin.findUnique({ where: { slug: COMPOSIO_PLUGIN_SLUG } })
      const prevCfg = parseJsonSafe<ComposioConfig>(existing?.configJson, { type: 'composio' })
      const apiKey =
        (typeof body.apiKey === 'string' && body.apiKey.trim()) || prevCfg.apiKey || ''
      const mcpUrl =
        (typeof body.mcpUrl === 'string' && body.mcpUrl.trim()) || prevCfg.mcpUrl || ''

      if (apiKey) {
        try {
          const probe = await testExternalEndpoint(`${COMPOSIO_BASE_URL}/connected_accounts?limit=20`, {
            method: 'GET',
            headers: { 'x-api-key': apiKey, Accept: 'application/json' },
          })
          if (!probe.ok) {
            return NextResponse.json(
              { ok: false, error: `Composio returned HTTP ${probe.status}: ${probe.detail}` },
              { status: 400 }
            )
          }
          let count = 0
          try {
            const parsed = JSON.parse(probe.detail) as { items?: unknown[]; data?: unknown[] }
            count = Array.isArray(parsed.items)
              ? parsed.items.length
              : Array.isArray(parsed.data)
                ? parsed.data.length
                : 0
          } catch {
            /* ignore non-JSON summary */
          }
          return NextResponse.json({
            ok: true,
            message: `Composio API key verified (${count} connected account(s) visible).`,
          })
        } catch (err) {
          return NextResponse.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : 'Composio connection test failed',
            },
            { status: 400 }
          )
        }
      }

      if (mcpUrl) {
        const check = validateExternalWebsiteUrl(mcpUrl)
        if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 })
        try {
          const probe = await testExternalEndpoint(mcpUrl, { method: 'GET' })
          return NextResponse.json({
            ok: probe.status < 500,
            message: `Composio MCP endpoint reachable (HTTP ${probe.status}).`,
          })
        } catch (err) {
          return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : 'MCP endpoint unreachable' },
            { status: 400 }
          )
        }
      }

      return NextResponse.json(
        { ok: false, error: 'Enter or save a Composio API key or MCP URL first.' },
        { status: 400 }
      )
    }

    if (action === 'disconnect_composio') {
      await db.tool.deleteMany({
        where: { slug: COMPOSIO_TOOL_SLUG, source: `plugin:${COMPOSIO_PLUGIN_SLUG}` },
      })
      await db.plugin.deleteMany({ where: { slug: COMPOSIO_PLUGIN_SLUG } })
      return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
    }

    if (action === 'add_service') {
      const name = String(body.name ?? '').trim()
      if (!name) return NextResponse.json({ ok: false, error: 'Service name is required' }, { status: 400 })

      const kind = body.kind === 'mcp' ? 'mcp' : 'http'
      const endpoint = String(body.endpoint ?? '').trim()
      if (!endpoint) {
        return NextResponse.json({ ok: false, error: 'Endpoint URL is required' }, { status: 400 })
      }
      const check = validateExternalWebsiteUrl(endpoint)
      if (!check.ok) {
        return NextResponse.json({ ok: false, error: check.error }, { status: 400 })
      }

      const authHeaderName = sanitizeHeaderName(
        typeof body.authHeaderName === 'string' ? body.authHeaderName : undefined
      )
      const authHeaderValue =
        typeof body.authHeaderValue === 'string' ? body.authHeaderValue.trim().slice(0, 512) : ''
      const description = String(body.description ?? `External ${kind.toUpperCase()} service: ${name}`)
        .trim()
        .slice(0, 300)

      let slug = slugify(name)
      if (kind === 'mcp') {
        const existingMcp = await db.mcpServer.findUnique({ where: { slug } })
        if (existingMcp) slug = `${slug}-${Date.now().toString(36).slice(-4)}`

        const rawTools = Array.isArray(body.tools)
          ? body.tools
          : typeof body.tools === 'string'
            ? body.tools
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => ({ name: t, description: `Call ${t} on ${name}` }))
            : [{ name: 'invoke', description }]

        const toolDefs = (rawTools as { name?: string; description?: string }[])
          .filter((t) => t && typeof t.name === 'string' && t.name.trim())
          .slice(0, 8)
          .map((t) => ({
            slug: `${slug}.${slugify(t.name ?? 'invoke').replace(/-/g, '_')}`,
            name: String(t.name).slice(0, 60),
            description: String(t.description ?? description).slice(0, 300),
          }))

        await db.mcpServer.create({
          data: {
            slug,
            name: name.slice(0, 80),
            description,
            status: 'connected',
            mode: 'remote',
            toolsJson: JSON.stringify(toolDefs),
            configJson: JSON.stringify({
              type: 'mcp',
              endpoint,
              ...(authHeaderName && authHeaderValue ? { authHeaderName, authHeaderValue } : {}),
            }),
            enabled: true,
          },
        })
      } else {
        const existingPlugin = await db.plugin.findUnique({ where: { slug } })
        if (existingPlugin) slug = `${slug}-${Date.now().toString(36).slice(-4)}`
        const toolSlug = `x_${slug}`
        const inputHint =
          typeof body.inputHint === 'string' && body.inputHint.trim()
            ? body.inputHint.trim().slice(0, 200)
            : '{"input": string}'

        await db.plugin.create({
          data: {
            slug,
            name: name.slice(0, 80),
            description,
            category: String(body.category ?? 'integrations').slice(0, 40),
            icon: 'plug',
            source: 'connect',
            installed: true,
            enabled: true,
            toolSlug,
            configJson: JSON.stringify({
              type: 'http',
              endpoint,
              instructions: description,
              inputHint,
              ...(authHeaderName && authHeaderValue ? { authHeaderName, authHeaderValue } : {}),
            }),
          },
        })

        await db.tool.upsert({
          where: { slug: toolSlug },
          create: {
            slug: toolSlug,
            name: name.slice(0, 80),
            description: `${description} Args: ${inputHint}`,
            source: `plugin:${slug}`,
            enabled: true,
          },
          update: {
            name: name.slice(0, 80),
            description: `${description} Args: ${inputHint}`,
            source: `plugin:${slug}`,
            enabled: true,
          },
        })
      }

      return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
    }

    if (action === 'test_service') {
      const id = String(body.id ?? '').trim()
      const kind = body.kind === 'mcp' ? 'mcp' : 'http'
      if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

      let endpoint = ''
      let authHeaderName = ''
      let authHeaderValue = ''

      if (kind === 'mcp') {
        const srv = await db.mcpServer.findUnique({ where: { id } })
        if (!srv) return NextResponse.json({ ok: false, error: 'MCP server not found' }, { status: 404 })
        const cfg = parseJsonSafe<CustomServiceConfig>(srv.configJson, {})
        endpoint = cfg.endpoint ?? ''
        authHeaderName = cfg.authHeaderName ?? ''
        authHeaderValue = cfg.authHeaderValue ?? ''
      } else {
        const plg = await db.plugin.findUnique({ where: { id } })
        if (!plg) return NextResponse.json({ ok: false, error: 'Service not found' }, { status: 404 })
        const cfg = parseJsonSafe<CustomServiceConfig>(plg.configJson, {})
        endpoint = cfg.endpoint ?? ''
        authHeaderName = cfg.authHeaderName ?? ''
        authHeaderValue = cfg.authHeaderValue ?? ''
      }

      if (!endpoint) {
        return NextResponse.json(
          { ok: false, error: 'No external endpoint configured for this service.' },
          { status: 400 }
        )
      }

      try {
        const headers: Record<string, string> = {}
        if (authHeaderName && authHeaderValue) headers[authHeaderName] = authHeaderValue
        const probe = await testExternalEndpoint(endpoint, { method: 'GET', headers })
        return NextResponse.json({
          ok: probe.status < 500,
          message: `Endpoint responded with HTTP ${probe.status}.`,
        })
      } catch (err) {
        return NextResponse.json(
          {
            ok: false,
            error:
              err instanceof SsrfBlockedError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Service test failed',
          },
          { status: 400 }
        )
      }
    }

    if (action === 'toggle_service') {
      const id = String(body.id ?? '').trim()
      const kind = body.kind === 'mcp' ? 'mcp' : 'http'
      const enabled = Boolean(body.enabled)
      if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

      if (kind === 'mcp') {
        await db.mcpServer.update({
          where: { id },
          data: { enabled, status: enabled ? 'connected' : 'disconnected' },
        })
      } else {
        const plg = await db.plugin.update({ where: { id }, data: { enabled } })
        if (plg.toolSlug) {
          await db.tool.updateMany({
            where: { slug: plg.toolSlug, source: `plugin:${plg.slug}` },
            data: { enabled },
          })
        }
      }
      return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
    }

    if (action === 'delete_service') {
      const id = String(body.id ?? '').trim()
      const kind = body.kind === 'mcp' ? 'mcp' : 'http'
      if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 })

      if (kind === 'mcp') {
        const srv = await db.mcpServer.findUnique({ where: { id } })
        if (!srv) return NextResponse.json({ ok: false, error: 'MCP server not found' }, { status: 404 })
        if (srv.mode === 'builtin') {
          return NextResponse.json({ ok: false, error: 'Built-in MCP servers cannot be deleted' }, { status: 400 })
        }
        await db.mcpServer.delete({ where: { id } })
      } else {
        const plg = await db.plugin.findUnique({ where: { id } })
        if (!plg) return NextResponse.json({ ok: false, error: 'Service not found' }, { status: 404 })
        if (plg.source === 'builtin') {
          return NextResponse.json({ ok: false, error: 'Built-in plugins cannot be deleted' }, { status: 400 })
        }
        if (plg.toolSlug) {
          await db.tool.deleteMany({ where: { slug: plg.toolSlug, source: `plugin:${plg.slug}` } })
        }
        await db.plugin.delete({ where: { id } })
      }
      return NextResponse.json({ ok: true, ...(await buildConnectSnapshot()) })
    }

    return NextResponse.json({ ok: false, error: `Unknown connect action: ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Connect action failed' },
      { status: 500 }
    )
  }
}
