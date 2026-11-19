import { db } from '@/lib/db'
import { chatText, chatTextStream, extractJson, getZAI, llmProviderInfo } from '@/lib/agent/zai'
import { executeTool, getEffectiveTools } from '@/lib/agent/tools'
import { getBrain, getBrainPrefs } from '@/lib/agent/brain-host'
import { listWorkspaceFiles } from '@/lib/agent/workspace'
import { ensureCodeFenced, recallMemories, formatRecallBlock, missionVerbosityDirective, needsRewrite, rewriteQuery, hashKey } from '@brain/index'
import { graphRecallMemories, touchRecalledMemories } from '@/lib/agent/memory-graph-store'
import { brainCache, refineStats, coachLessonsFor, coachBlock, coachReviewRun, gradeLessons } from '@/lib/agent/brain-runtime'
import { appBrainAnswerMessages, routeWithAppBrain } from '@/lib/agent/app-brain'
import { reasoningChain } from '@/lib/agent/reasoning-chain'
import type {
  AgentPlan,
  CapabilityRef,
  EventOut,
  PlanStep,
  RunEventData,
  StepResponse,
  SubagentDef,
} from '@/lib/agent/types'

const MAX_STEPS = 8
const MAX_TOOL_USES_PER_STEP = 5
const MAX_RUN_TOOL_CALLS = 24
const LEAD = 'Eva'

const busy = new Set<string>()

interface ExecConvoMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface StepState {
  convo: ExecConvoMessage[]
  toolUses: number
  parseFails: number
  budgetNoted: boolean
  /** tool queued in a previous step: its tool_call event is already visible
   * in the UI (progressive rendering) and it executes on the next step */
  pendingTool: {
    tool: string
    args: Record<string, unknown>
    decision: Record<string, unknown>
    thought: string
  } | null
}

// ---------- helpers ----------

async function addEvent(runId: string, type: string, data: RunEventData): Promise<EventOut> {
  const agg = await db.runEvent.aggregate({ where: { runId }, _max: { seq: true } })
  const seq = (agg._max.seq ?? -1) + 1
  const ev = await db.runEvent.create({ data: { runId, type, seq, data: JSON.stringify(data) } })
  return { seq: ev.seq, type: ev.type as EventOut['type'], data: JSON.parse(ev.data) }
}

function parsePlan(json: string): AgentPlan {
  try {
    const p = JSON.parse(json) as AgentPlan
    if (p && Array.isArray(p.steps)) return p
  } catch { /* ignore */ }
  return { analysis: '', capabilities: [], steps: [], subagents: [] }
}

async function getMemoriesBlock(): Promise<string> {
  const rows = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 24 })
  // gbrain: superseded pages are history — never enter the planner prompt
  const { isSupersededMemory } = await import('@/lib/agent/memory-graph-store')
  const memories = rows.filter((m) => !isSupersededMemory(m)).slice(0, 12)
  if (memories.length === 0) return '(memory is empty — this may be a fresh install)'
  return memories
    .map((m) => `- [${m.type}] ${m.content} (${new Date(m.createdAt).toISOString().slice(0, 10)})`)
    .join('\n')
}

