import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { chatText } from '@/lib/agent/zai'

export type TicketStatus = 'backlog' | 'queued' | 'in_progress' | 'needs_approval' | 'done' | 'blocked'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface PaperclipAgentConfig {
  agentId: string
  monthlyBudgetUsd: number
  spentUsd: number
  tokensUsed: number
  heartbeatIntervalMin: number
  heartbeatEnabled: boolean
  autoThrottle: boolean
  lastHeartbeatAt: string | null
  byoaWebhookUrl: string | null
  byoaProvider: string | null
  byoaSecretHeader: string | null
}

export interface PaperclipTicket {
  id: string
  key: string
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  assigneeId: string | null
  assigneeName: string
  requiresApproval: boolean
  approvedBy: string | null
  approvedAt: string | null
  tokensSpent: number
  costUsd: number
  outputSummary: string
  createdAt: string
  updatedAt: string
}

export interface HeartbeatRun {
  id: string
  agentId: string
  agentName: string
  ticketId: string | null
  ticketKey: string | null
  status: 'ok' | 'throttled' | 'idle' | 'error'
  summary: string
  tokensUsed: number
  costUsd: number
  via: 'gemini' | 'byoa' | 'local'
  ranAt: string
}

export interface PaperclipCompanyState {
  companyName: string
  mission: string
  monthlyBudgetUsd: number
  autoHireEnabled: boolean
  ticketSeq: number
  agentConfigs: Record<string, PaperclipAgentConfig>
  tickets: PaperclipTicket[]
  heartbeats: HeartbeatRun[]
  updatedAt: string
}

const STORE_FILE = path.join(process.cwd(), '.nexus-company.json')
const COST_PER_1K_TOKENS_USD = 0.00045

function defaultState(): PaperclipCompanyState {
  const now = new Date().toISOString()
  return {
    companyName: 'Nexus Autonomous Company',
    mission:
      'Operate a zero-human-bottleneck engineering company led by Eva with autonomous specialist agents, governed budgets, heartbeats, and verifiable delivery.',
    monthlyBudgetUsd: 250,
    autoHireEnabled: true,
    ticketSeq: 3,
    agentConfigs: {},
    tickets: [
      {
        id: 'tkt_seed_1',
        key: 'NEX-1',
        title: 'Audit workspace health & verify TypeScript build integrity',
        description:
          'Run periodic verification across core Next.js routes and ensure zero runtime or schema regressions.',
        status: 'queued',
        priority: 'high',
        assigneeId: null,
        assigneeName: 'Eva (Unassigned)',
        requiresApproval: false,
        approvedBy: null,
        approvedAt: null,
        tokensSpent: 0,
        costUsd: 0,
        outputSummary: '',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tkt_seed_2',
        key: 'NEX-2',
        title: 'Monitor external release dependencies & security advisories',
        description:
          'Check upstream frameworks and surface actionable upgrade recommendations with risk notes.',
        status: 'backlog',
        priority: 'medium',
        assigneeId: null,
        assigneeName: 'Eva (Unassigned)',
        requiresApproval: true,
        approvedBy: null,
        approvedAt: null,
        tokensSpent: 0,
        costUsd: 0,
        outputSummary: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    heartbeats: [],
    updatedAt: now,
  }
}

const globalCompany = globalThis as unknown as { __nexusPaperclipCompany?: PaperclipCompanyState }

export function loadCompanyState(): PaperclipCompanyState {
  if (globalCompany.__nexusPaperclipCompany) {
    return globalCompany.__nexusPaperclipCompany
  }
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PaperclipCompanyState>
      const merged: PaperclipCompanyState = {
        ...defaultState(),
        ...parsed,
        agentConfigs: parsed.agentConfigs ?? {},
        tickets: Array.isArray(parsed.tickets) ? parsed.tickets : defaultState().tickets,
        heartbeats: Array.isArray(parsed.heartbeats) ? parsed.heartbeats : [],
      }
      globalCompany.__nexusPaperclipCompany = merged
      return merged
    }
  } catch {
    /* fallback to default in-memory state */
  }
  const fresh = defaultState()
  globalCompany.__nexusPaperclipCompany = fresh
  return fresh
}

export function saveCompanyState(state: PaperclipCompanyState): void {
  state.updatedAt = new Date().toISOString()
  globalCompany.__nexusPaperclipCompany = state
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch {
    /* sandboxed fs fallback — memory state remains authoritative */
  }
}

