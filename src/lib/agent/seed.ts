import { db } from '@/lib/db'

let seeded = false

/** Default skill catalog — shared between seeding and the marketplace (restore / reinstall). */
export const DEFAULT_SKILLS: {
  slug: string
  name: string
  description: string
  category: string
  icon: string
  prompt: string
}[] = [
  {
    slug: 'research-analysis',
    name: 'Research & Analysis',
    description:
      'Systematic web research: gather sources, verify facts, compare options, synthesize findings.',
    category: 'research',
    icon: 'search',
    prompt:
      'Research methodology: break the question into sub-queries, run targeted web searches, cross-check at least two sources, note dates and URLs, and synthesize an evidence-based conclusion. Flag uncertainty explicitly.',
  },
  {
    slug: 'creative-writing',
    name: 'Creative Writing',
    description: 'Stories, copywriting, taglines, brand voice, poems and narrative content.',
    category: 'writing',
    icon: 'pen',
    prompt:
      'Creative writing craft: know the audience, pick a strong hook, vary sentence rhythm, show-don\u2019t-tell, and land a memorable close. Match tone to purpose (playful, premium, urgent).',
  },
  {
    slug: 'data-analysis',
    name: 'Data Analysis',
    description: 'Crunch numbers, statistics, comparisons and computations with the code runner.',
    category: 'data',
    icon: 'chart',
    prompt:
      'Data discipline: state assumptions, compute with code (never in your head), sanity-check magnitudes, and present results with units, context and one actionable takeaway.',
  },
  {
    slug: 'visual-design',
    name: 'Visual Design',
    description: 'Art direction for generated images: style, composition, lighting, palette.',
    category: 'creative',
    icon: 'image',
    prompt:
      'Art direction: specify subject, style, composition, lighting, color palette and mood in image prompts. Prefer concrete visual language over vague adjectives.',
  },
  {
    slug: 'web-development',
    name: 'Web Development',
    description: 'Building web pages and apps: architecture, components, styling, best practices.',
    category: 'developer',
    icon: 'code',
    prompt:
      'Engineering rigor: clarify requirements, choose simple architecture, write clean typed code, handle loading/error states, and verify behavior end-to-end.',
  },
  {
    slug: 'travel-planning',
    name: 'Travel Planning',
    description: 'Itineraries, logistics, budgets, timing and destination research.',
    category: 'lifestyle',
    icon: 'map',
    prompt:
      'Trip planning: check current info via web search (seasons, prices, visa rules), build day-by-day itineraries with realistic travel times, and include budget estimates and alternatives.',
  },
  {
    slug: 'product-strategy',
    name: 'Product Strategy',
    description: 'PRDs, roadmaps, positioning, go-to-market and competitor analysis.',
    category: 'business',
    icon: 'target',
    prompt:
      'Strategy thinking: define the user and problem, ground claims in market evidence, structure documents with goals/non-goals, and end with measurable success criteria.',
  },
]