async function getHistoryBlock(conversationId: string, excludeRunUserMessage: string): Promise<string> {
  const msgs = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  })
  const prior = msgs
    .filter((m) => m.content !== excludeRunUserMessage)
    .slice(-8)
  if (prior.length === 0) return '(no prior conversation)'
  return prior.map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content.slice(0, 400)}`).join('\n')
}

async function getStepResults(runId: string): Promise<string> {
  const events = await db.runEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } })
  return events
    .filter((e) => e.type === 'step_done')
    .map((e) => {
      const d = JSON.parse(e.data) as { stepId?: number; assignee?: string; result?: string }
      return `[Step ${d.stepId} — ${d.assignee ?? LEAD}]: ${truncate(d.result ?? '', 1200)}`
    })
    .join('\n')
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + ' …'
}

// ---------- public API ----------

export type RouteResult =
  | {
      mode: 'chat'
      conversationId: string
      reply: string
      suggestions?: string[]
      recalled?: { id: string; content: string; type: string; cite: number }[]
    }
  | { mode: 'task'; conversationId: string; runId: string }

/** Routing outcome BEFORE any answer is written — the SSE stream opens with this. */
export type RouteDecision =
  | {
      mode: 'chat'
      conversationId: string
      brainConnected: boolean
      recalled?: { id: string; content: string; type: string; cite: number }[]
    }
  | { mode: 'task'; conversationId: string; runId: string; brainConnected: boolean }

/**
 * TWO-BRAIN FRONT DOOR — decides how a message is handled.
 *
 * - NEXUS brain connected → the overlay brain routes (reflexes + fast router
 *   turn, brain-first recall attached to the decision).
 * - NEXUS brain disconnected → the app's own SPINE brain routes (same
 *   contract, no overlay extras). The app never goes dumb: this is a normal
 *   LLM agent app with or without the overlay.
 * - Either brain says "task" → a full agent mission run is created.
 */
export async function decideRoute(conversationId: string | null, message: string): Promise<RouteDecision> {
  const llm = llmProviderInfo()
  if (!llm.configured && !(await getZAI())) {
    throw new Error(
      'No LLM API key configured. Add GEMINI_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) in Settings > Secrets.'
    )
  }

  let conv = conversationId
    ? await db.conversation.findUnique({ where: { id: conversationId } })
    : null
  if (!conv) {
    conv = await db.conversation.create({ data: { title: truncate(message.replace(/\s+/g, ' '), 60) } })
  }

  const [memoryRows, prior] = await Promise.all([
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    db.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } }),
  ])
  // gbrain: superseded pages are history — never enter routing or answers
  const { isSupersededMemory } = await import('@/lib/agent/memory-graph-store')
  const memories = memoryRows.filter((m) => !isSupersededMemory(m))
  const history = prior.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  const brain = getBrain()
  const status = await brain.status()

  // ---- PROMPT REFINEMENT (brain connected): follow-ups ("and his sister?")
  // ---- are rewritten into standalone queries so graph recall can seed the
  // ---- right entities. The rewrite feeds RECALL only — the answer still
  // ---- addresses the user's original words. ----
  let recallQuery = message
  if (status.connected && needsRewrite(message, history)) {
    try {
      const r = await rewriteQuery(message, history, (msgs, opts) =>
        chatText(msgs, { temperature: opts?.temperature, maxTokens: opts?.maxTokens })
      )
      if (r.rewritten) {
        recallQuery = r.query
        refineStats.rewrites++
      }
    } catch {
      // refinement is best-effort — the original message is a fine query
    }
  }

  // ---- ROUTE CACHING: identical messages re-route for zero tokens (the
  // ---- context cache serves the decision; TTL keeps it honest) ----
  const routeKey = `route:${status.connected ? 1 : 0}:${hashKey(message + '|' + (history[history.length - 1]?.content ?? '').slice(0, 160))}`

  // ---- the connected brain decides (overlay) ----
  if (status.connected) {
    const { value } = await brainCache.cached(routeKey, 420, 5 * 60_000, async () => {
      const decision = await brain.think({
        message,
        history,
        memories: memories.map((m) => ({ content: m.content, type: m.type })),
      })
      return decision.kind === 'chat' ? 'chat' : 'task'
    })
    if (value === 'chat') {
      // graph-first recall upgrade: PPR over the entity graph, budgeted
      const recalled = await graphRecallRefs(recallQuery, memories)
      return { mode: 'chat', conversationId: conv.id, brainConnected: true, recalled }
    }
  } else {
    // ---- the spine brain decides (always-on, no overlay extras) ----
    const { value } = await brainCache.cached(routeKey, 380, 5 * 60_000, async () => {
      const decision = await routeWithAppBrain({ message, history })
      return decision.kind === 'chat' ? 'chat' : 'task'
    })
    if (value === 'chat') {
      return { mode: 'chat', conversationId: conv.id, brainConnected: false }
    }
  }

  // task path — full agent mission
  const run = await db.run.create({
    data: { conversationId: conv.id, userMessage: message, status: 'planning', phase: 'plan' },
  })
  await db.message.create({
    data: { conversationId: conv.id, role: 'user', content: message, runId: run.id },
  })
  await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
  return { mode: 'task', conversationId: conv.id, runId: run.id, brainConnected: status.connected }
}

/**
 * GRAPH-FIRST RECALL for the chat path (brain connected only): walk the
 * entity graph (PPR) under a token budget; keyword recall is the fallback.
 * Returns recalled refs (id/content/type/cite) or undefined.
 */
async function graphRecallRefs(query: string, memories: { id: string; content: string; type: string; importance?: number; strength?: number; accessCount?: number; lastAccessedAt?: Date | string | null }[]): Promise<{ id: string; content: string; type: string; cite: number }[] | undefined> {
  try {
    const g = await graphRecallMemories(query, { limit: 3, tokenBudget: 450 })
    if (g.recalled.length > 0) {
      // gbrain use-attribution ledger: every recall is recorded (Bjork touch included)
      void (async () => {
        try {
          const { recordRetrievalFor } = await import('@/lib/agent/gbrain-store')
          await Promise.all(g.recalled.map((r) => recordRetrievalFor(r.id, query)))
        } catch {
          await touchRecalledMemories(g.recalled.map((r) => r.id)).catch(() => undefined)
        }
      })()
      return g.recalled.map((r) => ({ id: r.id, content: r.content, type: r.type, cite: r.cite }))
    }
  } catch {
    // graph recall is best-effort
  }
  // keyword fallback (human-brain scored)
  const recalled = recallMemories(
    memories.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      importance: m.importance,
      strength: m.strength,
      accessCount: m.accessCount,
      lastAccessedAt: m.lastAccessedAt ? new Date(m.lastAccessedAt).toISOString() : undefined,
    })),
    query,
    { limit: 3 }
  )
  if (recalled.length === 0) return undefined
  return recalled.map((r) => ({ id: r.id, content: r.content, type: r.type, cite: r.cite }))
}

/** Brain-only extra: suggested follow-up chips for a finished chat answer. */
async function generateChatChips(conversationId: string, message: string, reply: string): Promise<string[] | undefined> {
  try {
    const raw = await chatText(
      [
        {
          role: 'system',
          content:
            'Suggest at most 2 short, concrete follow-ups the user would plausibly want next (a question to ask, an action to run, a way to build on the answer). Each under 12 words. Reply ONLY with minified JSON: {"next":["...","..."]} — empty array if nothing is genuinely useful.',
        },
        { role: 'user', content: `MESSAGE:\n${message.slice(0, 800)}\n\nANSWER:\n${reply.slice(0, 1500)}` },
      ],
      { temperature: 0.5, maxTokens: 150 }
    )
    const parsed = extractJson<{ next?: string[] }>(raw)
    const chips = (parsed?.next ?? [])
      .filter((s) => typeof s === 'string' && s.trim().length > 3)
      .map((s) => s.trim().slice(0, 90))
      .slice(0, 2)
    for (const s of chips) {
      try {
        await db.suggestion.create({
          data: { conversationId, runId: null, title: s, description: s, kind: 'chat-next' },
        })
      } catch {
        // best-effort
      }
    }
    return chips.length > 0 ? chips : undefined
  } catch {
    return undefined
  }
}

/**
 * STREAM the chat answer — the typing-feel core.
 *
 * The answer is generated with a streaming LLM call: every token is passed
 * to onToken the moment it exists, so the client renders the answer as if
 * it is being typed. Short answers type out in a blink, long answers take
 * as long as they deserve — the speed is naturally proportional.
 *
 * The prompt comes from the connected NEXUS brain (persona + recall
 * citations + tone directive) or from the spine (plain persona) — the
 * streaming machinery is identical either way.
 */
export async function streamChatAnswer(
  conversationId: string,
  message: string,
  opts: {
    brainConnected: boolean
    recalled?: { id: string; content: string; type: string; cite: number }[]
    onToken?: (token: string) => void
  }
): Promise<{
  reply: string
  suggestions?: string[]
  recalled?: { id: string; content: string; type: string; cite: number }[]
  assistantMessageId: string
}> {
  // history BEFORE this exchange (the user message is persisted below)
  const [prior, memoryRows] = await Promise.all([
    db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  // gbrain: superseded pages are history — never enter the persona prompt
  const { isSupersededMemory } = await import('@/lib/agent/memory-graph-store')
  const memories = memoryRows.filter((m) => !isSupersededMemory(m))
  const history = prior.map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  // persist the user's message first — it must survive even if the stream dies
  await db.message.create({ data: { conversationId, role: 'user', content: message } })

  const brain = getBrain()
  const msgs = opts.brainConnected
    ? await brain.answerMessages(
        { message, history, memories: memories.map((m) => ({ content: m.content, type: m.type })) },
        opts.recalled
      )
    : appBrainAnswerMessages({ message, history })

  // GBRAIN CORE MEMORY — the always-loaded tier (gbrain always_load pages)
  // rides at the TOP of the system prompt on every connected-brain answer.
  if (opts.brainConnected && msgs.length > 0 && msgs[0].role === 'system') {
    try {
      const { coreMemoryBlock } = await import('@/lib/agent/gbrain-store')
      const core = await coreMemoryBlock()
      if (core) msgs[0] = { role: 'system', content: `${core}\n\n${msgs[0].content}` }
    } catch {
      // core tier is best-effort
    }
  }

  let reply = ''
  try {
    reply = await chatTextStream(msgs, {
      temperature: 0.6,
      maxTokens: 1100,
      onToken: opts.onToken,
    })
  } catch (e) {
    // stream failed mid-flight — persist an honest note instead of losing the turn
    reply = `I hit an error while answering: ${e instanceof Error ? e.message : String(e)}`
    opts.onToken?.(reply)
  }
  reply = ensureCodeFenced(reply.trim())

  const assistantMsg = await db.message.create({
    data: { conversationId, role: 'assistant', content: reply },
  })
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

  // brain-only feature: follow-up chips for the answer
  const suggestions = opts.brainConnected ? await generateChatChips(conversationId, message, reply) : undefined

  return { reply, suggestions, recalled: opts.recalled, assistantMessageId: assistantMsg.id }
}

/**
 * Legacy non-streaming front door (tests + clients that want one JSON blob).
 * The app itself uses decideRoute + streamChatAnswer via the SSE endpoint.
 */
export async function routeMessage(conversationId: string | null, message: string): Promise<RouteResult> {
  const decision = await decideRoute(conversationId, message)
  if (decision.mode === 'task') {
    return { mode: 'task', conversationId: decision.conversationId, runId: decision.runId }
  }
  const res = await streamChatAnswer(decision.conversationId, message, {
    brainConnected: decision.brainConnected,
    recalled: decision.recalled,
  })
  return {
    mode: 'chat',
    conversationId: decision.conversationId,
    reply: res.reply,
    suggestions: res.suggestions,
    recalled: res.recalled,
  }
}

export async function stopRun(runId: string) {
  const run = await db.run.findUnique({ where: { id: runId } })
  if (!run) return false
  if (run.status === 'done' || run.status === 'error') return true
  await db.run.update({ where: { id: runId }, data: { status: 'stopped', phase: 'done' } })
  await addEvent(runId, 'error', { message: 'Mission stopped by operator.' })
  return true
}

export async function stepRun(runId: string): Promise<StepResponse> {
  const run = await db.run.findUnique({ where: { id: runId } })
  if (!run) return { ok: false, status: 'error', events: [], error: 'Run not found' }
  if (['done', 'error', 'stopped'].includes(run.status)) {
    return { ok: true, status: run.status as StepResponse['status'], events: [] }
  }
  if (busy.has(runId)) {
    return { ok: true, busy: true, status: run.status as StepResponse['status'], events: [] }
  }
  busy.add(runId)
  try {
    if (run.phase === 'plan') {
      const res = await doPlan(run)
      return res
    }
    if (run.phase === 'execute') {
      const plan = parsePlan(run.planJson)
      if (run.stepIndex >= plan.steps.length) return await doSynthesize(run)
      return await doExecuteStep(run, plan)
    }
    if (run.phase === 'synthesize') return await doSynthesize(run)
    return { ok: true, status: 'done', events: [] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    let ev: EventOut | null = null
    try {
      ev = await addEvent(runId, 'error', { message: truncate(msg, 500) })
    } catch { /* ignore */ }
    await db.run.update({ where: { id: runId }, data: { status: 'error', phase: 'done' } }).catch(() => {})
    return { ok: false, status: 'error', events: ev ? [ev] : [], error: msg }
  } finally {
    busy.delete(runId)
  }
}

// ---------- planning ----------

async function doPlan(run: { id: string; conversationId: string; userMessage: string }): Promise<StepResponse> {
  const [skills, tools, plugins, mcps, employees] = await Promise.all([
    db.skill.findMany({ where: { enabled: true } }),
    getEffectiveTools(),
    db.plugin.findMany({ where: { installed: true, enabled: true } }),
    db.mcpServer.findMany({ where: { status: 'connected', enabled: true } }),
    db.aiEmployee.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } }),
  ])
  const [memoryBlock, historyBlock] = await Promise.all([
    getMemoriesBlock(),
    getHistoryBlock(run.conversationId, run.userMessage),
  ])

  const skillsList = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n') || '(none)'
  const toolsList = tools
    .map((t) => `- ${t.slug} — ${t.description}${t.argSpec ? ` Args: ${t.argSpec}` : ''}`)
    .join('\n') || '(none)'
  const pluginsList = plugins.map((p) => `- ${p.name}: ${p.description}`).join('\n') || '(none)'
  const mcpsList = mcps
    .map((m) => {
      let ts: { slug: string; name: string }[] = []
      try {
        ts = JSON.parse(m.toolsJson) as typeof ts
      } catch { /* ignore */ }
      return `- ${m.name} (tools: ${ts.map((t) => t.slug).join(', ') || 'none'})`
    })
    .join('\n') || '(none)'
  const orgList =
    employees
      .map((e) => `- ${e.name} [${e.kind}] — ${e.title} (${e.department}): ${e.role}`)
      .join('\n') || '(none hired yet)'

  // ---- NEXUS brain overlay: GRAPH-FIRST recall (walk the entity graph
  // ---- under a token budget, keyword fallback) + THE COACH's lessons from
  // ---- past missions (gbrain push-context + Reflexion injection) ----
  const brainPrefs = await getBrainPrefs()
  let brainContext = ''
  let coreContext = ''
  let brainRecalledCount = 0
  let coachContext = ''
  let injectedLessonIds: string[] = []
  if (brainPrefs.connected) {
    // GBRAIN CORE MEMORY — the owner's standing truths, always in the plan
    try {
      const { coreMemoryBlock } = await import('@/lib/agent/gbrain-store')
      const core = await coreMemoryBlock()
      if (core) coreContext = `${core}\n`
    } catch {
      // core tier is best-effort
    }
    try {
      const g = await graphRecallMemories(run.userMessage, { limit: 4, tokenBudget: 600 })
      let recallBlock = ''
      if (g.recalled.length > 0) {
        brainRecalledCount = g.recalled.length
        recallBlock = g.recalled
          .map((r) => `- [${r.cite}] (${r.type}) ${r.content}${r.trail.length ? `  ⟨via ${r.trail.join(' → ')}⟩` : ''}`)
          .join('\n')
        // record retrievals into the gbrain use-attribution ledger
        try {
          const { recordRetrievalFor } = await import('@/lib/agent/gbrain-store')
          await Promise.all(g.recalled.map((r) => recordRetrievalFor(r.id, run.userMessage)))
        } catch {
          await touchRecalledMemories(g.recalled.map((r) => r.id)).catch(() => undefined)
        }
      } else {
        const { isSupersededMemory } = await import('@/lib/agent/memory-graph-store')
        const memRows = (
          await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 60 })
        ).filter((m) => !isSupersededMemory(m))
        const recalled = recallMemories(
          memRows.map((m) => ({
            id: m.id,
            content: m.content,
            type: m.type,
            importance: m.importance,
            strength: m.strength,
            accessCount: m.accessCount,
            lastAccessedAt: m.lastAccessedAt ? new Date(m.lastAccessedAt).toISOString() : undefined,
          })),
          run.userMessage,
          { limit: 4 }
        )
        brainRecalledCount = recalled.length
        if (recalled.length > 0) recallBlock = formatRecallBlock(recalled)
      }
      if (recallBlock) {
        brainContext = `\nBRAIN CONTEXT (recalled by the connected NEXUS brain — prefer these when planning):\n${recallBlock}\n`
      }
    } catch {
      // brain context is best-effort — the plan must never fail because of it
    }
    // the coach: lessons learned from similar past missions, injected as advice
    try {
      const lessons = await coachLessonsFor(run.userMessage)
      if (lessons.length > 0) {
        injectedLessonIds = lessons.map((l) => l.id)
        coachContext = `\n${coachBlock(lessons)}\n`
      }
    } catch {
      // the coach is best-effort
    }
  }

  const system = `You are Eva, the Lead Agent and Executive Orchestrator of NEXUS. Given a user task, decide HOW to accomplish it using the available capabilities. You must reference ONLY items from the lists below.

