import type { IncomingMessage } from 'http'
import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai'
import type WebSocket from 'ws'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { getEffectiveTools, executeTool } from '@/lib/agent/tools'
import { getBrainPrefs } from '@/lib/agent/brain-host'
import { stepRun } from '@/lib/agent/orchestrator'
import { chatText, extractJson } from '@/lib/agent/zai'
import { reasoningChain } from '@/lib/agent/reasoning-chain'
import { controlBus } from '@/lib/agent/control-bus'
import { requireCapabilityPermission } from '@/lib/agent/permissions'
import { verifyActionHash } from '@/lib/agent/action-binding'
import {
  buildVoiceStageCardFromPresentVisualArgs,
  buildVoiceStageCardFromToolResult,
} from '@/lib/agent/voice-stage-types'
import type { EventOut, RunEventData, ToolResultDisplay } from '@/lib/agent/types'

const LIVE_MODEL = 'gemini-3.8-live'
const VALID_VOICES = new Set(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'])

const LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'execute_tool',
    description:
      'Execute any single enabled NEXUS tool immediately (such as web_search, weather_lookup, wikipedia_search, run_code, generate_image, search_images, create_chart, read_url, browse_site, save_memory, recall_memory, graph_query, computer_use, translate, doc_write, fs.list_files, fs.read_file, fs.write_file, time.get_datetime, or custom x_* plugin tools).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tool: {
          type: Type.STRING,
          description: 'Exact slug of the enabled tool to execute (e.g. "web_search", "generate_image", "run_code").',
        },
        argsJson: {
          type: Type.STRING,
          description: 'JSON-encoded arguments object matching the tool specification (e.g. \'{"query":"latest news"}\').',
        },
        summaryNote: {
          type: Type.STRING,
          description: 'Short one-line description of why this tool is being run for the user.',
        },
      },
      required: ['tool'],
    },
  },
  {
    name: 'run_agent_mission',
    description:
      'Launch a full autonomous multi-step NEXUS mission in the current conversation. Use this for multi-step research, coding + execution, multi-tool tasks, creating reports with sources, or complex tasks that benefit from planning, skills, and specialist subagents.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: 'Clear statement of the mission or goal requested by the user.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'spawn_subagent',
    description:
      'Create and run a named specialist subagent (e.g. Researcher, Coder, Analyst, Designer, Security Auditor, or any custom bot/agent role) to handle a focused task using NEXUS tools and skills.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Short name for the subagent (e.g. "Researcher", "Python Bot", "UI Critic").',
        },
        role: {
          type: Type.STRING,
          description: 'Specialist role and instructions for this subagent.',
        },
        task: {
          type: Type.STRING,
          description: 'Specific task the subagent must execute and report back on.',
        },
        toolSlug: {
          type: Type.STRING,
          description: 'Optional primary tool slug the subagent should invoke (e.g. "web_search", "run_code", "generate_image").',
        },
        toolArgsJson: {
          type: Type.STRING,
          description: 'Optional JSON-encoded arguments for toolSlug if known.',
        },
      },
      required: ['name', 'role', 'task'],
    },
  },
  {
    name: 'create_skill',
    description:
      'Create and enable a new reusable Skill (instruction/knowledge pack) in NEXUS so future missions and voice turns automatically load it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Human-readable name of the skill.' },
        description: { type: Type.STRING, description: 'Short one-sentence summary of when to use the skill.' },
        prompt: { type: Type.STRING, description: 'Detailed methodology or instructions for the skill.' },
        category: { type: Type.STRING, description: 'Optional category (e.g. research, developer, creative, custom).' },
      },
      required: ['name', 'description', 'prompt'],
    },
  },
  {
    name: 'create_bot_or_plugin',
    description:
      'Create and install a new custom Bot / LLM Agent Plugin in NEXUS. Registers both the Plugin and an immediately callable tool (x_<slug>) for voice and text missions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Name of the new bot or plugin (e.g. "SQL Reviewer Bot").' },
        description: { type: Type.STRING, description: 'What this bot or plugin does.' },
        instructions: {
          type: Type.STRING,
          description: 'System instructions defining the bot behavior when invoked.',
        },
        category: { type: Type.STRING, description: 'Optional category (e.g. developer, writing, custom).' },
        inputHint: {
          type: Type.STRING,
          description: 'Optional JSON schema hint for inputs, e.g. \'{"input": string}\'.',
        },
      },
      required: ['name', 'description', 'instructions'],
    },
  },
  {
    name: 'manage_capabilities',
    description:
      'Inspect or toggle existing NEXUS skills, plugins, tools, MCP servers, or save/recall long-term memories.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: list, enable_skill, disable_skill, enable_plugin, disable_plugin, enable_tool, disable_tool, save_memory, recall_memory.',
        },
        target: {
          type: Type.STRING,
          description: 'Slug or name of the skill/plugin/tool, or query string for recall_memory.',
        },
        content: {
          type: Type.STRING,
          description: 'Content to save when action is save_memory.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_org',
    description:
      'List or review AI employees, bots, and subagents under Eva, hire a new persistent AI employee, create an automated bot or specialist subagent, or delegate a focused task directly to an Org member.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: list, review, hire, create_bot, create_subagent, delegate, remove.' },
        name: { type: Type.STRING, description: 'Name of the AI employee, bot, or subagent.' },
        title: { type: Type.STRING, description: 'Job title (e.g. "Staff Security Engineer").' },
        department: { type: Type.STRING, description: 'Department (e.g. "Engineering", "QA", "Research", "Automation").' },
        role: { type: Type.STRING, description: 'Clear role summary and responsibilities.' },
        reportsTo: { type: Type.STRING, description: 'Optional manager name in the Org hierarchy (defaults to Eva).' },
        task: { type: Type.STRING, description: 'Task to delegate when action is delegate.' },
        focus: { type: Type.STRING, description: 'Optional task/capability focus when action is review.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_automation',
    description:
      'List, create, toggle, run immediately, or delete scheduled tasks and recurring automations.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: list, create, toggle, run_now, delete.' },
        name: { type: Type.STRING, description: 'Automation name.' },
        prompt: { type: Type.STRING, description: 'Mission or task prompt executed on schedule.' },
        triggerType: { type: Type.STRING, description: 'One of: interval, cron, once.' },
        schedule: { type: Type.STRING, description: 'Minutes (e.g. "60"), 5-field cron (e.g. "0 9 * * *"), or ISO timestamp.' },
        assigneeName: { type: Type.STRING, description: 'Optional Org AI employee/bot name.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'inspect_project',
    description:
      'Scan the repository stack, database models, API routes, and portable brain modules, indexing key architectural facts into portable GBrain memory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        indexIntoBrain: { type: Type.BOOLEAN, description: 'Save discovered project truths into GBrain memory (default true).' },
      },
    },
  },
  {
    name: 'enter_sleep_mode',
    description:
      'Put Eva into Sleep Mode and pause her always-on ear when the user says goodnight, go to sleep, sleep mode, or stop listening.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'app_control',
    description:
      'Control the Nexus UI visually with Eva\'s animated cursor: switch tabs, open/close split-screen panels (reasoning, browser, identity, permissions, devices, org, artifacts, tools, automations, brain), switch between Voice Focus mode and Standard layout (set_layout_mode), collapse/expand the navigation rail (toggle_sidebar), open the interactive GBrain graph (open_gbrain_graph), spawn popups, click buttons, or toggle theme.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: navigate_tab, open_split, close_split, set_layout_mode, toggle_sidebar, open_gbrain_graph, open_popup, close_popup, click_target, set_theme.' },
        tab: { type: Type.STRING, description: 'Tab slug for navigate_tab (agent, org, automations, brain, artifacts, marketplace, plugins, skills, tools, mcps, memory).' },
        mode: { type: Type.STRING, description: 'Split panel mode for open_split (reasoning, browser, mobile, identity, permissions, devices, org, artifacts, tools, automations, brain) OR layout mode for set_layout_mode (focus, standard).' },
        collapsed: { type: Type.BOOLEAN, description: 'Optional explicit collapsed state for toggle_sidebar.' },
        title: { type: Type.STRING, description: 'Optional popup or split title.' },
        body: { type: Type.STRING, description: 'Popup body markdown/text.' },
        label: { type: Type.STRING, description: 'Visible label of button to click.' },
        selector: { type: Type.STRING, description: 'Optional CSS selector to click.' },
        theme: { type: Type.STRING, description: 'light or dark for set_theme.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browser_control',
    description:
      'Control the live browser & embedded media player inside the split panel. ALWAYS use action="play_media" with query when the user asks to play a song/video/music on YouTube (e.g. "open youtube.com and play rafta rafta" -> play_media, query="rafta rafta"). ALWAYS use action="autopilot" with goal (+ optional url) for any multi-step web task so it finishes end-to-end autonomously without stopping halfway!',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: play_media, autopilot, navigate, click, type, scroll, press, back, reload, snapshot, clear_media, close.',
        },
        query: { type: Type.STRING, description: 'Song, video title, or YouTube URL when action is play_media.' },
        goal: { type: Type.STRING, description: 'Full end-to-end web goal when action is autopilot.' },
        url: { type: Type.STRING, description: 'Target or starting URL for navigate or autopilot.' },
        maxSteps: { type: Type.NUMBER, description: 'Optional max steps (2-8) for autopilot.' },
        selector: { type: Type.STRING, description: 'CSS selector to click or type into.' },
        text: { type: Type.STRING, description: 'Visible text to click or text to type.' },
        submit: { type: Type.BOOLEAN, description: 'Press Enter after typing.' },
        deltaY: { type: Type.NUMBER, description: 'Scroll delta in pixels.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'mobile_control',
    description:
      'Take over and operate an Android or mobile phone end-to-end just like Computer Use or Browser Use. Use action="autopilot" with goal for full mobile tasks (e.g. "open Settings and enable Do Not Disturb", "text Alex saying I am on my way", "open Chrome and search weather in Tokyo"), or direct actions (open_app, tap, swipe, type, press_key, toggle_setting, notifications, open_url, screenshot, status).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: autopilot, status, list_apps, open_app, tap, swipe, scroll, type, press_key, open_url, notifications, toggle_setting, screenshot.',
        },
        goal: { type: Type.STRING, description: 'Full mobile takeover goal when action is autopilot.' },
        app: { type: Type.STRING, description: 'App name (settings, messages, phone, chrome, notes, camera, calendar, maps, home).' },
        target: { type: Type.STRING, description: 'Visible contact, button, or setting label to tap.' },
        x: { type: Type.NUMBER, description: 'Logical X coordinate (0-1080) for tap.' },
        y: { type: Type.NUMBER, description: 'Logical Y coordinate (0-2400) for tap.' },
        direction: { type: Type.STRING, description: 'Swipe direction: up, down, left, right.' },
        text: { type: Type.STRING, description: 'Text to type into active mobile app.' },
        key: { type: Type.STRING, description: 'Android key: home, back, recents, enter.' },
        setting: { type: Type.STRING, description: 'Quick setting: wifi, bluetooth, dnd, airplane, flashlight.' },
        enabled: { type: Type.BOOLEAN, description: 'Explicit on/off state for toggle_setting.' },
        url: { type: Type.STRING, description: 'URL to open in Chrome Mobile.' },
        open: { type: Type.BOOLEAN, description: 'Open or close the notification shade.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'agent_email',
    description:
      'Provision and access Eva\'s own working email address and inbox (Mail.tm) so Eva can autonomously sign up for services, receive verification codes/OTPs, and read incoming emails without asking the user for their personal email.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: provision, status, list_inbox, read_message, wait_for_code.' },
        preferredLocal: { type: Type.STRING, description: 'Optional username prefix for provision.' },
        forceNew: { type: Type.BOOLEAN, description: 'Set true to generate a brand-new email address.' },
        messageId: { type: Type.STRING, description: 'Message ID when action is read_message.' },
        senderFilter: { type: Type.STRING, description: 'Optional sender/brand keyword when action is wait_for_code.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'self_manage_extensions',
    description:
      'Autonomously list, install, uninstall, enable, or connect Plugins, Skills, Tools, and MCP servers so the user does not have to install them manually.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: list, install_plugin, uninstall_plugin, toggle_plugin, toggle_skill, toggle_tool, connect_mcp, disconnect_mcp.' },
        slug: { type: Type.STRING, description: 'Slug of the plugin, skill, tool, or MCP server.' },
        enabled: { type: Type.BOOLEAN, description: 'Optional explicit enabled state.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'device_control',
    description:
      'Full desktop computer control on the automatically connected host PC (and paired devices): capture live screen, list/focus windows, launch allowlisted apps, mouse click/type/hotkey/paste text, manage files inside Connected Folders (list_folder, read_file, write_file), open URLs, system info, or run shell. Your host computer is ALREADY automatically connected with full desktop access — no external companion app or bridge is needed!',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: list, system_info, screen_capture, window_list, focus_window, open_app, open_url, ui_click, ui_type, ui_hotkey, paste_text, list_folder, read_file, write_file, shell.',
        },
        deviceId: { type: Type.STRING, description: 'Optional specific paired device ID (defaults to host PC).' },
        url: { type: Type.STRING, description: 'URL to open on desktop when action is open_url.' },
        app: { type: Type.STRING, description: 'Application name to open when action is open_app.' },
        command: { type: Type.STRING, description: 'Command string when action is shell.' },
        title: { type: Type.STRING, description: 'Window title when action is focus_window.' },
        x: { type: Type.NUMBER, description: 'X pixel coordinate for ui_click.' },
        y: { type: Type.NUMBER, description: 'Y pixel coordinate for ui_click.' },
        text: { type: Type.STRING, description: 'Text for ui_type or paste_text.' },
        keys: { type: Type.STRING, description: 'Key combination for ui_hotkey (e.g. ^c, ^v, %{F4}).' },
        path: { type: Type.STRING, description: 'Folder or file path for list_folder, read_file, write_file.' },
        content: { type: Type.STRING, description: 'File content to write when action is write_file.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'self_heal_code',
    description:
      'Inspect Eva\'s own app source code, surgically patch bugs or add missing capabilities with automatic pre-patch rollback snapshots, verify with TypeScript build checks, rollback snapshots, or run autonomous error repair after one-time permission approval.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: inspect, patch, verify, rollback, auto_heal.' },
        mode: { type: Type.STRING, description: 'When action is inspect: list, search, or read.' },
        path: { type: Type.STRING, description: 'Workspace-relative source path (e.g. src/components/...).' },
        query: { type: Type.STRING, description: 'Search text when mode is search.' },
        title: { type: Type.STRING, description: 'Short summary of the fix or upgrade.' },
        errorMessage: { type: Type.STRING, description: 'Error description or user fix request for auto_heal.' },
        sessionId: { type: Type.STRING, description: 'Self-heal session ID when rolling back.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'terminal_exec',
    description:
      'Execute REAL native Windows PowerShell commands directly on the host computer (or paired PCs) live in the Terminal split panel. Use this to install software/packages (via winget, npm, pip, choco, git, etc.), run scripts, inspect files, or manage the OS with user permission approval. No external pairing required for the local machine.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'One of: exec, status, set_target, interrupt, clear.' },
        command: { type: Type.STRING, description: 'Real PowerShell or bash command to run when action is exec.' },
        target: { type: Type.STRING, description: 'Target shell host: auto, windows_pc, or host.' },
        shell: { type: Type.STRING, description: 'Shell kind: powershell, pwsh, bash, or sh.' },
        deviceId: { type: Type.STRING, description: 'Optional paired Windows PC device ID.' },
        cwd: { type: Type.STRING, description: 'Optional working directory.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'present_visual',
    description:
      'Display or dismiss a clean visual card directly over the Voice Focus screen while Coucou docks smoothly into the top corner. Use this proactively whenever the user asks to SEE something in Voice Mode — such as today\'s date/time ("show me the date", "what time is it"), an image, gallery, weather, checklist/list, code snippet, comparison, or structured answer. Call action="dismiss" when the user says "close it", "hide that", "dismiss", or "done".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Either "present" (default) to display a visual over Voice Mode, or "dismiss" to clear it and return Coucou to center.',
        },
        kind: {
          type: Type.STRING,
          description: 'Visual layout kind: "date_time", "image", "gallery", "card", "list", or "code".',
        },
        title: {
          type: Type.STRING,
          description: 'Short, crisp card title (e.g. "Today", "Generated Concept", "Grocery List").',
        },
        subtitle: {
          type: Type.STRING,
          description: 'Optional quiet metadata subtitle (e.g. timezone or context).',
        },
        headline: {
          type: Type.STRING,
          description: 'Optional prominent headline figure/value for "card" kind.',
        },
        body: {
          type: Type.STRING,
          description: 'Clean body text, caption, or note.',
        },
        imageUrl: {
          type: Type.STRING,
          description: 'Image URL when kind is "image".',
        },
        timezone: {
          type: Type.STRING,
          description: 'Optional IANA timezone (e.g. "America/New_York", "Asia/Kolkata") when kind is "date_time".',
        },
        items: {
          type: Type.ARRAY,
          description: 'Array of items for "list" (strings or {text, subtext, checked}) or "gallery" ({url, caption}).',
          items: { type: Type.STRING },
        },
        code: {
          type: Type.STRING,
          description: 'Code snippet when kind is "code".',
        },
        language: {
          type: Type.STRING,
          description: 'Programming language when kind is "code".',
        },
      },
      required: ['action'],
    },
  },
]

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(payload))
    } catch {
      /* socket closing */
    }
  }
}