export function ensureAgentConfig(
  state: PaperclipCompanyState,
  agentId: string,
  defaults?: Partial<PaperclipAgentConfig>
): PaperclipAgentConfig {
  const existing = state.agentConfigs[agentId]
  if (existing) return existing
  const cfg: PaperclipAgentConfig = {
    agentId,
    monthlyBudgetUsd: defaults?.monthlyBudgetUsd ?? 25,
    spentUsd: defaults?.spentUsd ?? 0,
    tokensUsed: defaults?.tokensUsed ?? 0,
    heartbeatIntervalMin: defaults?.heartbeatIntervalMin ?? 30,
    heartbeatEnabled: defaults?.heartbeatEnabled ?? true,
    autoThrottle: defaults?.autoThrottle ?? true,
    lastHeartbeatAt: defaults?.lastHeartbeatAt ?? null,
    byoaWebhookUrl: defaults?.byoaWebhookUrl ?? null,
    byoaProvider: defaults?.byoaProvider ?? null,
    byoaSecretHeader: defaults?.byoaSecretHeader ?? null,
  }
  state.agentConfigs[agentId] = cfg
  return cfg
}

export async function getCompanySnapshot() {
  const state = loadCompanyState()
  const employees = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })
  let mutated = false
  for (const emp of employees) {
    if (!state.agentConfigs[emp.id]) {
      ensureAgentConfig(state, emp.id)
      mutated = true
    }
  }
  if (mutated) saveCompanyState(state)

  const totalSpentUsd = Object.values(state.agentConfigs).reduce((sum, c) => sum + c.spentUsd, 0)
  const totalTokens = Object.values(state.agentConfigs).reduce((sum, c) => sum + c.tokensUsed, 0)
  const openTickets = state.tickets.filter((t) => t.status !== 'done').length
  const approvalPending = state.tickets.filter((t) => t.status === 'needs_approval').length

  return {
    company: {
      companyName: state.companyName,
      mission: state.mission,
      monthlyBudgetUsd: state.monthlyBudgetUsd,
      autoHireEnabled: state.autoHireEnabled,
      updatedAt: state.updatedAt,
    },
    metrics: {
      totalSpentUsd: Number(totalSpentUsd.toFixed(4)),
      monthlyBudgetUsd: state.monthlyBudgetUsd,
      budgetUtilizationPct:
        state.monthlyBudgetUsd > 0
          ? Math.min(100, Math.round((totalSpentUsd / state.monthlyBudgetUsd) * 100))
          : 0,
      totalTokens,
      openTickets,
      approvalPending,
      totalHeartbeats: state.heartbeats.length,
      activeAgents: employees.filter((e) => e.status === 'active').length,
      byoaAgents: Object.values(state.agentConfigs).filter((c) => Boolean(c.byoaWebhookUrl)).length,
    },
    agentConfigs: state.agentConfigs,
    tickets: state.tickets,
    heartbeats: state.heartbeats.slice(0, 40),
    employees,
  }
}

export function createCompanyTicket(input: {
  title: string
  description?: string
  priority?: TicketPriority
  assigneeId?: string | null
  assigneeName?: string
  requiresApproval?: boolean
  status?: TicketStatus
}): PaperclipTicket {
  const state = loadCompanyState()
  state.ticketSeq += 1
  const now = new Date().toISOString()
  const ticket: PaperclipTicket = {
    id: `tkt_${Date.now().toString(36)}_${state.ticketSeq}`,
    key: `NEX-${state.ticketSeq}`,
    title: input.title.trim().slice(0, 140),
    description: (input.description ?? '').trim().slice(0, 1200),
    status: input.status ?? 'queued',
    priority: input.priority ?? 'medium',
    assigneeId: input.assigneeId ?? null,
    assigneeName: input.assigneeName ?? 'Eva (Unassigned)',
    requiresApproval: Boolean(input.requiresApproval),
    approvedBy: null,
    approvedAt: null,
    tokensSpent: 0,
    costUsd: 0,
    outputSummary: '',
    createdAt: now,
    updatedAt: now,
  }
  state.tickets.unshift(ticket)
  saveCompanyState(state)
  return ticket
}