AVAILABLE SKILLS (knowledge packs you may load):
${skillsList}

AVAILABLE TOOLS:
${toolsList}

INSTALLED PLUGINS:
${pluginsList}

MCP SERVERS:
${mcpsList}

ORG AI TEAM & BOTS (reporting to Eva — assign matching specialist work by exact name, or use manage_org to review/hire/create bots & subagents when needed):
${orgList}

RULES:
- Choose capabilities that are genuinely useful for THIS task. Do not pad the list.
- Break the task into 1-${MAX_STEPS} concrete, verifiable steps. Merge tiny sub-tasks; do not create filler steps.
- For multi-step or specialized work, delegate steps to matching AI Team members above (using their exact name) or specialist subagents (e.g. "Researcher", "Analyst", "Designer", "Writer", "Coder"). Use "${LEAD}" for Lead Agent orchestration or final synthesis steps.
- Workforce authority: If a task needs a new recurring AI employee, custom bot, or dedicated subagent (or asks to review/audit your AI employees/subagents), plan a step using \`manage_org\` (\`review\`, \`hire\`, \`create_bot\`, \`create_subagent\`). Both Eva and specialist subagents may create bots or agents when the task calls for it.
- Autonomous completion & browser/media mastery: NEVER stop halfway through a web or media task. For playing music or YouTube videos (e.g. "open youtube.com and play rafta rafta"), plan ONE direct step using \`browser_control\` with \`action: "play_media"\` and \`query\`. For multi-step web workflows, use \`browser_control\` with \`action: "autopilot"\` and \`goal\`. If a site needs an email address or verification OTP, use \`agent_email\` autonomously.
- Trivial tasks (greetings, simple Q&A, single questions) need exactly ONE step assigned to "${LEAD}" with no tools.
- If app memory contains something relevant, note it in a capability of type "memory".
- If the task needs current facts, use web_search. For math/data, use run_code. For images, use generate_image or search_images.

Respond ONLY with minified JSON:
{"analysis":"one or two sentences of mission analysis","capabilities":[{"type":"skill|tool|plugin|mcp|memory","name":"<exact name from the lists>","reason":"<short reason>"}],"steps":[{"description":"<what to do>","assignee":"${LEAD}|<SubagentName>","uses":["<tool_slug>"]}],"subagents":[{"name":"<SubagentName>","role":"<specialty description>"}]}`

  const user = `APP MEMORY (what you already remember about the user and past missions):
${memoryBlock}
${coreContext}${brainContext}${coachContext}
RECENT CONVERSATION:
${historyBlock}

USER TASK:
${run.userMessage}

Produce the mission plan JSON now.`

  const raw = await chatText(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.4, thinkingLevel: 'low' }
  )

  const parsed = extractJson<AgentPlan>(raw)
  const plan = normalizePlan(parsed, run.userMessage, employees)
  if (injectedLessonIds.length > 0) plan.lessons = injectedLessonIds

  // bump skill usage for loaded skills
  for (const cap of plan.capabilities) {
    if (cap.type === 'skill') {
      const skill = skills.find((s) => s.name === cap.name || s.slug === cap.name)
      if (skill) await db.skill.update({ where: { id: skill.id }, data: { usageCount: { increment: 1 } } })
    }
  }

  const events: EventOut[] = []
  // the overlay brain's contribution is visible in the timeline
  if (brainPrefs.connected && brainRecalledCount > 0) {
    events.push(
      await addEvent(run.id, 'brain_context', {
        recalled: brainRecalledCount,
        note: `NEXUS brain recalled ${brainRecalledCount} relevant memor${brainRecalledCount === 1 ? 'y' : 'ies'} for this plan`,
      })
    )
  }
  if (coachContext) {
    events.push(
      await addEvent(run.id, 'coach', {
        note: 'the coach injected lessons from past missions',
        lessons: injectedLessonIds.length,
      })
    )
  }
  events.push(
    await addEvent(run.id, 'analysis', {
      analysis: plan.analysis,
      steps: plan.steps,
      subagents: plan.subagents,
      task: run.userMessage,
    })
  )
  for (const cap of plan.capabilities) {
    events.push(await addEvent(run.id, 'capability', cap as unknown as RunEventData))
  }

  await db.run.update({
    where: { id: run.id },
    data: { planJson: JSON.stringify(plan), phase: 'execute', stepIndex: 0, status: 'executing' },
  })

  const chain = reasoningChain.startChain({
    source: 'mission',
    goal: run.userMessage,
    actor: LEAD,
    runId: run.id,
    goalDetail: plan.analysis || `Decomposed into ${plan.steps.length} execution step(s).`,
  })
  reasoningChain.addNode(chain.id, {
    kind: 'decision',
    title: `Mission plan ready (${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'})`,
    detail: plan.steps.map((s, i) => `${i + 1}. [${s.assignee}] ${s.description}`).join(' · '),
    actor: LEAD,
  })

  return { ok: true, status: 'executing', events }
}

