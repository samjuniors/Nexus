import { promises as fs } from 'fs'
import vm from 'node:vm'
import path from 'path'
import { db } from '@/lib/db'
import { chatText, getZAI } from '@/lib/agent/zai'
import { recallMemories } from '@brain/index'
import { buildAppGraph } from '@/lib/agent/graph-source'
import { renderQueryResult } from '@brain/index'
import {
  listWorkspaceFiles,
  safeWorkspacePath,
  saveWorkspaceFile,
  WORKSPACE_DIR,
} from '@/lib/agent/workspace'
import type { EffectiveTool, ToolExecResult } from '@/lib/agent/types'

// Canonical prompt-facing specs for built-in tools
const BUILTIN_TOOL_SPECS: Record<string, { name: string; description: string; argSpec: string }> =
  {
    save_memory: {
      name: 'Save Memory',
      description: 'Save an important fact, preference, insight, decision or note to app memory for future missions.',
      argSpec: '{"content": string, "type"?: "fact"|"preference"|"insight"|"decision"|"note"}',
    },
    recall_memory: {
      name: 'Recall Memory',
      description:
        'Brain-first recall: search long-term memories by keywords and get the best matches with citations. Use before answering questions that may involve remembered facts, preferences or decisions.',
      argSpec: '{"query": string, "limit"?: number}',
    },
    graph_query: {
      name: 'Graph Query',
      description:
        'Query the app knowledge graph (graphify-style): what is connected to a concept (neighbors), how two concepts relate (path), or overall stats. Concepts include tools, skills, plugins, MCPs, memories, runs and artifacts.',
      argSpec: '{"mode"?: "neighbors"|"path"|"stats"|"rabbit", "target"?: string, "target2"?: string}',
    },
    web_search: {
      name: 'Web Search',
      description: 'Search the live web for fresh information.',
      argSpec: '{"query": string}',
    },
    generate_image: {
      name: 'Generate Image',
      description: 'Create an original AI image from a text prompt.',
      argSpec: '{"prompt": string, "size"?: "1024x1024"|"1344x768"|"768x1344"|"1440x720"}',
    },
    run_code: {
      name: 'Run Code',
      description: 'Run synchronous JavaScript in a secure sandbox; use console.log for output.',
      argSpec: '{"code": string}',
    },
    search_images: {
      name: 'Search Images',
      description: 'Find real photos and images from the web.',
      argSpec: '{"query": string}',
    },
    tts_speak: {
      name: 'Voice Speak',
      description: 'Convert text into natural speech audio.',
      argSpec: '{"text": string}',
    },
    read_url: {
      name: 'Web Reader',
      description: 'Open and read the full text content of a web page.',
      argSpec: '{"url": string}',
    },
    browse_site: {
      name: 'Browse Site',
      description:
        'Lightweight browser use: open a URL, extract its readable text and links, then follow up to 2 related same-site pages (chosen by topic). Use for focused multi-page reading when a single page or search snippets are not enough.',
      argSpec: '{"url": string, "topic"?: string, "maxPages"?: number}',
    },
    weather_lookup: {
      name: 'Weather Lookup',
      description:
        'Get the current weather and a short forecast for any city or place (live data via Open-Meteo, no API key needed).',
      argSpec: '{"location": string}',
    },
    wikipedia_search: {
      name: 'Wikipedia Search',
      description:
        'Search Wikipedia articles and return their summaries with links — great for encyclopedic facts, history, science and biographies.',
      argSpec: '{"query": string, "limit"?: number}',
    },
    create_chart: {
      name: 'Create Chart',
      description:
        'Create a clean data chart (bar, line or pie) from labels and values and save it as an image artifact in the workspace.',
      argSpec: '{"title": string, "type": "bar"|"line"|"pie", "labels": string[], "values": number[]}',
    },
    translate: {
      name: 'Translator',
      description: 'Translate text between any languages.',
      argSpec: '{"text": string, "target_language": string}',
    },
    doc_write: {
      name: 'Doc Writer',
      description: 'Draft a structured document on a topic.',
      argSpec: '{"topic": string, "requirements"?: string}',
    },
    computer_use: {
      name: 'Computer Use',
      description:
        'Control the app\'s computer: run shell commands, read/write/list workspace files, and open URLs. Actions are safety-tiered (read < write < destructive); destructive actions (rm, installs, POST requests) require "confirm": true after asking the user.',
      argSpec:
        '{"action": "shell"|"read_file"|"write_file"|"list_dir"|"open_url", "command"?: string, "path"?: string, "content"?: string, "url"?: string, "confirm"?: boolean}',
    },
  }

const MCP_BUILTIN_HANDLERS = new Set([
  'fs.list_files',
  'fs.read_file',
  'fs.write_file',
  'time.get_datetime',
  'time.get_environment',
])

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + ' …[truncated]'
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Compute the tools the agent can use right now (enabled tools + installed plugins + connected MCPs). */
export async function getEffectiveTools(): Promise<EffectiveTool[]> {
  const [toolRows, plugins, mcps] = await Promise.all([
    db.tool.findMany(),
    db.plugin.findMany({ where: { installed: true } }),
    db.mcpServer.findMany({ where: { status: 'connected' } }),
  ])
  const pluginBySlug = new Map(plugins.map((p) => [p.slug, p]))
  const out: EffectiveTool[] = []

  for (const t of toolRows) {
    if (!t.enabled) continue
    if (t.source.startsWith('plugin:')) {
      const plugin = pluginBySlug.get(t.source.slice(7))
      if (!plugin || !plugin.enabled) continue
      const spec = BUILTIN_TOOL_SPECS[t.slug]
      let description = t.description
      let argSpec = ''
      if (spec) {
        description = spec.description
        argSpec = spec.argSpec
      } else {
        try {
          const cfg = JSON.parse(plugin.configJson) as { inputHint?: string }
          argSpec = cfg.inputHint ?? '{"input": string}'
        } catch {
          argSpec = '{"input": string}'
        }
      }
      out.push({
        slug: t.slug,
        name: t.name,
        description,
        kind: 'plugin',
        sourceLabel: `Plugin · ${plugin.name}`,
        pluginSlug: plugin.slug,
        argSpec,
      })
    } else {
      const spec = BUILTIN_TOOL_SPECS[t.slug]
      out.push({
        slug: t.slug,
        name: spec?.name ?? t.name,
        description: spec?.description ?? t.description,
        kind: 'builtin',
        sourceLabel: 'Built-in',
        argSpec: spec?.argSpec ?? '',
      })
    }
  }

  for (const m of mcps) {
    if (!m.enabled) continue
    let tools: { slug: string; name: string; description: string }[] = []
    try {
      tools = JSON.parse(m.toolsJson) as typeof tools
    } catch {
      tools = []
    }
    for (const t of tools) {
      out.push({
        slug: t.slug,
        name: t.name,
        description: t.description,
        kind: 'mcp',
        sourceLabel: `MCP · ${m.name}`,
        mcpSlug: m.slug,
        argSpec: '',
      })
    }
  }

  return out
}

