import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

const BUILTIN_TOOL_INFO: Record<string, { name: string; description: string }> = {
  tts_speak: { name: 'Voice Speak', description: 'Convert text into natural speech audio. Args: {"text": string}' },
  read_url: { name: 'Web Reader', description: 'Read the full text of a web page. Args: {"url": string}' },
  translate: {
    name: 'Translator',
    description: 'Translate text between languages. Args: {"text": string, "target_language": string}',
  },
  doc_write: {
    name: 'Doc Writer',
    description: 'Draft a structured document. Args: {"topic": string, "requirements"?: string}',
  },
  web_search: { name: 'Web Search', description: 'Search the live web. Args: {"query": string}' },
  generate_image: {
    name: 'Generate Image',
    description: 'Create an AI image from a prompt. Args: {"prompt": string, "size"?: string}',
  },
  run_code: { name: 'Run Code', description: 'Run JavaScript in a sandbox. Args: {"code": string}' },
  search_images: { name: 'Search Images', description: 'Find real photos on the web. Args: {"query": string}' },
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'plugin'
  )
}

async function ensureToolRow(pluginSlug: string, toolSlug: string, name: string, description: string) {
  await db.tool.upsert({
    where: { slug: toolSlug },
    update: { name, description, source: `plugin:${pluginSlug}`, enabled: true },
    create: { slug: toolSlug, name, description, source: `plugin:${pluginSlug}`, enabled: true },
  })
}

export async function GET() {
  try {
    await ensureSeeded()
    const plugins = await db.plugin.findMany({ orderBy: [{ installed: 'desc' }, { name: 'asc' }] })
    return NextResponse.json({ ok: true, plugins })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// install / uninstall / enable / disable
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string
      installed?: boolean
      enabled?: boolean
    }
    if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const plugin = await db.plugin.findUnique({ where: { id: body.id } })
    if (!plugin) return NextResponse.json({ ok: false, error: 'Plugin not found' }, { status: 404 })

    const data: { installed?: boolean; enabled?: boolean } = {}
    if (typeof body.installed === 'boolean') data.installed = body.installed
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    const updated = await db.plugin.update({ where: { id: body.id }, data })

    if (data.installed === true && plugin.toolSlug) {
      const info = BUILTIN_TOOL_INFO[plugin.toolSlug]
      await ensureToolRow(
        plugin.slug,
        plugin.toolSlug,
        info?.name ?? plugin.name,
        info?.description ?? `${plugin.description} Args: {"input": string}`
      )
    }
    // uninstalling removes the tool from the agent's arsenal for every plugin
    // (catalog plugins simply go back to the marketplace; reinstalling recreates the tool)
    if (data.installed === false && plugin.toolSlug) {
      await db.tool.deleteMany({ where: { slug: plugin.toolSlug, source: `plugin:${plugin.slug}` } })
    }

    return NextResponse.json({ ok: true, plugin: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// install a custom plugin from JSON definition
export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      name?: string
      description?: string
      icon?: string
      category?: string
      config?: { type?: string; instructions?: string; endpoint?: string; inputHint?: string }
    }
    const name = (body.name ?? '').trim()
    if (!name) return NextResponse.json({ ok: false, error: 'Plugin name is required' }, { status: 400 })
    const config = body.config ?? {}
    const type = config.type === 'http' ? 'http' : 'llm'
    if (type === 'http' && !config.endpoint) {
      return NextResponse.json(
        { ok: false, error: 'HTTP plugins require an "endpoint" URL in config' },
        { status: 400 }
      )
    }
    if (type === 'llm' && !config.instructions) {
      return NextResponse.json(
        { ok: false, error: 'LLM plugins require "instructions" in config (how the tool should behave)' },
        { status: 400 }
      )
    }

    let slug = slugify(name)
    const existing = await db.plugin.findUnique({ where: { slug } })
    if (existing) slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    const toolSlug = `x_${slug}`

    const plugin = await db.plugin.create({
      data: {
        slug,
        name,
        description: (body.description ?? 'Custom plugin').slice(0, 300),
        category: (body.category ?? 'custom').slice(0, 40),
        icon: (body.icon ?? 'puzzle').slice(0, 30),
        source: 'custom',
        installed: true,
        enabled: true,
        toolSlug,
        configJson: JSON.stringify({
          type,
          instructions: (config.instructions ?? '').slice(0, 2000),
          endpoint: config.endpoint ?? '',
          inputHint: config.inputHint ?? '{"input": string}',
        }),
      },
    })

    await ensureToolRow(
      slug,
      toolSlug,
      name,
      `${plugin.description} Args: ${config.inputHint ?? '{"input": string}'}`
    )

    return NextResponse.json({ ok: true, plugin })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const plugin = await db.plugin.findUnique({ where: { id } })
    if (!plugin) return NextResponse.json({ ok: false, error: 'Plugin not found' }, { status: 404 })
    if (plugin.source === 'builtin') {
      return NextResponse.json(
        { ok: false, error: 'System plugins cannot be deleted — disable them instead' },
        { status: 400 }
      )
    }
    if (plugin.toolSlug) {
      await db.tool.deleteMany({ where: { slug: plugin.toolSlug, source: `plugin:${plugin.slug}` } })
    }
    await db.plugin.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
