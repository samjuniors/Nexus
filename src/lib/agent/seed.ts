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
  {
    slug: 'subagent-bot-architect',
    name: 'Subagent & Bot Architect',
    description: 'Design, hire, and orchestrate persistent AI employees, custom bots, and focused subagents.',
    category: 'agents',
    icon: 'bot',
    prompt:
      'Subagent & Bot design methodology: when a task benefits from recurring specialist roles or reusable custom bots, use manage_org to hire an AI Employee or create a dedicated Bot with clear role boundaries, curated tools/skills, concise system prompt, and clear reporting hierarchy under the Lead Agent or a department head.',
  },
  {
    slug: 'automation-scheduler',
    name: 'Automation & Scheduling',
    description: 'Build reliable recurring workflows, cron jobs, monitors, and scheduled briefings.',
    category: 'automation',
    icon: 'clock',
    prompt:
      'Automation discipline: use manage_automation to turn recurring operational checks, digests, or project monitoring into scheduled tasks (interval minutes, 5-field cron, or one-shot timestamp). Assign each automation to either Lead Agent or the best-matching Org AI Employee.',
  },
  {
    slug: 'project-intelligence',
    name: 'Project Intelligence',
    description: 'Inspect codebase architecture, schemas, routes, and dependencies into the portable Brain.',
    category: 'developer',
    icon: 'compass',
    prompt:
      'Project understanding methodology: call inspect_project before planning significant codebase changes so you know the exact framework stack, Prisma models, API routes, and portable brain/ boundaries. Persist key project truths into Graph Memory so the portable Brain retains workspace architecture.',
  },
  {
    slug: 'verification-qa',
    name: 'Verification & QA',
    description: 'Verify implementations systematically via type checks, runtime probes, and edge-case validation.',
    category: 'developer',
    icon: 'wrench',
    prompt:
      'Verification standard: never claim work is complete without concrete verification. Check TypeScript types, schema alignment, error handling, empty states, and edge cases; report observed results honestly.',
  },
  {
    slug: 'knowledge-graph-curator',
    name: 'Knowledge Graph Curator',
    description: 'Maintain high-signal semantic truths and traverse entity relations with graph_query.',
    category: 'intelligence',
    icon: 'sparkles',
    prompt:
      'Knowledge graph curation: recall first via recall_memory or graph_query before duplicating facts. Store durable architectural decisions and preferences cleanly with save_memory.',
  },
  {
    slug: 'mcp-orchestrator',
    name: 'MCP Orchestrator',
    description: 'Discover, compose, and safely invoke Model Context Protocol tools across registries.',
    category: 'developer',
    icon: 'terminal',
    prompt:
      'MCP orchestration: prefer connected MCP tools (e.g. fs.*, time.*) for workspace operations and suggest installing relevant MCP servers when external context is needed.',
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
      {
        slug: 'project-indexer',
        name: 'Project Indexer',
        description:
          'Scans codebase architecture, database schema, API routes, and indexes truths into the portable Brain.',
        category: 'developer',
        icon: 'compass',
        source: 'builtin',
        installed: true,
        toolSlug: 'inspect_project',
        config: { type: 'builtin' },
      },
      {
        slug: 'bot-architect',
        name: 'Org & Bot Architect',
        description:
          'Creates persistent AI employees, custom bots, and reporting lines; delegates specialist tasks.',
        category: 'agents',
        icon: 'bot',
        source: 'builtin',
        installed: true,
        toolSlug: 'manage_org',
        config: { type: 'builtin' },
      },
      {
        slug: 'automation-ops',
        name: 'Automation Ops',
        description:
          'Schedules recurring cron, interval, and one-shot tasks for Lead Agent or AI employees.',
        category: 'automation',
        icon: 'clock',
        source: 'builtin',
        installed: true,
        toolSlug: 'manage_automation',
        config: { type: 'builtin' },
      },
      {
        slug: 'code-reviewer',
        name: 'Code Reviewer',
        description:
          'Audits TypeScript/React/API snippets for bugs, security risks, race conditions, and maintainability.',
        category: 'developer',
        icon: 'code',
        source: 'marketplace',
        installed: false,
        toolSlug: 'x_code_reviewer',
        config: {
          type: 'llm',
          inputHint: '{"code": string, "focus"?: string}',
          instructions:
            'You are a Principal Software Engineer conducting a rigorous code review. Identify correctness bugs, security vulnerabilities, race conditions, missing edge cases, and concrete fixes.',
        },
      },
      {
        slug: 'json-validator',
        name: 'JSON & Schema Architect',
        description:
          'Validates payloads, infers strict TypeScript/Zod/JSON schemas, and transforms structured specs.',
        category: 'developer',
        icon: 'file-text',
        source: 'marketplace',
        installed: false,
        toolSlug: 'x_json_validator',
        config: {
          type: 'llm',
          inputHint: '{"payload": string, "task"?: string}',
          instructions:
            'You are a strict schema and JSON validation specialist. Inspect the payload, report structural issues or type mismatches, and output clean corrected JSON + Zod/TypeScript types.',
        },
      },
      {
        slug: 'sql-architect',
        name: 'SQL & Schema Optimizer',
        description:
          'Designs normalized schemas, indexes, migrations, and safe query plans for SQLite and PostgreSQL.',
        category: 'data',
        icon: 'chart',
        source: 'marketplace',
        installed: false,
        toolSlug: 'x_sql_architect',
        config: {
          type: 'llm',
          inputHint: '{"queryOrSchema": string, "dialect"?: string}',
          instructions:
            'You are a database systems engineer. Analyze SQL queries or schemas, recommend indexes, normalization fixes, and safe zero-downtime migrations.',
        },
      },
      {
        slug: 'prd-writer',
        name: 'PRD & ADR Architect',
        description:
          'Produces engineering PRDs, Architecture Decision Records (ADRs), and milestone verification plans.',
        category: 'business',
        icon: 'target',
        source: 'marketplace',
        installed: false,
        toolSlug: 'x_prd_architect',
        config: {
          type: 'llm',
          inputHint: '{"feature": string, "constraints"?: string}',
          instructions:
            'You are a Staff Engineering Manager writing a crisp PRD/ADR. Include Problem, Goals, Non-Goals, Hierarchy/Data Model impact, Verification Gates, and Risks.',
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
      {
        slug: 'inspect_project',
        name: 'Inspect Project',
        description:
          'Scan project codebase structure, stack, database models, API routes, and portable brain/ modules; optionally index into Brain memory. Args: {"indexIntoBrain"?: boolean}',
        source: 'plugin:project-indexer',
      },
      {
        slug: 'manage_org',
        name: 'Manage Org & Bots',
        description:
          'List, hire, update, or delegate tasks to AI Employees and custom Bots in the Org hierarchy. Args: {"action": "list"|"hire"|"create_bot"|"delegate"|"remove", "name"?: string, "title"?: string, "department"?: string, "role"?: string, "systemPrompt"?: string, "skills"?: string[], "tools"?: string[], "target"?: string, "task"?: string}',
        source: 'plugin:bot-architect',
      },
      {
        slug: 'manage_automation',
        name: 'Manage Automations',
        description:
          'Create, list, pause/resume, run, or delete scheduled tasks (interval/cron/once). Args: {"action": "list"|"create"|"toggle"|"run_now"|"delete", "name"?: string, "prompt"?: string, "triggerType"?: "interval"|"cron"|"once", "schedule"?: string, "assignee"?: string, "id"?: string}',
        source: 'plugin:automation-ops',
      },
      {
        slug: 'create_skill',
        name: 'Create Skill',
        description:
          'Author and save a new reusable Agent Skill into NEXUS. Args: {"name": string, "description": string, "prompt": string, "category"?: string}',
        source: 'builtin',
      },
      {
        slug: 'browser_control',
        name: 'Live Browser Control',
        description:
          'Drive a real Playwright browser & live YouTube media player in the split panel. Use "play_media" for songs/videos, "autopilot" for multi-step goals end-to-end, or navigate/click/type/scroll. Args: {"action": "play_media"|"autopilot"|"navigate"|"click"|"type"|"scroll"|"press"|"back"|"reload"|"snapshot"|"clear_media"|"close", "query"?: string, "goal"?: string, "url"?: string}',
        source: 'builtin',
      },
      {
        slug: 'agent_email',
        name: 'Eva Autonomous Email',
        description:
          'Provision and read Eva\'s own working email inbox to autonomously receive OTP verification codes and sign-up links. Args: {"action": "provision"|"status"|"list_inbox"|"read_message"|"wait_for_code", "senderFilter"?: string}',
        source: 'builtin',
      },
      {
        slug: 'app_control',
        name: 'App UI Self-Control',
        description:
          'Control Nexus UI visually with animated live cursor: switch tabs, open split panels (browser, identity, permissions, devices, org, artifacts, tools, automations, brain), spawn popups, click buttons, toggle theme. Args: {"action": "navigate_tab"|"open_split"|"close_split"|"open_popup"|"close_popup"|"click_target"|"set_theme", ...}',
        source: 'builtin',
      },
      {
        slug: 'self_manage_extensions',
        name: 'Self-Install Extensions',
        description:
          'Autonomously list, install, enable, or connect Plugins, Skills, Tools, and MCP servers after one-time permission. Args: {"action": "list"|"install_plugin"|"uninstall_plugin"|"toggle_plugin"|"toggle_skill"|"toggle_tool"|"connect_mcp"|"disconnect_mcp", "slug"?: string}',
        source: 'builtin',
      },
      {
        slug: 'device_control',
        name: 'Connected Device Control',
        description:
          'List paired Mac/Windows/Linux computers and execute approved host actions (system_info, open_url, open_app, shell) via the Local Companion Bridge. Args: {"action": "list"|"system_info"|"open_url"|"open_app"|"shell", ...}',
        source: 'builtin',
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

    // ---------- Starter Org AI Employees (fresh install only) ----------
    if ((await db.aiEmployee.count()) === 0) {
      const architect = await db.aiEmployee.create({
        data: {
          slug: 'chief-architect',
          name: 'Chief Architect',
          title: 'Principal Systems Architect',
          department: 'Engineering',
          kind: 'employee',
          role: 'Owns system design, code structure, schema integrity, and technical planning.',
          systemPrompt:
            'You are Chief Architect, reporting to Lead Agent. Design modular, scalable, strictly typed software architectures. Inspect the project first with inspect_project before recommending structural changes.',
          skillsJson: JSON.stringify(['project-intelligence', 'web-development', 'verification-qa']),
          toolsJson: JSON.stringify(['inspect_project', 'run_code', 'graph_query', 'recall_memory']),
          autonomy: 'autonomous',
          status: 'active',
          icon: 'compass',
        },
      })

      await db.aiEmployee.create({
        data: {
          slug: 'knowledge-curator',
          name: 'Knowledge Lead',
          title: 'Portable Brain & Graph Curator',
          department: 'Intelligence',
          kind: 'employee',
          role: 'Curates project truths, Graphify entity links, and deep cross-session research.',
          systemPrompt:
            'You are Knowledge Lead, reporting to Lead Agent. Keep the portable Brain high-signal, eliminate contradictions, query the knowledge graph, and index key workspace facts.',
          skillsJson: JSON.stringify(['knowledge-graph-curator', 'project-intelligence', 'research-analysis']),
          toolsJson: JSON.stringify(['inspect_project', 'graph_query', 'recall_memory', 'save_memory', 'web_search']),
          autonomy: 'autonomous',
          status: 'active',
          icon: 'brain',
        },
      })

      await db.aiEmployee.create({
        data: {
          slug: 'automation-engineer',
          name: 'Ops & Automation Bot',
          title: 'Workflow Automation Specialist',
          department: 'Operations',
          kind: 'bot',
          role: 'Builds, schedules, and executes recurring checks, digests, and background workflows.',
          systemPrompt:
            'You are Ops & Automation Bot, reporting to Lead Agent. Automate repeatable workflows using manage_automation, run diagnostics, and report concise operational summaries.',
          skillsJson: JSON.stringify(['automation-scheduler', 'subagent-bot-architect']),
          toolsJson: JSON.stringify(['manage_automation', 'inspect_project', 'time.get_datetime']),
          autonomy: 'autonomous',
          status: 'active',
          icon: 'clock',
        },
      })

      await db.aiEmployee.create({
        data: {
          slug: 'qa-verifier',
          name: 'QA Verifier',
          title: 'Staff Verification & Security Engineer',
          department: 'Engineering',
          kind: 'employee',
          role: 'Verifies implementation correctness, type safety, edge cases, and security hygiene.',
          reportsToId: architect.id,
          systemPrompt:
            'You are QA Verifier, reporting to Chief Architect. Verify every feature strictly via deterministic tests, static inspection, and runtime checks before marking work complete.',
          skillsJson: JSON.stringify(['verification-qa', 'project-intelligence']),
          toolsJson: JSON.stringify(['inspect_project', 'run_code', 'computer_use']),
          autonomy: 'supervised',
          status: 'active',
          icon: 'wrench',
        },
      })
    }

    seeded = true
  } catch (e) {
    // Seeding is best-effort; API routes will surface DB errors if truly broken
    console.error('[seed] failed:', e)
  }
}