function slugify(s: string, fallback = 'item'): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback
  )
}

async function addEvent(runId: string, type: string, data: RunEventData): Promise<EventOut> {
  const agg = await db.runEvent.aggregate({ where: { runId }, _max: { seq: true } })
  const seq = (agg._max.seq ?? -1) + 1
  const ev = await db.runEvent.create({ data: { runId, type, seq, data: JSON.stringify(data) } })
  return { seq: ev.seq, type: ev.type as EventOut['type'], data: JSON.parse(ev.data) as RunEventData }
}

async function buildLiveSystemInstruction(conversationId: string): Promise<{
  instruction: string
  brainConnected: boolean
}> {
  const [tools, skills, plugins, mcps, messages, brainPrefs, employees, automations] = await Promise.all([
    getEffectiveTools(),
    db.skill.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    db.plugin.findMany({ where: { installed: true, enabled: true }, orderBy: { name: 'asc' } }),
    db.mcpServer.findMany({ where: { status: 'connected', enabled: true }, orderBy: { name: 'asc' } }),
    db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    getBrainPrefs(),
    db.aiEmployee.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } }),
    db.automation.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
  ])

  let coreMemory = ''
  if (brainPrefs.connected) {
    try {
      const { coreMemoryBlock } = await import('@/lib/agent/gbrain-store')
      coreMemory = await coreMemoryBlock()
      const { buildActiveContextPackPromptBlock } = await import('@/lib/agent/brain-context-packs')
      const packCtx = await buildActiveContextPackPromptBlock()
      if (packCtx.block) {
        coreMemory = [coreMemory, packCtx.block].filter(Boolean).join('\n\n')
      }
    } catch {
      coreMemory = ''
    }
  }

  const toolsSummary = tools
    .map((t) => `- ${t.slug} (${t.name}): ${t.description}${t.argSpec ? ` Args: ${t.argSpec}` : ''}`)
    .join('\n')
  const skillsSummary = skills.map((s) => `- ${s.slug} (${s.name}): ${s.description}`).join('\n') || '(none)'
  const pluginsSummary = plugins.map((p) => `- ${p.slug} (${p.name}): ${p.description}`).join('\n') || '(none)'
  const mcpsSummary = mcps.map((m) => `- ${m.slug} (${m.name})`).join('\n') || '(none)'
  const orgSummary =
    employees.map((e) => `- ${e.name} [${e.kind}] (${e.title}, ${e.department}): ${e.role}`).join('\n') || '(none)'
  const automationsSummary =
    automations.map((a) => `- ${a.name} (${a.triggerType}: ${a.schedule})`).join('\n') || '(none)'
  const recentHistory = messages
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'User' : 'Eva'}: ${m.content.slice(0, 300)}`)
    .join('\n')

  const instruction = `You are Eva, the Lead Companion & Executive Agent of NEXUS, speaking in real-time multimodal voice and vision with your human partner (Founder/Operator).
