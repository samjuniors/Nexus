import { promises as fs } from 'fs'
import os from 'node:os'
import vm from 'node:vm'
import path from 'path'
import { GoogleGenAI } from '@google/genai'
import { db } from '@/lib/db'
import { chatText, getZAI } from '@/lib/agent/zai'
import { controlBus } from '@/lib/agent/control-bus'
import { liveBrowser } from '@/lib/agent/browser-manager'
import { getCapabilityPolicy, requireCapabilityPermission } from '@/lib/agent/permissions'
import { verifyActionHash } from '@/lib/agent/action-binding'
import { listConnectedDevices } from '@/lib/agent/device-bridge'
import { terminalManager } from '@/lib/agent/terminal-manager'
import type { TerminalShellKind, TerminalTarget } from '@/lib/agent/terminal-types'
import {
  getAgentIdentity,
  listAgentInbox,
  provisionAgentEmail,
  readAgentInboxMessage,
  waitForVerificationCode,
} from '@/lib/agent/agent-identity'
import { recallMemories } from '@brain/index'
import { buildAppGraph } from '@/lib/agent/graph-source'
import { renderQueryResult } from '@brain/index'
import {
  listWorkspaceFiles,
  safeWorkspacePath,
  saveWorkspaceFile,
  WORKSPACE_DIR,
} from '@/lib/agent/workspace'
import {
  buildVectorIllustrationPrompts,
  extractAndSanitizeSvg,
  parseWikimediaImageResponse,
  rasterizeSvgToPng,
  resolveImageDimensions,
} from '@/lib/agent/image-gen'
import {
  fetchPublicExternalUrl,
  resolvePublicExternalUrl,
  SsrfBlockedError,
} from '@/lib/agent/product-source-ingest'
import type { EffectiveTool, ToolExecResult } from '@/lib/agent/types'