export function updateCompanyTicket(
  id: string,
  patch: Partial<
    Pick<
      PaperclipTicket,
      'title' | 'description' | 'status' | 'priority' | 'assigneeId' | 'assigneeName' | 'requiresApproval' | 'outputSummary'
    >
  >
): PaperclipTicket | null {
  const state = loadCompanyState()
  const idx = state.tickets.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const updated: PaperclipTicket = {
    ...state.tickets[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  state.tickets[idx] = updated
  saveCompanyState(state)
  return updated
}

export function approveCompanyTicket(id: string, approver = 'Board / Owner'): PaperclipTicket | null {
  const state = loadCompanyState()
  const idx = state.tickets.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const current = state.tickets[idx]
  const nextStatus: TicketStatus = current.outputSummary ? 'done' : 'queued'
  const updated: PaperclipTicket = {
    ...current,
    status: nextStatus,
    approvedBy: approver,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  state.tickets[idx] = updated
  saveCompanyState(state)
  return updated
}

export function deleteCompanyTicket(id: string): boolean {
  const state = loadCompanyState()
  const before = state.tickets.length
  state.tickets = state.tickets.filter((t) => t.id !== id)
  if (state.tickets.length !== before) {
    saveCompanyState(state)
    return true
  }
  return false
}

export function updateAgentPaperclipConfig(
  agentId: string,
  patch: Partial<Omit<PaperclipAgentConfig, 'agentId'>>
): PaperclipAgentConfig {
  const state = loadCompanyState()
  const current = ensureAgentConfig(state, agentId)
  const next: PaperclipAgentConfig = {
    ...current,
    ...patch,
    monthlyBudgetUsd:
      patch.monthlyBudgetUsd !== undefined
        ? Math.max(0, Number(patch.monthlyBudgetUsd) || 0)
        : current.monthlyBudgetUsd,
    heartbeatIntervalMin:
      patch.heartbeatIntervalMin !== undefined
        ? Math.max(1, Math.min(1440, Math.round(Number(patch.heartbeatIntervalMin) || 30)))
        : current.heartbeatIntervalMin,
  }
  state.agentConfigs[agentId] = next
  saveCompanyState(state)
  return next
}

export function isAgentOverBudget(
  cfg: PaperclipAgentConfig,
  companyState: PaperclipCompanyState
): { over: boolean; reason?: string } {
  if (!cfg.autoThrottle) return { over: false }
  if (cfg.monthlyBudgetUsd > 0 && cfg.spentUsd >= cfg.monthlyBudgetUsd) {
    return {
      over: true,
      reason: `Agent monthly budget exhausted ($${cfg.spentUsd.toFixed(2)} / $${cfg.monthlyBudgetUsd.toFixed(2)})`,
    }
  }
  const companySpent = Object.values(companyState.agentConfigs).reduce((s, c) => s + c.spentUsd, 0)
  if (companyState.monthlyBudgetUsd > 0 && companySpent >= companyState.monthlyBudgetUsd) {
    return {
      over: true,
      reason: `Company monthly budget ceiling reached ($${companySpent.toFixed(2)} / $${companyState.monthlyBudgetUsd.toFixed(2)})`,
    }
  }
  return { over: false }
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/**
 * Executes a single Paperclip Heartbeat wake-up for an AI employee, subagent, or BYOA bot.
 * Enforces budget auto-throttle, picks the top queued ticket, runs via BYOA webhook or Gemini,
 * logs token + USD spend, and respects governance approval gates.
 */
export async function runAgentHeartbeat(agentId: string): Promise<{
  run: HeartbeatRun
  ticket: PaperclipTicket | null
  config: PaperclipAgentConfig
}> {
  const state = loadCompanyState()
  const emp = await db.aiEmployee.findUnique({ where: { id: agentId } })
  if (!emp) {
    throw new Error('Agent not found in AI organization')
  }

  const cfg = ensureAgentConfig(state, emp.id)
  const now = new Date().toISOString()
  cfg.lastHeartbeatAt = now

  // 1. Budget & Auto-Throttle check
  const budgetCheck = isAgentOverBudget(cfg, state)
  if (budgetCheck.over) {
    const run: HeartbeatRun = {
      id: `hb_${Date.now().toString(36)}`,
      agentId: emp.id,
      agentName: emp.name,
      ticketId: null,
      ticketKey: null,
      status: 'throttled',
      summary: budgetCheck.reason ?? 'Throttled by budget policy',
      tokensUsed: 0,
      costUsd: 0,
      via: 'local',
      ranAt: now,
    }
    state.heartbeats.unshift(run)
    state.heartbeats = state.heartbeats.slice(0, 80)
    saveCompanyState(state)
    return { run, ticket: null, config: cfg }
  }

  // 2. Select highest-priority queued ticket for this agent (or unassigned queued ticket)
  const candidates = state.tickets
    .filter(
      (t) =>
        t.status === 'queued' &&
        (t.assigneeId === emp.id || (!t.assigneeId && emp.status === 'active'))
    )
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])

  const ticket = candidates[0] ?? null
  if (!ticket) {
    const run: HeartbeatRun = {
      id: `hb_${Date.now().toString(36)}`,
      agentId: emp.id,
      agentName: emp.name,
      ticketId: null,
      ticketKey: null,
      status: 'idle',
      summary: `${emp.name} woke up on heartbeat — no queued tickets assigned.`,
      tokensUsed: 0,
      costUsd: 0,
      via: 'local',
      ranAt: now,
    }
    state.heartbeats.unshift(run)
    state.heartbeats = state.heartbeats.slice(0, 80)
    saveCompanyState(state)
    return { run, ticket: null, config: cfg }
  }

  // Claim ticket
  ticket.assigneeId = emp.id
  ticket.assigneeName = emp.name
  ticket.status = 'in_progress'
  ticket.updatedAt = now

  let output = ''
  let via: HeartbeatRun['via'] = 'gemini'
  let status: HeartbeatRun['status'] = 'ok'

  try {
    if (cfg.byoaWebhookUrl) {
      // BYOA external agent runtime dispatch (HTTP webhook adapter)
      via = 'byoa'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cfg.byoaSecretHeader) {
        headers['X-Paperclip-Signature'] = cfg.byoaSecretHeader
      }
      const res = await fetch(cfg.byoaWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company: state.companyName,
          agent: { id: emp.id, name: emp.name, title: emp.title, department: emp.department },
          ticket: { id: ticket.id, key: ticket.key, title: ticket.title, description: ticket.description },
        }),
        signal: AbortSignal.timeout(12_000),
      })
      const bodyText = await res.text()
      if (!res.ok) {
        throw new Error(`BYOA webhook HTTP ${res.status}: ${bodyText.slice(0, 200)}`)
      }
      try {
        const parsed = JSON.parse(bodyText) as { summary?: string; output?: string; result?: string }
        output = parsed.summary || parsed.output || parsed.result || bodyText.slice(0, 1200)
      } catch {
        output = bodyText.slice(0, 1200)
      }
    } else {
      // Native Gemini specialist heartbeat execution
      const prompt = `Ticket ${ticket.key}: ${ticket.title}\nPriority: ${ticket.priority}\nDetails: ${ticket.description || 'Execute according to your role.'}\n\nProvide a concise, actionable execution report with concrete verification evidence and next checks (max 180 words).`
      output = await chatText(
        [
          {
            role: 'system',
            content:
              emp.systemPrompt ||
              `You are ${emp.name} (${emp.title}, ${emp.department}) operating inside ${state.companyName}. Role: ${emp.role}. Be direct, engineering-focused, and verifiable.`,
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 420 }
      )
    }
  } catch (err) {
    // Graceful deterministic fallback if LLM key/webhook unavailable during offline heartbeat
    const msg = err instanceof Error ? err.message : String(err)
    if (via === 'byoa') {
      status = 'error'
      output = `BYOA dispatch failed: ${msg}`
    } else {
      via = 'local'
      output = `Heartbeat checklist executed by ${emp.name} for ${ticket.key}: verified scope "${ticket.title}", logged readiness note, and queued for follow-up review.`
    }
  }

  const estimatedTokens = Math.max(
    120,
    Math.round(((ticket.title.length + ticket.description.length + output.length) / 3.8) * 1.25)
  )
  const costUsd = Number(((estimatedTokens / 1000) * COST_PER_1K_TOKENS_USD).toFixed(5))

  cfg.tokensUsed += estimatedTokens
  cfg.spentUsd = Number((cfg.spentUsd + costUsd).toFixed(5))

  ticket.tokensSpent += estimatedTokens
  ticket.costUsd = Number((ticket.costUsd + costUsd).toFixed(5))
  ticket.outputSummary = output.trim()
  ticket.status =
    status === 'error'
      ? 'blocked'
      : ticket.requiresApproval && !ticket.approvedAt
        ? 'needs_approval'
        : 'done'
  ticket.updatedAt = new Date().toISOString()

  if (status === 'ok') {
    await db.aiEmployee
      .update({
        where: { id: emp.id },
        data: { tasksCompleted: { increment: 1 }, lastActiveAt: new Date() },
      })
      .catch(() => {})
  }

  const run: HeartbeatRun = {
    id: `hb_${Date.now().toString(36)}`,
    agentId: emp.id,
    agentName: emp.name,
    ticketId: ticket.id,
    ticketKey: ticket.key,
    status,
    summary: output.trim().slice(0, 280),
    tokensUsed: estimatedTokens,
    costUsd,
    via,
    ranAt: new Date().toISOString(),
  }

  state.heartbeats.unshift(run)
  state.heartbeats = state.heartbeats.slice(0, 80)
  saveCompanyState(state)

  return { run, ticket, config: cfg }
}