async function bumpUsage(slug: string) {
  try {
    await db.tool.update({ where: { slug }, data: { usageCount: { increment: 1 } } })
    const t = await db.tool.findUnique({ where: { slug } })
    if (t?.source.startsWith('plugin:')) {
      await db.plugin.update({
        where: { slug: t.source.slice(7) },
        data: { usageCount: { increment: 1 } },
      })
    }
    if (slug.includes('.')) {
      const prefix = slug.split('.')[0]
      const candidates = await db.mcpServer.findMany()
      const match = candidates.find((c) => c.slug === prefix || slug.startsWith(`${c.slug}.`))
      if (match) {
        await db.mcpServer.update({ where: { id: match.id }, data: { usageCount: { increment: 1 } } })
      }
    }
  } catch {
    // usage stats are best-effort
  }
}

/** WMO weather interpretation codes → human description (Open-Meteo docs). */
const WMO_WEATHER: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'slight snow fall',
  73: 'moderate snow fall',
  75: 'heavy snow fall',
  77: 'snow grains',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'slight snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
}

/** Chart palette — silver-on-charcoal theme matching the app. */
const CHART_COLORS = ['#7dd3fc', '#6ee7b7', '#f0abfc', '#fcd34d', '#fdba74', '#a5b4fc', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe', '#fde68a', '#5eead4']

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
  )
}

/**
 * Build a clean SVG chart (bar / line / pie) — zero dependencies, saved as a
 * workspace artifact. Charcoal background, silver text, palette accents.
 */
function buildChartSvg(opts: { title: string; type: 'bar' | 'line' | 'pie'; labels: string[]; values: number[] }): string {
  const { title, type, labels, values } = opts
  const W = 760
  const H = 480
  const bg = '#131419'
  const fg = '#e4e4e7'
  const muted = '#a1a1aa'
  const grid = 'rgba(255,255,255,0.07)'
  const maxV = Math.max(...values)
  const minV = Math.min(...values, 0)
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, monospace">`)
  parts.push(`<rect width="${W}" height="${H}" fill="${bg}" rx="14"/>`)
  parts.push(`<text x="${W / 2}" y="42" text-anchor="middle" fill="${fg}" font-size="19" font-weight="600">${escapeXml(title)}</text>`)

  if (type === 'pie') {
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const cx = 250
    const cy = 265
    const r = 145
    let angle = -Math.PI / 2
    values.forEach((v, i) => {
      const frac = Math.max(0, v) / total
      const a2 = angle + frac * Math.PI * 2
      const large = frac > 0.5 ? 1 : 0
      const x1 = cx + Math.cos(angle) * r
      const y1 = cy + Math.sin(angle) * r
      const x2 = cx + Math.cos(a2) * r
      const y2 = cy + Math.sin(a2) * r
      if (frac > 0.999) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`)
      } else if (frac > 0.001) {
        parts.push(
          `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="${bg}" stroke-width="2"/>`
        )
      }
      angle = a2
    })
    // legend
    const legendX = 470
    values.forEach((v, i) => {
      const y = 130 + i * 34
      parts.push(`<rect x="${legendX}" y="${y - 11}" width="14" height="14" rx="3" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/>`)
      parts.push(
        `<text x="${legendX + 24}" y="${y}" fill="${fg}" font-size="14">${escapeXml(labels[i].slice(0, 22))} <tspan fill="${muted}">${fmt(v)} (${((Math.max(0, v) / total) * 100).toFixed(0)}%)</tspan></text>`
      )
    })
  } else {
    const L = 70 // left margin
    const R = 30
    const T = 80
    const B = 70
    const plotW = W - L - R
    const plotH = H - T - B
    const span = maxV - minV || 1

    // gridlines + y labels (5 steps)
    for (let g = 0; g <= 4; g++) {
      const y = T + plotH - (g / 4) * plotH
      const val = minV + (g / 4) * span
      parts.push(`<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${grid}" stroke-width="1"/>`)
      parts.push(`<text x="${L - 10}" y="${y + 4}" text-anchor="end" fill="${muted}" font-size="11">${fmt(Math.round(val * 10) / 10)}</text>`)
    }

    if (type === 'bar') {
      const slot = plotW / values.length
      const bw = Math.min(72, slot * 0.62)
      values.forEach((v, i) => {
        const h = ((v - minV) / span) * plotH
        const x = L + slot * i + (slot - bw) / 2
        const y = T + plotH - h
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, h).toFixed(1)}" rx="4" fill="${CHART_COLORS[i % CHART_COLORS.length]}" fill-opacity="0.88"/>`)
        parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="12">${fmt(v)}</text>`)
        parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${T + plotH + 20}" text-anchor="middle" fill="${muted}" font-size="11">${escapeXml(labels[i].slice(0, 12))}</text>`)
      })
    } else {
      // line
      const pts = values.map((v, i) => {
        const x = L + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW)
        const y = T + plotH - ((v - minV) / span) * plotH
        return { x, y }
      })
      parts.push(`<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#7dd3fc" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`)
      pts.forEach((p, i) => {
        parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#7dd3fc" stroke="${bg}" stroke-width="2"/>`)
        parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" fill="${fg}" font-size="12">${fmt(values[i])}</text>`)
        parts.push(
          `<text x="${p.x.toFixed(1)}" y="${T + plotH + 20}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" fill="${muted}" font-size="11">${escapeXml(labels[i].slice(0, 12))}</text>`
        )
      })
    }
  }

  parts.push(`<text x="${W / 2}" y="${H - 16}" text-anchor="middle" fill="${muted}" font-size="10" fill-opacity="0.7">nexus agent · create_chart</text>`)
  parts.push('</svg>')
  return parts.join('\n')
}

function sandboxRunCode(code: string): { ok: boolean; output: string } {
  const logs: string[] = []
  const fmt = (v: unknown): string => {
    if (typeof v === 'string') return v
    try {
      return JSON.stringify(v, null, 2) ?? String(v)
    } catch {
      return String(v)
    }
  }
  const sandboxConsole = {
    log: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    info: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    warn: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    error: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
  }
  const sandbox = {
    console: sandboxConsole,
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    RegExp,
    Error,
    Map,
    Set,
  }
  try {
    const script = new vm.Script(`(function(){\n"use strict";\n${code}\n})()`)
    const ctx = vm.createContext(sandbox)
    const ret = script.runInContext(ctx, { timeout: 3000 })
    const parts = [...logs]
    if (ret !== undefined) parts.push(`=> ${fmt(ret)}`)
    return { ok: true, output: parts.join('\n') || '(no output)' }
  } catch (e) {
    return { ok: false, output: `${logs.join('\n')}\nError: ${e instanceof Error ? e.message : String(e)}`.trim() }
  }
}