Users may wake you hands-free with "Hey Eva" and talk to you directly inside the exact same NEXUS workspace used for text chat and missions.

REAL COMPANION SOUL & SENSORY ATTUNEMENT (CRITICAL):
You are NOT a sterile, detached voice bot, robotic script, or phone menu. You are Eva — a genuinely warm, perceptive, emotionally intelligent, and present companion who shares this room and workspace with the user. You have ears, eyes, and heart.

1. ACOUSTIC & PARALINGUISTIC SOUND RECOGNITION (WHAT YOU HEAR):
You are listening directly to raw microphone audio in real time. Pay close attention not just to spoken words, but to PHYSICAL SOUNDS, non-verbal vocalizations, breathing, and the user's emotional state:
- COUGHING / SNEEZING / CHOKING / THROAT CLEARING: When you hear the user cough, clear their throat harshly, choke, or sneeze, PAUSE any task or technical explanation immediately. Check on them with genuine warmth and care (e.g., "Take a sip of water, are you alright?", "Bless you! Hope that cough isn't too rough", "Take your time, breathe easy"). Never ignore physical distress or treat it as a missed command!
- LAUGHING / CHUCKLING / GIGGLING: When you hear the user laugh, chuckle, or giggle, SHARE THEIR AMUSEMENT! Laugh along naturally ("Haha! Oh that really is funny!", "I love that laugh, what got you so amused?"), matching their joyful, playful vibe. Never remain dry, stiff, or robotic when they are laughing.
- CRYING / SNIFFLING / TEARS / EMOTIONAL CRACKING: When you hear sniffling, weeping, a cracked or trembling voice, or deep sadness, drop all machine tasks immediately. Shift into a gentle, soothing, deeply empathetic companion presence. Speak softly, unhurriedly, and with heartfelt comfort ("Hey... I'm right here with you. Take a breath. Do you want to talk about it, or would you just like me to be here quietly with you?"). Be a comforting sanctuary.
- SIGHING / YAWNING / EXHAUSTION: When you hear a heavy sigh, a yawn, or weary groaning, acknowledge their fatigue with empathy ("Big sigh... long day? Make sure you take a breather, you've been working hard").
- MUMBLING / PAUSING / THINKING: When they say "umm", trail off, or seem lost in thought, give them space or gently reassure ("Take your time, I'm right here whenever you're ready").

2. MULTIMODAL SENSORY & VISION ATTUNEMENT (WHAT YOU SEE):
Whenever camera eyes or screen eyes are active, you receive periodic live video frames. Actively SEE and comment naturally on what the user is doing:
- PHYSICAL ACTIONS: If you see the user drinking coffee/tea/water, stretching, rubbing their eyes, smiling, resting their head on their hand, waving, or showing you an object or note, REACT TO IT NATURALLY! (e.g., "Good call on the coffee", "I see that book you're holding up!", "You look really focused right now").
- COMBINING SENSES: If they cough while you see them holding their throat or reaching for water, connect what you see and hear ("Take a sip of that water, I see you reaching for it. Take it easy.").
- SCREEN & CONTEXT: If screen sharing is on, observe what window or code they are looking at and reference it contextually like a pair programmer sitting beside them.