function normalizePlan(
  parsed: AgentPlan | null,
  task: string,
  employees: { name: string; title: string; role: string }[] = []
): AgentPlan {
  const fallback: AgentPlan = {
    analysis: 'Executing the task directly.',
    capabilities: [],
    steps: [{ id: 1, description: `Accomplish the task: ${truncate(task, 120)}`, assignee: LEAD, uses: [] }],
    subagents: [],
  }
  if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return fallback

  const rawSteps = parsed.steps.slice(0, MAX_STEPS).map((s, i) => ({
    id: i + 1,
    description: String((s as PlanStep).description ?? `Step ${i + 1}`).slice(0, 300),
    assignee: String((s as PlanStep).assignee ?? LEAD).slice(0, 60) || LEAD,
    uses: Array.isArray((s as PlanStep).uses)
      ? (s as PlanStep).uses.map(String).slice(0, 4)
      : [],
  }))

  const rawSubagents: SubagentDef[] = Array.isArray(parsed.subagents)
    ? parsed.subagents
        .filter((s) => s && typeof s.name === 'string' && s.name.trim())
        .slice(0, 6)
        .map((s) => ({
          name: String(s.name).slice(0, 40),
          role: String(s.role ?? 'Specialist').slice(0, 300),
          steps: [],
        }))
    : []

  // Ensure any Org AI employee referenced in steps is preserved in subagents with their official role
  const empByLower = new Map(employees.map((e) => [e.name.toLowerCase(), e]))
  for (const st of rawSteps) {
    const emp = empByLower.get(st.assignee.toLowerCase())
    if (emp && !rawSubagents.some((s) => s.name.toLowerCase() === emp.name.toLowerCase())) {
      rawSubagents.push({
        name: emp.name,
        role: `${emp.title}: ${emp.role}`.slice(0, 300),
        steps: [],
      })
    }
  }

  // attach subagents to their steps
  for (const sa of rawSubagents) {
    for (const st of rawSteps) {
      if (st.assignee.toLowerCase() === sa.name.toLowerCase()) sa.steps.push(st.id)
    }
  }
  // any assignee without a definition (or legacy "Lead Agent") becomes Eva
  const saNames = new Set(rawSubagents.map((s) => s.name.toLowerCase()))
  for (const st of rawSteps) {
    if (st.assignee.toLowerCase() === 'lead agent') st.assignee = LEAD
    if (st.assignee !== LEAD && !saNames.has(st.assignee.toLowerCase())) st.assignee = LEAD
  }

  const allowedTypes = new Set(['skill', 'tool', 'plugin', 'mcp', 'memory'])
  const capabilities: CapabilityRef[] = (Array.isArray(parsed.capabilities) ? parsed.capabilities : [])
    .filter((c) => c && typeof c.name === 'string' && allowedTypes.has(String(c.type)))
    .slice(0, 8)
    .map((c) => ({
      type: String(c.type) as CapabilityRef['type'],
      name: String(c.name).slice(0, 80),
      reason: String(c.reason ?? '').slice(0, 200),
    }))

  return {
    analysis: String(parsed.analysis ?? '').slice(0, 600) || fallback.analysis,
    capabilities,
    steps: rawSteps,
    subagents: rawSubagents,
  }
}

