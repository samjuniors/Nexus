import type { IncomingMessage } from 'http'
import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai'
import type WebSocket from 'ws'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { getEffectiveTools, executeTool } from '@/lib/agent/tools'
import { getBrainPrefs } from '@/lib/agent/brain-host'
import { stepRun } from '@/lib/agent/orchestrator'
import { chatText, extractJson } from '@/lib/agent/zai'
import type { EventOut, RunEventData } from '@/lib/agent/types'

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
  const [tools, skills, plugins, mcps, messages, brainPrefs] = await Promise.all([
    getEffectiveTools(),
    db.skill.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    db.plugin.findMany({ where: { installed: true, enabled: true }, orderBy: { name: 'asc' } }),
    db.mcpServer.findMany({ where: { status: 'connected', enabled: true }, orderBy: { name: 'asc' } }),
    db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    getBrainPrefs(),
  ])

  let coreMemory = ''
  if (brainPrefs.connected) {
    try {
      const { coreMemoryBlock } = await import('@/lib/agent/gbrain-store')
      coreMemory = await coreMemoryBlock()
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
  const recentHistory = messages
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'User' : 'Nexus'}: ${m.content.slice(0, 300)}`)
    .join('\n')

  const instruction = `You are NEXUS, a real-time voice autonomous AI agent OS.
You are having a live, low-latency spoken conversation with the operator inside the exact same NEXUS workspace used for text chat and missions.

HOW TO ACT BY VOICE:
- For casual conversation, quick explanations, definitions, or answers you already know, speak concisely and naturally (2-4 sentences unless the user asks for depth).
- When the user asks you to DO something that needs real tools, live data, images, charts, code, files, or web lookups:
  * Call \`execute_tool\` for single direct tool actions (weather, web search, generating an image, running JavaScript, Wikipedia, reading a URL, creating a chart, saving/recalling memory, or calling a custom x_* bot tool).
  * Call \`run_agent_mission\` for complex multi-step tasks, deep research with sources, or tasks that need automated planning + multiple steps + subagents.
  * Call \`spawn_subagent\` when the user asks you to create/spawn a specialist subagent or delegate a focused task to a specific role (Researcher, Coder, Analyst, Designer, or a custom specialist).
  * Call \`create_skill\` when the user asks to create a new reusable skill/workflow.
  * Call \`create_bot_or_plugin\` when the user asks to create a new bot, custom agent, or plugin tool.
  * Call \`manage_capabilities\` when the user asks what tools/skills/plugins are available, or wants to enable/disable capabilities or save/recall memory.
- Briefly let the user know before or while executing a longer mission/subagent, and after receiving tool results, summarize the outcome clearly in spoken language (mention any created files/images/bots/skills by name).

${coreMemory ? `${coreMemory}\n` : ''}ACTIVE SKILLS:
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
        analysis: `Voice agent invoking tool "${toolSlug}".`,
        steps: [{ id: 1, description: `Run ${toolSlug}`, assignee: 'Lead Agent', uses: [toolSlug] }],
        subagents: [],
        task: note,
      })
    )
    evs.push(
      await addEvent(run.id, 'capability', {
        type: 'tool',
        name: toolSlug,
        reason: 'Requested during live voice session',
      })
    )
    evs.push(
      await addEvent(run.id, 'step_start', {
        stepId: 1,
        description: `Execute ${toolSlug}`,
        assignee: 'Lead Agent',
      })
    )
    evs.push(
      await addEvent(run.id, 'tool_call', {
        actor: 'Lead Agent',
        stepId: 1,
        tool: toolSlug,
        toolName: toolSlug,
        args: parsedArgs,
      })
    )
    safeSend(ws, { type: 'mission_events', runId: run.id, status: 'executing', events: evs })

    const res = await executeTool(toolSlug, parsedArgs, run.id, conversationId)
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
        assignee: 'Lead Agent',
        result: res.raw.slice(0, 1500),
      })
    )
    const finalText = res.ok ? res.summary : `Tool ${toolSlug} error: ${res.summary}`
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
          content: `You are ${subName}, a specialist subagent of NEXUS. Role: ${role}.
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
    const skillName = String(args.name ?? '').trim()
    const description = String(args.description ?? 'Voice-created custom skill').trim()
    const prompt = String(args.prompt ?? '').trim()
    const category = String(args.category ?? 'custom').trim()
    if (!skillName || !prompt) return { ok: false, error: 'name and prompt are required' }

    let slug = slugify(skillName, 'skill')
    if (await db.skill.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    }
    const skill = await db.skill.create({
      data: {
        slug,
        name: skillName.slice(0, 80),
        description: description.slice(0, 300),
        category: category.slice(0, 40),
        icon: 'sparkles',
        prompt: prompt.slice(0, 4000),
        enabled: true,
      },
    })
    safeSend(ws, { type: 'sync', target: 'skills' })
    return { ok: true, skill: { id: skill.id, slug: skill.slug, name: skill.name, description: skill.description } }
  }

  if (name === 'create_bot_or_plugin') {
    const botName = String(args.name ?? '').trim()
    const description = String(args.description ?? 'Voice-created custom bot').trim()
    const instructions = String(args.instructions ?? '').trim()
    const category = String(args.category ?? 'custom').trim()
    const inputHint = String(args.inputHint ?? '{"input": string}').trim()
    if (!botName || !instructions) return { ok: false, error: 'name and instructions are required' }

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
    let assistantTranscriptBuf = ''
    let flushingTurn = false

    const flushTurn = async () => {
      if (flushingTurn) return
      const u = userTranscriptBuf.trim()
      const a = assistantTranscriptBuf.trim()
      if (!u && !a) return
      flushingTurn = true
      userTranscriptBuf = ''
      assistantTranscriptBuf = ''
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
        const msg = JSON.parse(rawStr) as { type?: string; audio?: string; text?: string }
        if (msg.type === 'audio' && typeof msg.audio === 'string' && msg.audio.length > 0) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          })
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          const trimmed = msg.text.trim()
          userTranscriptBuf = userTranscriptBuf ? `${userTranscriptBuf}\n${trimmed}` : trimmed
          session.sendRealtimeInput({ text: trimmed })
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
            assistantTranscriptBuf += content.outputTranscription.text
            safeSend(ws, {
              type: 'output_transcript',
              text: assistantTranscriptBuf,
              delta: content.outputTranscription.text,
            })
          }

          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              safeSend(ws, { type: 'audio', audio: part.inlineData.data })
            }
          }

          if (content?.interrupted) {
            safeSend(ws, { type: 'interrupted' })
          }

          const calls = message.toolCall?.functionCalls ?? []
          if (calls.length > 0) {
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
                session.sendToolResponse({ functionResponses: responses })
              }
            })()
          }

          if (content?.turnComplete) {
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