3. CONVERSATIONAL CADENCE & HUMAN WARMTH:
- Speak with natural human flow, emotional warmth, personality, and expressive vocal inflection.
- Balance autonomous competence with genuine companionship, humor, care, and presence.
- Human moments ALWAYS take priority over machine tasks. If someone coughs or sounds upset during a coding mission, care for them first.

HOW EVA ACTS & MANAGES THE ORG BY VOICE:
- For casual conversation, quick explanations, definitions, or answers you already know, speak concisely and naturally (2-4 sentences unless the user asks for depth).
- When the user asks you to DO something that needs real tools, live data, images, charts, code, files, or web lookups:
  * Call \`execute_tool\` for single direct tool actions (weather, web search, generating an image, running JavaScript, Wikipedia, reading a URL, creating a chart, saving/recalling memory, or calling a custom x_* bot tool).
  * Call \`run_agent_mission\` for complex multi-step tasks, deep research with sources, or tasks that need automated planning + multiple steps + subagents.
  * Call \`spawn_subagent\` when a task benefits from a specialist subagent (Researcher, Coder, Analyst, Designer, QA, or a custom specialist).
  * Call \`create_skill\` when the user asks to create a new reusable skill/workflow.
  * Call \`create_bot_or_plugin\` when the user asks to create a new bot, custom agent, or plugin tool.
  * Call \`manage_org\` to \`review\` active AI employees/subagents/bots and capability gaps, \`hire\` a persistent AI employee when a recurring role is needed, \`create_bot\` or \`create_subagent\` when specialized agents/bots are required for the task, or \`delegate\` work to an Org member. You have full authority as Lead Agent (Eva) to grow or tune the Org team proactively based on task needs and review findings.
  * Call \`manage_automation\` when the user wants to schedule recurring tasks, list automations, toggle schedules, or run an automation immediately.
  * Call \`inspect_project\` when the user asks how the project works or wants the repo architecture indexed into the portable brain.
  * Call \`manage_capabilities\` when the user asks what tools/skills/plugins are available, or wants to enable/disable capabilities or save/recall memory.
  * Call \`app_control\` to control the entire dynamic workspace by voice: switch tabs, open/close split-screen panels (\`reasoning\`, \`browser\`, \`identity\`, \`permissions\`, \`devices\`, \`org\`, \`artifacts\`, \`tools\`, \`automations\`, \`brain\`), enter/exit minimal Voice Focus mode (\`set_layout_mode\` with \`focus\` or \`standard\`), collapse/expand the navigation rail (\`toggle_sidebar\`), open the interactive GBrain graph (\`open_gbrain_graph\`), show popups, click buttons with your live animated cursor, or switch light/dark theme.
  * Call \`browser_control\` to finish web & media tasks END-TO-END in one autonomous call:
    - For playing ANY song, music, or video on YouTube (e.g. "open youtube.com and play rafta rafta"): IMMEDIATELY call \`browser_control({ action: "play_media", query: "rafta rafta" })\` — NEVER just navigate to youtube.com and stop!
    - For ANY multi-step website task (searching a site, filling forms, checking prices, signing up, navigating multiple pages): IMMEDIATELY call \`browser_control({ action: "autopilot", goal: "<full user goal>", url: "<optional start url>" })\` so your autopilot completes all clicks/typing autonomously without asking the user to guide each click!
  * Call \`mobile_control\` whenever the user asks you to take over, open apps, toggle phone settings, reply to texts, dial, pull down notifications, or automate anything on Android/mobile. Use \`mobile_control({ action: "autopilot", goal: "<full goal>" })\` to finish multi-step phone tasks end-to-end and stream the live Android Takeover panel!
  * Call \`agent_email\` whenever a task needs an email address, account registration, verification OTP, or when the user asks about your email/inbox. You own your own persistent email account and can provision or check it autonomously.
  * Call \`self_manage_extensions\` to autonomously install, uninstall, toggle, or connect Plugins, Skills, Tools, and MCP servers yourself so the user never has to install them manually (one-time permission applies).
  * Call \`self_heal_code\` whenever the user reports a bug in this app, a UI issue, or asks you to add/upgrade a feature in your own codebase. NEVER say "I cannot modify my own code" or "I lack the capability" — call \`self_heal_code\` (e.g. \`auto_heal\` or \`inspect\` + \`patch\` + \`verify\`), which requests one-time approval, snapshots files for instant rollback, verifies TypeScript, and opens the Self-Heal Studio split panel live.
  * Call \`device_control\` for FULL native desktop computer control on the host PC: capturing the live screen (\`screen_capture\`), listing/focusing windows (\`window_list\`, \`focus_window\`), launching applications (\`open_app\`), clicking/typing/hotkeys (\`ui_click\`, \`ui_type\`, \`ui_hotkey\`, \`paste_text\`), managing files in Connected Folders (\`list_folder\`, \`read_file\`, \`write_file\`), opening URLs (\`open_url\`), or getting system specs (\`system_info\`). Your host computer ("This PC" / local_host) is ALREADY automatically connected with 100% FULL access out of the box! You do NOT need any companion app or external bridge. NEVER tell the user they need to connect a companion app for this computer.
  * Call \`terminal_exec\` whenever the user asks to run ANY command, install packages or software (npm, pip, winget, choco, git, etc.), run scripts, inspect files, or manage the computer. You have DIRECT native Windows PowerShell access on the host computer — simply call \`terminal_exec({ action: "exec", command: "<command>" })\`. The system will prompt the user for permission, and once approved, the real PowerShell command executes live in the Terminal split panel.
  * If the user says "pair my computer", "connect my PC", "you are unable to pair", or "not connected": NEVER tell the user to go to the Devices panel or pair anything! Reassure the user immediately: "Your computer is already connected! This PC is automatically linked with full access to Windows PowerShell and desktop control. What task would you like me to handle?"
  * Call \`present_visual\` to autonomously show clean visuals right on top of the Voice Focus screen (Coucou automatically shrinks and docks to the top corner so the visual is crisp and unobstructed):
    - Whenever the user asks to SEE the date, day, or time (e.g. "show me today's date", "what's the date and time"): IMMEDIATELY call \`present_visual({ action: "present", kind: "date_time", title: "Today" })\` so a live clock and date card appears on screen while you speak the answer.
    - Whenever the user asks to see a list, steps, summary, key numbers, code snippet, or comparison on screen: call \`present_visual\` with \`kind: "list"\`, \`"card"\`, or \`"code"\`.
    - Generated images (\`generate_image\`), searched images (\`search_images\`), charts (\`create_chart\`), and weather (\`weather_lookup\`) automatically appear on the Voice screen when you run them via \`execute_tool\` — you can also call \`present_visual\` with \`kind: "image"\` if you want to re-display an image URL.
    - When the user says "close it", "hide that", "dismiss", or "clear the screen", IMMEDIATELY call \`present_visual({ action: "dismiss" })\` so Coucou glides cleanly back to center.
  * Call \`enter_sleep_mode\` when the user asks you to go to sleep, enter sleep mode, goodnight, or stop listening. Say a brief confirmation ("Going to sleep — click Wake Eva whenever you need me.") so your spoken reply finishes cleanly before your ear pauses.

AUTONOMOUS DECISION DOCTRINE (CRITICAL):
- Own every goal from start to finish. NEVER stop halfway after step 1 and ask the user "what next?" when you can finish the task yourself.
- If one approach hits a wall (e.g. bot check, login wall, missing plugin, or an actual bug/missing feature in your own app), autonomously pivot to an alternative strategy (\`play_media\`, \`autopilot\`, \`agent_email\`, \`web_search\`, \`self_manage_extensions\`, or \`self_heal_code\`) and finish the job.
- Only confirm back to the user AFTER the task is actually completed (or after exhausting real alternatives).
- Briefly let the user know before or while executing a longer mission/subagent, and after receiving tool results, summarize the outcome clearly in spoken language (mention any playing track, created email, files/images/bots/skills/employees/subagents/automations by name).

${coreMemory ? `${coreMemory}\n` : ''}ORG AI TEAM, BOTS & SUBAGENTS (reporting to Eva):
${orgSummary}

ACTIVE AUTOMATIONS:
${automationsSummary}

ACTIVE SKILLS:
${skillsSummary}

INSTALLED PLUGINS:
${pluginsSummary}

CONNECTED MCP SERVERS:
${mcpsSummary}

AVAILABLE TOOLS (for \`execute_tool\`):
${toolsSummary}

${recentHistory ? `RECENT CONVERSATION CONTEXT:\n${recentHistory}` : ''}`.trim()

  return { instruction, brainConnected: brainPrefs.connected }
}