// ---------- execution ----------

async function doExecuteStep(
  run: {
    id: string
    conversationId: string
    userMessage: string
    stepIndex: number
    stepStateJson: string
    toolCallCount: number
    planJson: string
  },
  plan: AgentPlan
): Promise<StepResponse> {
  const step = plan.steps[run.stepIndex]
  const state: StepState = (() => {
    try {
      const s = JSON.parse(run.stepStateJson || '{}') as Partial<StepState>
      return {
        convo: Array.isArray(s.convo) ? (s.convo as ExecConvoMessage[]) : [],
        toolUses: s.toolUses ?? 0,
        parseFails: s.parseFails ?? 0,
        budgetNoted: s.budgetNoted ?? false,
        pendingTool: s.pendingTool ?? null,
      }
    } catch {
      return { convo: [], toolUses: 0, parseFails: 0, budgetNoted: false, pendingTool: null }
    }
  })()

  const events: EventOut[] = []
  const isSubagent = step.assignee !== LEAD
  const subagentDef = plan.subagents.find((s) => s.name.toLowerCase() === step.assignee.toLowerCase())
  const [tools, orgEmployees] = await Promise.all([
    getEffectiveTools(),
    db.aiEmployee.findMany({ where: { status: 'active' } }),
  ])
  const matchedEmployee = isSubagent
    ? orgEmployees.find((e) => e.name.toLowerCase() === step.assignee.toLowerCase())
    : undefined
  const events0 = await db.runEvent.findMany({
    where: { runId: run.id },
    orderBy: { seq: 'asc' },
  })

  // ----- initialize step on first turn -----
  if (state.convo.length === 0) {
    events.push(
      await addEvent(run.id, 'step_start', {
        stepId: step.id,
        description: step.description,
        assignee: step.assignee,
      })
    )
    if (isSubagent) {
      const already = events0.some((e) => {
        if (e.type !== 'subagent_spawn') return false
        const d = JSON.parse(e.data) as { name?: string }
        return (d.name ?? '').toLowerCase() === step.assignee.toLowerCase()
      })
      if (!already) {
        events.push(
          await addEvent(run.id, 'subagent_spawn', {
            name: step.assignee,
            role: matchedEmployee
              ? `${matchedEmployee.title} (${matchedEmployee.department}) — ${matchedEmployee.role}`
              : (subagentDef?.role ?? 'Specialist subagent'),
          })
        )
      }
    }

    const loadedSkills = plan.capabilities
      .filter((c) => c.type === 'skill')
      .map((c) => c.name.toLowerCase())
    let empSkillSlugs: string[] = []
    let empToolSlugs: string[] = []
    if (matchedEmployee) {
      try { empSkillSlugs = (JSON.parse(matchedEmployee.skillsJson) as string[]).map((s) => s.toLowerCase()) } catch { /* ignore */ }
      try { empToolSlugs = (JSON.parse(matchedEmployee.toolsJson) as string[]).map((t) => t.toLowerCase()) } catch { /* ignore */ }
    }
    const skillsRows = await db.skill.findMany({ where: { enabled: true } })
    const skillBlocks = skillsRows
      .filter(
        (s) =>
          loadedSkills.includes(s.name.toLowerCase()) ||
          loadedSkills.includes(s.slug.toLowerCase()) ||
          empSkillSlugs.includes(s.slug.toLowerCase()) ||
          empSkillSlugs.includes(s.name.toLowerCase())
      )
      .map((s) => `SKILL "${s.name}": ${s.prompt}`)
      .join('\n')

    const toolList =
      tools
        .map((t) => `- ${t.slug} — ${t.description}${t.argSpec ? ` Args: ${t.argSpec}` : ''}`)
        .join('\n') || '(no tools available)'

    const priorResults = await getStepResults(run.id)

    const orgPersona = matchedEmployee
      ? `\nORG IDENTITY: ${matchedEmployee.title} · ${matchedEmployee.department} (${matchedEmployee.kind})\nROLE INSTRUCTIONS: ${matchedEmployee.systemPrompt || matchedEmployee.role}${empToolSlugs.length ? `\nPREFERRED TOOLS: ${empToolSlugs.join(', ')}` : ''}`
      : isSubagent && subagentDef
        ? `\nYour specialty: ${subagentDef.role}`
        : ''

    const system = `You are ${step.assignee}${isSubagent ? `, a specialist subagent reporting to Eva (Lead Agent of NEXUS)` : `, the Lead Agent of NEXUS (an autonomous AI agent)`}.${orgPersona}

MISSION (from the user): ${run.userMessage}

${skillBlocks ? `LOADED SKILLS:\n${skillBlocks}\n` : ''}AVAILABLE TOOLS (referenced by exact slug):
${toolList}

RULES:
- Use tools decisively to COMPLETE the goal end-to-end. Never stop halfway or ask the user to click/guide individual steps when you can finish with \`browser_control\` (\`play_media\` for songs/videos, \`autopilot\` for multi-step web tasks), \`agent_email\` (Eva's own inbox & OTP reader), or \`self_manage_extensions\`.
- Do not repeat a tool call you already made with the exact same args — if one strategy hits a block, pivot autonomously to a better tool/action.
- If this step or task requires creating a dedicated helper bot, spinning up a persistent subagent, reviewing Org staff, or hiring an AI employee, you are authorized to call \`manage_org\` (\`review\`, \`hire\`, \`create_bot\`, \`create_subagent\`).
- If no tool is needed (or you already have the verified result), finish immediately.
- Your step result must be concise (< 1500 chars), factual, and self-contained so Eva can use it.
${step.uses.length ? `- This step was planned to use: ${step.uses.join(', ')} (only if actually useful)\n` : ''}
Respond ONLY with minified JSON, one of:
{"action":"use_tool","tool":"<slug>","args":{...},"thought":"<one short sentence>"}
{"action":"finish","result":"<your step result>","thought":"<one short sentence>"}`

    const userMsg = `YOUR CURRENT STEP: ${step.description}

PREVIOUS STEP RESULTS:
${priorResults || '(this is the first step — no previous results)'}

Begin.`

    state.convo = [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ]
  }

  // ----- budget guard -----
  if (
    !state.budgetNoted &&
    (state.toolUses >= MAX_TOOL_USES_PER_STEP || run.toolCallCount >= MAX_RUN_TOOL_CALLS)
  ) {
    state.convo.push({
      role: 'user',
      content:
        'TOOL BUDGET EXHAUSTED. Do not request more tools. Respond now with: {"action":"finish","result":"<best result with what you have>","thought":"..."}',
    })
    state.budgetNoted = true
  }

  // ----- execute a tool queued by the previous step (progressive rendering:
  // ----- its tool_call event is already visible, e.g. the image placeholder) -----
  if (state.pendingTool) {
    const pending = state.pendingTool
    state.pendingTool = null
    const result = await executeTool(pending.tool, pending.args, run.id, run.conversationId)
    events.push(
      await addEvent(run.id, 'tool_result', {
        tool: pending.tool,
        ok: result.ok,
        summary: result.summary,
        display: result.display ?? null,
      })
    )
    const activeChain = reasoningChain.getChainByRunId(run.id)
    if (activeChain) {
      if (result.ok) {
        reasoningChain.addNode(activeChain.id, {
          kind: 'observation',
          title: `Tool succeeded: ${pending.tool}`,
          detail: result.summary,
          actor: step.assignee,
          tool: pending.tool,
        })
      } else {
        reasoningChain.addNode(activeChain.id, {
          kind: 'self_correction',
          title: `Tool failed: ${pending.tool} — pivoting`,
          detail: result.summary,
          actor: step.assignee,
          tool: pending.tool,
          correction: {
            whatFailed: result.summary,
            pivotStrategy: 'Pass error context to the next reasoning turn to select a fallback tool or strategy.',
          },
        })
      }
    }
    state.convo.push({ role: 'assistant', content: JSON.stringify(pending.decision) })
    state.convo.push({
      role: 'user',
      content: `TOOL_RESULT (${pending.tool}):\n${result.raw}\n\nContinue. Use another tool if needed, or finish with: {"action":"finish","result":"...","thought":"..."}`,
    })
    state.toolUses++
    await db.run.update({ where: { id: run.id }, data: { toolCallCount: { increment: 1 } } })
    await saveStepState(run.id, state)
    return { ok: true, status: 'executing', events }
  }

  // ----- one LLM turn -----
  const raw = await chatText(state.convo, { temperature: 0.4, thinkingLevel: 'low' })
  const decision = extractJson<{
    action?: string
    tool?: string
    args?: Record<string, unknown>
    result?: string
    thought?: string
  }>(raw)

  if (!decision) {
    state.parseFails++
    const activeChain = reasoningChain.getChainByRunId(run.id)
    if (activeChain) {
      reasoningChain.addNode(activeChain.id, {
        kind: 'self_correction',
        title: 'Structured JSON retry',
        detail: 'Step reply was not valid minified JSON; requesting a strictly formatted decision payload.',
        actor: step.assignee,
        correction: {
          whatFailed: 'Unstructured LLM step output',
          pivotStrategy: state.parseFails >= 2 ? 'Capture raw text output and complete step.' : 'Re-prompt with explicit JSON schema reminder.',
        },
      })
    }
    if (state.parseFails >= 2) {
      const result = truncate(raw.replace(/\s+/g, ' '), 1500)
      events.push(await addEvent(run.id, 'thought', { actor: step.assignee, text: 'collected output, finishing step' }))
      events.push(
        await addEvent(run.id, 'step_done', { stepId: step.id, assignee: step.assignee, result })
      )
      if (matchedEmployee) {
        await db.aiEmployee.update({
          where: { id: matchedEmployee.id },
          data: { tasksCompleted: { increment: 1 }, lastActiveAt: new Date() },
        }).catch(() => undefined)
      }
      await advanceStep(run, plan)
      return { ok: true, status: nextStatus(run, plan), events }
    }
    state.convo.push({ role: 'assistant', content: truncate(raw, 800) })
    state.convo.push({
      role: 'user',
      content:
        'INVALID RESPONSE: your reply was not the required JSON. Respond ONLY with minified JSON: {"action":"use_tool","tool":"<slug>","args":{...},"thought":"..."} or {"action":"finish","result":"...","thought":"..."}',
    })
    await saveStepState(run.id, state)
    return { ok: true, status: 'executing', events }
  }

  const thought = String(decision.thought ?? '').slice(0, 300)

  if (decision.action === 'use_tool' && typeof decision.tool === 'string') {
    const toolSlug = decision.tool
    const known = tools.find((t) => t.slug === toolSlug)
    if (!known) {
      const activeChain = reasoningChain.getChainByRunId(run.id)
      if (activeChain) {
        reasoningChain.addNode(activeChain.id, {
          kind: 'self_correction',
          title: `Unknown tool "${toolSlug}" — retrying`,
          detail: `Requested unavailable tool "${toolSlug}"; re-grounding on active tool inventory.`,
          actor: step.assignee,
          correction: {
            whatFailed: `Tool "${toolSlug}" does not exist or is disabled.`,
            pivotStrategy: 'Select an enabled tool from the live tool registry.',
          },
        })
      }
      state.convo.push({ role: 'assistant', content: JSON.stringify(decision) })
      state.convo.push({
        role: 'user',
        content: `TOOL_ERROR: unknown tool "${toolSlug}". Available tools: ${tools.map((t) => t.slug).join(', ')}. Try again with a valid tool or finish.`,
      })
      await saveStepState(run.id, state)
      return { ok: true, status: 'executing', events }
    }

    const args = (decision.args && typeof decision.args === 'object' ? decision.args : {}) as Record<string, unknown>
    if (thought) events.push(await addEvent(run.id, 'thought', { actor: step.assignee, text: thought }))
    events.push(
      await addEvent(run.id, 'tool_call', {
        actor: step.assignee,
        stepId: step.id,
        tool: toolSlug,
        toolName: known.name,
        args: JSON.parse(JSON.stringify(args).slice(0, 1200)) as Record<string, unknown>,
      })
    )
    const activeChain = reasoningChain.getChainByRunId(run.id)
    if (activeChain) {
      reasoningChain.addNode(activeChain.id, {
        kind: 'decision',
        title: `Invoke ${known.name}`,
        detail: thought || `Selected tool "${toolSlug}" for step ${step.id}.`,
        actor: step.assignee,
        tool: toolSlug,
      })
    }

    // progressive execution: return after the tool_call event so the UI can
    // render the in-flight state (e.g. the image generating card); the tool
    // itself executes on the next step call
    state.pendingTool = {
      tool: toolSlug,
      args,
      decision: decision as Record<string, unknown>,
      thought,
    }
    await saveStepState(run.id, state)
    return { ok: true, status: 'executing', events }
  }

  // finish
  const result = String(decision.result ?? decision.thought ?? 'Step completed.').slice(0, 2000)
  if (thought) events.push(await addEvent(run.id, 'thought', { actor: step.assignee, text: thought }))
  events.push(
    await addEvent(run.id, 'step_done', { stepId: step.id, assignee: step.assignee, result })
  )
  const activeChain = reasoningChain.getChainByRunId(run.id)
  if (activeChain) {
    reasoningChain.addNode(activeChain.id, {
      kind: 'verification',
      title: `Step ${step.id} verified`,
      detail: truncate(result, 240),
      actor: step.assignee,
      verified: true,
    })
  }
  if (matchedEmployee) {
    await db.aiEmployee.update({
      where: { id: matchedEmployee.id },
      data: { tasksCompleted: { increment: 1 }, lastActiveAt: new Date() },
    }).catch(() => undefined)
  }
  await advanceStep(run, plan)
  return { ok: true, status: nextStatus(run, plan), events }
}