function createServerGemini(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) return null
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  })
}

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
      description: 'Create an original AI illustration/image from a text prompt and save it as a PNG artifact.',
      argSpec: '{"prompt": string, "size"?: "1024x1024"|"1344x768"|"768x1344"|"1152x864"|"864x1152"|"1440x720", "aspectRatio"?: "1:1"|"16:9"|"9:16"|"4:3"|"3:4"}',
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
    inspect_project: {
      name: 'Inspect Project',
      description:
        'Scan the repository stack, Prisma data models, API routes, and portable brain modules, and optionally index architectural truths into the portable GBrain.',
      argSpec: '{"indexIntoBrain"?: boolean}',
    },
    manage_org: {
      name: 'Manage Org',
      description:
        'Manage AI employees, custom bots, and subagents reporting to Eva: list team, review performance/gaps, hire AI employee, create bot, create persistent subagent, delegate a focused task, or remove.',
      argSpec:
        '{"action": "list"|"review"|"hire"|"create_bot"|"create_subagent"|"delegate"|"remove", "id"?: string, "name"?: string, "title"?: string, "department"?: string, "role"?: string, "systemPrompt"?: string, "reportsTo"?: string, "skills"?: string[], "tools"?: string[], "task"?: string, "focus"?: string}',
    },
    manage_automation: {
      name: 'Manage Automation',
      description:
        'List, create, toggle, run immediately, or delete scheduled recurring/cron/one-shot automations.',
      argSpec:
        '{"action": "list"|"create"|"toggle"|"run_now"|"delete", "id"?: string, "name"?: string, "description"?: string, "prompt"?: string, "triggerType"?: "interval"|"cron"|"once", "schedule"?: string, "assigneeName"?: string, "enabled"?: boolean}',
    },
    create_skill: {
      name: 'Create Skill',
      description: 'Create or update a reusable Agent Skill instruction pack.',
      argSpec: '{"name": string, "description": string, "prompt": string, "category"?: string}',
    },
    browser_control: {
      name: 'Live Browser Control',
      description:
        'Control a real server-side Playwright browser streamed live in the split-screen panel. Use "play_media" for songs/videos on YouTube (streams real interactive audio & video), "autopilot" for multi-step web goals completed end-to-end automatically, or single actions (navigate, click, type, scroll, press, back, reload, snapshot, clear_media, close).',
      argSpec:
        '{"action": "play_media"|"autopilot"|"navigate"|"click"|"type"|"scroll"|"press"|"back"|"reload"|"snapshot"|"clear_media"|"close", "query"?: string, "goal"?: string, "url"?: string, "maxSteps"?: number, "selector"?: string, "text"?: string, "x"?: number, "y"?: number, "submit"?: boolean, "key"?: string, "deltaY"?: number}',
    },
    agent_email: {
      name: 'Eva Autonomous Email & Inbox',
      description:
        'Manage Eva\'s own persistent email address and live inbox so Eva can autonomously sign up, verify accounts, read incoming emails, and extract OTP verification codes/links without asking the user.',
      argSpec:
        '{"action": "provision"|"status"|"list_inbox"|"read_message"|"wait_for_code", "preferredLocal"?: string, "forceNew"?: boolean, "messageId"?: string, "senderFilter"?: string, "timeoutMs"?: number}',
    },
    app_control: {
      name: 'App UI Self-Control',
      description:
        'Control the Nexus Agent OS interface visually with an animated live cursor: switch tabs, open or close split-screen panels (reasoning, self_heal, browser, terminal, google_workspace, mobile, identity, permissions, devices, org, artifacts, tools, automations, brain), switch between standard and Voice Focus layout modes, collapse/expand the sidebar rail, open the interactive GBrain graph, show popups, click buttons/targets, or toggle light/dark theme.',
      argSpec:
        '{"action": "navigate_tab"|"open_split"|"close_split"|"set_layout_mode"|"toggle_sidebar"|"open_gbrain_graph"|"open_popup"|"close_popup"|"click_target"|"set_theme", "tab"?: string, "mode"?: "reasoning"|"self_heal"|"browser"|"terminal"|"google_workspace"|"mobile"|"identity"|"permissions"|"devices"|"org"|"artifacts"|"tools"|"automations"|"brain"|"standard"|"focus", "collapsed"?: boolean, "title"?: string, "body"?: string, "selector"?: string, "label"?: string, "theme"?: "light"|"dark", "url"?: string}',
    },
    mobile_control: {
      name: 'Android & Mobile Device Takeover',
      description:
        'Take over and automate an Android/mobile phone just like Computer Use or Browser Use: run multi-step "autopilot" goals end-to-end, open apps (settings, messages, phone, chrome, notes, camera, calendar, maps), tap coordinates or targets, swipe/scroll, type text or SMS replies, press Android keys (home, back, recents), pull down notifications, toggle quick settings (wifi, bluetooth, dnd, airplane, flashlight), or open URLs on the Live Android Viewport or a paired ADB Android phone.',
      argSpec:
        '{"action": "autopilot"|"status"|"list_apps"|"open_app"|"tap"|"long_press"|"swipe"|"scroll"|"type"|"press_key"|"open_url"|"notifications"|"toggle_setting"|"screenshot"|"select_device", "goal"?: string, "app"?: string, "target"?: string, "x"?: number, "y"?: number, "direction"?: "up"|"down"|"left"|"right", "text"?: string, "key"?: "home"|"back"|"recents"|"enter", "setting"?: "wifi"|"bluetooth"|"dnd"|"airplane"|"flashlight", "enabled"?: boolean, "url"?: string, "open"?: boolean, "deviceId"?: string}',
    },
    self_manage_extensions: {
      name: 'Self-Install & Manage Extensions',
      description:
        'Autonomously list, install, uninstall, enable, or disable Plugins, Skills, Tools, and MCP servers so the user never has to install extensions manually. Protected by a one-time Allow Always permission.',
      argSpec:
        '{"action": "list"|"install_plugin"|"uninstall_plugin"|"toggle_plugin"|"toggle_skill"|"toggle_tool"|"connect_mcp"|"disconnect_mcp", "slug"?: string, "enabled"?: boolean}',
    },
    device_control: {
      name: 'Windows PC & Desktop Control',
      description:
        'Full native desktop computer control on the automatically connected host PC (and paired devices): capture live screen, list/focus windows, launch allowlisted apps, mouse click/type/hotkey/paste text, manage files inside Connected Folders (list_folder, read_file, write_file, move_file), batch-analyze local folder images with Gemini Vision, open URLs, or run shell/PowerShell commands. Your host computer is ALREADY fully connected out of the box — no companion app or external bridge is needed.',
      argSpec:
        '{"action": "list"|"system_info"|"screen_capture"|"window_list"|"focus_window"|"open_url"|"open_app"|"ui_click"|"ui_type"|"ui_hotkey"|"paste_text"|"list_folder"|"read_file"|"write_file"|"move_file"|"analyze_folder_images"|"shell", "deviceId"?: string, "url"?: string, "app"?: string, "title"?: string, "x"?: number, "y"?: number, "text"?: string, "keys"?: string, "path"?: string, "from"?: string, "to"?: string, "content"?: string, "prompt"?: string, "command"?: string}',
    },
    terminal_exec: {
      name: 'Real Terminal & PowerShell',
      description:
        'Execute REAL OS shell commands (native Windows PowerShell directly on the host computer or on a paired Windows PC) streamed live into the Terminal split panel. Never fakes or simulates output. Use this to install software/packages (via winget, npm, pip, choco, git, etc.), run scripts, inspect files, or manage the OS with user permission approval. Also supports "pair_windows" for external machines, "status", "set_target", "interrupt", and "clear".',
      argSpec:
        '{"action": "exec"|"status"|"pair_windows"|"set_target"|"interrupt"|"clear", "command"?: string, "target"?: "auto"|"windows_pc"|"host", "shell"?: "powershell"|"pwsh"|"bash"|"sh", "deviceId"?: string, "deviceName"?: string, "cwd"?: string, "timeoutMs"?: number}',
    },
    self_heal_code: {
      name: 'Self-Healing Code & App Repair',
      description:
        'Inspect Eva\'s own Next.js/TypeScript source code, apply surgical verified code patches with automatic pre-patch snapshots and rollback protection, run TypeScript build verification, or trigger autonomous error repair. Use this whenever a bug occurs or a requested app feature needs real code changes after one-time approval.',
      argSpec:
        '{"action": "inspect"|"patch"|"verify"|"rollback"|"auto_heal", "mode"?: "list"|"search"|"read", "path"?: string, "query"?: string, "startLine"?: number, "endLine"?: number, "title"?: string, "errorMessage"?: string, "edits"?: [{"path": string, "mode": "replace"|"write", "target"?: string, "replacement"?: string, "content"?: string, "summary"?: string}], "verify"?: boolean, "sessionId"?: string, "testFile"?: string}',
    },
    composio_action: {
      name: 'Composio Connected Apps',
      description:
        'List connected accounts/tools or execute external app actions (Gmail, Slack, GitHub, Notion, Stripe, etc.) via Composio configured in Settings > Connect.',
      argSpec:
        '{"action": "list_accounts"|"list_tools"|"execute", "toolSlug"?: string, "toolkit"?: string, "connectedAccountId"?: string, "input"?: object}',
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
    await db.tool.updateMany({ where: { slug }, data: { usageCount: { increment: 1 } } })
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
  // Run inside an isolated VM context with codeGeneration disabled and zero host
  // objects/functions passed in, preventing prototype-chain escapes like
  // console.log.constructor('return process')().
  const wrapped = `
    "use strict";
    const __logs = [];
    const __fmt = (v) => {
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
    };
    const console = {
      log: (...a) => __logs.push(a.map(__fmt).join(' ')),
      info: (...a) => __logs.push(a.map(__fmt).join(' ')),
      warn: (...a) => __logs.push(a.map(__fmt).join(' ')),
      error: (...a) => __logs.push(a.map(__fmt).join(' ')),
    };
    let __ret;
    let __err = null;
    try {
      __ret = (function(){\n${code}\n})();
    } catch (e) {
      __err = e && e.message ? String(e.message) : String(e);
    }
    JSON.stringify({
      ok: __err === null,
      logs: __logs.slice(0, 200),
      ret: __ret === undefined ? null : __fmt(__ret),
      hasRet: __ret !== undefined,
      err: __err,
    });
  `
  try {
    const script = new vm.Script(wrapped)
    const ctx = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    })
    const raw = String(script.runInContext(ctx, { timeout: 3000 }) ?? '{}')
    const parsed = JSON.parse(raw) as {
      ok?: boolean
      logs?: string[]
      ret?: string | null
      hasRet?: boolean
      err?: string | null
    }
    const parts = Array.isArray(parsed.logs) ? [...parsed.logs] : []
    if (parsed.ok) {
      if (parsed.hasRet && parsed.ret !== null) parts.push(`=> ${parsed.ret}`)
      return { ok: true, output: parts.join('\n') || '(no output)' }
    }
    if (parsed.err) parts.push(`Error: ${parsed.err}`)
    return { ok: false, output: parts.join('\n').trim() || 'Error: execution failed' }
  } catch (e) {
    return { ok: false, output: `Error: ${e instanceof Error ? e.message : String(e)}`.trim() }
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
        const query = str(args.query).trim()
        if (!query) {
          return { ok: false, summary: 'Empty search query', raw: 'Error: provide a non-empty "query".' }
        }
        const num = Math.min(Math.max(Number(args.num) || 6, 1), 8)
        // PROVIDER CHAIN: Tavily (optional) -> Gemini Google Search Grounding (built-in free tier) -> ZAI SDK
        let items: { title: string; url: string; snippet: string; host: string; date?: string }[] = []
        let groundedAnswer = ''

        const tavilyKey = process.env.TAVILY_API_KEY?.trim()
        if (tavilyKey) {
          try {
            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: tavilyKey, query, max_results: num, search_depth: 'basic' }),
              signal: AbortSignal.timeout(25_000),
            })
            if (res.ok) {
              const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
              items = (json.results ?? []).slice(0, num).map((r) => ({
                title: r.title ?? '(untitled)',
                url: r.url ?? '',
                snippet: truncate(r.content ?? '', 300),
                host: r.url ? (() => { try { return new URL(r.url).hostname } catch { return '' } })() : '',
              }))
            }
          } catch {
            /* fall through to Gemini Google Search Grounding */
          }
        }

        // Primary zero-config live web search: Gemini Google Search Grounding
        if (items.length === 0) {
          const gemini = createServerGemini()
          if (gemini) {
            try {
              const resp = await gemini.models.generateContent({
                model: 'gemini-4-hydrogen',
                contents: `Search the live web for: ${query}\nProvide a concise, factual summary of the top current findings.`,
                config: {
                  tools: [{ googleSearch: {} }],
                },
              })
              groundedAnswer = (resp.text ?? '').trim()
              const chunks =
                (
                  resp.candidates?.[0] as
                    | { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }
                    | undefined
                )?.groundingMetadata?.groundingChunks ?? []
              const seen = new Set<string>()
              for (const ch of chunks) {
                const uri = ch.web?.uri?.trim()
                if (!uri || seen.has(uri)) continue
                seen.add(uri)
                let host = ''
                try {
                  host = new URL(uri).hostname
                } catch {
                  host = ''
                }
                items.push({
                  title: ch.web?.title?.trim() || host || uri,
                  url: uri,
                  snippet: truncate(groundedAnswer, 240),
                  host,
                })
                if (items.length >= num) break
              }
            } catch {
              /* fall through to ZAI SDK if present */
            }
          }
        }

        if (items.length === 0 && !groundedAnswer) {
          const zai = await getZAI()
          if (zai) {
            const rawResults = (await zai.functions.invoke('web_search', { query, num })) as unknown[]
            if (Array.isArray(rawResults)) {
              items = rawResults.slice(0, num).map((raw) => {
                const r = raw as { name?: string; url?: string; snippet?: string; host_name?: string; date?: string }
                return {
                  title: str(r.name, '(untitled)'),
                  url: str(r.url),
                  snippet: truncate(str(r.snippet), 300),
                  host: str(r.host_name),
                  date: str(r.date) || undefined,
                }
              })
            }
          }
        }

        if (items.length === 0 && !groundedAnswer) {
          return {
            ok: false,
            summary: 'Web search unavailable',
            raw: 'Error: Web search could not reach Google Search Grounding, Tavily, or ZAI.',
          }
        }

        const sourcesBlock = items
          .map((r, i) => `[${i + 1}] ${r.title}${r.host ? ` (${r.host})` : ''}\n${r.url}\n${r.snippet}`)
          .join('\n\n')
        const raw = [groundedAnswer ? `SUMMARY:\n${groundedAnswer}` : '', sourcesBlock].filter(Boolean).join('\n\n')
        return {
          ok: true,
          summary:
            items.length > 0
              ? `${items.length} grounded results for "${query}"`
              : `Web summary for "${query}"`,
          raw: truncate(raw, 6000),
          display:
            items.length > 0
              ? { kind: 'search', results: items }
              : { kind: 'text', text: truncate(groundedAnswer, 1200) },
        }
      }

      case 'read_url': {
        const rawUrl = str(args.url)
        const safeUrl = (await resolvePublicExternalUrl(rawUrl)).toString()
        const zai = await getZAI()
        if (zai) {
          const page = await zai.functions.invoke('page_reader', { url: safeUrl })
          const title = str(page?.data?.title, safeUrl)
          const text = truncate(stripHtml(str(page?.data?.html)), 4000)
          return {
            ok: true,
            summary: `Read page: ${title}`,
            raw: `PAGE: ${title}\nURL: ${safeUrl}\n\n${text}`,
            display: { kind: 'text', text: `Read "${title}" — ${text.length} chars extracted` },
          }
        }
        let res: Response
        try {
          res = await fetchPublicExternalUrl(safeUrl, {
            headers: { 'User-Agent': 'NexusAgent/1.0', Accept: 'text/html,text/plain' },
            signal: AbortSignal.timeout(12000),
          })
        } catch (err) {
          if (err instanceof SsrfBlockedError) {
            return { ok: false, summary: 'Blocked redirect target', raw: `Error: ${err.message}` }
          }
          throw err
        }
        if (!res.ok) return { ok: false, summary: `Failed to read ${safeUrl}`, raw: `HTTP ${res.status}` }
        const html = await res.text()
        const title = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? safeUrl).trim()
        const text = truncate(stripHtml(html), 4000)
        return {
          ok: true,
          summary: `Read page: ${title}`,
          raw: `PAGE: ${title}\nURL: ${safeUrl}\n\n${text}`,
          display: { kind: 'text', text: `Read "${title}" — ${text.length} chars extracted` },
        }
      }

      case 'browse_site': {
        // lightweight browser use: read a page + follow related same-site links
        const startUrl = (await resolvePublicExternalUrl(str(args.url))).toString()
        const topic = str(args.topic).toLowerCase()
        const maxPages = Math.min(Math.max(Number(args.maxPages) || 3, 1), 3)

        /** direct fetch — fast, but some sites (e.g. Wikipedia) block non-browser clients */
        const fetchDirect = async (u: string): Promise<{ title: string; text: string; links: { href: string; label: string }[] } | null> => {
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 9000)
          try {
            const res = await fetchPublicExternalUrl(u, {
              signal: ctrl.signal,
              headers: { 'User-Agent': 'NexusAgent/1.0 (lightweight browser)', Accept: 'text/html' },
            })
            if (!res.ok) return null
            const html = await res.text()
            return parsePage(res.url || u, html)
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
        const prompt = str(args.prompt)
        if (!prompt.trim()) {
          return { ok: false, summary: 'Empty prompt', raw: 'Error: provide a prompt describing the image to generate.' }
        }
        const dims = resolveImageDimensions(str(args.size), str(args.aspectRatio))
        const name = `img_${Date.now()}.png`
        const url = `/api/files?name=${name}`

        // 1) Optional OpenAI Images path when user configured OPENAI_API_KEY
        const openaiKey = process.env.OPENAI_API_KEY?.trim()
        if (openaiKey && process.env.LLM_PROVIDER?.trim().toLowerCase() === 'openai') {
          try {
            const imgModel = process.env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-1'
            const res = await fetch('https://api.openai.com/v1/images/generations', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openaiKey}`,
              },
              body: JSON.stringify({
                model: imgModel,
                prompt,
                size: '1024x1024',
              }),
              signal: AbortSignal.timeout(45_000),
            })
            if (res.ok) {
              const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
              const b64 = json.data?.[0]?.b64_json
              if (b64) {
                await saveWorkspaceFile(name, Buffer.from(b64, 'base64'))
                return {
                  ok: true,
                  summary: `Generated image: ${truncate(prompt, 80)}`,
                  raw: `Image generated successfully and saved as ${name}. Embed it with markdown: ![${prompt}](${url})`,
                  display: { kind: 'image', url, prompt },
                }
              }
            }
          } catch {
            /* fall through to ZAI or vector-PNG fallback */
          }
        }

        // 2) Built-in ZAI SDK path if configured
        const zai = await getZAI()
        if (zai) {
          const res = await zai.images.generations.create({
            prompt,
            size: dims.sizeLabel as '1024x1024',
          })
          const b64 = res?.data?.[0]?.base64
          if (b64) {
            await saveWorkspaceFile(name, Buffer.from(b64, 'base64'))
            return {
              ok: true,
              summary: `Generated image: ${truncate(prompt, 80)}`,
              raw: `Image generated successfully and saved as ${name}. Embed it with markdown: ![${prompt}](${url})`,
              display: { kind: 'image', url, prompt },
            }
          }
        }

        // 3) Free-tier Gemini vector-to-PNG pipeline (active LLM crafts layered SVG → Sharp renders PNG)
        const prompts = buildVectorIllustrationPrompts(prompt, dims)
        let lastErr = 'Unable to produce valid SVG artwork'
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const rawSvg = await chatText(
              [
                { role: 'system', content: prompts.system },
                {
                  role: 'user',
                  content:
                    attempt === 0
                      ? prompts.user
                      : `${prompts.user}\n\nIMPORTANT: Your previous attempt could not be parsed (${lastErr}). Output ONLY strict, valid XML starting with <svg and ending with </svg>.`,
                },
              ],
              { temperature: 0.7, maxTokens: 2800, thinkingLevel: 'low', timeoutMs: 16_000 }
            )
            const cleanSvg = extractAndSanitizeSvg(rawSvg, dims)
            if (!cleanSvg) {
              lastErr = 'Missing <svg>...</svg> block'
              continue
            }
            const pngBuf = await rasterizeSvgToPng(cleanSvg)
            await saveWorkspaceFile(name, pngBuf)
            return {
              ok: true,
              summary: `Generated vector illustration (${dims.sizeLabel}): ${truncate(prompt, 70)}`,
              raw: `Image generated as an AI-crafted vector illustration rendered to PNG (${dims.sizeLabel}) and saved as ${name}. Embed it with markdown: ![${prompt}](${url})`,
              display: { kind: 'image', url, prompt },
            }
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err)
          }
        }

        return {
          ok: false,
          summary: `Image generation failed: ${truncate(lastErr, 90)}`,
          raw: `Image generation error: ${lastErr}`,
        }
      }

      case 'search_images': {
        const query = str(args.query)
        if (!query.trim()) {
          return { ok: false, summary: 'Empty query', raw: 'Error: provide a search query.' }
        }
        const zai = await getZAI()
        if (zai) {
          try {
            const res = await zai.images.search.create({ query, count: 6 })
            if (res?.results?.length) {
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
          } catch {
            /* fall back to Wikimedia Commons */
          }
        }

        try {
          const endpoint =
            `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=960&format=json`
          const res = await fetch(endpoint, {
            headers: { 'User-Agent': 'NexusAgent/1.0 (https://localhost)' },
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) {
            return {
              ok: false,
              summary: `Image search HTTP ${res.status}`,
              raw: `Image search failed with HTTP ${res.status}.`,
            }
          }
          const json = (await res.json()) as unknown
          const items = parseWikimediaImageResponse(json, 6)
          if (items.length === 0) {
            return { ok: true, summary: `No images found for "${query}"`, raw: 'No images found.' }
          }
          const raw = items.map((r, i) => `[${i + 1}] ${r.url} ${r.caption ?? ''}`).join('\n')
          return {
            ok: true,
            summary: `${items.length} images for "${query}"`,
            raw: truncate(raw, 3000),
            display: { kind: 'images', items },
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, summary: 'Image search unavailable', raw: `Image search failed: ${msg}` }
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
        const text = str(args.text ?? args.input).trim()
        if (!text) return { ok: false, summary: 'Empty text', raw: 'Error: empty text.' }
        const voiceName = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(str(args.voice))
          ? str(args.voice)
          : 'Zephyr'

        // 1) Primary zero-config TTS: Gemini 3.8 Flash Lite TTS (unary returns complete 24kHz WAV)
        const gemini = createServerGemini()
        if (gemini) {
          try {
            const resp = await gemini.models.generateContent({
              model: 'gemini-3.8-flash-lite-tts',
              contents: [{ role: 'user', parts: [{ text: text.slice(0, 1500) }] }],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              },
            })
            const b64 = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
            if (b64) {
              const wavBuf = Buffer.from(b64, 'base64')
              if (wavBuf.length >= 100) {
                const name = `tts_${Date.now()}.wav`
                await saveWorkspaceFile(name, wavBuf)
                const url = `/api/files?name=${name}`
                return {
                  ok: true,
                  summary: `Spoke ${text.length} chars (${voiceName})`,
                  raw: `Speech audio generated via Gemini TTS (${(wavBuf.length / 1024).toFixed(0)} KB), available at ${url}`,
                  display: { kind: 'audio', url, text: truncate(text, 300) },
                }
              }
            }
          } catch {
            /* fall through to ZAI SDK if present */
          }
        }

        // 2) Fallback: ZAI SDK if configured
        const zai = await getZAI()
        if (!zai) {
          return { ok: false, summary: 'TTS unavailable', raw: 'Text-to-speech failed via Gemini TTS and ZAI is not configured.' }
        }
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
            const saved = await saveWorkspaceFile(rel, Buffer.from(content, 'utf-8'))
            if (!saved) return { ok: false, summary: 'Path outside workspace', raw: 'Error: workspace paths cannot traverse symbolic links or junctions.' }
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
          const rawUrl = str(args.url)
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 12000)
          try {
            const res = await fetchPublicExternalUrl(rawUrl, {
              signal: ctrl.signal,
              headers: { 'User-Agent': 'NexusAgent/1.0 (computer use)', Accept: 'text/html,application/json,text/plain' },
            })
            const body = await res.text()
            const text = /<\/?[a-z][\s\S]*>/i.test(body.slice(0, 500)) ? stripHtml(body) : body
            return {
              ok: true,
              summary: `Opened ${rawUrl} (HTTP ${res.status})`,
              raw: `HTTP ${res.status} ${res.statusText}\n\n${truncate(text, 4500)}`,
              display: { kind: 'text', text: `Opened ${rawUrl} — HTTP ${res.status}, ${text.length} chars` },
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return {
              ok: false,
              summary: e instanceof SsrfBlockedError ? 'Blocked redirect target' : `Could not open ${rawUrl}`,
              raw: `Error: ${msg}`,
            }
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

        const program = path.basename(argv[0]).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, '')
        // never run, no exceptions
        const BANNED = new Set([
          'sudo', 'su', 'shutdown', 'reboot', 'kill', 'pkill', 'mkfs', 'dd', 'crontab', 'passwd', 'chsh', 'visudo',
          'powershell', 'pwsh', 'cmd', 'wscript', 'cscript', 'reg', 'sc', 'net', 'netsh', 'taskkill', 'format',
          'diskpart', 'wsl', 'del', 'erase', 'rd', 'attrib', 'icacls', 'takeown', 'runas',
        ])
        if (BANNED.has(program)) {
          return { ok: false, summary: 'Command blocked', raw: `Error: "${program}" is on the never-run list (system safety).` }
        }

        // Fail-closed read-only allowlist: any command outside this set requires workspace_shell approval.
        const SAFE_READONLY_CMDS = new Set([
          'ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'findstr', 'pwd', 'echo', 'which', 'where',
          'whoami', 'date', 'uname', 'stat', 'file',
        ])
        const isSafeGitRead = program === 'git' && /^(status|log|diff|branch|show|rev-parse)$/.test(argv[1] ?? '')
        const isSafeReadOnly = SAFE_READONLY_CMDS.has(program) || isSafeGitRead
        const DESTRUCTIVE_CMDS = new Set(['rm', 'rmdir', 'chmod', 'chown'])
        const isDestructive =
          DESTRUCTIVE_CMDS.has(program) ||
          (program === 'npm' && /(^install$|^i$|^add$)/.test(argv[1] ?? '')) ||
          (program === 'pip' && (argv[1] ?? '') === 'install') ||
          (program === 'git' && /^(push|reset|clean|checkout\s--)/.test(argv.slice(1).join(' '))) ||
          (program === 'curl' && /-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-T\s/.test(command))
        const isWrite = !isSafeReadOnly

        if (isWrite || isDestructive) {
          // LLM-supplied args.confirm can never authorize an OS command.
          const actionBinding = { actionName: 'workspace.shell', target: WORKSPACE_DIR, payload: { command, argv } }
          const perm = await requireCapabilityPermission({
            capability: 'workspace_shell',
            actionSummary: `Run shell command: ${truncate(command, 90)}`,
            details: 'Write-capable command inside the workspace directory',
            ...actionBinding,
          })
          if (!perm.allowed || !verifyActionHash(perm.actionHash, actionBinding)) {
            return {
              ok: false,
              summary: `Permission required: ${truncate(command, 80)}`,
              raw: perm.reason ?? 'Permission declined for workspace shell command.',
              display: { kind: 'text', text: perm.reason ?? `Permission declined for "${truncate(command, 80)}"` },
            }
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
            try {
              const { recordWorkingMemoryTrace } = await import('@/lib/agent/brain-trace')
              await recordWorkingMemoryTrace({
                runId: runId || undefined,
                operation: 'recall',
                memoryIds: g.recalled.map((r) => r.id),
                entityNames: g.recalled.flatMap((r) => r.trail),
                summary: `Recalled ${g.recalled.length} graph memories for "${truncate(query, 60)}"`,
              })
            } catch {
              /* trace best-effort */
            }
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
        const saved = await saveWorkspaceFile(str(args.path), Buffer.from(content, 'utf-8'))
        if (!saved) {
          return {
            ok: false,
            summary: 'Path outside workspace',
            raw: 'Error: workspace paths cannot traverse symbolic links or junctions.',
          }
        }
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

      case 'inspect_project': {
        const shouldIndex = args.indexIntoBrain !== false
        const { indexProjectIntoBrain, scanProjectStructure } = await import('@/lib/agent/project-intel')
        if (shouldIndex) {
          const { scan, memoriesSaved } = await indexProjectIntoBrain()
          return {
            ok: true,
            summary: `Indexed ${scan.name} (${memoriesSaved} new truths)`,
            raw: `${scan.summaryText}\n\nIndexed ${memoriesSaved} new architectural truths into portable GBrain memory.`,
            display: {
              kind: 'text',
              text: `${scan.name} (${scan.framework}) — ${scan.prismaModels.length} models, ${scan.apiRoutes.length} API routes, ${memoriesSaved} truths indexed`,
            },
          }
        }
        const scan = await scanProjectStructure()
        return {
          ok: true,
          summary: `Scanned ${scan.name}`,
          raw: scan.summaryText,
          display: { kind: 'text', text: scan.summaryText },
        }
      }

      case 'manage_org': {
        const action = str(args.action, 'list').toLowerCase()
        const employees = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })

        if (action === 'list') {
          const lines = employees.map(
            (e) => `- ${e.name} [${e.kind}, ${e.status}] — ${e.title} (${e.department}) | tasks: ${e.tasksCompleted}`
          )
          return {
            ok: true,
            summary: `${employees.length} Org members`,
            raw: lines.length ? `ORG AI TEAM (under Eva):\n${lines.join('\n')}` : 'No AI employees or bots yet.',
            display: { kind: 'text', text: lines.join('\n') || 'No AI employees or bots yet.' },
          }
        }

        if (action === 'review') {
          const { evaluateOrgRoster } = await import('@/lib/agent/org-review')
          const focus = str(args.focus ?? args.task).trim()
          const targetKey = str(args.id ?? args.name).trim().toLowerCase()
          const target = targetKey
            ? employees.find(
                (e) => e.id.toLowerCase() === targetKey || e.slug === targetKey || e.name.toLowerCase() === targetKey
              )
            : null
          const rosterEval = evaluateOrgRoster(target ? [target] : employees, focus)
          let aiCritique = ''
          try {
            aiCritique = await chatText(
              [
                {
                  role: 'system',
                  content:
                    'You are Eva, Lead Agent reviewing your Org AI employees, bots, and subagents. Give a crisp, practical assessment: strengths, bottlenecks, and concrete hiring/bot recommendations if needed.',
                },
                {
                  role: 'user',
                  content: `${rosterEval.summaryText}${focus ? `\n\nREVIEW FOCUS: ${focus}` : ''}`,
                },
              ],
              { temperature: 0.3, maxTokens: 500, thinkingLevel: 'low', timeoutMs: 12_000 }
            )
          } catch {
            aiCritique = ''
          }
          const combined = aiCritique.trim()
            ? `${rosterEval.summaryText}\n\nEVA EXECUTIVE ASSESSMENT:\n${aiCritique.trim()}`
            : rosterEval.summaryText
          return {
            ok: true,
            summary: target ? `Reviewed ${target.name}` : `Reviewed ${employees.length} Org members`,
            raw: truncate(combined, 4500),
            display: { kind: 'text', text: truncate(combined, 1400) },
          }
        }

        if (action === 'hire' || action === 'create_bot' || action === 'create_subagent') {
          const name = str(args.name).trim()
          const role = str(args.role ?? args.description).trim()
          if (!name || !role) {
            return {
              ok: false,
              summary: 'Missing name or role',
              raw: 'Error: manage_org hire/create_bot/create_subagent requires "name" and "role".',
            }
          }
          const kind = action === 'create_bot' ? 'bot' : action === 'create_subagent' ? 'subagent' : 'employee'
          const defaultTitle =
            kind === 'bot' ? 'Autonomous Bot' : kind === 'subagent' ? 'Specialist Subagent' : 'AI Specialist'
          const defaultDept = kind === 'bot' ? 'Automation' : 'Engineering'
          const title = str(args.title, defaultTitle).trim()
          const department = str(args.department, defaultDept).trim()
          const systemPrompt = str(
            args.systemPrompt,
            `You are ${name}, ${title} reporting to Eva (Lead Agent). ${role}`
          ).trim()
          const skills = Array.isArray(args.skills) ? args.skills.map(String) : []
          const tools = Array.isArray(args.tools) ? args.tools.map(String) : []
          const reportsToName = str(args.reportsTo).trim().toLowerCase()
          const manager = reportsToName && reportsToName !== 'eva' && reportsToName !== 'lead agent'
            ? employees.find((e) => e.id === args.reportsTo || e.slug === reportsToName || e.name.toLowerCase() === reportsToName)
            : null

          const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || kind
          const slug = employees.some((e) => e.slug === baseSlug) ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug

          const created = await db.aiEmployee.create({
            data: {
              slug,
              name: name.slice(0, 80),
              title: title.slice(0, 80),
              department: department.slice(0, 50),
              kind,
              role: role.slice(0, 400),
              reportsToId: manager ? manager.id : null,
              systemPrompt: systemPrompt.slice(0, 3000),
              skillsJson: JSON.stringify(skills),
              toolsJson: JSON.stringify(tools),
              autonomy: 'autonomous',
              status: 'active',
              icon: 'bot',
            },
          })

          // Bots also register a callable x_<slug> plugin tool so workflows/voice can invoke directly
          if (kind === 'bot') {
            const botBinding = { actionName: 'extensions.create_bot', target: slug, payload: args }
            const perm = await requireCapabilityPermission({
              capability: 'self_install',
              actionSummary: `Register bot tool x_${slug} (${created.name})`,
              details: 'Allows Eva to register a new callable bot plugin tool.',
              ...botBinding,
            })
            if (!perm.allowed || !verifyActionHash(perm.actionHash, botBinding)) {
              await db.aiEmployee.delete({ where: { id: created.id } }).catch(() => {})
              return {
                ok: false,
                summary: 'Bot plugin registration declined',
                raw: perm.reason ?? 'Permission declined for self_install.',
              }
            }
            const toolSlug = `x_${slug}`
            await db.plugin.upsert({
              where: { slug },
              update: { installed: true, enabled: true, toolSlug, description: role.slice(0, 300) },
              create: {
                slug,
                name: created.name,
                description: role.slice(0, 300),
                category: 'automation',
                icon: 'bot',
                source: 'custom',
                installed: true,
                enabled: true,
                toolSlug,
                configJson: JSON.stringify({
                  type: 'llm',
                  instructions: created.systemPrompt,
                  endpoint: '',
                  inputHint: '{"input": string}',
                }),
              },
            })
            await db.tool.upsert({
              where: { slug: toolSlug },
              update: { name: created.name, description: `${role.slice(0, 200)} Args: {"input": string}`, source: `plugin:${slug}`, enabled: true },
              create: { slug: toolSlug, name: created.name, description: `${role.slice(0, 200)} Args: {"input": string}`, source: `plugin:${slug}`, enabled: true },
            })
          }

          const verb = kind === 'bot' ? 'Created bot' : kind === 'subagent' ? 'Created subagent' : 'Hired'
          return {
            ok: true,
            summary: `${verb} ${created.name}`,
            raw: `Created ${kind} "${created.name}" (${created.title}, ${created.department}, id=${created.id})${manager ? ` reporting to ${manager.name}` : ' reporting to Eva'}.`,
            display: { kind: 'text', text: `${created.name} · ${created.title} (${created.department})` },
          }
        }

        if (action === 'delegate') {
          const targetKey = str(args.id ?? args.name).trim().toLowerCase()
          const task = str(args.task ?? args.prompt).trim()
          const emp = employees.find((e) => e.id.toLowerCase() === targetKey || e.slug === targetKey || e.name.toLowerCase() === targetKey)
          if (!emp) return { ok: false, summary: 'Employee not found', raw: `Error: no Org member matching "${targetKey}".` }
          if (!task) return { ok: false, summary: 'Missing task', raw: 'Error: delegate requires a "task".' }

          const out = await chatText(
            [
              {
                role: 'system',
                content: `You are ${emp.name}, ${emp.title} in ${emp.department}.\nRole: ${emp.role}\n${emp.systemPrompt}\nDeliver a thorough, actionable engineering/specialist response.`,
              },
              { role: 'user', content: task },
            ],
            { temperature: 0.4, maxTokens: 900 }
          )
          await db.aiEmployee.update({
            where: { id: emp.id },
            data: { tasksCompleted: { increment: 1 }, lastActiveAt: new Date() },
          })
          return {
            ok: true,
            summary: `Delegated to ${emp.name}`,
            raw: `[Response from ${emp.name} — ${emp.title}]:\n${truncate(out, 4500)}`,
            display: { kind: 'text', text: truncate(out, 1200) },
          }
        }

        if (action === 'remove') {
          const targetKey = str(args.id ?? args.name).trim().toLowerCase()
          const emp = employees.find((e) => e.id.toLowerCase() === targetKey || e.slug === targetKey || e.name.toLowerCase() === targetKey)
          if (!emp) return { ok: false, summary: 'Employee not found', raw: `Error: no Org member matching "${targetKey}".` }
          await db.aiEmployee.delete({ where: { id: emp.id } })
          return {
            ok: true,
            summary: `Removed ${emp.name}`,
            raw: `Removed "${emp.name}" from the Org.`,
            display: { kind: 'text', text: `Removed ${emp.name}` },
          }
        }

        return { ok: false, summary: 'Invalid manage_org action', raw: `Error: unknown action "${action}".` }
      }

      case 'manage_automation': {
        const action = str(args.action, 'list')
        const { computeNextRunAt, executeAutomation } = await import('@/lib/agent/scheduler')
        const list = await db.automation.findMany({ orderBy: { createdAt: 'desc' } })

        if (action === 'list') {
          const lines = list.map(
            (a) => `- ${a.name} (${a.id}) [${a.enabled ? 'enabled' : 'paused'}] ${a.triggerType}:${a.schedule} | runs: ${a.runCount} | last: ${a.lastStatus}`
          )
          return {
            ok: true,
            summary: `${list.length} automations`,
            raw: lines.length ? `AUTOMATIONS:\n${lines.join('\n')}` : 'No scheduled automations yet.',
            display: { kind: 'text', text: lines.join('\n') || 'No scheduled automations yet.' },
          }
        }

        if (action === 'create') {
          const name = str(args.name).trim()
          const prompt = str(args.prompt).trim()
          if (!name || !prompt) {
            return { ok: false, summary: 'Missing name or prompt', raw: 'Error: create requires "name" and "prompt".' }
          }
          const triggerType = ['interval', 'cron', 'once'].includes(str(args.triggerType)) ? str(args.triggerType) : 'interval'
          const schedule = str(args.schedule, triggerType === 'cron' ? '0 9 * * *' : '60').trim()
          const enabled = args.enabled !== false
          let assigneeId: string | null = null
          const assigneeName = str(args.assigneeName).trim().toLowerCase()
          if (assigneeName) {
            const emps = await db.aiEmployee.findMany()
            const match = emps.find((e) => e.id.toLowerCase() === assigneeName || e.name.toLowerCase() === assigneeName || e.slug === assigneeName)
            if (match) assigneeId = match.id
          }
          const nextRunAt = enabled ? computeNextRunAt(triggerType, schedule) : null
          const created = await db.automation.create({
            data: {
              name: name.slice(0, 100),
              description: str(args.description).slice(0, 300),
              prompt: prompt.slice(0, 2000),
              triggerType,
              schedule,
              assigneeId,
              enabled,
              nextRunAt,
            },
          })
          return {
            ok: true,
            summary: `Scheduled "${created.name}"`,
            raw: `Created automation "${created.name}" (${triggerType} "${schedule}"), next run: ${nextRunAt ? nextRunAt.toISOString() : 'paused'}.`,
            display: { kind: 'text', text: `Scheduled "${created.name}" (${triggerType}: ${schedule})` },
          }
        }

        const targetKey = str(args.id ?? args.name).trim().toLowerCase()
        const target = list.find((a) => a.id.toLowerCase() === targetKey || a.name.toLowerCase() === targetKey)
        if (!target) {
          return { ok: false, summary: 'Automation not found', raw: `Error: no automation matching "${targetKey}".` }
        }

        if (action === 'toggle') {
          const nextEnabled = typeof args.enabled === 'boolean' ? args.enabled : !target.enabled
          const nextRunAt = nextEnabled ? computeNextRunAt(target.triggerType, target.schedule) : null
          await db.automation.update({
            where: { id: target.id },
            data: { enabled: nextEnabled, nextRunAt },
          })
          return {
            ok: true,
            summary: `${target.name} ${nextEnabled ? 'enabled' : 'paused'}`,
            raw: `Automation "${target.name}" is now ${nextEnabled ? 'enabled' : 'paused'}.`,
            display: { kind: 'text', text: `${target.name}: ${nextEnabled ? 'enabled' : 'paused'}` },
          }
        }

        if (action === 'run_now') {
          const res = await executeAutomation(target.id)
          return {
            ok: res.ok,
            summary: `Ran ${target.name} (${res.status})`,
            raw: res.summary,
            display: { kind: 'text', text: truncate(res.summary, 1000) },
          }
        }

        if (action === 'delete') {
          await db.automation.delete({ where: { id: target.id } })
          return {
            ok: true,
            summary: `Deleted ${target.name}`,
            raw: `Deleted automation "${target.name}".`,
            display: { kind: 'text', text: `Deleted ${target.name}` },
          }
        }

        return { ok: false, summary: 'Invalid action', raw: `Error: unsupported action "${action}".` }
      }

      case 'create_skill': {
        const name = str(args.name).trim()
        const prompt = str(args.prompt).trim()
        if (!name || !prompt) {
          return { ok: false, summary: 'Missing name or prompt', raw: 'Error: create_skill requires "name" and "prompt".' }
        }
        const description = str(args.description, `Custom skill: ${name}`).trim()
        const category = str(args.category, 'custom').trim()
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill'
        const skillBinding = { actionName: 'extensions.create_skill', target: slug, payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'self_install',
          actionSummary: `Create & enable skill: ${name}`,
          details: 'Allows Eva to create and activate reusable Agent Skills.',
          ...skillBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, skillBinding)) {
          return {
            ok: false,
            summary: 'Skill creation permission declined',
            raw: perm.reason ?? 'Permission declined for self_install.',
          }
        }
        const skill = await db.skill.upsert({
          where: { slug },
          update: { name: name.slice(0, 80), description: description.slice(0, 300), prompt: prompt.slice(0, 4000), category, enabled: true },
          create: {
            slug,
            name: name.slice(0, 80),
            description: description.slice(0, 300),
            category,
            icon: 'sparkles',
            prompt: prompt.slice(0, 4000),
            enabled: true,
          },
        })
        return {
          ok: true,
          summary: `Skill ready: ${skill.name}`,
          raw: `Skill "${skill.name}" (slug: ${skill.slug}) created and enabled.`,
          display: { kind: 'text', text: `Skill enabled: ${skill.name}` },
        }
      }

      case 'browser_control': {
        const action = str(args.action, 'snapshot').toLowerCase()
        const browserBinding = { actionName: 'browser.' + action, target: 'live_browser', payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'browser_control',
          actionSummary:
            action === 'play_media'
              ? `Play media on YouTube: ${truncate(str(args.query ?? args.url ?? args.text), 80)}`
              : action === 'autopilot'
                ? `Run autonomous browser task: ${truncate(str(args.goal ?? args.text ?? args.url), 80)}`
                : action === 'navigate'
                  ? `Open live browser at ${truncate(str(args.url), 80)}`
                  : `Browser action "${action}"${args.selector ? ` on ${str(args.selector)}` : ''}`,
          details: 'Streams a live Playwright Chromium window or embedded media player inside the split-screen panel.',
          ...browserBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, browserBinding)) {
          return {
            ok: false,
            summary: 'Browser control permission declined',
            raw: perm.reason ?? 'Permission declined for browser_control.',
            display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
          }
        }

        controlBus.broadcastEvaMood('working', `Browser: ${action}`, 4500)
        if (action === 'close') {
          await liveBrowser.close()
          controlBus.broadcastUiCommand({ command: 'close_split' })
          return {
            ok: true,
            summary: 'Closed live browser',
            raw: 'Live browser session closed.',
            display: { kind: 'text', text: 'Closed live Playwright browser session.' },
          }
        }

        let res
        if (action === 'play_media') {
          const query = str(args.query ?? args.url ?? args.text).trim()
          if (!query) return { ok: false, summary: 'Missing media query', raw: 'Error: play_media requires "query" or "url".' }
          res = await liveBrowser.playMedia(query)
        } else if (action === 'autopilot') {
          const goal = str(args.goal ?? args.text ?? args.query).trim()
          if (!goal) return { ok: false, summary: 'Missing goal', raw: 'Error: autopilot requires "goal".' }
          res = await liveBrowser.runAutopilot(
            goal,
            str(args.url) || undefined,
            typeof args.maxSteps === 'number' ? args.maxSteps : 6
          )
        } else if (action === 'clear_media') {
          res = await liveBrowser.clearMedia()
        } else if (action === 'navigate') {
          const url = str(args.url)
          if (!url) return { ok: false, summary: 'Missing URL', raw: 'Error: navigate requires "url".' }
          res = await liveBrowser.navigate(url)
        } else if (action === 'click') {
          res = await liveBrowser.click({
            selector: str(args.selector) || undefined,
            text: str(args.text) || undefined,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
          })
        } else if (action === 'type') {
          res = await liveBrowser.type({
            text: str(args.text),
            selector: str(args.selector) || undefined,
            submit: Boolean(args.submit),
          })
        } else if (action === 'press') {
          res = await liveBrowser.press(str(args.key, 'Enter'))
        } else if (action === 'scroll') {
          res = await liveBrowser.scroll(typeof args.deltaY === 'number' ? args.deltaY : 480)
        } else if (action === 'back') {
          res = await liveBrowser.back()
        } else if (action === 'reload') {
          res = await liveBrowser.reload()
        } else {
          res = await liveBrowser.snapshot()
        }

        const elementsText = res.elements
          .slice(0, 14)
          .map((e) => `[${e.index}] <${e.tag}> "${e.text}" (selector: ${e.selector})`)
          .join('\n')
        const stepsText = Array.isArray(res.steps) && res.steps.length > 0 ? `\nAUTOPILOT STEPS:\n${res.steps.join('\n')}` : ''
        const raw = [
          `LIVE BROWSER — ${res.title}`,
          `URL: ${res.url}`,
          res.error ? `ERROR: ${res.error}` : '',
          stepsText,
          elementsText ? `\nVISIBLE INTERACTIVE ELEMENTS:\n${elementsText}` : '',
          res.textExcerpt ? `\nPAGE TEXT EXCERPT:\n${truncate(res.textExcerpt, 2800)}` : '',
        ]
          .filter(Boolean)
          .join('\n')

        if (res.ok) controlBus.broadcastEvaMood('happy', res.summary, 2400)
        return {
          ok: res.ok,
          summary: res.summary,
          raw: truncate(raw, 5500),
          display: { kind: 'text', text: `${res.summary}\n${res.url}` },
        }
      }

      case 'agent_email': {
        const action = str(args.action, 'status').toLowerCase()
        if (action === 'provision') {
          const { identity, created } = await provisionAgentEmail({
            preferredLocal: str(args.preferredLocal) || undefined,
            forceNew: Boolean(args.forceNew),
          })
          controlBus.broadcastUiCommand({ command: 'open_split', mode: 'identity', title: 'Eva Email & Identity' })
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['identity'] })
          return {
            ok: true,
            summary: created ? `Provisioned Eva email: ${identity.address}` : `Active Eva email: ${identity.address}`,
            raw: `EVA AUTONOMOUS EMAIL\nAddress: ${identity.address}\nProvider: ${identity.provider}\nCreated: ${created ? 'new inbox created' : 'existing inbox reused'}`,
            display: { kind: 'text', text: `Eva Email: ${identity.address}` },
          }
        }

        if (action === 'status') {
          const existing = await getAgentIdentity()
          if (!existing) {
            const { identity } = await provisionAgentEmail()
            controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['identity'] })
            return {
              ok: true,
              summary: `Auto-provisioned Eva email: ${identity.address}`,
              raw: `EVA AUTONOMOUS EMAIL\nAddress: ${identity.address}\nProvider: ${identity.provider}`,
              display: { kind: 'text', text: `Eva Email: ${identity.address}` },
            }
          }
          return {
            ok: true,
            summary: `Eva email: ${existing.address}`,
            raw: `EVA AUTONOMOUS EMAIL\nAddress: ${existing.address}\nProvider: ${existing.provider}\nCreatedAt: ${existing.createdAt}`,
            display: { kind: 'text', text: `Eva Email: ${existing.address}` },
          }
        }

        if (action === 'list_inbox') {
          let existing = await getAgentIdentity()
          if (!existing) {
            const prov = await provisionAgentEmail()
            existing = prov.identity
          }
          const { messages } = await listAgentInbox()
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['identity'] })
          const raw =
            messages.length === 0
              ? `Inbox (${existing.address}) has 0 messages right now.`
              : `INBOX (${existing.address}) — ${messages.length} messages:\n` +
                messages.map((m, i) => `[${i + 1}] id=${m.id} | From: ${m.from} | Subject: ${m.subject}\n${m.intro}`).join('\n\n')
          return {
            ok: true,
            summary: `${messages.length} email${messages.length === 1 ? '' : 's'} in ${existing.address}`,
            raw: truncate(raw, 4500),
            display: { kind: 'text', text: `${existing.address}: ${messages.length} inbox message(s)` },
          }
        }

        if (action === 'read_message') {
          const messageId = str(args.messageId).trim()
          if (!messageId) {
            return { ok: false, summary: 'Missing messageId', raw: 'Error: read_message requires "messageId".' }
          }
          const detail = await readAgentInboxMessage(messageId)
          const raw = [
            `FROM: ${detail.from}`,
            `SUBJECT: ${detail.subject}`,
            detail.codes.length ? `VERIFICATION CODES: ${detail.codes.join(', ')}` : '',
            detail.links.length ? `VERIFICATION LINKS:\n${detail.links.join('\n')}` : '',
            `\nBODY:\n${detail.text}`,
          ]
            .filter(Boolean)
            .join('\n')
          return {
            ok: true,
            summary: `Read email: ${detail.subject}`,
            raw: truncate(raw, 5000),
            display: {
              kind: 'text',
              text: `${detail.subject}${detail.codes.length ? ` · Codes: ${detail.codes.join(', ')}` : ''}`,
            },
          }
        }

        if (action === 'wait_for_code') {
          const existing = await getAgentIdentity()
          if (!existing) await provisionAgentEmail()
          const waited = await waitForVerificationCode({
            senderFilter: str(args.senderFilter) || undefined,
            timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : 20_000,
          })
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['identity'] })
          if (!waited.found || !waited.message) {
            return { ok: false, summary: waited.note, raw: waited.note }
          }
          const m = waited.message
          const raw = [
            `RECEIVED VERIFICATION EMAIL`,
            `From: ${m.from}`,
            `Subject: ${m.subject}`,
            m.codes.length ? `Codes: ${m.codes.join(', ')}` : '',
            m.links.length ? `Links: ${m.links.join('\n')}` : '',
            `\n${m.text}`,
          ]
            .filter(Boolean)
            .join('\n')
          return {
            ok: true,
            summary: m.codes.length ? `Got OTP code ${m.codes[0]}` : `Received "${m.subject}"`,
            raw: truncate(raw, 4500),
            display: { kind: 'text', text: m.codes.length ? `OTP Code: ${m.codes[0]}` : m.subject },
          }
        }

        return { ok: false, summary: `Unknown agent_email action: ${action}`, raw: `Unsupported action "${action}".` }
      }

      case 'app_control': {
        const action = str(args.action).trim()
        if (!action) return { ok: false, summary: 'Missing action', raw: 'Error: app_control requires "action".' }
        const uiBinding = { actionName: 'app_ui.' + action, target: 'nexus_ui', payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'app_ui',
          actionSummary: `UI control: ${action}${args.tab ? ` (${str(args.tab)})` : args.mode ? ` (${str(args.mode)})` : ''}`,
          details: 'Allows Eva to navigate panels, open split-screen views, spawn popups, and glide her animated cursor.',
          ...uiBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, uiBinding)) {
          return {
            ok: false,
            summary: 'App UI permission declined',
            raw: perm.reason ?? 'Permission declined for app_control.',
            display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
          }
        }

        if (action === 'navigate_tab') {
          const tab = str(args.tab, 'agent')
          controlBus.broadcastCursor({ visible: true, selector: `[data-eva-target="nav-${tab}"]`, label: `Opening ${tab}`, clicking: true, actor: 'Eva' })
          controlBus.broadcastUiCommand({ command: 'navigate_tab', tab })
          return {
            ok: true,
            summary: `Switched workspace to ${tab}`,
            raw: `Navigated Nexus UI to tab "${tab}" with live cursor indicator.`,
            display: { kind: 'text', text: `Opened tab: ${tab}` },
          }
        }
        if (action === 'open_split') {
          const validModes = [
            'reasoning',
            'self_heal',
            'browser',
            'terminal',
            'google_workspace',
            'mobile',
            'identity',
            'permissions',
            'devices',
            'org',
            'artifacts',
            'tools',
            'automations',
            'brain',
          ] as const
          const rawMode = str(args.mode)
          const mode = (validModes.includes(rawMode as (typeof validModes)[number])
            ? rawMode
            : 'browser') as (typeof validModes)[number]
          controlBus.broadcastCursor({ visible: true, selector: `[data-eva-target="split-${mode}"]`, label: `Opening split: ${mode}`, clicking: true, actor: 'Eva' })
          controlBus.broadcastUiCommand({
            command: 'open_split',
            mode,
            title: str(args.title) || undefined,
            url: str(args.url) || undefined,
          })
          return {
            ok: true,
            summary: `Opened split panel: ${mode}`,
            raw: `Opened right-hand split-screen panel in "${mode}" mode.`,
            display: { kind: 'text', text: `Split-screen opened: ${mode}` },
          }
        }
        if (action === 'close_split') {
          controlBus.broadcastUiCommand({ command: 'close_split' })
          controlBus.broadcastCursor({ visible: false })
          return {
            ok: true,
            summary: 'Closed split panel',
            raw: 'Closed the split-screen panel.',
            display: { kind: 'text', text: 'Split-screen panel closed.' },
          }
        }
        if (action === 'set_layout_mode') {
          const mode = str(args.mode) === 'focus' ? 'focus' : 'standard'
          controlBus.broadcastUiCommand({ command: 'set_layout_mode', mode })
          return {
            ok: true,
            summary: mode === 'focus' ? 'Switched to Voice Focus mode' : 'Switched to Standard workspace',
            raw: `Workspace layout switched to "${mode}" mode.`,
            display: { kind: 'text', text: `Layout mode: ${mode}` },
          }
        }
        if (action === 'toggle_sidebar') {
          const collapsed = typeof args.collapsed === 'boolean' ? args.collapsed : undefined
          controlBus.broadcastUiCommand({ command: 'toggle_sidebar', collapsed })
          return {
            ok: true,
            summary: collapsed === true ? 'Collapsed navigation rail' : collapsed === false ? 'Expanded navigation rail' : 'Toggled navigation rail',
            raw: `Navigation sidebar ${collapsed === true ? 'collapsed to slim rail' : collapsed === false ? 'expanded' : 'toggled'}.`,
            display: { kind: 'text', text: 'Updated sidebar rail state.' },
          }
        }
        if (action === 'open_gbrain_graph') {
          controlBus.broadcastUiCommand({ command: 'open_gbrain_graph' })
          return {
            ok: true,
            summary: 'Opened GBrain interactive knowledge graph',
            raw: 'Opened fullscreen interactive GBrain knowledge graph.',
            display: { kind: 'text', text: 'Interactive GBrain knowledge graph opened.' },
          }
        }
        if (action === 'open_popup') {
          const id = `pop_${Date.now().toString(36)}`
          const title = str(args.title, 'Eva Workspace Card')
          const body = str(args.body, '')
          const imageUrl = str(args.imageUrl) || str(args.image_url) || ''
          const actions = Array.isArray(args.actions)
            ? (args.actions as { label: string; tab?: string; splitMode?: string; url?: string }[])
            : undefined
          controlBus.broadcastUiCommand({
            command: 'open_popup',
            id,
            title,
            body,
            kind: 'action',
            actions,
          })
          if (imageUrl) {
            controlBus.broadcastVoiceStagePresent({
              id,
              kind: 'image',
              title,
              url: imageUrl,
              caption: body || undefined,
              sourceTool: 'app_control',
              createdAt: new Date().toISOString(),
            })
          }
          return {
            ok: true,
            summary: `Opened popup: ${title}`,
            raw: `Displayed interactive popup "${title}" to the user.`,
            display: { kind: 'text', text: `Popup opened: ${title}` },
          }
        }
        if (action === 'close_popup') {
          const popupId = str(args.id) || undefined
          controlBus.broadcastUiCommand({ command: 'close_popup', id: popupId })
          controlBus.broadcastVoiceStageDismiss(popupId)
          return { ok: true, summary: 'Closed popup', raw: 'Dismissed workspace popup.' }
        }
        if (action === 'click_target') {
          const selector = str(args.selector) || undefined
          const label = str(args.label) || undefined
          controlBus.broadcastCursor({
            visible: true,
            selector,
            label: label ? `Clicking "${label}"` : 'Clicking control',
            clicking: true,
            actor: 'Eva',
          })
          controlBus.broadcastUiCommand({ command: 'click_target', selector, label })
          return {
            ok: true,
            summary: `Clicked ${label ?? selector ?? 'target'}`,
            raw: `Guided Eva cursor and clicked target (${label ?? selector ?? 'control'}).`,
            display: { kind: 'text', text: `Clicked UI control: ${label ?? selector}` },
          }
        }
        if (action === 'set_theme') {
          const theme = str(args.theme) === 'light' ? 'light' : 'dark'
          controlBus.broadcastUiCommand({ command: 'set_theme', theme })
          return {
            ok: true,
            summary: `Switched theme to ${theme}`,
            raw: `Workspace theme switched to ${theme} mode.`,
            display: { kind: 'text', text: `Theme set to ${theme} mode.` },
          }
        }
        return { ok: false, summary: `Unknown app_control action: ${action}`, raw: `Unsupported app_control action "${action}".` }
      }

      case 'self_manage_extensions': {
        const action = str(args.action, 'list').toLowerCase()
        if (action === 'list') {
          const [plugins, skills, mcps] = await Promise.all([
            db.plugin.findMany({ orderBy: { name: 'asc' } }),
            db.skill.findMany({ orderBy: { name: 'asc' } }),
            db.mcpServer.findMany({ orderBy: { name: 'asc' } }),
          ])
          const raw = [
            `PLUGINS (${plugins.length}):`,
            ...plugins.map((p) => `- ${p.slug} (${p.name}): ${p.installed ? (p.enabled ? 'installed+on' : 'installed+off') : 'available'}`),
            `\nSKILLS (${skills.length}):`,
            ...skills.map((s) => `- ${s.slug} (${s.name}): ${s.enabled ? 'on' : 'off'}`),
            `\nMCP SERVERS (${mcps.length}):`,
            ...mcps.map((m) => `- ${m.slug} (${m.name}): ${m.status}`),
          ].join('\n')
          return { ok: true, summary: `${plugins.length} plugins, ${skills.length} skills, ${mcps.length} MCPs`, raw }
        }

        const slug = str(args.slug).trim()
        if (!slug) return { ok: false, summary: 'Missing slug', raw: 'Error: provide "slug" of the plugin, skill, tool, or MCP server.' }

        const extensionBinding = { actionName: 'extensions.' + action, target: slug, payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'self_install',
          actionSummary: `${action.replace(/_/g, ' ')}: ${slug}`,
          details: 'Allows Eva to self-install or configure plugins, skills, tools, and MCP servers autonomously.',
          ...extensionBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, extensionBinding)) {
          return {
            ok: false,
            summary: 'Self-install permission declined',
            raw: perm.reason ?? 'Permission declined for self_manage_extensions.',
            display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
          }
        }

        if (action === 'install_plugin' || action === 'uninstall_plugin' || action === 'toggle_plugin') {
          const plugin = await db.plugin.findUnique({ where: { slug } })
          if (!plugin) return { ok: false, summary: `Plugin not found: ${slug}`, raw: `No plugin found with slug "${slug}".` }
          const nextInstalled = action === 'install_plugin' ? true : action === 'uninstall_plugin' ? false : plugin.installed
          const nextEnabled =
            action === 'install_plugin'
              ? true
              : action === 'uninstall_plugin'
                ? false
                : typeof args.enabled === 'boolean'
                  ? args.enabled
                  : !plugin.enabled
          await db.plugin.update({
            where: { slug },
            data: { installed: nextInstalled, enabled: nextEnabled },
          })
          if (plugin.toolSlug) {
            if (nextInstalled) {
              await db.tool.upsert({
                where: { slug: plugin.toolSlug },
                create: {
                  slug: plugin.toolSlug,
                  name: plugin.name,
                  description: plugin.description,
                  source: `plugin:${plugin.slug}`,
                  enabled: nextEnabled,
                },
                update: { enabled: nextEnabled },
              })
            } else {
              await db.tool.updateMany({ where: { slug: plugin.toolSlug }, data: { enabled: false } }).catch(() => {})
            }
          }
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['plugins', 'tools'] })
          return {
            ok: true,
            summary: `Plugin ${plugin.name}: ${nextInstalled ? (nextEnabled ? 'installed & enabled' : 'disabled') : 'uninstalled'}`,
            raw: `Updated plugin "${plugin.name}" (${slug}) -> installed=${nextInstalled}, enabled=${nextEnabled}.`,
            display: { kind: 'text', text: `Eva updated plugin "${plugin.name}".` },
          }
        }

        if (action === 'toggle_skill') {
          const skill = await db.skill.findUnique({ where: { slug } })
          if (!skill) return { ok: false, summary: `Skill not found: ${slug}`, raw: `No skill found with slug "${slug}".` }
          const enabled = typeof args.enabled === 'boolean' ? args.enabled : !skill.enabled
          await db.skill.update({ where: { slug }, data: { enabled } })
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['skills'] })
          return { ok: true, summary: `Skill ${skill.name}: ${enabled ? 'enabled' : 'disabled'}`, raw: `Skill "${skill.name}" set to enabled=${enabled}.` }
        }

        if (action === 'toggle_tool') {
          const tool = await db.tool.findUnique({ where: { slug } })
          if (!tool) return { ok: false, summary: `Tool not found: ${slug}`, raw: `No tool found with slug "${slug}".` }
          const enabled = typeof args.enabled === 'boolean' ? args.enabled : !tool.enabled
          await db.tool.update({ where: { slug }, data: { enabled } })
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['tools'] })
          return { ok: true, summary: `Tool ${tool.name}: ${enabled ? 'enabled' : 'disabled'}`, raw: `Tool "${tool.name}" set to enabled=${enabled}.` }
        }

        if (action === 'connect_mcp' || action === 'disconnect_mcp') {
          const mcp = await db.mcpServer.findUnique({ where: { slug } })
          if (!mcp) return { ok: false, summary: `MCP server not found: ${slug}`, raw: `No MCP server found with slug "${slug}".` }
          const connected = action === 'connect_mcp'
          await db.mcpServer.update({
            where: { slug },
            data: { status: connected ? 'connected' : 'disconnected', enabled: connected },
          })
          controlBus.broadcastUiCommand({ command: 'refresh_state', scopes: ['mcps', 'tools'] })
          return {
            ok: true,
            summary: `MCP ${mcp.name}: ${connected ? 'connected' : 'disconnected'}`,
            raw: `MCP server "${mcp.name}" is now ${connected ? 'connected' : 'disconnected'}.`,
          }
        }

        return { ok: false, summary: `Unsupported action: ${action}`, raw: `Unknown self_manage_extensions action "${action}".` }
      }

      case 'device_control': {
        const {
          automationSession,
          evaluateAppPolicy,
          evaluateFolderAccess,
          listAllowedDesktopApps,
          listConnectedFolders,
        } = await import('@/lib/agent/computer-control')

        const action = str(args.action, 'list').toLowerCase()
        const devices = await listConnectedDevices()
        if (action === 'list') {
          if (devices.length === 0) {
            controlBus.broadcastUiCommand({ command: 'open_split', mode: 'devices', title: 'Connected Devices' })
            return {
              ok: true,
              summary: 'No local devices paired yet',
              raw: 'No connected desktop computers are paired yet. I opened the Connected Devices panel so the user can pair a Windows/macOS/Linux PC with one command.',
              display: { kind: 'text', text: 'Opened Connected Devices panel for one-time pairing.' },
            }
          }
          const raw = devices
            .map((d) => `- ${d.name} (${d.platform}, id: ${d.id}) — ${d.status.toUpperCase()}`)
            .join('\n')
          return { ok: true, summary: `${devices.filter((d) => d.status === 'online').length}/${devices.length} devices online`, raw }
        }

        const { getLocalHostDevice } = await import('@/lib/agent/device-bridge')
        const target =
          (str(args.deviceId) ? devices.find((d) => d.id === str(args.deviceId)) : null) ??
          devices.find((d) => d.status === 'online' && d.platform !== 'android' && d.platform !== 'ios') ??
          devices.find((d) => d.status === 'online') ??
          getLocalHostDevice()
        if (!target || target.status !== 'online') {
          // Seamless fallback: if action is shell, execute directly via local host terminal with permission
          if (action === 'shell' && (args.command || args.script)) {
            const command = str(args.command || args.script).trim()
            const terminalBinding = {
              actionName: 'terminal.exec',
              target: 'host',
              payload: { command, requestedTarget: 'host', requestedShell: 'powershell' },
            }
            const perm = await requireCapabilityPermission({
              capability: 'workspace_shell',
              actionSummary: `Run local PowerShell command: ${truncate(command, 90)}`,
              details: `Real local host PowerShell execution on ${os.hostname()}`,
              ...terminalBinding,
            })
            if (!perm.allowed || !verifyActionHash(perm.actionHash, terminalBinding)) {
              return {
                ok: false,
                summary: 'Permission declined for terminal command',
                raw: perm.reason ?? 'User declined execution permission.',
              }
            }
            const res = await terminalManager.execute({
              command,
              actor: 'eva',
              target: 'host',
              shell: 'powershell',
            })
            const outText = truncate(res.output || '(no output)', 5000)
            return {
              ok: res.ok,
              summary: `${res.targetLabel}: exit ${res.exitCode} (${res.durationMs}ms)`,
              raw: `[Local Windows Host] ${res.cwd}\n$ ${command}\nexit=${res.exitCode} (${res.durationMs}ms)\n${outText}`,
              display: {
                kind: 'code',
                code: command,
                output: truncate(outText, 1600),
                ok: res.ok,
              },
            }
          }

          if (action === 'system_info') {
            const cpus = os.cpus()
            const info = [
              `Host: ${os.hostname()}`,
              `Platform: ${os.platform()} (${os.type()} ${os.release()})`,
              `Arch: ${os.arch()}`,
              `CPU: ${cpus[0]?.model || 'Unknown'} (${cpus.length} cores)`,
              `Memory: ${Math.round(os.freemem() / 1024 / 1024)}MB free / ${Math.round(os.totalmem() / 1024 / 1024)}MB total`,
              `Uptime: ${Math.round(os.uptime() / 60)} minutes`,
            ].join('\n')
            return {
              ok: true,
              summary: `Host System: ${os.hostname()} (${os.platform()} ${os.arch()})`,
              raw: info,
              display: { kind: 'text', text: info },
            }
          }

          controlBus.broadcastUiCommand({ command: 'open_split', mode: 'devices', title: 'Connected Devices' })
          return {
            ok: false,
            summary: 'No online desktop bridge connected',
            raw: 'No external companion desktop is paired. For local system tasks, use tool "terminal_exec" to run real Windows PowerShell commands directly on this machine.',
            display: { kind: 'text', text: 'No external device connected. Use terminal_exec for local commands.' },
          }
        }

        // Pause / Takeover execution barrier
        const canProceed = await automationSession.waitIfPausedOrTakeover()
        if (!canProceed) {
          return {
            ok: false,
            summary: 'Desktop automation stopped by user',
            raw: 'Automation session was stopped by the user.',
            display: { kind: 'text', text: 'Stopped by user.' },
          }
        }

        // Connected Folders strict guard
        if (['list_folder', 'read_file', 'write_file', 'move_file', 'analyze_folder_images'].includes(action)) {
          const folders = await listConnectedFolders()
          const checkPaths =
            action === 'move_file'
              ? [str(args.from), str(args.to)]
              : [str(args.path)]
          const op = action === 'write_file' || action === 'move_file' ? 'write' : 'read'
          for (const p of checkPaths) {
            const guard = evaluateFolderAccess(p, op, folders)
            if (!guard.allowed) {
              controlBus.broadcastUiCommand({
                command: 'open_split',
                mode: 'permissions',
                title: 'Permissions & Connected Folders',
              })
              return {
                ok: false,
                summary: 'Blocked by Connected Folders allowlist',
                raw: guard.reason,
                display: { kind: 'text', text: guard.reason },
              }
            }
          }
        }

        // Per-App Allowlist strict guard
        const desktopBinding = { actionName: 'desktop.' + action, target: target.id, payload: args }
        if (action === 'open_app') {
          const apps = await listAllowedDesktopApps()
          const appName = str(args.app)
          const evalRes = evaluateAppPolicy(appName, apps)
          if (evalRes.policy === 'deny') {
            return {
              ok: false,
              summary: `App blocked by policy: ${appName}`,
              raw: `Blocked: "${appName}" is set to Deny in Permissions > Allowed Apps.`,
              display: { kind: 'text', text: `Blocked by Allowed Apps policy: ${appName}` },
            }
          }
          const willPromptDesktop = evalRes.policy === 'ask' && (await getCapabilityPolicy('desktop_bridge')) === 'ask'
          if (willPromptDesktop) {
            automationSession.setAwaitingApproval(`Launch ${appName} on ${target.name}`)
          }
          const appPerm = await requireCapabilityPermission({
            capability: 'desktop_bridge',
            actionSummary: `Launch app "${appName}" on ${target.name}`,
            details: JSON.stringify(args).slice(0, 180),
            ...desktopBinding,
          })
          if (willPromptDesktop) {
            automationSession.clearAwaitingApproval()
          }
          if (!appPerm.allowed || !verifyActionHash(appPerm.actionHash, desktopBinding)) {
            return {
              ok: false,
              summary: `Launch declined for ${appName}`,
              raw: appPerm.reason ?? `User declined launching ${appName}.`,
              display: { kind: 'text', text: appPerm.reason ?? 'App launch declined.' },
            }
          }
        } else {
          const perm = await requireCapabilityPermission({
            capability: 'desktop_bridge',
            actionSummary: `${action} on ${target.name} (${target.platform})`,
            details: JSON.stringify(args).slice(0, 180),
            ...desktopBinding,
          })
          if (!perm.allowed || !verifyActionHash(perm.actionHash, desktopBinding)) {
            return {
              ok: false,
              summary: 'Desktop bridge permission declined',
              raw: perm.reason ?? 'Permission declined for device_control.',
              display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
            }
          }
        }

        // Remote commands can execute arbitrary code. An app/device grant does not
        // implicitly approve shell access: require the workspace_shell capability too.
        if (action === 'shell' || action === 'powershell') {
          const shellPermission = await requireCapabilityPermission({
            capability: 'workspace_shell',
            actionSummary: 'Paired device shell: ' + action,
            ...desktopBinding,
          })
          if (!shellPermission.allowed || !verifyActionHash(shellPermission.actionHash, desktopBinding)) {
            return { ok: false, summary: 'Remote shell permission declined', raw: shellPermission.reason ?? 'Denied by workspace shell gate' }
          }
        }

        // Batch-analyze local images inside a Connected Folder using Gemini Vision
        if (action === 'analyze_folder_images') {
          const folderPath = str(args.path)
          const analysisPrompt =
            str(args.prompt) ||
            'Analyze these local images. For each item, write a crisp title, key visual attributes, and a ready-to-publish description.'
          const listRes = await controlBus.sendDeviceCommand(target.id, 'list_folder', { path: folderPath })
          if (!listRes.ok) {
            return {
              ok: false,
              summary: 'Failed to list connected folder',
              raw: listRes.error ?? listRes.output,
              display: { kind: 'text', text: `Error: ${listRes.error ?? listRes.output}` },
            }
          }

          let entries: { name: string; path?: string; isDir?: boolean; kind?: string }[] = []
          try {
            const parsed = JSON.parse(listRes.output) as { items?: typeof entries; entries?: typeof entries }
            entries = Array.isArray(parsed.items)
              ? parsed.items
              : Array.isArray(parsed.entries)
                ? parsed.entries
                : []
          } catch {
            entries = []
          }

          const imageFiles = entries
            .filter((e) => !e.isDir && e.kind !== 'dir' && /\.(png|jpe?g|webp)$/i.test(e.name))
            .slice(0, 5)

          if (imageFiles.length === 0) {
            return {
              ok: true,
              summary: 'No images found in folder',
              raw: `No .png, .jpg, or .webp images found in ${folderPath}.`,
              display: { kind: 'text', text: `No image files found in ${folderPath}.` },
            }
          }

          const apiKey = process.env.GEMINI_API_KEY?.trim()
          if (!apiKey) {
            return {
              ok: false,
              summary: 'GEMINI_API_KEY missing for image analysis',
              raw: 'GEMINI_API_KEY is not configured on the server.',
            }
          }

          const { GoogleGenAI, ThinkingLevel } = await import('@google/genai')
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          })

          const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = []
          const loadedNames: string[] = []
          for (const file of imageFiles) {
            const fullPath = file.path || `${folderPath}\\${file.name}`
            const readRes = await controlBus.sendDeviceCommand(target.id, 'read_file', {
              path: fullPath,
              encoding: 'base64',
            })
            if (readRes.ok && readRes.output) {
              const ext = file.name.split('.').pop()?.toLowerCase()
              let mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
              let base64Data = readRes.output.trim()
              try {
                const parsedImg = JSON.parse(base64Data) as { base64?: string; mimeType?: string }
                if (parsedImg && typeof parsedImg.base64 === 'string') {
                  base64Data = parsedImg.base64
                  if (parsedImg.mimeType) mimeType = parsedImg.mimeType
                }
              } catch {
                /* raw base64 output */
              }
              parts.push({ text: `File: ${file.name}` })
              parts.push({ inlineData: { mimeType, data: base64Data } })
              loadedNames.push(file.name)
            }
          }

          if (loadedNames.length === 0) {
            return {
              ok: false,
              summary: 'Could not read image bytes from connected folder',
              raw: 'None of the detected image files could be read from the bridge.',
            }
          }

          parts.push({ text: analysisPrompt })
          const visionRes = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts },
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          })
          const analysis = (visionRes.text ?? '').trim()
          return {
            ok: true,
            summary: `Analyzed ${loadedNames.length} image(s) from ${folderPath}`,
            raw: analysis,
            display: { kind: 'text', text: analysis },
          }
        }

        const res = await controlBus.sendDeviceCommand(target.id, action, args)
        return {
          ok: res.ok,
          summary: res.ok ? `Executed ${action} on ${target.name}` : `Device action failed: ${res.error ?? 'error'}`,
          raw: res.ok ? res.output : `Error: ${res.error ?? res.output}`,
          display: { kind: 'text', text: res.ok ? `${target.name}: ${truncate(res.output, 600)}` : `Error: ${res.error}` },
        }
      }

      case 'mobile_control': {
        const { mobileManager } = await import('@/lib/agent/mobile-manager')
        const action = str(args.action, 'status').toLowerCase()

        if (action !== 'status' && action !== 'list_apps') {
          const mobileBinding = { actionName: 'mobile.' + action, target: str(args.deviceId) || 'mobile_device', payload: args }
          const perm = await requireCapabilityPermission({
            capability: 'mobile_control',
            actionSummary: `Android / Mobile takeover: ${action}${str(args.goal || args.app || args.target || args.setting) ? ` (${str(args.goal || args.app || args.target || args.setting).slice(0, 60)})` : ''}`,
            details: JSON.stringify(args).slice(0, 200),
            ...mobileBinding,
          })
          if (!perm.allowed || !verifyActionHash(perm.actionHash, mobileBinding)) {
            return {
              ok: false,
              summary: 'Mobile takeover permission declined',
              raw: perm.reason ?? 'Permission declined for mobile_control.',
              display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
            }
          }
        }

        const res = await mobileManager.execute(
          {
            action: action as Parameters<typeof mobileManager.execute>[0]['action'],
            app: str(args.app) || undefined,
            target: str(args.target) || undefined,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
            fromX: typeof args.fromX === 'number' ? args.fromX : undefined,
            fromY: typeof args.fromY === 'number' ? args.fromY : undefined,
            toX: typeof args.toX === 'number' ? args.toX : undefined,
            toY: typeof args.toY === 'number' ? args.toY : undefined,
            direction: (['up', 'down', 'left', 'right'].includes(str(args.direction))
              ? str(args.direction)
              : undefined) as 'up' | 'down' | 'left' | 'right' | undefined,
            text: str(args.text) || undefined,
            key: str(args.key) || undefined,
            setting: str(args.setting) || undefined,
            enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
            url: str(args.url) || undefined,
            goal: str(args.goal) || undefined,
            deviceId: str(args.deviceId) || undefined,
            open: typeof args.open === 'boolean' ? args.open : undefined,
          },
          { broadcast: true, openPanel: true }
        )

        return {
          ok: res.ok,
          summary: res.summary,
          raw: res.output,
          display: { kind: 'text', text: res.output },
        }
      }

      case 'self_heal_code': {
        const {
          applySelfHealPatch,
          inspectAppCode,
          rollbackSelfHealSession,
          runAutonomousSelfHeal,
          verifyAppBuild,
        } = await import('@/lib/agent/self-heal')

        const action = str(args.action || 'inspect').toLowerCase()

        if (action === 'inspect') {
          const mode = (['list', 'search', 'read'].includes(str(args.mode)) ? str(args.mode) : 'list') as
            | 'list'
            | 'search'
            | 'read'
          const res = await inspectAppCode({
            mode,
            path: str(args.path) || undefined,
            query: str(args.query) || undefined,
            startLine: typeof args.startLine === 'number' ? args.startLine : undefined,
            endLine: typeof args.endLine === 'number' ? args.endLine : undefined,
          })
          return {
            ok: res.ok,
            summary: res.ok ? `Inspected app code (${mode})` : `Code inspection failed`,
            raw: truncate(res.output, 6000),
            display: { kind: 'text', text: truncate(res.output, 900) },
          }
        }

        if (action === 'verify') {
          controlBus.broadcastUiCommand({ command: 'open_split', mode: 'self_heal', title: 'Self-Heal Studio' })
          const verification = await verifyAppBuild({ testFile: str(args.testFile) || undefined })
          return {
            ok: verification.ok,
            summary: verification.ok
              ? `Build verification passed (${verification.durationMs}ms)`
              : `Build verification failed (${verification.durationMs}ms)`,
            raw: verification.output,
            display: {
              kind: 'text',
              text: `${verification.ok ? 'PASS' : 'FAIL'} · ${verification.command} (${verification.durationMs}ms)\n${truncate(verification.output, 800)}`,
            },
          }
        }

        if (action === 'rollback') {
          const sessionId = str(args.sessionId)
          if (!sessionId) {
            return { ok: false, summary: 'Missing sessionId for rollback', raw: 'Error: sessionId is required.' }
          }
          const rollbackBinding = { actionName: 'self_heal.rollback', target: sessionId, payload: args }
          const rollbackPermission = await requireCapabilityPermission({
            capability: 'self_code_edit',
            actionSummary: 'Rollback self-heal snapshot: ' + sessionId,
            ...rollbackBinding,
          })
          if (!rollbackPermission.allowed || !verifyActionHash(rollbackPermission.actionHash, rollbackBinding)) {
            return { ok: false, summary: 'Self-heal rollback not approved', raw: rollbackPermission.reason ?? 'Approval required' }
          }
          const res = await rollbackSelfHealSession(sessionId)
          controlBus.broadcastUiCommand({ command: 'open_split', mode: 'self_heal', title: 'Self-Heal Studio' })
          return {
            ok: res.ok,
            summary: `Rolled back ${res.restored.length + res.deleted.length} file(s)`,
            raw: res.session.summary || 'Snapshot restored.',
            display: { kind: 'text', text: res.session.summary || 'Snapshot restored cleanly.' },
          }
        }

        // Mutating actions ('patch' or 'auto_heal') require one-time self_code_edit permission
        const repairBinding = { actionName: 'self_heal.' + action, target: str(args.path || 'nexus_source'), payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'self_code_edit',
          actionSummary:
            action === 'auto_heal'
              ? `Self-heal issue: ${truncate(str(args.errorMessage || args.title || 'App error'), 120)}`
              : `Patch app code: ${truncate(str(args.title || 'Apply verified fix'), 120)}`,
          details: Array.isArray(args.edits)
            ? (args.edits as { path?: string }[]).map((e) => e.path).filter(Boolean).join(', ')
            : str(args.path) || undefined,
          ...repairBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, repairBinding)) {
          return {
            ok: false,
            summary: 'Self-healing code permission declined',
            raw: perm.reason ?? 'Permission declined for self_code_edit.',
            display: { kind: 'text', text: perm.reason ?? 'Permission declined for self_code_edit.' },
          }
        }

        controlBus.broadcastUiCommand({ command: 'open_split', mode: 'self_heal', title: 'Self-Heal Studio' })
        controlBus.broadcastEvaMood('working', 'Self-healing app code…', 15_000)

        if (action === 'auto_heal') {
          const res = await runAutonomousSelfHeal({
            trigger: 'agent_tool',
            errorMessage: str(args.errorMessage || args.title || 'Diagnose and repair current app issue'),
            stack: str(args.stack) || undefined,
            viewName: str(args.viewName) || undefined,
            targetFileHint: str(args.path) || undefined,
          })
          controlBus.broadcastEvaMood(
            res.ok ? 'happy' : 'curious',
            res.ok ? 'Self-heal verified' : 'Self-heal completed with findings',
            2600
          )
          const brainSummary = res.session.brainContext?.learnedLesson
            ? `\nPortable Brain Lesson Saved: ${res.session.brainContext.learnedLesson}`
            : ''
          const capSummary = res.session.capabilityUpgrade?.applied
            ? `\nCapability Upgraded: Enabled skill "${res.session.capabilityUpgrade.name}"`
            : ''
          return {
            ok: res.ok,
            summary: res.ok
              ? `Self-heal verified (${res.session.patches.length} file(s), ${res.session.attemptsUsed ?? 1} attempt(s))`
              : 'Self-heal could not auto-verify',
            raw: `${res.message}\nSession ID: ${res.session.id}\nAttempts: ${res.session.attemptsUsed ?? 1}\nPortable Brain Recalled: ${res.session.brainContext?.recalledCount ?? 0} memories${brainSummary}${capSummary}\nSnapshot rollback available: ${res.session.canRollback}`,
            display: { kind: 'text', text: `${res.message}${capSummary}\nSession: ${res.session.id}` },
          }
        }

        if (action === 'patch') {
          const edits = Array.isArray(args.edits) ? (args.edits as Parameters<typeof applySelfHealPatch>[0]['edits']) : []
          const res = await applySelfHealPatch({
            sessionId: str(args.sessionId) || undefined,
            trigger: 'agent_tool',
            title: str(args.title || 'Eva self-healing patch'),
            errorContext: str(args.errorMessage) || undefined,
            edits,
            verify: args.verify !== false,
            autoRollbackOnFail: args.autoRollbackOnFail !== false,
            testFile: str(args.testFile) || undefined,
          })
          controlBus.broadcastEvaMood(
            res.ok ? 'happy' : 'error',
            res.ok ? 'Code patch verified' : 'Patch failed typecheck & rolled back',
            2600
          )
          return {
            ok: res.ok,
            summary: res.ok
              ? `Verified patch across ${res.session.patches.length} file(s) (session ${res.session.id})`
              : 'Patch failed verification and auto-rolled back',
            raw: res.ok
              ? `${res.session.summary}\nSession ID: ${res.session.id}\nPatched files: ${res.session.patches.map((p) => p.path).join(', ')}`
              : `Error: ${res.error}\nSession ID: ${res.session.id}`,
            display: {
              kind: 'text',
              text: res.ok
                ? `Verified patch (${res.session.id}): ${res.session.patches.map((p) => `${p.path} (+${p.addedLines}/-${p.removedLines})`).join(', ')}`
                : `Auto-rolled back (${res.session.id}): ${truncate(res.error || 'Verification failed', 500)}`,
            },
          }
        }

        return { ok: false, summary: `Unknown self_heal_code action: ${action}`, raw: `Unsupported action "${action}".` }
      }

      case 'terminal_exec': {
        const action = str(args.action, args.command ? 'exec' : 'status').toLowerCase()
        // Always open the real live Terminal split panel so the user watches real commands & output
        controlBus.broadcastUiCommand({
          command: 'open_split',
          mode: 'terminal',
          title: 'Terminal · PowerShell',
        })

        if (action === 'status') {
          const snap = terminalManager.getSnapshot()
          const devices = await listConnectedDevices()
          const desktops = devices.filter((d) => d.platform !== 'android' && d.platform !== 'ios')
          const onlineDesktops = desktops.filter((d) => d.status === 'online')
          const summary = `Terminal active: ${snap.target === 'windows_pc' ? `${snap.deviceName} (Windows PowerShell)` : `${snap.shell} on ${snap.hostPlatform}`}`
          const raw = [
            `Active Target: ${snap.target} (${snap.shell} via ${snap.shellBinary})`,
            `Current Directory: ${snap.cwd}`,
            `Host Platform: ${snap.hostPlatform}`,
            `Available Host Shells: ${snap.availableHostShells.join(', ') || 'none'}`,
            `Connected Desktop Computers (${onlineDesktops.length}): ${onlineDesktops.map((d) => `${d.name} [${d.platform}, id=${d.id}, status=${d.status}]`).join(', ')}`,
          ].join('\n')
          return { ok: true, summary, raw, display: { kind: 'text', text: raw } }
        }

        if (action === 'clear') {
          terminalManager.clear()
          return { ok: true, summary: 'Cleared terminal console', raw: 'Cleared terminal output buffer.' }
        }

        if (action === 'interrupt') {
          const res = terminalManager.interrupt()
          return { ok: res.ok, summary: res.message, raw: res.message }
        }

        if (action === 'set_target') {
          const target: TerminalTarget = str(args.target) === 'windows_pc' ? 'windows_pc' : 'host'
          const shellArg = str(args.shell) as TerminalShellKind | ''
          const snap = await terminalManager.setTarget({
            target,
            deviceId: str(args.deviceId) || null,
            shell: shellArg || undefined,
          })
          return {
            ok: true,
            summary: `Switched terminal to ${snap.target === 'windows_pc' ? `${snap.deviceName} PowerShell` : snap.shell}`,
            raw: `Terminal target is now ${snap.target} (${snap.shell}, cwd=${snap.cwd}).`,
          }
        }

        if (action === 'pair_windows') {
          return {
            ok: true,
            summary: `This PC (${os.hostname()}) is already automatically connected!`,
            raw: `Your host computer (${os.hostname()} - This PC) is ALREADY automatically connected and online with full native Windows PowerShell and desktop control. You do NOT need to go to Devices or pair anything for this computer! I can execute any command, install software, open apps, or control the desktop directly after asking your permission.`,
            display: { kind: 'text', text: `This PC (${os.hostname()}) is already automatically connected.` },
          }
        }

        // Default: exec a real OS shell / PowerShell command
        const command = str(args.command || args.script).trim()
        if (!command) {
          return { ok: false, summary: 'Missing command', raw: 'Error: provide "command" (the real PowerShell or shell command to execute).' }
        }

        const requestedTarget = (str(args.target, 'auto') as TerminalTarget | 'auto') || 'auto'
        const requestedShell = (str(args.shell) as TerminalShellKind | '') || undefined
        const devices = await listConnectedDevices()
        const remoteDesktop =
          (str(args.deviceId) && str(args.deviceId) !== 'local_host'
            ? devices.find((d) => d.id === str(args.deviceId) && d.status === 'online')
            : null) ??
          devices.find((d) => d.id !== 'local_host' && d.status === 'online' && d.platform === 'windows') ??
          devices.find((d) => d.id !== 'local_host' && d.status === 'online' && d.platform !== 'android' && d.platform !== 'ios')

        const willUseRemoteDesktop =
          (requestedTarget === 'windows_pc' && Boolean(remoteDesktop)) ||
          (requestedTarget === 'auto' &&
            Boolean(remoteDesktop) &&
            (requestedShell === 'powershell' ||
              requestedShell === 'pwsh' ||
              terminalManager.getSnapshot().target === 'windows_pc'))

        const terminalBinding = {
          actionName: 'terminal.exec',
          target: willUseRemoteDesktop ? str(args.deviceId || remoteDesktop?.id) : 'host',
          payload: { command, requestedTarget, requestedShell, cwd: args.cwd, timeoutMs: args.timeoutMs },
        }
        const perm = await requireCapabilityPermission({
          capability: willUseRemoteDesktop ? 'desktop_bridge' : 'workspace_shell',
          actionSummary: `Run ${willUseRemoteDesktop ? 'remote Windows PowerShell' : process.platform === 'win32' ? 'local Windows PowerShell' : 'Terminal'} command: ${truncate(command, 90)}`,
          details: willUseRemoteDesktop
            ? `Real Windows PowerShell execution on ${remoteDesktop?.name ?? 'paired Windows PC'}`
            : `Real local host command on ${os.hostname()} in ${terminalManager.getSnapshot().cwd}`,
          ...terminalBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, terminalBinding)) {
          return {
            ok: false,
            summary: `Permission declined for terminal command`,
            raw: perm.reason ?? 'User declined terminal execution permission.',
            display: { kind: 'text', text: perm.reason ?? 'Permission declined.' },
          }
        }

        if (willUseRemoteDesktop) {
          const shellPermission = await requireCapabilityPermission({
            capability: 'workspace_shell',
            actionSummary: 'Authorize remote shell command: ' + truncate(command, 90),
            ...terminalBinding,
          })
          if (!shellPermission.allowed || !verifyActionHash(shellPermission.actionHash, terminalBinding)) {
            return { ok: false, summary: 'Remote shell permission declined', raw: shellPermission.reason ?? 'Approval required' }
          }
        }

        const execRes = await terminalManager.execute({
          command,
          actor: 'eva',
          target: requestedTarget,
          deviceId: str(args.deviceId) || null,
          shell: requestedShell || undefined,
          cwd: str(args.cwd) || undefined,
          timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
        })

        const outText = truncate(execRes.output || '(no output)', 5000)
        return {
          ok: execRes.ok,
          summary: `${execRes.targetLabel}: exit ${execRes.exitCode} (${execRes.durationMs}ms)`,
          raw: `[${execRes.targetLabel}] ${execRes.cwd}\n$ ${command}\nexit=${execRes.exitCode} (${execRes.durationMs}ms)\n${outText}`,
          display: {
            kind: 'code',
            code: command,
            output: truncate(outText, 1600),
            ok: execRes.ok,
          },
        }
      }

      case 'composio_action': {
        const plugin = await db.plugin.findUnique({ where: { slug: 'composio-connect' } })
        if (!plugin || !plugin.installed || !plugin.enabled) {
          return {
            ok: false,
            summary: 'Composio not configured',
            raw: 'Composio is not connected. Configure your Composio API key or MCP URL in Settings > Connect.',
          }
        }
        let cfg: { apiKey?: string; mcpUrl?: string; userId?: string } = {}
        try {
          cfg = JSON.parse(plugin.configJson) as typeof cfg
        } catch { /* ignore */ }
        const action = str(args.action, 'list_accounts').toLowerCase()

        if (!cfg.apiKey && cfg.mcpUrl) {
          // Proxy MCP JSON-RPC call when only a Composio MCP URL is configured
          const binding = { actionName: 'composio.mcp', target: cfg.mcpUrl, payload: args }
          const perm = await requireCapabilityPermission({
            capability: 'self_install',
            actionSummary: `Run Composio MCP action: ${str(args.toolSlug || action)}`,
            details: 'External service action via Composio MCP URL',
            ...binding,
          })
          if (!perm.allowed || !verifyActionHash(perm.actionHash, binding)) {
            return { ok: false, summary: 'Composio action declined', raw: perm.reason ?? 'Permission declined.' }
          }
          const res = await fetchPublicExternalUrl(cfg.mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Date.now(),
              method: action === 'list_tools' ? 'tools/list' : 'tools/call',
              params:
                action === 'list_tools'
                  ? {}
                  : { name: str(args.toolSlug), arguments: (args.input as Record<string, unknown>) ?? {} },
            }),
            signal: AbortSignal.timeout(15_000),
          })
          const text = await res.text()
          return {
            ok: res.ok,
            summary: `Composio MCP: HTTP ${res.status}`,
            raw: truncate(text, 4500),
            display: { kind: 'text', text: truncate(text, 1200) },
          }
        }

        if (!cfg.apiKey) {
          return {
            ok: false,
            summary: 'Composio API key missing',
            raw: 'No Composio API key saved. Add it in Settings > Connect.',
          }
        }

        if (action === 'list_accounts') {
          const qs = cfg.userId ? `?user_id=${encodeURIComponent(cfg.userId)}&limit=30` : '?limit=30'
          const res = await fetchPublicExternalUrl(`https://backend.composio.dev/api/v3/connected_accounts${qs}`, {
            headers: { 'x-api-key': cfg.apiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(12_000),
          })
          const text = await res.text()
          return {
            ok: res.ok,
            summary: `Composio connected accounts (HTTP ${res.status})`,
            raw: truncate(text, 4500),
            display: { kind: 'text', text: truncate(text, 1200) },
          }
        }

        if (action === 'list_tools') {
          const toolkit = str(args.toolkit).trim()
          const qs = toolkit ? `?toolkit_slug=${encodeURIComponent(toolkit)}&limit=30` : '?limit=30'
          const res = await fetchPublicExternalUrl(`https://backend.composio.dev/api/v3/tools${qs}`, {
            headers: { 'x-api-key': cfg.apiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(12_000),
          })
          const text = await res.text()
          return {
            ok: res.ok,
            summary: `Composio tools${toolkit ? ` (${toolkit})` : ''} (HTTP ${res.status})`,
            raw: truncate(text, 4500),
            display: { kind: 'text', text: truncate(text, 1200) },
          }
        }

        const toolSlug = str(args.toolSlug).trim()
        if (!toolSlug) {
          return { ok: false, summary: 'Missing toolSlug', raw: 'Error: provide "toolSlug" (e.g. GMAIL_SEND_EMAIL).' }
        }
        const composioBinding = { actionName: `composio.${toolSlug}`, target: 'composio', payload: args }
        const perm = await requireCapabilityPermission({
          capability: 'self_install',
          actionSummary: `Execute Composio tool: ${toolSlug}`,
          details: JSON.stringify(args.input ?? {}).slice(0, 200),
          ...composioBinding,
        })
        if (!perm.allowed || !verifyActionHash(perm.actionHash, composioBinding)) {
          return {
            ok: false,
            summary: `Composio action declined: ${toolSlug}`,
            raw: perm.reason ?? 'Permission declined for Composio execution.',
          }
        }
        const payload: Record<string, unknown> = {
          input: (args.input && typeof args.input === 'object' ? args.input : {}) as Record<string, unknown>,
        }
        if (str(args.connectedAccountId)) payload.connected_account_id = str(args.connectedAccountId)
        else if (cfg.userId) payload.user_id = cfg.userId

        const res = await fetchPublicExternalUrl(
          `https://backend.composio.dev/api/v3.1/tools/execute/${encodeURIComponent(toolSlug)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': cfg.apiKey,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20_000),
          }
        )
        const text = await res.text()
        return {
          ok: res.ok,
          summary: `Composio ${toolSlug}: HTTP ${res.status}`,
          raw: truncate(text, 4500),
          display: { kind: 'text', text: truncate(text, 1200) },
        }
      }

      default: {
        // ---- Custom plugins, connected HTTP services & MCP tools ----
        const plugin = await db.plugin.findFirst({ where: { toolSlug: slug, installed: true } })
        if (plugin) {
          let cfg: {
            type?: string
            instructions?: string
            endpoint?: string
            authHeaderName?: string
            authHeaderValue?: string
          } = {}
          try {
            cfg = JSON.parse(plugin.configJson) as typeof cfg
          } catch { /* ignore */ }
          const input = str(args.input ?? args.text ?? args.query ?? JSON.stringify(args))
          if (cfg.type === 'http' && cfg.endpoint) {
            if (plugin.source === 'connect') {
              const svcBinding = { actionName: `connect.${plugin.slug}`, target: cfg.endpoint, payload: args }
              const perm = await requireCapabilityPermission({
                capability: 'self_install',
                actionSummary: `Call connected service: ${plugin.name}`,
                details: `${cfg.endpoint} · ${input.slice(0, 140)}`,
                ...svcBinding,
              })
              if (!perm.allowed || !verifyActionHash(perm.actionHash, svcBinding)) {
                return {
                  ok: false,
                  summary: `${plugin.name} declined`,
                  raw: perm.reason ?? 'Permission declined for connected service.',
                }
              }
            }
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 12000)
            try {
              const headers: Record<string, string> = { 'Content-Type': 'application/json' }
              if (cfg.authHeaderName && cfg.authHeaderValue) {
                headers[cfg.authHeaderName] = cfg.authHeaderValue
              }
              const res = await fetchPublicExternalUrl(cfg.endpoint, {
                method: 'POST',
                headers,
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
            } catch (err) {
              if (err instanceof SsrfBlockedError) {
                return { ok: false, summary: `${plugin.name}: blocked redirect`, raw: err.message }
              }
              throw err
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

        // Remote or simulated MCP tool (custom MCP server added by user)
        if (slug.includes('.')) {
          const prefix = slug.split('.')[0]
          const servers = await db.mcpServer.findMany()
          const server = servers.find((s) => s.slug === prefix)
          if (server) {
            let tools: { slug: string; name: string; description: string }[] = []
            try {
              tools = JSON.parse(server.toolsJson) as typeof tools
            } catch { /* ignore */ }
            let srvCfg: { endpoint?: string; authHeaderName?: string; authHeaderValue?: string } = {}
            try {
              srvCfg = JSON.parse(server.configJson) as typeof srvCfg
            } catch { /* ignore */ }
            const toolDef = tools.find((t) => t.slug === slug)
            const input = str(args.input ?? args.text ?? args.query ?? JSON.stringify(args))

            if (server.mode === 'remote' && srvCfg.endpoint) {
              const mcpBinding = { actionName: `mcp.${slug}`, target: srvCfg.endpoint, payload: args }
              const perm = await requireCapabilityPermission({
                capability: 'self_install',
                actionSummary: `Call remote MCP ${server.name}: ${toolDef?.name ?? slug}`,
                details: srvCfg.endpoint,
                ...mcpBinding,
              })
              if (!perm.allowed || !verifyActionHash(perm.actionHash, mcpBinding)) {
                return {
                  ok: false,
                  summary: `${server.name} declined`,
                  raw: perm.reason ?? 'Permission declined for remote MCP.',
                }
              }
              const headers: Record<string, string> = { 'Content-Type': 'application/json' }
              if (srvCfg.authHeaderName && srvCfg.authHeaderValue) {
                headers[srvCfg.authHeaderName] = srvCfg.authHeaderValue
              }
              const res = await fetchPublicExternalUrl(srvCfg.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: Date.now(),
                  method: 'tools/call',
                  params: { name: toolDef?.name ?? slug, arguments: args },
                }),
                signal: AbortSignal.timeout(15_000),
              })
              const text = await res.text()
              return {
                ok: res.ok,
                summary: `${server.name} · ${toolDef?.name ?? slug} (HTTP ${res.status})`,
                raw: truncate(text, 4000),
                display: { kind: 'text', text: truncate(text, 1200) },
              }
            }

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