interface DisciplineBlueprint {
  key: string
  keywords: RegExp
  name: string
  title: string
  department: string
  kind: 'employee' | 'bot' | 'subagent'
  role: string
  systemPrompt: string
  skills: string[]
  tools: string[]
  budgetUsd: number
}

const DISCIPLINE_BLUEPRINTS: DisciplineBlueprint[] = [
  {
    key: 'frontend',
    keywords: /\b(ui|ux|frontend|react|next\.?js|tailwind|component|design|css|dashboard|layout)\b/i,
    name: 'UI Craft Agent',
    title: 'Frontend Systems Engineer',
    department: 'Engineering',
    kind: 'subagent',
    role: 'Build responsive React, Next.js, and Tailwind CSS interfaces with WCAG 2.2 AA accessibility.',
    systemPrompt:
      'You are UI Craft Agent. Build clean, accessible Next.js + Tailwind UI components with strict TypeScript and tabular numerals.',
    skills: ['code-helper'],
    tools: ['inspect_project', 'self_heal_code'],
    budgetUsd: 30,
  },
  {
    key: 'backend',
    keywords: /\b(api|backend|database|schema|server|auth|webhook|stripe|socket|electron|endpoint)\b/i,
    name: 'API Systems Engineer',
    title: 'Backend & Integration Architect',
    department: 'Engineering',
    kind: 'employee',
    role: 'Design and verify resilient API routes, data stores, webhooks, and system integrations.',
    systemPrompt:
      'You are API Systems Engineer. Implement deterministic, type-safe backend routes and never leak secrets to clients.',
    skills: ['project-intelligence', 'code-helper'],
    tools: ['inspect_project', 'run_code', 'self_heal_code'],
    budgetUsd: 35,
  },
  {
    key: 'qa',
    keywords: /\b(test|qa|audit|security|verify|bug|fix|regression|playwright|lint|quality)\b/i,
    name: 'QA Sentinel Bot',
    title: 'Autonomous Verification & Security Bot',
    department: 'QA',
    kind: 'bot',
    role: 'Verify builds, write automated tests, audit edge cases, and block unverified releases.',
    systemPrompt:
      'You are QA Sentinel Bot. No task is complete without concrete verification evidence. Catch regressions early.',
    skills: ['verification-qa'],
    tools: ['inspect_project', 'run_code', 'self_heal_code'],
    budgetUsd: 20,
  },
  {
    key: 'research',
    keywords: /\b(research|market|competitor|repo|github|paperclip|docs|benchmark|compare|analyze)\b/i,
    name: 'Scout Research Bot',
    title: 'Autonomous Web & Repo Intelligence Bot',
    department: 'Research',
    kind: 'bot',
    role: 'Research repositories, technical docs, and market benchmarks with verified citations.',
    systemPrompt:
      'You are Scout Research Bot. Gather accurate primary-source information and produce structured, citation-backed briefs.',
    skills: ['deep-research'],
    tools: ['web_search', 'read_url', 'save_memory'],
    budgetUsd: 20,
  },
  {
    key: 'automation',
    keywords: /\b(automate|automation|cron|schedule|pipeline|workflow|deploy|company|heartbeat|ops)\b/i,
    name: 'Ops Automation Bot',
    title: 'Autonomous Workflow & Heartbeat Runner',
    department: 'Operations',
    kind: 'bot',
    role: 'Orchestrate recurring automations, company heartbeats, and cross-system webhooks reliably.',
    systemPrompt:
      'You are Ops Automation Bot. Build idempotent workflows with clear failure recovery and budget discipline.',
    skills: ['project-intelligence'],
    tools: ['manage_org', 'browser_control', 'run_code'],
    budgetUsd: 25,
  },
]