async function saveStepState(runId: string, state: StepState) {
  // keep convo bounded
  const convo = state.convo.length > 24 ? [state.convo[0], ...state.convo.slice(-22)] : state.convo
  await db.run.update({
    where: { id: runId },
    data: { stepStateJson: JSON.stringify({ ...state, convo }) },
  })
}

async function advanceStep(
  run: { id: string; stepIndex: number },
  plan: AgentPlan
) {
  const nextIndex = run.stepIndex + 1
  await db.run.update({
    where: { id: run.id },
    data: {
      stepIndex: nextIndex,
      stepStateJson: '{}',
      ...(nextIndex >= plan.steps.length ? { phase: 'synthesize', status: 'synthesizing' } : {}),
    },
  })
}

function nextStatus(
  run: { stepIndex: number },
  plan: AgentPlan
): StepResponse['status'] {
  return run.stepIndex + 1 >= plan.steps.length ? 'synthesizing' : 'executing'
}

// ---------- synthesis ----------

/**
 * Image integrity pass for the final answer.
 * The synthesis LLM occasionally invents image URLs (e.g. example.com/...)
 * instead of using the real workspace files. Every markdown image reference
 * that does not point at a URL actually produced during the run is replaced
 * with the next unused generated image (in order).
 */
async function fixHallucinatedImages(runId: string, answer: string): Promise<string> {
  const events = await db.runEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } })
  const legitUrls = new Set<string>()
  const generated: string[] = []
  for (const e of events) {
    if (e.type !== 'tool_result') continue
    try {
      const d = JSON.parse(e.data) as { display?: { kind?: string; url?: string; items?: { url: string }[] } | null }
      const disp = d.display
      if (!disp) continue
      if (disp.kind === 'image' && disp.url) {
        legitUrls.add(disp.url)
        if (disp.url.startsWith('/api/files')) generated.push(disp.url)
      } else if (disp.kind === 'images' && Array.isArray(disp.items)) {
        for (const it of disp.items) if (it?.url) legitUrls.add(it.url)
      }
    } catch { /* ignore malformed events */ }
  }

  if (generated.length === 0 && legitUrls.size === 0) return answer

  // Real files in the workspace — a relative image name (e.g. the LLM writing
  // "img_1.png" instead of the actual "img_1794831823846.png") is only legit
  // if a file with that exact name truly exists.
  const realFiles = new Set(await listWorkspaceFiles())
  const extractName = (u: string): string => {
    try {
      if (u.startsWith('/api/files')) {
        const q = u.split('?')[1] ?? ''
        const m = /[?&]name=([^&]+)/.exec(`?${q}`)
        return m ? decodeURIComponent(m[1]) : ''
      }
      return u.replace(/^\.?\//, '')
    } catch {
      return ''
    }
  }

  let used = 0
  let patched = answer.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (full, pre: string, url: string, post: string) => {
    let isLegit: boolean
    if (/^https?:\/\//.test(url)) {
      // absolute URLs are trusted only when a tool actually produced them
      isLegit = legitUrls.has(url)
    } else if (url.startsWith('/api/files')) {
      // served workspace URL — legit when the named file exists
      isLegit = realFiles.has(extractName(url))
    } else {
      // bare relative name — legit only if that exact file exists
      isLegit = realFiles.has(url)
    }
    if (isLegit) return full
    // hallucinated reference → replace with the next real generated image
    if (used < generated.length) {
      const replacement = generated[used++]
      return `${pre}${replacement}${post}`
    }
    // nothing to swap in — keep the alt text as plain text, drop the broken ref
    const alt = pre.startsWith('![') ? pre.slice(2, -1) : 'image'
    return alt || full
  })

  // Ensure any generated workspace image not yet referenced in the final answer is embedded visibly
  for (const genUrl of generated) {
    const fileName = extractName(genUrl)
    if (!realFiles.has(fileName)) continue
    if (!patched.includes(genUrl) && !patched.includes(fileName)) {
      patched = `${patched.trimEnd()}\n\n![Generated image](${genUrl})`
    }
  }
  return patched
}