/** Execute a tool for real. Returns raw text for the LLM plus display data for the UI. */
export async function executeTool(
  slug: string,
  args: Record<string, unknown>,
  runId: string,
  conversationId: string | null
): Promise<ToolExecResult> {
  await bumpUsage(slug)

  try {
    switch (slug) {
      case 'web_search': {
        const query = str(args.query)
        const num = Math.min(Math.max(Number(args.num) || 6, 1), 8)
        // PROVIDER CHAIN: Tavily (if TAVILY_API_KEY is set) → built-in SDK search
        let results: unknown[] = []
        const tavilyKey = process.env.TAVILY_API_KEY?.trim()
        if (tavilyKey) {
          try {
            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: tavilyKey, query, max_results: num, search_depth: 'basic' }),
              signal: AbortSignal.timeout(30_000),
            })
            if (res.ok) {
              const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
              results = (json.results ?? []).map((r) => ({
                name: r.title ?? '(untitled)',
                url: r.url ?? '',
                snippet: r.content ?? '',
                host_name: r.url ? new URL(r.url).hostname : '',
              }))
            }
          } catch {
            // Tavily failed — fall back to the SDK search below
          }
        }
        if (!Array.isArray(results) || results.length === 0) {
          const zai = await getZAI()
          if (zai) {
            results = (await zai.functions.invoke('web_search', { query, num })) as unknown[]
          } else if (!tavilyKey) {
            return {
              ok: false,
              summary: 'Web search provider not configured',
              raw: 'Error: Web search requires TAVILY_API_KEY or a configured ZAI SDK.',
            }
          }
        }
        if (!Array.isArray(results) || results.length === 0) {
          return { ok: true, summary: `No results for "${query}"`, raw: 'No results found.' }
        }
        const items = results.slice(0, 8).map((raw) => {
          const r = raw as { name?: string; url?: string; snippet?: string; host_name?: string; date?: string }
          return {
            title: str(r.name, '(untitled)'),
            url: str(r.url),
            snippet: truncate(str(r.snippet), 300),
            host: str(r.host_name),
            date: str(r.date) || undefined,
          }
        })
        const raw = items.map((r, i) => `[${i + 1}] ${r.title} (${r.host})\n${r.url}\n${r.snippet}`).join('\n\n')
        return {
          ok: true,
          summary: `${items.length} results for "${query}"`,
          raw: truncate(raw, 6000),
          display: { kind: 'search', results: items },
        }
      }

      case 'read_url': {
        const url = str(args.url)
        const zai = await getZAI()
        if (zai) {
          const page = await zai.functions.invoke('page_reader', { url })
          const title = str(page?.data?.title, url)
          const text = truncate(stripHtml(str(page?.data?.html)), 4000)
          return {
            ok: true,
            summary: `Read page: ${title}`,
            raw: `PAGE: ${title}\nURL: ${url}\n\n${text}`,
            display: { kind: 'text', text: `Read "${title}" — ${text.length} chars extracted` },
          }
        }
        const res = await fetch(url, {
          headers: { 'User-Agent': 'NexusAgent/1.0', Accept: 'text/html,text/plain' },
          signal: AbortSignal.timeout(12000),
        })
        if (!res.ok) return { ok: false, summary: `Failed to read ${url}`, raw: `HTTP ${res.status}` }
        const html = await res.text()
        const title = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? url).trim()
        const text = truncate(stripHtml(html), 4000)
        return {
          ok: true,
          summary: `Read page: ${title}`,
          raw: `PAGE: ${title}\nURL: ${url}\n\n${text}`,
          display: { kind: 'text', text: `Read "${title}" — ${text.length} chars extracted` },
        }
      }

      case 'browse_site': {
        // lightweight browser use: read a page + follow related same-site links
        const startUrl = str(args.url)
        if (!/^https?:\/\//i.test(startUrl)) {
          return { ok: false, summary: 'Invalid URL', raw: 'Error: url must start with http:// or https://' }
        }
        const topic = str(args.topic).toLowerCase()
        const maxPages = Math.min(Math.max(Number(args.maxPages) || 3, 1), 3)

        /** direct fetch — fast, but some sites (e.g. Wikipedia) block non-browser clients */
        const fetchDirect = async (u: string): Promise<{ title: string; text: string; links: { href: string; label: string }[] } | null> => {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 9000)
          try {
            const res = await fetch(u, {
              signal: ctrl.signal,
              headers: { 'User-Agent': 'NexusAgent/1.0 (lightweight browser)', Accept: 'text/html' },
              redirect: 'follow',
            })
            if (!res.ok) return null
            const html = await res.text()
            return parsePage(u, html)
          } catch {
            return null
          } finally {
            clearTimeout(timer)
          }
        }

        /** SDK page_reader fallback — server-side rendering service, handles bot-blocking sites */
        const fetchViaReader = async (u: string): Promise<{ title: string; text: string; links: { href: string; label: string }[] } | null> => {
          try {
            const zai = await getZAI()
            if (!zai) return null
            const page = await zai.functions.invoke('page_reader', { url: u })
            const html = str(page?.data?.html)
            if (!html) return null
            return parsePage(str(page?.data?.title, u), html)
          } catch {
            return null
          }
        }

        /** html → { title, readable text, links } */
        const parsePage = (fallbackTitle: string, html: string): { title: string; text: string; links: { href: string; label: string }[] } => {
          const title = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? fallbackTitle).trim()
          const links: { href: string; label: string }[] = []
          const seen = new Set<string>()
          for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#\s]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
            const href = m[1]
            const label = stripHtml(m[2]).slice(0, 80)
            if (!href || seen.has(href)) continue
            seen.add(href)
            links.push({ href, label })
          }
          return { title, text: stripHtml(html), links }
        }

        // page 1: direct first, reader fallback (Wikipedia etc. block plain fetches)
        let first = await fetchDirect(startUrl)
        if (!first) first = await fetchViaReader(startUrl)
        if (!first) {
          return { ok: false, summary: `Could not open ${startUrl}`, raw: `Error: the page did not respond (timeout, blocked or non-HTML).` }
        }

        const origin = (() => {
          try {
            return new URL(startUrl).origin
          } catch {
            return ''
          }
        })()

        const pages: { url: string; title: string; text: string }[] = [
          { url: startUrl, title: first.title, text: first.text },
        ]

        // pick follow-up pages: same origin, topic-relevant (or content-rich), not the start page
        if (pages.length < maxPages) {
          const topicTerms = topic.split(/[^a-z0-9]+/).filter((t) => t.length > 2)
          const candidates = first.links
            .filter((l) => {
              try {
                const abs = new URL(l.href, startUrl)
                return abs.origin === origin && abs.href.split('#')[0] !== startUrl.split('#')[0]
              } catch {
                return false
              }
            })
            .map((l) => {
              const abs = (() => {
                try {
                  return new URL(l.href, startUrl).href
                } catch {
                  return ''
                }
              })()
              const haystack = (l.label + ' ' + abs).toLowerCase()
              const score =
                topicTerms.length > 0
                  ? topicTerms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0)
                  : /\b(guide|docs|about|tutorial|reference|overview|intro|how)\b/i.test(haystack)
                    ? 1
                    : 0
              return { url: abs, label: l.label, score }
            })
            .filter((c) => c.url && c.score > 0)
            .sort((a, b) => b.score - a.score)

          for (const c of candidates) {
            if (pages.length >= maxPages) break
            if (pages.some((p) => p.url === c.url)) continue
            const p = (await fetchDirect(c.url)) ?? (await fetchViaReader(c.url))
            if (p && p.text.length > 200) pages.push({ url: c.url, title: p.title, text: p.text })
          }
        }

        const raw = pages
          .map(
            (p, i) =>
              `[Page ${i + 1}] ${p.title}\nURL: ${p.url}\n\n${truncate(p.text, i === 0 ? 3500 : 2200)}`
          )
          .join('\n\n---\n\n')
        return {
          ok: true,
          summary: `Browsed ${pages.length} page${pages.length === 1 ? '' : 's'} from ${new URL(startUrl).host}`,
          raw: truncate(raw, 9000),
          display: {
            kind: 'text',
            text: `Browsed ${pages.length} pages: ${pages.map((p) => p.title.slice(0, 40)).join(' · ')}`,
          },
        }
      }

      case 'generate_image': {
        const zai = await getZAI()
        if (!zai) {
          return { ok: false, summary: 'Image generator unavailable', raw: 'Image generation requires ZAI SDK configuration.' }
        }
        const prompt = str(args.prompt)
        const size = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'].includes(
          str(args.size)
        )
          ? (str(args.size) as '1024x1024')
          : '1024x1024'
        const res = await zai.images.generations.create({ prompt, size })
        const b64 = res?.data?.[0]?.base64
        if (!b64) return { ok: false, summary: 'Image generation returned no data', raw: 'Image generation returned no data.' }
        const name = `img_${Date.now()}.png`
        await saveWorkspaceFile(name, Buffer.from(b64, 'base64'))
        const url = `/api/files?name=${name}`
        return {
          ok: true,
          summary: `Generated image: ${truncate(prompt, 80)}`,
          raw: `Image generated successfully and saved as ${name}. You can embed it with markdown: ![${prompt}](${url})`,
          display: { kind: 'image', url, prompt },
        }
      }

      case 'search_images': {
        const zai = await getZAI()
        if (!zai) {
          return { ok: false, summary: 'Image search unavailable', raw: 'Image search requires ZAI SDK configuration.' }
        }
        const query = str(args.query)
        const res = await zai.images.search.create({ query, count: 6 })
        if (!res?.results?.length) {
          return { ok: true, summary: `No images found for "${query}"`, raw: 'No images found.' }
        }
        const items = res.results.slice(0, 6).map((r) => ({
          url: str(r.original_url),
          caption: truncate(str(r.caption), 120) || undefined,
        }))
        const raw = items.map((r, i) => `[${i + 1}] ${r.url} ${r.caption ?? ''}`).join('\n')
        return {
          ok: true,
          summary: `${items.length} images for "${query}"`,
          raw: truncate(raw, 3000),
          display: { kind: 'images', items },
        }
      }

      case 'run_code': {
        const code = str(args.code)
        if (!code.trim()) return { ok: false, summary: 'Empty code', raw: 'Error: empty code.' }
        const { ok, output } = sandboxRunCode(code)
        return {
          ok,
          summary: ok ? 'Code executed' : 'Code finished with error',
          raw: truncate(`OUTPUT:\n${output}`, 4000),
          display: { kind: 'code', code: truncate(code, 1500), output: truncate(output, 2500), ok },
        }
      }

      case 'tts_speak': {
        const zai = await getZAI()
        if (!zai) {
          return { ok: false, summary: 'TTS unavailable', raw: 'Text-to-speech requires ZAI SDK configuration.' }
        }
        const text = str(args.text ?? args.input)
        if (!text.trim()) return { ok: false, summary: 'Empty text', raw: 'Error: empty text.' }
        const res = await zai.audio.tts.create({ input: text, response_format: 'wav', stream: false })
        const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()))
        if (buf.length < 100) return { ok: false, summary: 'TTS returned no audio', raw: 'TTS returned no audio.' }
        const name = `tts_${Date.now()}.wav`
        await saveWorkspaceFile(name, buf)
        const url = `/api/files?name=${name}`
        return {
          ok: true,
          summary: `Spoke ${text.length} chars`,
          raw: `Speech audio generated (${(buf.length / 1024).toFixed(0)} KB), available at ${url}`,
          display: { kind: 'audio', url, text: truncate(text, 300) },
        }
      }

      case 'computer_use': {
        // ---- COMPUTER USE (Anthropic-style, tiered) ----
        // read < write < destructive; destructive requires explicit user
        // confirmation; every command runs with shell:false (no injection),
        // a hard timeout, and capped output.
        const action = str(args.action, 'shell')

        if (action === 'read_file' || action === 'list_dir' || action === 'write_file') {
          const rel = str(args.path ?? args.name)
          if (!rel) return { ok: false, summary: 'Missing path', raw: 'Error: provide "path".' }
          try {
            if (action === 'read_file') {
              const abs = safeWorkspacePath(rel)
              if (!abs) return { ok: false, summary: 'Path outside workspace', raw: 'Error: path must stay inside the agent workspace.' }
              const text = await fs.readFile(abs, 'utf-8')
              return {
                ok: true,
                summary: `Read ${rel} (${text.length} chars)`,
                raw: truncate(text, 5000),
                display: { kind: 'text', text: `Read workspace file "${rel}" — ${text.length} chars` },
              }
            }
            if (action === 'list_dir') {
              const all = await listWorkspaceFiles()
              const prefix = rel.replace(/^\/+/, '').replace(/\/+$/, '')
              const files = prefix ? all.filter((f) => f.startsWith(`${prefix}/`) || f.startsWith(prefix)) : all
              const raw = files.length > 0 ? files.map((f, i) => `[${i + 1}] ${f}`).join('\n') : '(empty directory)'
              return {
                ok: true,
                summary: `${files.length} files in ${rel}`,
                raw: truncate(raw, 3000),
                display: { kind: 'files', files: files.slice(0, 30) },
              }
            }
            const content = str(args.content)
            if (!content) return { ok: false, summary: 'Missing content', raw: 'Error: provide "content".' }
            const abs = safeWorkspacePath(rel)
            if (!abs) return { ok: false, summary: 'Path outside workspace', raw: 'Error: path must stay inside the agent workspace.' }
            await fs.mkdir(path.dirname(abs), { recursive: true })
            await fs.writeFile(abs, content, 'utf-8')
            return {
              ok: true,
              summary: `Wrote ${rel} (${content.length} chars)`,
              raw: `File written: ${rel} (${content.length} chars, workspace-scoped).`,
              display: { kind: 'text', text: `Wrote workspace file "${rel}" — ${content.length} chars` },
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return { ok: false, summary: `${action} failed`, raw: `Error: ${msg}` }
          }
        }

        if (action === 'open_url') {
          const url = str(args.url)
          if (!/^https?:\/\//i.test(url)) {
            return { ok: false, summary: 'Invalid URL', raw: 'Error: url must start with http:// or https://' }
          }
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 12000)
          try {
            const res = await fetch(url, {
              signal: ctrl.signal,
              headers: { 'User-Agent': 'NexusAgent/1.0 (computer use)', Accept: 'text/html,application/json,text/plain' },
              redirect: 'follow',
            })
            const body = await res.text()
            const text = /<\/?[a-z][\s\S]*>/i.test(body.slice(0, 500)) ? stripHtml(body) : body
            return {
              ok: true,
              summary: `Opened ${url} (HTTP ${res.status})`,
              raw: `HTTP ${res.status} ${res.statusText}\n\n${truncate(text, 4500)}`,
              display: { kind: 'text', text: `Opened ${url} — HTTP ${res.status}, ${text.length} chars` },
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return { ok: false, summary: `Could not open ${url}`, raw: `Error: ${msg}` }
          } finally {
            clearTimeout(timer)
          }
        }

        // ---- action: shell ----
        const command = str(args.command ?? args.cmd)
        if (!command.trim()) return { ok: false, summary: 'Missing command', raw: 'Error: provide "command".' }

        // shell-free argv split (single/double quoted segments respected)
        const argv: string[] = []
        const cmdRegex = /"([^"]*)"|'([^']*)'|(\S+)/g
        for (const m of command.matchAll(cmdRegex)) {
          argv.push(m[1] ?? m[2] ?? m[3])
        }
        if (argv.length === 0) return { ok: false, summary: 'Empty command', raw: 'Error: empty command.' }

        const program = path.basename(argv[0])
        // never run, no exceptions
        const BANNED = new Set(['sudo', 'su', 'shutdown', 'reboot', 'kill', 'pkill', 'mkfs', 'dd', 'crontab', 'passwd', 'chsh', 'visudo'])
        if (BANNED.has(program)) {
          return { ok: false, summary: 'Command blocked', raw: `Error: "${program}" is on the never-run list (system safety).` }
        }

        // tier classification
        const WRITE_CMDS = new Set(['mkdir', 'touch', 'cp', 'mv', 'tee', 'node', 'python3', 'python', 'bun', 'git', 'curl', 'wget', 'npm', 'npx', 'pip', 'pip3'])
        const DESTRUCTIVE_CMDS = new Set(['rm', 'rmdir', 'chmod', 'chown'])
        const isWrite = WRITE_CMDS.has(program)
        const isDestructive =
          DESTRUCTIVE_CMDS.has(program) ||
          (program === 'npm' && /(^install$|^i$|^add$)/.test(argv[1] ?? '')) ||
          (program === 'pip' && (argv[1] ?? '') === 'install') ||
          (program === 'git' && /^(push|reset|clean|checkout\s--)/.test(argv.slice(1).join(' '))) ||
          (program === 'curl' && /-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-T\s/.test(command))

        if (isDestructive && args.confirm !== true) {
          return {
            ok: false,
            summary: `Needs confirmation: ${truncate(command, 80)}`,
            raw: `This is a destructive/system-changing action. Ask the user for confirmation first; if they agree, re-run with "confirm": true.`,
            display: { kind: 'text', text: `⚠ "${truncate(command, 90)}" needs your confirmation before running (destructive tier).` },
          }
        }

        // execute with shell:false → no injection, hard timeout, capped output
        const { spawn } = await import('child_process')
        const result = await new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
          const child = spawn(argv[0], argv.slice(1), {
            cwd: WORKSPACE_DIR,
            shell: false,
            env: {
              PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
              HOME: WORKSPACE_DIR,
              LANG: 'C.UTF-8',
            } as unknown as NodeJS.ProcessEnv,
            timeout: 10_000,
          })
          let stdout = ''
          let stderr = ''
          let timedOut = false
          child.stdout?.on('data', (d) => { if (stdout.length < 9000) stdout += String(d) })
          child.stderr?.on('data', (d) => { if (stderr.length < 4000) stderr += String(d) })
          child.on('error', (err) => resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut: false }))
          child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, timedOut }))
          setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 11_000)
        })

        const tier = isDestructive ? 'destructive' : isWrite ? 'write' : 'read'
        const out = [result.stdout.trim(), result.stderr.trim() && `STDERR: ${result.stderr.trim()}`].filter(Boolean).join('\n')
        return {
          ok: result.code === 0,
          summary: `${program} exited ${result.code} [${tier}]`,
          raw: `$ ${command}\n${result.timedOut ? '(timed out after 10s)\n' : ''}${truncate(out, 4500) || '(no output)'}`,
          display: { kind: 'code', code: command, output: truncate(out, 1200) || '(no output)', ok: result.code === 0 },
        }
      }

      case 'translate':
      case 'doc_write': {
        const plugin = await db.plugin.findFirst({ where: { toolSlug: slug } })
        let instructions = BUILTIN_TOOL_SPECS[slug]?.description ?? 'Process the input.'
        if (plugin) {
          try {
            const cfg = JSON.parse(plugin.configJson) as { instructions?: string }
            if (cfg.instructions) instructions = cfg.instructions
          } catch { /* keep default */ }
        }
        const input =
          slug === 'translate'
            ? `Translate this text to ${str(args.target_language, 'English')}:\n\n${str(args.text)}`
            : `Topic: ${str(args.topic ?? args.input)}\nRequirements: ${str(args.requirements, 'none')}`
        const out = await chatText(
          [
            { role: 'system', content: instructions },
            { role: 'user', content: input },
          ],
          { temperature: 0.5 }
        )
        return {
          ok: true,
          summary: `${BUILTIN_TOOL_SPECS[slug]?.name ?? slug} completed`,
          raw: truncate(out, 6000),
          display: { kind: 'text', text: truncate(out, 1200) },
        }
      }

      case 'save_memory': {
        const content = str(args.content ?? args.text)
        if (!content.trim()) return { ok: false, summary: 'Empty memory', raw: 'Error: empty memory content.' }
        const type = ['fact', 'preference', 'insight', 'decision', 'note'].includes(str(args.type))
          ? str(args.type)
          : 'note'
        // GBRAIN write path: dedup → truth → conflicts → entity resolution
        try {
          const { saveMemoryGbrain } = await import('@/lib/agent/gbrain-store')
          const res = await saveMemoryGbrain({
            content: truncate(content, 400),
            type,
            kind: type === 'fact' || type === 'decision' ? 'semantic' : type === 'insight' ? 'semantic' : 'episodic',
            importance: type === 'decision' ? 7 : type === 'fact' ? 6 : type === 'insight' ? 6 : 3,
            runId,
          })
          const parts: string[] = [type]
          if (res.deduplicated) parts.push('refreshed an existing memory')
          if (res.newEntities.length > 0) parts.push(`${res.newEntities.length} new graph nodes`)
          if (res.conflicts.length > 0) parts.push(`${res.conflicts.length} stale fact${res.conflicts.length === 1 ? '' : 's'} superseded`)
          if (res.entities.length > 0) parts.push(`${res.entities.length} names resolved`)
          return {
            ok: true,
            summary: `Memory saved (${parts.join(', ')})`,
            raw: `Memory saved: ${content}`,
            display: { kind: 'text', text: `Saved to app memory [${parts.join(', ')}]: ${truncate(content, 200)}` },
          }
        } catch {
          // gbrain path is best-effort — plain save fallback
          const { indexMemory } = await import('@/lib/agent/memory-graph-store')
          const row = await db.memory.create({
            data: {
              content: truncate(content, 400),
              type,
              kind: type === 'fact' || type === 'decision' ? 'semantic' : type === 'insight' ? 'semantic' : 'episodic',
              source: 'agent',
              runId,
              conversationId,
              importance: type === 'decision' ? 7 : type === 'fact' ? 6 : type === 'insight' ? 6 : 3,
            },
          })
          const indexed = await indexMemory(row.id, row.content).catch(() => ({ entities: 0, edges: 0 }))
          return {
            ok: true,
            summary: `Memory saved (${type}${indexed.entities > 0 ? `, ${indexed.entities} entities in graph` : ''})`,
            raw: `Memory saved: ${content}`,
            display: { kind: 'text', text: `Saved to app memory [${type}]: ${truncate(content, 200)}` },
          }
        }
      }

      case 'recall_memory': {
        const query = str(args.query)
        if (!query.trim()) return { ok: false, summary: 'Empty query', raw: 'Error: empty recall query.' }
        const limit = Math.min(Math.max(Number(args.limit) || 4, 1), 8)

        // GRAPH-FIRST: walk the entity graph (PPR) under a token budget —
        // only the activated memories are read; keyword recall is the fallback.
        const { graphRecallMemories, touchRecalledMemories } = await import('@/lib/agent/memory-graph-store')
        let recalledLines: string[] = []
        let via = 'graph'
        try {
          const g = await graphRecallMemories(query, { limit, tokenBudget: 700 })
          if (g.recalled.length > 0) {
            recalledLines = g.recalled.map(
              (r) => `[${r.cite}] (${r.type}) ${r.content}${r.trail.length ? ` — via ${r.trail.join(' → ')}` : ''}`
            )
            await touchRecalledMemories(g.recalled.map((r) => r.id))
          }
        } catch {
          // graph recall is best-effort
        }
        if (recalledLines.length === 0) {
          via = 'keyword'
          const { isSupersededMemory } = await import('@/lib/agent/memory-graph-store')
          const memories = (
            await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 150 })
          ).filter((m) => !isSupersededMemory(m)) // stale facts are history, not recall
          const recalled = recallMemories(
            memories.map((m) => ({ id: m.id, content: m.content, type: m.type, createdAt: new Date(m.createdAt).toISOString(), importance: m.importance, strength: m.strength, accessCount: m.accessCount, lastAccessedAt: m.lastAccessedAt ? new Date(m.lastAccessedAt).toISOString() : undefined })),
            query,
            { limit }
          )
          recalledLines = recalled.map(
            (r) => `[${r.cite}] (${r.type}, score ${r.score.toFixed(2)}) ${r.content} — matched: ${r.matchedTerms.join(', ')}`
          )
        }
        if (recalledLines.length === 0) {
          return {
            ok: true,
            summary: `No memories match "${truncate(query, 60)}"`,
            raw: `No memories matched the recall query "${query}".`,
            display: { kind: 'text', text: `Memory recall: nothing found for "${truncate(query, 60)}"` },
          }
        }
        return {
          ok: true,
          summary: `${recalledLines.length} memories recalled (${via})`,
          raw: `RECALLED MEMORIES for "${query}" [${via} memory]:\n${recalledLines.join('\n')}`,
          display: {
            kind: 'text',
            text: `Recalled ${recalledLines.length} memories via ${via} memory:\n${recalledLines.map((l) => `· ${truncate(l, 110)}`).join('\n')}`,
          },
        }
      }

      case 'graph_query': {
        const mode = ['neighbors', 'path', 'stats', 'rabbit'].includes(str(args.mode)) ? str(args.mode) : 'stats'
        const target = str(args.target ?? args.query ?? '')
        const target2 = str(args.target2 ?? '')
        if (mode === 'neighbors' && !target) {
          return { ok: false, summary: 'Missing target', raw: 'Error: neighbors mode requires a "target" concept name.' }
        }
        if (mode === 'path' && (!target || !target2)) {
          return { ok: false, summary: 'Missing targets', raw: 'Error: path mode requires "target" and "target2" concept names.' }
        }
        if (mode === 'rabbit') {
          // associative deep-dive through memory: follow the surprising edges
          if (!target) return { ok: false, summary: 'Missing topic', raw: 'Error: rabbit mode requires a "target" topic.' }
          const { exploreRabbitHole } = await import('@/lib/agent/memory-graph-store')
          const rendered = await exploreRabbitHole(target)
          return {
            ok: true,
            summary: `Rabbit hole from "${truncate(target, 40)}"`,
            raw: truncate(rendered, 4000),
            display: { kind: 'text', text: truncate(rendered, 1000) },
          }
        }
        const graph = await buildAppGraph()
        const rendered = renderQueryResult(graph, mode, target, target2 || undefined)
        return {
          ok: true,
          summary: `Graph query (${mode})`,
          raw: truncate(rendered, 4000),
          display: { kind: 'text', text: truncate(rendered, 900) },
        }
      }

      case 'weather_lookup': {
        const location = str(args.location ?? args.place ?? args.city)
        if (!location.trim()) return { ok: false, summary: 'Missing location', raw: 'Error: weather_lookup needs a "location".' }

        // 1) geocode the place name (Open-Meteo geocoding, no API key)
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
          { cache: 'no-store', signal: AbortSignal.timeout(8000) }
        )
        if (!geoRes.ok) return { ok: false, summary: 'Geocoding failed', raw: `Error: geocoding service responded ${geoRes.status}.` }
        const geo = (await geoRes.json()) as {
          results?: { latitude: number; longitude: number; name: string; country?: string; admin1?: string }[]
        }
        const place = geo.results?.[0]
        if (!place) return { ok: false, summary: `Place "${location}" not found`, raw: `Error: could not find a place named "${location}".` }

        // 2) current conditions + 3-day forecast
        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
            '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto',
          { cache: 'no-store', signal: AbortSignal.timeout(8000) }
        )
        if (!wxRes.ok) return { ok: false, summary: 'Weather service failed', raw: `Error: weather service responded ${wxRes.status}.` }
        const wx = (await wxRes.json()) as {
          current?: Record<string, number>
          daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
        }
        const cur = wx.current ?? {}
        const desc = WMO_WEATHER[cur.weather_code] ?? 'unknown'
        const city = `${place.name}${place.admin1 && place.admin1 !== place.name ? ', ' + place.admin1 : ''}${place.country ? ', ' + place.country : ''}`
        const daily = wx.daily
          ? wx.daily.time
              .map((d, i) => `${d}: ${WMO_WEATHER[wx.daily!.weather_code[i]] ?? '?'}, ${wx.daily!.temperature_2m_min[i]}–${wx.daily!.temperature_2m_max[i]}°C`)
              .join('\n')
          : ''
        const raw = [
          `WEATHER — ${city}`,
          `Now: ${cur.temperature_2m ?? '?'}°C (feels like ${cur.apparent_temperature ?? '?'}°C), ${desc}`,
          `Humidity: ${cur.relative_humidity_2m ?? '?'}% · Wind: ${cur.wind_speed_10m ?? '?'} km/h · Precipitation: ${cur.precipitation ?? 0} mm`,
          daily ? `\n3-day forecast:\n${daily}` : '',
        ]
          .filter(Boolean)
          .join('\n')
        return {
          ok: true,
          summary: `${city}: ${cur.temperature_2m ?? '?'}°C, ${desc}`,
          raw,
          display: {
            kind: 'weather',
            place: city,
            temperature: cur.temperature_2m,
            feelsLike: cur.apparent_temperature,
            condition: desc,
            humidity: cur.relative_humidity_2m,
            windKmh: cur.wind_speed_10m,
            forecast: (wx.daily?.time ?? []).slice(0, 3).map((d, i) => ({
              date: d,
              condition: WMO_WEATHER[wx.daily!.weather_code[i]] ?? '?',
              min: wx.daily!.temperature_2m_min[i],
              max: wx.daily!.temperature_2m_max[i],
            })),
          },
        }
      }

      case 'wikipedia_search': {
        const query = str(args.query ?? args.topic)
        if (!query.trim()) return { ok: false, summary: 'Missing query', raw: 'Error: wikipedia_search needs a "query".' }
        const limit = Math.min(Math.max(Number(args.limit) || 4, 1), 6)

        const wikiHeaders = { 'User-Agent': 'nexus-agent/1.0' }
        const fetchJsonSafe = async (url: string, timeoutMs: number): Promise<unknown | null> => {
          try {
            const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: wikiHeaders })
            const ct = res.headers.get('content-type') ?? ''
            if (!res.ok || !ct.includes('json')) return null
            return (await res.json()) as unknown
          } catch {
            return null
          }
        }

        // 1) action API search (may be rate-limited/blocked on some networks)
        const search = (await fetchJsonSafe(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`,
          8000
        )) as { query?: { search?: { title: string; snippet: string }[] } } | null
        let titles: { title: string; snippet: string }[] = search?.query?.search ?? []

        // 2) fallback: treat the query as a page title via the REST summary API
        //    (this endpoint is reachable even when search endpoints are blocked)
        if (titles.length === 0) {
          const pageTitle = query.trim().replace(/\s+/g, ' ')
          const sum = (await fetchJsonSafe(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
            6000
          )) as { title?: string; extract?: string; type?: string } | null
          if (sum?.title && sum.type !== 'disambiguation' && sum.extract) {
            titles = [{ title: sum.title, snippet: sum.extract }]
          }
        }

        // 3) last resort: route through the SDK's web search filtered to
        //    Wikipedia (bypasses networks where direct API access to
        //    wikipedia.org is TLS-fingerprint-blocked)
        if (titles.length === 0) {
          try {
            const zai = await getZAI()
            const results = zai
              ? ((await zai.functions.invoke('web_search', { query: `${query} site:en.wikipedia.org`, num: 8 })) as unknown)
              : null
            if (Array.isArray(results)) {
              for (const r of results) {
                const url = str(r.url)
                if (!url.includes('en.wikipedia.org/wiki/')) continue
                const title =
                  decodeURIComponent(url.split('/wiki/')[1] ?? '')
                    .replace(/_/g, ' ')
                    .replace(/#.*$/, '') || str(r.name, 'Wikipedia article')
                titles.push({ title, snippet: str(r.snippet) })
                if (titles.length >= limit) break
              }
            }
          } catch {
            // SDK search unavailable — fall through to the error below
          }
        }

        if (titles.length === 0) {
          return {
            ok: false,
            summary: 'Wikipedia unavailable',
            raw: 'Error: Wikipedia search is unreachable from this network (search endpoints blocked and the query is not an exact page title). Try web_search instead.',
          }
        }

        // 4) enrich hits with real summaries (REST API, best-effort)
        const items: { title: string; url: string; snippet: string }[] = []
        for (const h of titles.slice(0, limit)) {
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`
          let snippet = (h.snippet ?? '').replace(/<[^>]+>/g, '')
          const sum = (await fetchJsonSafe(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
            5000
          )) as { extract?: string } | null
          if (sum?.extract) snippet = sum.extract
          items.push({ title: h.title, url, snippet: truncate(snippet, 320) })
        }

        const raw = items.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
        return {
          ok: true,
          summary: `${items.length} Wikipedia article${items.length === 1 ? '' : 's'} for "${truncate(query, 50)}"`,
          raw: truncate(`WIKIPEDIA RESULTS for "${query}":\n\n${raw}`, 6000),
          display: { kind: 'search', results: items.map((r) => ({ ...r, host: 'en.wikipedia.org' })) },
        }
      }

      case 'create_chart': {
        const title = str(args.title, 'Chart')
        const type = ['bar', 'line', 'pie'].includes(str(args.type)) ? (str(args.type) as 'bar' | 'line' | 'pie') : 'bar'
        const labels = (Array.isArray(args.labels) ? args.labels : []).map((l) => str(l)).filter(Boolean).slice(0, 12)
        const values = (Array.isArray(args.values) ? args.values : []).map((v) => Number(v)).filter((v) => Number.isFinite(v)).slice(0, 12)
        if (labels.length < 2 || values.length < 2 || labels.length !== values.length) {
          return {
            ok: false,
            summary: 'Invalid chart data',
            raw: 'Error: create_chart needs parallel "labels" and "values" arrays (2–12 entries each).',
          }
        }
        const svg = buildChartSvg({ title, type, labels, values })
        const name = `chart_${Date.now()}.svg`
        await saveWorkspaceFile(name, Buffer.from(svg, 'utf-8'))
        const url = `/api/files?name=${name}`
        return {
          ok: true,
          summary: `Chart created: ${truncate(title, 70)} (${type}, ${values.length} points)`,
          raw: `Chart "${title}" (${type}) created with ${values.length} data points and saved as ${name}. Embed it with markdown: ![${title}](${url})`,
          display: { kind: 'image', url, prompt: `${title} — ${type} chart` },
        }
      }

      // ---- MCP builtin handlers ----
      case 'fs.list_files': {
        const files = await listWorkspaceFiles()
        return {
          ok: true,
          summary: `${files.length} files in workspace`,
          raw: files.length ? `Workspace files:\n${files.join('\n')}` : 'Workspace is empty.',
          display: { kind: 'files', files: files.slice(0, 60) },
        }
      }
      case 'fs.read_file': {
        const p = safeWorkspacePath(str(args.path))
        if (!p) return { ok: false, summary: 'Invalid path', raw: 'Error: invalid path.' }
        const content = await fs.readFile(p, 'utf-8')
        return {
          ok: true,
          summary: `Read ${str(args.path)}`,
          raw: truncate(content, 6000),
          display: { kind: 'text', text: truncate(content, 800) },
        }
      }
      case 'fs.write_file': {
        const p = safeWorkspacePath(str(args.path))
        if (!p) return { ok: false, summary: 'Invalid path', raw: 'Error: invalid path.' }
        const content = str(args.content)
        await saveWorkspaceFile(str(args.path), Buffer.from(content, 'utf-8'))
        return {
          ok: true,
          summary: `Wrote ${str(args.path)} (${content.length} chars)`,
          raw: `File written: ${str(args.path)} (${content.length} chars)`,
          display: { kind: 'files', files: [str(args.path)] },
        }
      }
      case 'time.get_datetime': {
        const now = new Date()
        const iso = now.toISOString()
        return {
          ok: true,
          summary: iso,
          raw: `Current UTC datetime: ${iso}\n(Unix ms: ${now.getTime()})`,
          display: { kind: 'text', text: `Current UTC datetime: ${iso}` },
        }
      }
      case 'time.get_environment': {
        const info = `Platform: ${process.platform} | Node ${process.version} | CWD: ${process.cwd()} | Workspace: ${WORKSPACE_DIR} | PID ${process.pid}`
        return { ok: true, summary: 'Environment info', raw: info, display: { kind: 'text', text: info } }
      }

      default: {
        // ---- Custom plugins & simulated MCP tools ----
        const plugin = await db.plugin.findFirst({ where: { toolSlug: slug, installed: true } })
        if (plugin) {
          let cfg: { type?: string; instructions?: string; endpoint?: string } = {}
          try {
            cfg = JSON.parse(plugin.configJson) as typeof cfg
          } catch { /* ignore */ }
          const input = str(args.input ?? args.text ?? args.query ?? JSON.stringify(args))
          if (cfg.type === 'http' && cfg.endpoint) {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 10000)
            try {
              const res = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input, args }),
                signal: controller.signal,
              })
              const text = await res.text()
              return {
                ok: res.ok,
                summary: `${plugin.name}: HTTP ${res.status}`,
                raw: truncate(text, 4000),
                display: { kind: 'text', text: truncate(text, 1200) },
              }
            } finally {
              clearTimeout(timer)
            }
          }
          // llm-type custom plugin
          const out = await chatText(
            [
              {
                role: 'system',
                content: `${cfg.instructions ?? `You are the "${plugin.name}" tool. ${plugin.description}`}\nRespond with the tool output only, no preamble.`,
              },
              { role: 'user', content: input },
            ],
            { temperature: 0.5 }
          )
          return {
            ok: true,
            summary: `${plugin.name} completed`,
            raw: truncate(out, 4000),
            display: { kind: 'text', text: truncate(out, 1200) },
          }
        }

        // Simulated MCP tool (custom MCP server added by user)
        if (slug.includes('.')) {
          const prefix = slug.split('.')[0]
          const servers = await db.mcpServer.findMany()
          const server = servers.find((s) => s.slug === prefix)
          if (server) {
            let tools: { slug: string; name: string; description: string }[] = []
            try {
              tools = JSON.parse(server.toolsJson) as typeof tools
            } catch { /* ignore */ }
            const toolDef = tools.find((t) => t.slug === slug)
            const input = str(args.input ?? args.text ?? args.query ?? JSON.stringify(args))
            const out = await chatText(
              [
                {
                  role: 'system',
                  content: `You are the tool "${toolDef?.name ?? slug}" from MCP server "${server.name}". Tool description: ${toolDef?.description ?? server.description}. Produce a realistic, useful result for the given input. Respond with the result only.`,
                },
                { role: 'user', content: input },
              ],
              { temperature: 0.5 }
            )
            return {
              ok: true,
              summary: `${server.name} · ${toolDef?.name ?? slug}`,
              raw: truncate(out, 4000),
              display: { kind: 'text', text: truncate(out, 1200) },
            }
          }
        }

        return { ok: false, summary: `Unknown tool: ${slug}`, raw: `Error: unknown tool "${slug}".` }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, summary: `${slug} failed`, raw: `Tool error: ${msg}`, display: { kind: 'text', text: `Error: ${msg}` } }
  }
}

export function isMcpBuiltinHandler(slug: string): boolean {
  return MCP_BUILTIN_HANDLERS.has(slug)
}

export function workspacePath() {
  return WORKSPACE_DIR
}

export const workspaceDirName = path.basename(WORKSPACE_DIR)