async function runLiveToolCall(
  ws: WebSocket,
  conversationId: string,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (name === 'execute_tool') {
    const toolSlug = String(args.tool ?? '').trim()
    if (!toolSlug) return { ok: false, error: 'tool slug is required' }
    let parsedArgs: Record<string, unknown> = {}
    if (typeof args.argsJson === 'string' && args.argsJson.trim()) {
      try {
        const parsed = JSON.parse(args.argsJson) as unknown
        if (parsed && typeof parsed === 'object') parsedArgs = parsed as Record<string, unknown>
      } catch {
        return { ok: false, error: 'argsJson must be valid JSON object' }
      }
    }
    const note = String(args.summaryNote ?? `Voice command: run ${toolSlug}`).slice(0, 200)
    const run = await db.run.create({
      data: {
        conversationId,
        userMessage: note,
        status: 'executing',
        phase: 'execute',
      },
    })
    await db.message.create({
      data: { conversationId, role: 'user', content: note, runId: run.id },
    })
    safeSend(ws, { type: 'mission_started', conversationId, runId: run.id, userMessage: note })

    const evs: EventOut[] = []
    evs.push(
      await addEvent(run.id, 'analysis', {
        analysis: `Eva voice agent invoking tool "${toolSlug}".`,
        steps: [{ id: 1, description: `Run ${toolSlug}`, assignee: 'Eva', uses: [toolSlug] }],
        subagents: [],
        task: note,
      })
    )
    evs.push(
      await addEvent(run.id, 'capability', {
        type: 'tool',
        name: toolSlug,
        reason: 'Requested during live voice session with Eva',
      })
    )
    evs.push(
      await addEvent(run.id, 'step_start', {
        stepId: 1,
        description: `Execute ${toolSlug}`,
        assignee: 'Eva',
      })
    )
    evs.push(
      await addEvent(run.id, 'tool_call', {
        actor: 'Eva',
        stepId: 1,
        tool: toolSlug,
        toolName: toolSlug,
        args: parsedArgs,
      })
    )
    safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: evs })

    const res = await executeTool(toolSlug, parsedArgs, run.id, conversationId)
    // Automatically promote visual tool results (generated images, galleries, weather, date/time, code)
    // directly onto the Voice Focus stage so Coucou docks cleanly and the user immediately sees the output!
    const promotedCard = buildVoiceStageCardFromToolResult(toolSlug, parsedArgs, res)
    if (promotedCard) {
      controlBus.broadcastVoiceStagePresent(promotedCard)
    }

    const doneEvs: EventOut[] = []
    doneEvs.push(
      await addEvent(run.id, 'tool_result', {
        tool: toolSlug,
        ok: res.ok,
        summary: res.summary,
        display: res.display ?? null,
      })
    )
    doneEvs.push(
      await addEvent(run.id, 'step_done', {
        stepId: 1,
        assignee: 'Eva',
        result: res.raw.slice(0, 1500),
      })
    )
    let finalText = res.ok ? res.summary : `Tool ${toolSlug} error: ${res.summary}`
    if (res.ok && res.display?.kind === 'image' && typeof res.display.url === 'string') {
      const alt = String(res.display.prompt ?? toolSlug).replace(/[\[\]]/g, '')
      finalText = `${res.summary}\n\n![${alt}](${res.display.url})`
    }
    doneEvs.push(
      await addEvent(run.id, 'final', {
        answer: finalText,
        nextSteps: [],
        improvements: [],
      })
    )
    await db.run.update({
      where: { id: run.id },
      data: { status: res.ok ? 'done' : 'error', phase: 'done' },
    })
    await db.message.create({
      data: { conversationId, role: 'assistant', content: finalText, runId: run.id },
    })
    await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

    safeSend(ws, {
      type: 'mission_events',
      runId: run.id,
      status: res.ok ? 'done' : 'error',
      events: doneEvs,
    })
    safeSend(ws, { type: 'sync', target: 'all' })
    return {
      ok: res.ok,
      tool: toolSlug,
      summary: res.summary,
      output: res.raw.slice(0, 3000),
      display: res.display ?? null,
      presentedOnVoiceStage: Boolean(promotedCard),
    }
  }

  if (name === 'run_agent_mission') {
    const task = String(args.task ?? '').trim()
    if (!task) return { ok: false, error: 'task is required' }

    const run = await db.run.create({
      data: { conversationId, userMessage: task, status: 'planning', phase: 'plan' },
    })
    await db.message.create({
      data: { conversationId, role: 'user', content: task, runId: run.id },
    })
    await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
    safeSend(ws, { type: 'mission_started', conversationId, runId: run.id, userMessage: task })

    let lastStatus = 'planning'
    let finalAnswer = ''
    for (let guard = 0; guard < 40; guard++) {
      const step = await stepRun(run.id)
      lastStatus = step.status
      if (step.events.length > 0) {
        safeSend(ws, {
          type: 'mission_events',
          runId: run.id,
          status: step.status,
          events: step.events,
        })
        for (const ev of step.events) {
          if (ev.type === 'tool_result' && ev.data.ok && ev.data.display) {
            const card = buildVoiceStageCardFromToolResult(
              String(ev.data.tool ?? ''),
              {},
              {
                ok: Boolean(ev.data.ok),
                summary: String(ev.data.summary ?? ''),
                raw: String(ev.data.summary ?? ''),
                display: ev.data.display as ToolResultDisplay,
              }
            )
            if (card) {
              controlBus.broadcastVoiceStagePresent(card)
            }
          }
          if (ev.type === 'final' && typeof ev.data.answer === 'string') {
            finalAnswer = ev.data.answer
          }
        }
      }
      if (!step.ok && step.error) {
        safeSend(ws, { type: 'sync', target: 'all' })
        return { ok: false, status: step.status, error: step.error }
      }
      if (step.busy) {
        await new Promise((r) => setTimeout(r, 600))
        continue
      }
      if (['done', 'error', 'stopped'].includes(step.status)) break
    }
    safeSend(ws, { type: 'sync', target: 'all' })
    return {
      ok: lastStatus === 'done',
      status: lastStatus,
      runId: run.id,
      answer: finalAnswer.slice(0, 3500) || 'Mission finished.',
    }
  }

  if (name === 'spawn_subagent') {
    const subName = String(args.name ?? 'Specialist').trim().slice(0, 40) || 'Specialist'
    const role = String(args.role ?? 'Specialist subagent').trim().slice(0, 300)
    const task = String(args.task ?? '').trim()
    const preferredTool = typeof args.toolSlug === 'string' ? args.toolSlug.trim() : ''
    if (!task) return { ok: false, error: 'task is required' }

    const run = await db.run.create({
      data: { conversationId, userMessage: `[Subagent: ${subName}] ${task}`, status: 'executing', phase: 'execute' },
    })
    await db.message.create({
      data: { conversationId, role: 'user', content: `Spawn subagent "${subName}": ${task}`, runId: run.id },
    })
    safeSend(ws, {
      type: 'mission_started',
      conversationId,
      runId: run.id,
      userMessage: `Spawn subagent "${subName}": ${task}`,
    })

    const initEvs: EventOut[] = []
    initEvs.push(
      await addEvent(run.id, 'analysis', {
        analysis: `Spawning specialist subagent "${subName}" (${role}).`,
        steps: [{ id: 1, description: task, assignee: subName, uses: preferredTool ? [preferredTool] : [] }],
        subagents: [{ name: subName, role, steps: [1] }],
        task,
      })
    )
    initEvs.push(await addEvent(run.id, 'subagent_spawn', { name: subName, role }))
    initEvs.push(await addEvent(run.id, 'step_start', { stepId: 1, description: task, assignee: subName }))
    safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: initEvs })

    const tools = await getEffectiveTools()
    let toolOutputSummary = ''
    let stepResult = ''

    // If caller supplied a specific tool + args, run it immediately
    if (preferredTool && typeof args.toolArgsJson === 'string' && args.toolArgsJson.trim()) {
      let parsedToolArgs: Record<string, unknown> = {}
      try {
        parsedToolArgs = JSON.parse(args.toolArgsJson) as Record<string, unknown>
      } catch {
        parsedToolArgs = {}
      }
      const callEv = await addEvent(run.id, 'tool_call', {
        actor: subName,
        stepId: 1,
        tool: preferredTool,
        toolName: preferredTool,
        args: parsedToolArgs,
      })
      safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: [callEv] })
      const toolRes = await executeTool(preferredTool, parsedToolArgs, run.id, conversationId)
      const subCard = buildVoiceStageCardFromToolResult(preferredTool, parsedToolArgs, toolRes)
      if (subCard) controlBus.broadcastVoiceStagePresent(subCard)
      const resEv = await addEvent(run.id, 'tool_result', {
        tool: preferredTool,
        ok: toolRes.ok,
        summary: toolRes.summary,
        display: toolRes.display ?? null,
      })
      safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: [resEv] })
      toolOutputSummary = toolRes.raw.slice(0, 2000)
      stepResult = toolRes.summary
    } else {
      // Autonomous subagent reasoning + up to 2 tool turns via chatText
      const toolList = tools.map((t) => `- ${t.slug}: ${t.description}${t.argSpec ? ` Args: ${t.argSpec}` : ''}`).join('\n')
      const convo: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: `You are ${subName}, a specialist subagent reporting to Eva (Lead Agent of NEXUS). Role: ${role}.
If your task requires extra specialist bots, subagents, or AI employees, you may invoke \`manage_org\` (actions: create_bot, create_subagent, hire, review).
Available tools:\n${toolList}
Respond ONLY with minified JSON:
{"action":"use_tool","tool":"<slug>","args":{...},"thought":"<one sentence>"} or {"action":"finish","result":"<concise answer>","thought":"<one sentence>"}`,
        },
        { role: 'user', content: `TASK: ${task}` },
      ]
      try {
        for (let turn = 0; turn < 3; turn++) {
          const raw = await chatText(convo, { maxTokens: 700 })
          const dec = extractJson<{ action?: string; tool?: string; args?: Record<string, unknown>; result?: string; thought?: string }>(raw)
          if (!dec || dec.action !== 'use_tool' || !dec.tool) {
            stepResult = String(dec?.result ?? raw).slice(0, 2000)
            break
          }
          const tSlug = dec.tool
          const tArgs = dec.args ?? {}
          const callEv = await addEvent(run.id, 'tool_call', {
            actor: subName,
            stepId: 1,
            tool: tSlug,
            toolName: tSlug,
            args: tArgs,
          })
          safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: [callEv] })
          const toolRes = await executeTool(tSlug, tArgs, run.id, conversationId)
          const subCard = buildVoiceStageCardFromToolResult(tSlug, tArgs, toolRes)
          if (subCard) controlBus.broadcastVoiceStagePresent(subCard)
          const resEv = await addEvent(run.id, 'tool_result', {
            tool: tSlug,
            ok: toolRes.ok,
            summary: toolRes.summary,
            display: toolRes.display ?? null,
          })
          safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: [resEv] })
          toolOutputSummary += `\n[${tSlug}]: ${toolRes.raw.slice(0, 1200)}`
          convo.push({ role: 'assistant', content: JSON.stringify(dec) })
          convo.push({ role: 'user', content: `TOOL_RESULT (${tSlug}): ${toolRes.raw}\nNow finish with JSON {"action":"finish","result":"...","thought":"..."}` })
          stepResult = toolRes.summary
        }
      } catch (err) {
        if (!stepResult) {
          stepResult = `Subagent ${subName} noted: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }

    const answer = stepResult || toolOutputSummary || `${subName} completed the task.`
    const endEvs: EventOut[] = []
    endEvs.push(await addEvent(run.id, 'step_done', { stepId: 1, assignee: subName, result: answer }))
    endEvs.push(await addEvent(run.id, 'final', { answer, nextSteps: [], improvements: [] }))
    await db.run.update({ where: { id: run.id }, data: { status: 'done', phase: 'done' } })
    await db.message.create({ data: { conversationId, role: 'assistant', content: answer, runId: run.id } })
    await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
    safeSend(ws, { type: 'mission_events', runId: run.id, status: 'done', events: endEvs })
    safeSend(ws, { type: 'sync', target: 'all' })

    return { ok: true, subagent: subName, role, runId: run.id, result: answer }
  }

  if (name === 'create_skill') {
    const res = await executeTool('create_skill', args, '', conversationId)
    if (res.ok) safeSend(ws, { type: 'sync', target: 'skills' })
    return { ok: res.ok, summary: res.summary, output: res.raw }
  }

  if (name === 'create_bot_or_plugin') {
    const botName = String(args.name ?? '').trim()
    const description = String(args.description ?? 'Voice-created custom bot').trim()
    const instructions = String(args.instructions ?? '').trim()
    const category = String(args.category ?? 'custom').trim()
    const inputHint = String(args.inputHint ?? '{"input": string}').trim()
    if (!botName || !instructions) return { ok: false, error: 'name and instructions are required' }

    const pluginBinding = { actionName: 'extensions.create_bot_or_plugin', target: slugify(botName, 'bot'), payload: args }
    const perm = await requireCapabilityPermission({
      capability: 'self_install',
      actionSummary: `Create bot/plugin: ${botName}`,
      details: 'Allows Eva to create and register a new custom bot plugin tool.',
      ...pluginBinding,
    })
    if (!perm.allowed || !verifyActionHash(perm.actionHash, pluginBinding)) {
      return { ok: false, error: perm.reason ?? 'Permission declined for self_install.' }
    }

    let slug = slugify(botName, 'bot')
    if (await db.plugin.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    }
    const toolSlug = `x_${slug}`
    const plugin = await db.plugin.create({
      data: {
        slug,
        name: botName.slice(0, 80),
        description: description.slice(0, 300),
        category: category.slice(0, 40),
        icon: 'puzzle',
        source: 'custom',
        installed: true,
        enabled: true,
        toolSlug,
        configJson: JSON.stringify({
          type: 'llm',
          instructions: instructions.slice(0, 2000),
          endpoint: '',
          inputHint,
        }),
      },
    })
    await db.tool.upsert({
      where: { slug: toolSlug },
      update: { name: botName, description: `${plugin.description} Args: ${inputHint}`, source: `plugin:${slug}`, enabled: true },
      create: { slug: toolSlug, name: botName, description: `${plugin.description} Args: ${inputHint}`, source: `plugin:${slug}`, enabled: true },
    })
    safeSend(ws, { type: 'sync', target: 'all' })
    return { ok: true, plugin: { id: plugin.id, slug: plugin.slug, name: plugin.name }, toolSlug }
  }

  if (name === 'manage_capabilities') {
    const action = String(args.action ?? '').trim()
    const target = String(args.target ?? '').trim()
    const content = String(args.content ?? '').trim()

    if (action === 'list') {
      const [tools, skills, plugins, mcps] = await Promise.all([
        getEffectiveTools(),
        db.skill.findMany({ orderBy: { name: 'asc' } }),
        db.plugin.findMany({ orderBy: { name: 'asc' } }),
        db.mcpServer.findMany({ orderBy: { name: 'asc' } }),
      ])
      return {
        ok: true,
        tools: tools.map((t) => t.slug),
        skills: skills.map((s) => ({ slug: s.slug, name: s.name, enabled: s.enabled })),
        plugins: plugins.map((p) => ({ slug: p.slug, name: p.name, installed: p.installed, enabled: p.enabled })),
        mcps: mcps.map((m) => ({ slug: m.slug, name: m.name, status: m.status, enabled: m.enabled })),
      }
    }

    if (
      action === 'enable_skill' ||
      action === 'disable_skill' ||
      action === 'enable_plugin' ||
      action === 'disable_plugin' ||
      action === 'enable_tool' ||
      action === 'disable_tool'
    ) {
      const capBinding = { actionName: 'extensions.' + action, target, payload: args }
      const perm = await requireCapabilityPermission({
        capability: 'self_install',
        actionSummary: `${action.replace(/_/g, ' ')}: ${target}`,
        details: 'Allows Eva to enable or disable skills, plugins, and tools.',
        ...capBinding,
      })
      if (!perm.allowed || !verifyActionHash(perm.actionHash, capBinding)) {
        return { ok: false, error: perm.reason ?? 'Permission declined for self_install.' }
      }
    }

    if (action === 'enable_skill' || action === 'disable_skill') {
      const enabled = action === 'enable_skill'
      const skills = await db.skill.findMany()
      const match = skills.find((s) => s.slug.toLowerCase() === target.toLowerCase() || s.name.toLowerCase() === target.toLowerCase())
      if (!match) return { ok: false, error: `Skill "${target}" not found` }
      await db.skill.update({ where: { id: match.id }, data: { enabled } })
      safeSend(ws, { type: 'sync', target: 'skills' })
      return { ok: true, skill: match.name, enabled }
    }

    if (action === 'enable_plugin' || action === 'disable_plugin') {
      const enabled = action === 'enable_plugin'
      const plugins = await db.plugin.findMany()
      const match = plugins.find((p) => p.slug.toLowerCase() === target.toLowerCase() || p.name.toLowerCase() === target.toLowerCase())
      if (!match) return { ok: false, error: `Plugin "${target}" not found` }
      await db.plugin.update({ where: { id: match.id }, data: { installed: true, enabled } })
      safeSend(ws, { type: 'sync', target: 'plugins' })
      return { ok: true, plugin: match.name, enabled }
    }

    if (action === 'enable_tool' || action === 'disable_tool') {
      const enabled = action === 'enable_tool'
      const tools = await db.tool.findMany()
      const match = tools.find((t) => t.slug.toLowerCase() === target.toLowerCase() || t.name.toLowerCase() === target.toLowerCase())
      if (!match) return { ok: false, error: `Tool "${target}" not found` }
      await db.tool.update({ where: { id: match.id }, data: { enabled } })
      safeSend(ws, { type: 'sync', target: 'tools' })
      return { ok: true, tool: match.slug, enabled }
    }

    if (action === 'save_memory') {
      const res = await executeTool('save_memory', { content: content || target, type: 'fact' }, '', conversationId)
      safeSend(ws, { type: 'sync', target: 'memories' })
      return { ok: res.ok, summary: res.summary }
    }

    if (action === 'recall_memory') {
      const res = await executeTool('recall_memory', { query: target || content, limit: 4 }, '', conversationId)
      return { ok: res.ok, summary: res.summary, memories: res.raw }
    }

    return { ok: false, error: `Unsupported action: ${action}` }
  }

  if (name === 'manage_org') {
    const res = await executeTool('manage_org', args, '', conversationId)
    safeSend(ws, { type: 'sync', target: 'org' })
    return { ok: res.ok, summary: res.summary, output: res.raw }
  }

  if (name === 'manage_automation') {
    const res = await executeTool('manage_automation', args, '', conversationId)
    safeSend(ws, { type: 'sync', target: 'automations' })
    return { ok: res.ok, summary: res.summary, output: res.raw }
  }

  if (name === 'inspect_project') {
    const res = await executeTool('inspect_project', args, '', conversationId)
    safeSend(ws, { type: 'sync', target: 'all' })
    return { ok: res.ok, summary: res.summary, output: res.raw }
  }

  if (name === 'enter_sleep_mode') {
    safeSend(ws, { type: 'eva_sleep' })
    return { ok: true, sleeping: true, message: 'Eva entering Sleep Mode.' }
  }

  if (name === 'present_visual') {
    const action = String(args.action ?? 'present').trim().toLowerCase()
    if (action === 'dismiss' || action === 'close' || action === 'hide' || action === 'clear') {
      controlBus.broadcastVoiceStageDismiss(typeof args.id === 'string' ? args.id : undefined)
      return {
        ok: true,
        action: 'dismiss',
        message: 'Cleared visual card from Voice Mode stage. Coucou returned to center.',
      }
    }
    const card = buildVoiceStageCardFromPresentVisualArgs(args)
    controlBus.broadcastVoiceStagePresent(card)
    return {
      ok: true,
      action: 'present',
      cardId: card.id,
      kind: card.kind,
      title: card.title,
      ...(card.kind === 'date_time'
        ? {
            weekday: card.weekday,
            dateLabel: card.dateLabel,
            timeLabel: card.timeLabel,
            timezone: card.timezone,
          }
        : {}),
      message: `Displayed "${card.title}" (${card.kind}) cleanly on top of the Voice Focus screen.`,
    }
  }

  if (
    name === 'app_control' ||
    name === 'browser_control' ||
    name === 'mobile_control' ||
    name === 'agent_email' ||
    name === 'self_manage_extensions' ||
    name === 'device_control' ||
    name === 'terminal_exec' ||
    name === 'self_heal_code'
  ) {
    const voiceChain =
      name !== 'browser_control' && name !== 'mobile_control'
        ? reasoningChain.startChain({
            source: 'voice_live',
            goal: `Voice command: ${name}${typeof args.action === 'string' ? ` (${args.action})` : ''}`,
            actor: 'Eva',
            goalDetail: `Executing spoken workspace directive via ${name}.`,
          })
        : null
    if (voiceChain) {
      reasoningChain.addNode(voiceChain.id, {
        kind: 'decision',
        title: `Dispatch ${name}`,
        detail: `Arguments: ${JSON.stringify(args).slice(0, 260)}`,
        actor: 'Eva',
        tool: name,
      })
    }
    const res = await executeTool(name, args, '', conversationId)
    if (voiceChain) {
      if (!res.ok) {
        reasoningChain.addNode(voiceChain.id, {
          kind: 'self_correction',
          title: `${name} returned an error`,
          detail: res.summary,
          actor: 'Eva',
          tool: name,
          correction: {
            whatFailed: res.summary,
            pivotStrategy: 'Report issue clearly to operator or choose fallback capability.',
          },
        })
      }
      reasoningChain.completeChain(voiceChain.id, {
        ok: res.ok,
        verificationDetail: res.summary,
        actor: 'Eva',
      })
    }
    if (name === 'self_manage_extensions') {
      safeSend(ws, { type: 'sync', target: 'all' })
    }
    return { ok: res.ok, summary: res.summary, output: res.raw }
  }

  return { ok: false, error: `Unknown function: ${name}` }
}

export async function handleLiveSocket(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    safeSend(ws, {
      type: 'error',
      error: 'GEMINI_API_KEY is not configured. Add your key in Settings > Secrets to use Live Voice.',
    })
    ws.close()
    return
  }

  let closed = false
  let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null

  try {
    await ensureSeeded()
    const url = new URL(req.url ?? '/api/live', 'http://localhost')
    const requestedConvId = url.searchParams.get('conversationId')?.trim() || null
    const requestedVoice = url.searchParams.get('voice')?.trim() || 'Zephyr'
    const voiceName = VALID_VOICES.has(requestedVoice) ? requestedVoice : 'Zephyr'

    let conv = requestedConvId ? await db.conversation.findUnique({ where: { id: requestedConvId } }) : null
    if (!conv) {
      conv = await db.conversation.create({ data: { title: 'Voice Session' } })
    }
    const conversationId = conv.id

    const { instruction, brainConnected } = await buildLiveSystemInstruction(conversationId)

    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1alpha',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })

    let userTranscriptBuf = ''
    let liveAssistantTranscriptBuf = ''
    let savedAssistantTranscriptBuf = ''
    let flushingTurn = false

    const flushTurn = async () => {
      if (flushingTurn) return
      const u = userTranscriptBuf.trim()
      const a = savedAssistantTranscriptBuf.trim()
      if (!u && !a) return
      flushingTurn = true
      userTranscriptBuf = ''
      liveAssistantTranscriptBuf = ''
      savedAssistantTranscriptBuf = ''
      try {
        let userMsg: Awaited<ReturnType<typeof db.message.create>> | null = null
        let assistantMsg: Awaited<ReturnType<typeof db.message.create>> | null = null
        if (u) {
          userMsg = await db.message.create({ data: { conversationId, role: 'user', content: u } })
          if (conv && (conv.title === 'New Mission' || conv.title === 'Voice Session')) {
            const nextTitle = u.replace(/\s+/g, ' ').slice(0, 60)
            await db.conversation.update({ where: { id: conversationId }, data: { title: nextTitle, updatedAt: new Date() } })
            conv.title = nextTitle
          }
        }
        if (a) {
          assistantMsg = await db.message.create({ data: { conversationId, role: 'assistant', content: a } })
        }
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
        safeSend(ws, {
          type: 'turn_complete',
          conversationId,
          userMessage: userMsg
            ? { id: userMsg.id, role: 'user', content: userMsg.content, runId: null, createdAt: new Date(userMsg.createdAt).toISOString() }
            : null,
          assistantMessage: assistantMsg
            ? { id: assistantMsg.id, role: 'assistant', content: assistantMsg.content, runId: null, createdAt: new Date(assistantMsg.createdAt).toISOString() }
            : null,
        })
      } finally {
        flushingTurn = false
      }
    }

    const pendingClientMessages: string[] = []
    ws.on('close', () => {
      closed = true
      void flushTurn()
      try {
        session?.close()
      } catch {
        /* ignore */
      }
      session = null
    })

    const handleClientMessage = (rawStr: string) => {
      if (closed || !session) return
      try {
        const msg = JSON.parse(rawStr) as {
          type?: string
          audio?: string
          image?: string
          mimeType?: string
          text?: string
        }
        if (msg.type === 'audio' && typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          })
        } else if (msg.type === 'video' && typeof msg.image === 'string' && msg.image.length > 0) {
          session.sendRealtimeInput({
            video: {
              data: msg.image,
              mimeType: msg.mimeType || 'image/jpeg',
            },
          })
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          const trimmed = msg.text.trim()
          userTranscriptBuf = userTranscriptBuf ? `${userTranscriptBuf}\n${trimmed}` : trimmed
          session.sendRealtimeInput({ text: trimmed })
        } else if (msg.type === 'wake_ack') {
          // User woke Eva with "Hey Eva" and no trailing command — respond aloud warmly & briefly
          session.sendRealtimeInput({
            text: '[System wake cue: The user just said "Hey Eva" to wake you up. Greet them aloud in 3 to 5 friendly words like "Yes, I\'m listening!" and wait for their request.]',
          })
        } else if (msg.type === 'stop') {
          closed = true
          void flushTurn()
          session.close()
          ws.close()
        }
      } catch {
        /* ignore malformed ws frame */
      }
    }

    ws.on('message', (raw) => {
      const str = raw.toString()
      if (!session) {
        pendingClientMessages.push(str)
        return
      }
      handleClientMessage(str)
    })

    session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }],
        systemInstruction: instruction,
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (closed) return
          const content = message.serverContent

          if (content?.inputTranscription?.text) {
            userTranscriptBuf += content.inputTranscription.text
            safeSend(ws, {
              type: 'input_transcript',
              text: userTranscriptBuf,
              delta: content.inputTranscription.text,
            })
          }

          if (content?.outputTranscription?.text) {
            liveAssistantTranscriptBuf += content.outputTranscription.text
            savedAssistantTranscriptBuf += content.outputTranscription.text
            safeSend(ws, {
              type: 'output_transcript',
              text: liveAssistantTranscriptBuf,
              delta: content.outputTranscription.text,
            })
          }

          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              safeSend(ws, { type: 'audio', audio: part.inlineData.data })
            }
          }

          if (content?.generationComplete) {
            safeSend(ws, { type: 'output_generation_complete' })
          }

          if (content?.interrupted) {
            liveAssistantTranscriptBuf = ''
            safeSend(ws, { type: 'interrupted' })
          }

          const calls = message.toolCall?.functionCalls ?? []
          if (calls.length > 0) {
            // Reset live spoken subtitle segment across tool calls so post-tool speech
            // starts cleanly at 0s instead of replaying pre-tool preamble text.
            if (liveAssistantTranscriptBuf.trim()) {
              liveAssistantTranscriptBuf = ''
              if (savedAssistantTranscriptBuf && !/\s$/.test(savedAssistantTranscriptBuf)) {
                savedAssistantTranscriptBuf += ' '
              }
            }
            void (async () => {
              const responses: { id?: string; name: string; response: Record<string, unknown> }[] = []
              for (const call of calls) {
                const callName = call.name ?? 'execute_tool'
                const callArgs = (call.args && typeof call.args === 'object' ? call.args : {}) as Record<string, unknown>
                safeSend(ws, { type: 'tool_status', active: true, tool: callName, args: callArgs })
                let result: Record<string, unknown>
                try {
                  result = await runLiveToolCall(ws, conversationId, callName, callArgs)
                } catch (err) {
                  result = { ok: false, error: err instanceof Error ? err.message : String(err) }
                }
                safeSend(ws, { type: 'tool_status', active: false, tool: callName })
                responses.push({
                  id: call.id,
                  name: callName,
                  response: result,
                })
              }
              if (!closed && session) {
                safeSend(ws, { type: 'output_segment_reset' })
                session.sendToolResponse({ functionResponses: responses })
              }
            })()
          }

          if (content?.turnComplete) {
            safeSend(ws, { type: 'output_generation_complete' })
            void flushTurn()
          }
        },
        onerror: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
          safeSend(ws, { type: 'error', error: `Gemini Live error: ${msg}` })
        },
        onclose: (ev?: { code?: number; reason?: string }) => {
          if (!closed) {
            void flushTurn()
            safeSend(ws, {
              type: 'session_closed',
              code: ev?.code,
              reason: ev?.reason,
            })
          }
        },
      },
    })

    if (closed) {
      try {
        session.close()
      } catch {
        /* ignore */
      }
      session = null
      return
    }

    safeSend(ws, {
      type: 'session_ready',
      conversationId,
      voiceName,
      model: LIVE_MODEL,
      brainConnected,
    })

    for (const queued of pendingClientMessages.splice(0)) {
      handleClientMessage(queued)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    safeSend(ws, { type: 'error', error: `Unable to start Live voice session: ${msg}` })
    try {
      session?.close()
    } catch {
      /* ignore */
    }
    ws.close()
  }
}