/** Idempotent seeding of the default capability registry. */
export async function ensureSeeded() {
  if (seeded) return
  try {
    // ---------- Plugins ----------
    const plugins: {
      slug: string
      name: string
      description: string
      category: string
      icon: string
      source: string
      installed: boolean
      toolSlug: string
      config: Record<string, unknown>
    }[] = [
      {
        slug: 'web-search',
        name: 'Web Search',
        description:
          'Searches the live web for fresh information, news, prices, facts and current events.',
        category: 'research',
        icon: 'globe',
        source: 'builtin',
        installed: true,
        toolSlug: 'web_search',
        config: { type: 'builtin' },
      },
      {
        slug: 'image-gen',
        name: 'Image Generator',
        description:
          'Creates original AI images from a text prompt — logos, art, illustrations, concepts.',
        category: 'creative',
        icon: 'palette',
        source: 'builtin',
        installed: true,
        toolSlug: 'generate_image',
        config: { type: 'builtin' },
      },
      {
        slug: 'code-runner',
        name: 'Code Runner',
        description:
          'Runs JavaScript in a secure sandbox — math, data crunching, simulations, quick algorithms.',
        category: 'developer',
        icon: 'terminal',
        source: 'builtin',
        installed: true,
        toolSlug: 'run_code',
        config: { type: 'builtin' },
      },
      {
        slug: 'image-search',
        name: 'Image Search',
        description:
          'Finds real photos and images from across the web for any topic or query.',
        category: 'research',
        icon: 'camera',
        source: 'builtin',
        installed: true,
        toolSlug: 'search_images',
        config: { type: 'builtin' },
      },
      {
        slug: 'voice-speak',
        name: 'Voice Speak',
        description:
          'Converts any text into natural-sounding speech audio you can play in the browser.',
        category: 'audio',
        icon: 'audio',
        source: 'marketplace',
        installed: false,
        toolSlug: 'tts_speak',
        config: { type: 'builtin' },
      },
      {
        slug: 'web-reader',
        name: 'Web Reader',
        description:
          'Opens and reads a specific web page in full — for deep research beyond search snippets.',
        category: 'research',
        icon: 'book',
        source: 'marketplace',
        installed: false,
        toolSlug: 'read_url',
        config: { type: 'builtin' },
      },
      {
        slug: 'translator',
        name: 'Translator',
        description:
          'Translates text between any languages with natural, context-aware phrasing.',
        category: 'language',
        icon: 'languages',
        source: 'marketplace',
        installed: false,
        toolSlug: 'translate',
        config: {
          type: 'llm',
          instructions:
            'You are a professional translator. Translate the given text into the target language. Preserve tone and meaning. Respond with the translation only.',
        },
      },
      {
        slug: 'doc-writer',
        name: 'Doc Writer',
        description:
          'Drafts structured documents — reports, proposals, emails, specs with clean sections.',
        category: 'writing',
        icon: 'file-text',
        source: 'marketplace',
        installed: false,
        toolSlug: 'doc_write',
        config: {
          type: 'llm',
          instructions:
            'You are an expert document writer. Given a topic and requirements, produce a well-structured markdown document with headings, lists and clear prose.',
        },
      },
    ]

    for (const p of plugins) {
      await db.plugin.upsert({
        where: { slug: p.slug },
        update: {
          name: p.name,
          description: p.description,
          category: p.category,
          icon: p.icon,
          source: p.source,
          toolSlug: p.toolSlug,
          configJson: JSON.stringify(p.config),
        },
        create: {
          slug: p.slug,
          name: p.name,
          description: p.description,
          category: p.category,
          icon: p.icon,
          source: p.source,
          installed: p.installed,
          enabled: true,
          toolSlug: p.toolSlug,
          configJson: JSON.stringify(p.config),
        },
      })
    }

    // ---------- Tools (only for installed plugins + builtin) ----------
    const tools: {
      slug: string
      name: string
      description: string
      source: string
    }[] = [
      {
        slug: 'save_memory',
        name: 'Save Memory',
        description:
          'Save an important fact, preference, insight or decision to the app memory for future missions.',
        source: 'builtin',
      },
      {
        slug: 'recall_memory',
        name: 'Recall Memory',
        description:
          'Graph-first memory recall: walks the entity graph under a token budget, keyword fallback. Args: {"query": string, "limit"?: number}',
        source: 'builtin',
      },
      {
        slug: 'graph_query',
        name: 'Graph Query',
        description:
          'Query the app knowledge graph: neighbors of a concept, path between concepts, stats, or a rabbit-hole deep-dive through memory. Args: {"mode"?: "neighbors"|"path"|"stats"|"rabbit", "target"?: string, "target2"?: string}',
        source: 'builtin',
      },
      {
        slug: 'computer_use',
        name: 'Computer Use',
        description:
          'Control the computer: run shell commands (safety-tiered), read/write/list workspace files, open URLs. Destructive actions need "confirm": true. Args: {"action": "shell"|"read_file"|"write_file"|"list_dir"|"open_url", ...}',
        source: 'builtin',
      },
      {
        slug: 'browse_site',
        name: 'Browse Site',
        description:
          'Lightweight browser use: read a page + follow up to 2 related same-site pages. Args: {"url": string, "topic"?: string, "maxPages"?: number}',
        source: 'builtin',
      },
      {
        slug: 'weather_lookup',
        name: 'Weather Lookup',
        description:
          'Current weather + 3-day forecast for any city (live Open-Meteo data). Args: {"location": string}',
        source: 'builtin',
      },
      {
        slug: 'wikipedia_search',
        name: 'Wikipedia Search',
        description:
          'Search Wikipedia articles and get their summaries with links. Args: {"query": string, "limit"?: number}',
        source: 'builtin',
      },
      {
        slug: 'create_chart',
        name: 'Create Chart',
        description:
          'Create a bar/line/pie chart image from data. Args: {"title": string, "type": "bar"|"line"|"pie", "labels": string[], "values": number[]}',
        source: 'builtin',
      },
      {
        slug: 'web_search',
        name: 'Web Search',
        description: 'Search the live web. Args: {"query": string}',
        source: 'plugin:web-search',
      },
      {
        slug: 'generate_image',
        name: 'Generate Image',
        description:
          'Generate an AI image from a prompt. Args: {"prompt": string, "size"?: "1024x1024"|"1344x768"|"768x1344"}',
        source: 'plugin:image-gen',
      },
      {
        slug: 'run_code',
        name: 'Run Code',
        description:
          'Run JavaScript in a sandbox (console.log for output). Args: {"code": string}',
        source: 'plugin:code-runner',
      },
      {
        slug: 'search_images',
        name: 'Search Images',
        description: 'Find real photos on the web. Args: {"query": string}',
        source: 'plugin:image-search',
      },
    ]

    for (const t of tools) {
      await db.tool.upsert({
        where: { slug: t.slug },
        update: { name: t.name, description: t.description, source: t.source },
        create: { ...t, enabled: true },
      })
    }

    // ---------- Skills ----------
    for (const s of DEFAULT_SKILLS) {
      await db.skill.upsert({
        where: { slug: s.slug },
        update: {
          name: s.name,
          description: s.description,
          category: s.category,
          icon: s.icon,
          prompt: s.prompt,
        },
        create: { ...s, enabled: true },
      })
    }

    // ---------- MCP servers ----------
    const mcps = [
      {
        slug: 'filesystem',
        name: 'Filesystem MCP',
        description:
          'Built-in Model Context Protocol server exposing a sandboxed agent workspace.',
        tools: [
          {
            slug: 'fs.list_files',
            name: 'list_files',
            description: 'List files in the agent workspace. Args: {"path"?: string}',
          },
          {
            slug: 'fs.read_file',
            name: 'read_file',
            description: 'Read a text file from the workspace. Args: {"path": string}',
          },
          {
            slug: 'fs.write_file',
            name: 'write_file',
            description:
              'Write a text file to the workspace. Args: {"path": string, "content": string}',
          },
        ],
      },
      {
        slug: 'system-time',
        name: 'System Time MCP',
        description:
          'Built-in Model Context Protocol server exposing current date/time and runtime environment.',
        tools: [
          {
            slug: 'time.get_datetime',
            name: 'get_datetime',
            description: 'Get the current date and time. Args: {}',
          },
          {
            slug: 'time.get_environment',
            name: 'get_environment',
            description: 'Get runtime environment info (platform, versions). Args: {}',
          },
        ],
      },
    ]

    for (const m of mcps) {
      await db.mcpServer.upsert({
        where: { slug: m.slug },
        update: {
          name: m.name,
          description: m.description,
          toolsJson: JSON.stringify(m.tools),
        },
        create: {
          slug: m.slug,
          name: m.name,
          description: m.description,
          status: 'connected',
          mode: 'builtin',
          toolsJson: JSON.stringify(m.tools),
          enabled: true,
        },
      })
    }

    seeded = true
  } catch (e) {
    // Seeding is best-effort; API routes will surface DB errors if truly broken
    console.error('[seed] failed:', e)
  }
}