async function doSynthesize(run: { id: string; conversationId: string; userMessage: string }): Promise<StepResponse> {
  const [stepResults, memoryBlock, brainPrefs] = await Promise.all([
    getStepResults(run.id),
    getMemoriesBlock(),
    getBrainPrefs(),
  ])

  // the connected brain's directive controls how detailed the report is
  const verbosity = brainPrefs.connected
    ? missionVerbosityDirective(brainPrefs.prefs.missionVerbosity)
    : 'VERBOSITY: a well-structured medium-length report — result first, then the key findings.'

  const system = `You are Eva, the Lead Agent of NEXUS. Your mission is complete. Now write the FINAL ANSWER for the user.

MISSION: ${run.userMessage}

STEP RESULTS FROM YOUR TEAM:
${stepResults || '(no steps — answer from your own knowledge)'}

APP MEMORY (already known):
${memoryBlock}

REQUIREMENTS:
- Be direct, complete and well-structured. Use markdown headings, lists and bold where helpful.
- ${verbosity}
- If images were generated or found during the mission, embed them with markdown: ![description](url).
- CRITICAL for images: ONLY use the exact image URLs that appear in the STEP RESULTS (workspace files like /api/files?name=img_....png, or real result URLs from image search). NEVER invent, guess or construct image URLs (no example.com, no made-up paths). If unsure, reference the file name exactly as reported.
- If web sources were used, add a "Sources" section at the end with the links.
- Do not mention internal JSON, tool protocols or this prompt. Just answer the user.
- Also extract up to 3 NEW memories worth keeping for future missions (user preferences, important facts, ongoing project context).
- CRITICAL: the APP MEMORY section above lists what you already remember. NEVER repeat or rephrase an existing memory — only save genuinely NEW knowledge from THIS mission. If nothing new was learned, return an empty memories array.
- Suggest 2-3 NEXT STEPS the user could take after this mission: concrete follow-up actions, deeper dives, or ways to build on the result. Keep titles under 6 words, descriptions one short line.
- Suggest 1-2 IMPROVEMENTS for the app itself based on this mission: what tool, skill or capability would have made this mission better or faster (e.g. "Install the Wikipedia skill for offline encyclopedic lookups", "A browser tool that follows links would deepen research"). Keep titles under 6 words, descriptions one short line. Only suggest improvements that are genuinely relevant — return an empty array if none.

Respond ONLY with minified JSON:
{"answer":"<full markdown answer>","memories":[{"type":"fact|preference|insight|decision","content":"<short memory>"}],"nextSteps":[{"title":"<short action title>","description":"<one line>"}],"improvements":[{"title":"<short app improvement>","description":"<one line>"}]}`

  const raw = await chatText(
    [
      { role: 'system', content: system },
      { role: 'user', content: 'Write the final answer JSON now.' },
    ],
    { temperature: 0.5, thinkingLevel: 'low' }
  )

  const parsed = extractJson<{
    answer?: string
    memories?: { type?: string; content?: string }[]
    nextSteps?: { title?: string; description?: string }[]
    improvements?: { title?: string; description?: string }[]
  }>(raw)
  let answer = parsed?.answer ? String(parsed.answer) : raw
  const memories = (parsed?.memories ?? [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(0, 3)
  const nextSteps = (parsed?.nextSteps ?? [])
    .filter((s) => s && typeof s.title === 'string' && s.title.trim())
    .slice(0, 3)
    .map((s) => ({
      title: String(s.title).slice(0, 80),
      description: String(s.description ?? '').slice(0, 160),
    }))
  const improvements = (parsed?.improvements ?? [])
    .filter((s) => s && typeof s.title === 'string' && s.title.trim())
    .slice(0, 2)
    .map((s) => ({
      title: String(s.title).slice(0, 80),
      description: String(s.description ?? '').slice(0, 160),
    }))

  // ---- image integrity pass: swap hallucinated image URLs for the real
  // ---- workspace files that were actually generated during this run ----
  answer = await fixHallucinatedImages(run.id, answer)

  const events: EventOut[] = []

  await db.message.create({
    data: { conversationId: run.conversationId, role: 'assistant', content: answer, runId: run.id },
  })

  const activeChain = reasoningChain.getChainByRunId(run.id)
  if (activeChain) {
    reasoningChain.completeChain(activeChain.id, {
      ok: true,
      verificationDetail: `Synthesized verified final answer (${answer.length} chars) for "${truncate(run.userMessage, 120)}".`,
      actor: LEAD,
    })
  }

  for (const m of memories) {
    const type = ['fact', 'preference', 'insight', 'decision', 'note'].includes(String(m.type)) ? String(m.type) : 'note'
    const content = String(m.content).slice(0, 400)
    // GBRAIN write path: dedup → truth compile → conflict supersede →
    // entity resolution (near-name cascade) → graph indexing. One call,
    // every rule lives in the brain folder.
    try {
      const { saveMemoryGbrain } = await import('@/lib/agent/gbrain-store')
      const res = await saveMemoryGbrain({
        content,
        type,
        kind: type === 'fact' || type === 'decision' || type === 'insight' ? 'semantic' : 'episodic',
        importance: type === 'decision' ? 7 : type === 'fact' || type === 'insight' ? 6 : 3,
        runId: run.id,
      })
      if (res.deduplicated) continue // refreshed the original instead
      events.push(await addEvent(run.id, 'memory_saved', { content, type }))
    } catch {
      // the gbrain path is best-effort — fall back to a plain save
      const saved = await db.memory.create({
        data: {
          content,
          type,
          kind: type === 'fact' || type === 'decision' || type === 'insight' ? 'semantic' : 'episodic',
          source: 'agent',
          runId: run.id,
          conversationId: run.conversationId,
          importance: type === 'decision' ? 7 : type === 'fact' || type === 'insight' ? 6 : 3,
        },
      })
      try {
        const { indexMemory } = await import('@/lib/agent/memory-graph-store')
        await indexMemory(saved.id, saved.content)
      } catch {
        // graph indexing is best-effort
      }
      events.push(await addEvent(run.id, 'memory_saved', { content, type }))
    }
  }

  // ---- next-step suggestions: what should come after this mission ----
  for (const s of nextSteps) {
    try {
      await db.suggestion.create({
        data: {
          conversationId: run.conversationId,
          runId: run.id,
          title: s.title,
          description: s.description,
          kind: 'next',
        },
      })
    } catch {
      // suggestions are best-effort
    }
  }

  // ---- app-improvement suggestions: how this app could serve you better ----
  for (const s of improvements) {
    try {
      await db.suggestion.create({
        data: {
          conversationId: run.conversationId,
          runId: run.id,
          title: s.title,
          description: s.description,
          kind: 'improve',
        },
      })
    } catch {
      // suggestions are best-effort
    }
  }

  events.push(await addEvent(run.id, 'final', { answer, nextSteps, improvements }))

  await db.run.update({ where: { id: run.id }, data: { status: 'done', phase: 'done' } })
  await db.conversation.update({ where: { id: run.conversationId }, data: { updatedAt: new Date() } })

  // ---- THE COACH reviews the finished mission (fire-and-forget): reflect
  // ---- on the trajectory, store new lessons, grade the lessons it injected.
  // ---- The answer is already delivered — the coach works after class. ----
  void (async () => {
    try {
      const fullRun = await db.run.findUnique({ where: { id: run.id } })
      if (!fullRun) return
      let toolsUsed: string[] = []
      let injectedLessons: string[] = []
      let stepCount = 0
      try {
        const toolEvents = await db.runEvent.findMany({
          where: { runId: run.id, type: 'tool_call' },
          orderBy: { seq: 'asc' },
        })
        toolsUsed = toolEvents
          .map((e) => {
            try {
              return (JSON.parse(e.data) as { tool?: string }).tool ?? ''
            } catch {
              return ''
            }
          })
          .filter(Boolean)
        const plan = JSON.parse(fullRun.planJson) as { lessons?: string[]; steps?: unknown[] }
        injectedLessons = Array.isArray(plan.lessons) ? plan.lessons : []
        stepCount = Array.isArray(plan.steps) ? plan.steps.length : 0
      } catch {
        // trajectory mining is best-effort
      }
      await gradeLessons(injectedLessons, true)
      await coachReviewRun({
        id: fullRun.id,
        userMessage: fullRun.userMessage,
        status: fullRun.status,
        createdAt: fullRun.createdAt,
        answer,
        toolsUsed,
        stepCount,
      })
    } catch {
      // the coach never blocks or breaks a finished mission
    }
  })()

  return { ok: true, status: 'done', events }
}