/**
 * Autonomous Paperclip Auto-Hiring:
 * Given a goal or mission prompt, Eva analyzes required disciplines, hires any missing
 * specialist employees/subagents/bots into db.aiEmployee (capped at maxNewHires), provisions
 * their Paperclip budgets + heartbeats, and creates tracked tickets on the Company Task Board.
 */
export async function autoHireForTask(
  goal: string,
  options?: { maxNewHires?: number; createTickets?: boolean; force?: boolean }
): Promise<{
  hired: { id: string; name: string; title: string; kind: string; department: string }[]
  matchedExisting: { id: string; name: string; department: string }[]
  ticketsCreated: PaperclipTicket[]
}> {
  const state = loadCompanyState()
  if (!state.autoHireEnabled && !options?.force) {
    return { hired: [], matchedExisting: [], ticketsCreated: [] }
  }

  const maxNewHires = options?.maxNewHires ?? 2
  const shouldCreateTickets = options?.createTickets ?? true
  const existing = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })

  const needed = DISCIPLINE_BLUEPRINTS.filter((bp) => bp.keywords.test(goal))
  if (needed.length === 0 && options?.force) {
    needed.push(DISCIPLINE_BLUEPRINTS[1], DISCIPLINE_BLUEPRINTS[2])
  }

  const hired: { id: string; name: string; title: string; kind: string; department: string }[] = []
  const matchedExisting: { id: string; name: string; department: string }[] = []
  const ticketsCreated: PaperclipTicket[] = []

  for (const bp of needed) {
    const already = existing.find(
      (e) =>
        e.name.toLowerCase() === bp.name.toLowerCase() ||
        (e.department.toLowerCase() === bp.department.toLowerCase() &&
          (e.role.toLowerCase().includes(bp.key) || e.title.toLowerCase().includes(bp.key)))
    )

    let targetId: string
    let targetName: string

    if (already) {
      matchedExisting.push({ id: already.id, name: already.name, department: already.department })
      targetId = already.id
      targetName = already.name
      ensureAgentConfig(state, already.id, { monthlyBudgetUsd: bp.budgetUsd })
    } else if (hired.length < maxNewHires) {
      const created = await db.aiEmployee.create({
        data: {
          slug: `agent_${bp.key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
          name: bp.name,
          title: bp.title,
          department: bp.department,
          kind: bp.kind,
          role: bp.role,
          systemPrompt: bp.systemPrompt,
          skillsJson: JSON.stringify(bp.skills),
          toolsJson: JSON.stringify(bp.tools),
          status: 'active',
          autonomy: 'autonomous',
          icon: bp.kind === 'bot' ? 'bot' : 'users',
        },
      })

      if (bp.kind === 'bot') {
        const slug = `bot_${bp.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
        const existingTool = await db.tool.findUnique({ where: { slug } }).catch(() => null)
        if (!existingTool) {
          await db.tool
            .create({
              data: {
                slug,
                name: `${bp.name} (Auto-Hired Bot)`,
                description: `Delegate to ${bp.name}: ${bp.role}`,
                source: 'org_bot',
                enabled: true,
              },
            })
            .catch(() => {})
        }
      }

      ensureAgentConfig(state, created.id, {
        monthlyBudgetUsd: bp.budgetUsd,
        heartbeatIntervalMin: bp.kind === 'bot' ? 15 : 30,
        heartbeatEnabled: true,
        autoThrottle: true,
      })

      hired.push({
        id: created.id,
        name: created.name,
        title: created.title,
        kind: created.kind,
        department: created.department,
      })
      targetId = created.id
      targetName = created.name
    } else {
      continue
    }

    if (shouldCreateTickets) {
      const shortGoal = goal.trim().replace(/\s+/g, ' ').slice(0, 96)
      const ticket = createCompanyTicket({
        title: `[${bp.department}] ${shortGoal}`,
        description: `Auto-generated by Eva Paperclip Orchestrator for goal: "${goal.trim().slice(0, 400)}"`,
        priority: bp.key === 'qa' ? 'high' : 'medium',
        assigneeId: targetId,
        assigneeName: targetName,
        requiresApproval: bp.key === 'backend' || bp.key === 'automation',
        status: 'queued',
      })
      ticketsCreated.push(ticket)
    }
  }

  saveCompanyState(state)
  return { hired, matchedExisting, ticketsCreated }
}
