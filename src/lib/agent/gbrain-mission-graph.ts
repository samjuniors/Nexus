import type { ConversationDTO, GBrainNodeDTO, RunDTO, RunEventDTO } from '@/lib/agent/client'
import { extractMissionProgress, type MissionPhase } from '@/lib/agent/mission-progress'
import type { ReasoningChain } from '@/lib/agent/reasoning-chain'
import type { SelfHealSession } from '@/lib/agent/self-heal'

export type MissionTaskStatus = 'done' | 'running' | 'failed' | 'blocked' | 'pending'

export type MissionNodeKind = 'mission_root' | 'mission_task'

export interface MissionToolExecution {
  tool: string
  summary: string
  ok: boolean
}

export interface MissionGraphNode {
  id: string
  nodeKind: MissionNodeKind
  stepId: number | null
  stepIndex: number | null
  totalSteps: number
  title: string
  description: string
  status: MissionTaskStatus
  statusLabel: string
  assignee: string
  assigneeRole?: string
  uses: string[]
  toolExecutions: MissionToolExecution[]
  resultPreview?: string
  dependsOn: string[]
  dependents: string[]
  linkedEntityIds: string[]
  dagDepth: number
}

export type MissionEdgeKind = 'decomposes_into' | 'depends_on' | 'knowledge_bridge'

export interface MissionGraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: string
  edgeKind: MissionEdgeKind
  status: MissionTaskStatus
}

export interface MissionOverlayGraph {
  hasMission: boolean
  source: 'run' | 'self_heal' | 'reasoning' | 'none'
  runId: string | null
  missionTitle: string
  analysis: string
  phase: MissionPhase
  phaseLabel: string
  percent: number
  total: number
  completed: number
  running: number
  failed: number
  blocked: number
  pending: number
  toolCalls: number
  nodes: MissionGraphNode[]
  edges: MissionGraphEdge[]
  linkedEntityIds: string[]
}

export interface LaidMissionNode {
  node: MissionGraphNode
  x: number
  y: number
  width: number
  height: number
}

export interface MissionOverlayLayout {
  nodes: LaidMissionNode[]
  zone: {
    x: number
    y: number
    width: number
    height: number
  } | null
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    width: number
    height: number
  }
}

export const MISSION_ROOT_W = 216
export const MISSION_ROOT_H = 66
export const MISSION_TASK_W = 196
export const MISSION_TASK_H = 64

export const MISSION_STATUS_META: Record<
  MissionTaskStatus,
  { label: string; accent: string; stroke: string; textClass: string }
> = {
  done: {
    label: 'Done',
    accent: '#10b981',
    stroke: '#059669',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  running: {
    label: 'Running',
    accent: '#38bdf8',
    stroke: '#0284c7',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
  failed: {
    label: 'Failed',
    accent: '#ef4444',
    stroke: '#dc2626',
    textClass: 'text-red-600 dark:text-red-400',
  },
  blocked: {
    label: 'Blocked',
    accent: '#f59e0b',
    stroke: '#d97706',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  pending: {
    label: 'Queued',
    accent: '#64748b',
    stroke: '#475569',
    textClass: 'text-muted-foreground',
  },
}

interface RawStepPayload {
  id: number
  description: string
  assignee?: string
  uses?: string[]
  dependsOn?: number[]
}

interface RawSubagentPayload {
  name?: string
  role?: string
  steps?: number[]
}

function readEventData<T>(ev: RunEventDTO): T {
  return (ev.data ?? {}) as T
}

function compactTitle(text: string, maxLen = 46): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLen) return clean
  return `${clean.slice(0, maxLen - 1)}…`
}

function phaseToTaskStatus(phase: MissionPhase): MissionTaskStatus {
  if (phase === 'done') return 'done'
  if (phase === 'error') return 'failed'
  if (phase === 'running' || phase === 'planning' || phase === 'synthesizing') return 'running'
  return 'pending'
}

/**
 * Selects the most relevant active or recent mission RunDTO across conversations:
 * 1. Currently streaming/running run (`runningRunId`)
 * 2. Most recent run in the active conversation (`activeConvId`)
 * 3. Most recent run across all conversations
 */
export function selectActiveMissionRun(
  conversations: ConversationDTO[],
  activeConvId: string | null,
  runningRunId: string | null
): { run: RunDTO | null; live: boolean } {
  if (runningRunId) {
    for (const conv of conversations) {
      const found = conv.runs.find((r) => r.id === runningRunId)
      if (found) return { run: found, live: true }
    }
  }

  if (activeConvId) {
    const activeConv = conversations.find((c) => c.id === activeConvId)
    if (activeConv && activeConv.runs.length > 0) {
      const sorted = [...activeConv.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const top = sorted[0]
      const live = top.status === 'planning' || top.status === 'executing' || top.status === 'synthesizing'
      return { run: top, live }
    }
  }

  let latest: RunDTO | null = null
  for (const conv of conversations) {
    for (const r of conv.runs) {
      if (!latest || r.createdAt.localeCompare(latest.createdAt) > 0) {
        latest = r
      }
    }
  }
  if (!latest) return { run: null, live: false }
  const live = latest.status === 'planning' || latest.status === 'executing' || latest.status === 'synthesizing'
  return { run: latest, live }
}

/**
 * Matches a mission task (assignee, tool slugs, description) to existing GBrain entity IDs
 * so the Mission Path physically bridges into the Knowledge Graph.
 */
function matchGBrainEntitiesForTask(
  task: { assignee: string; uses: string[]; description: string; toolsExecuted: string[] },
  gbrainNodes: Pick<GBrainNodeDTO, 'id' | 'name' | 'variants'>[]
): string[] {
  if (gbrainNodes.length === 0) return []
  const matched: string[] = []
  const seen = new Set<string>()
  const hay = `${task.description} ${task.assignee} ${task.uses.join(' ')} ${task.toolsExecuted.join(' ')}`.toLowerCase()
  const assigneeLower = task.assignee.trim().toLowerCase()
  const toolTokens = new Set(
    [...task.uses, ...task.toolsExecuted]
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3)
  )

  for (const entity of gbrainNodes) {
    const nameLower = entity.name.toLowerCase()
    const aliasList = (entity.variants ?? [])
      .filter((v) => !v.startsWith('cat:'))
      .map((v) => v.toLowerCase())

    let score = 0
    if (
      assigneeLower &&
      (nameLower === assigneeLower ||
        nameLower.includes(assigneeLower) ||
        aliasList.some((a) => a === assigneeLower))
    ) {
      score += 4
    }
    for (const tok of toolTokens) {
      const normalizedTok = tok.replace(/[_-]+/g, ' ')
      if (
        nameLower.includes(tok) ||
        nameLower.includes(normalizedTok) ||
        aliasList.some((a) => a === tok || a.includes(tok))
      ) {
        score += 3
      }
    }
    if (nameLower.length >= 5 && hay.includes(nameLower)) {
      score += 2
    }
    if (score > 0 && !seen.has(entity.id)) {
      seen.add(entity.id)
      matched.push(entity.id)
      if (matched.length >= 3) break
    }
  }

  return matched
}

/**
 * Computes DAG dependency step-IDs for each planned step.
 * Honors explicit `dependsOn` when provided; otherwise builds realistic
 * parallel fan-out / sequential / convergence dependencies across assignees.
 */
function inferStepDependencies(steps: RawStepPayload[]): Map<number, number[]> {
  const deps = new Map<number, number[]>()
  const validIds = new Set(steps.map((s) => s.id))
  const orderIndex = new Map(steps.map((s, i) => [s.id, i]))

  // Check if explicit dependsOn is provided on any step
  const hasExplicit = steps.some((s) => Array.isArray(s.dependsOn) && s.dependsOn.length > 0)
  if (hasExplicit) {
    for (const step of steps) {
      const idx = orderIndex.get(step.id) ?? 0
      const clean = (step.dependsOn ?? []).filter(
        (d) => validIds.has(d) && d !== step.id && (orderIndex.get(d) ?? 999) < idx
      )
      deps.set(step.id, Array.from(new Set(clean)))
    }
    return deps
  }

  // Distinct assignees check: if multi-agent mission (>= 3 steps, >= 2 assignees), build parallel lanes + convergence
  const assignees = new Set(steps.map((s) => (s.assignee || 'Eva').trim().toLowerCase()))
  if (steps.length >= 3 && assignees.size >= 2) {
    const firstStep = steps[0]
    const lastStep = steps[steps.length - 1]
    const lastIsSynthesis =
      (lastStep.assignee || 'Eva').trim().toLowerCase() === 'eva' ||
      /\b(synthesiz|summar|compil|final|report|verify|deliver|review|combin)\b/i.test(lastStep.description)

    const lastByAssignee = new Map<string, number>()
    deps.set(firstStep.id, [])
    lastByAssignee.set((firstStep.assignee || 'Eva').trim().toLowerCase(), firstStep.id)

    const middleEnd = lastIsSynthesis ? steps.length - 1 : steps.length
    for (let i = 1; i < middleEnd; i++) {
      const s = steps[i]
      const key = (s.assignee || 'Eva').trim().toLowerCase()
      const prevSame = lastByAssignee.get(key)
      if (prevSame !== undefined) {
        deps.set(s.id, [prevSame])
      } else {
        // Branch off initial discovery/planning step 1 so specialist lanes run in parallel
        deps.set(s.id, [firstStep.id])
      }
      lastByAssignee.set(key, s.id)
    }

    if (lastIsSynthesis) {
      // Final step converges all leaf branches
      const referenced = new Set<number>()
      for (const [, parentIds] of deps.entries()) {
        for (const p of parentIds) referenced.add(p)
      }
      const leaves = steps
        .slice(0, steps.length - 1)
        .filter((s) => !referenced.has(s.id))
        .map((s) => s.id)
      deps.set(lastStep.id, leaves.length > 0 ? leaves : [steps[steps.length - 2].id])
    }

    return deps
  }

  // Single-agent sequential dependency chain: Step 1 -> Step 2 -> ... -> Step N
  for (let i = 0; i < steps.length; i++) {
    deps.set(steps[i].id, i === 0 ? [] : [steps[i - 1].id])
  }
  return deps
}

function buildFromSelfHeal(
  session: SelfHealSession,
  gbrainNodes: Pick<GBrainNodeDTO, 'id' | 'name' | 'variants'>[]
): MissionOverlayGraph {
  const rootId = `mission_root_${session.id}`
  const phase: MissionPhase =
    session.status === 'verified'
      ? 'done'
      : session.status === 'failed' || session.status === 'rolled_back'
        ? 'error'
        : 'running'
  const rootStatus = phaseToTaskStatus(phase)

  const steps = session.steps.slice(0, 8)
  const taskNodes: MissionGraphNode[] = steps.map((st, idx) => {
    const isLast = idx === steps.length - 1
    let status: MissionTaskStatus = 'done'
    if (st.phase === 'error' || st.phase === 'rollback') status = 'failed'
    else if (isLast && phase === 'running') status = 'running'
    else if (isLast && phase === 'error') status = 'failed'

    const nodeId = `mission_step_${session.id}_${idx + 1}`
    const depIds = idx === 0 ? [rootId] : [`mission_step_${session.id}_${idx}`]
    const linked = matchGBrainEntitiesForTask(
      {
        assignee: 'Eva',
        uses: ['self_heal_code', st.phase],
        description: `${st.label} ${st.detail ?? ''}`,
        toolsExecuted: ['self_heal_code'],
      },
      gbrainNodes
    )
    return {
      id: nodeId,
      nodeKind: 'mission_task',
      stepId: idx + 1,
      stepIndex: idx + 1,
      totalSteps: steps.length,
      title: compactTitle(st.label, 42),
      description: st.detail || st.label,
      status,
      statusLabel: MISSION_STATUS_META[status].label,
      assignee: 'Eva',
      assigneeRole: 'Autonomous Self-Heal Engineer',
      uses: ['self_heal_code'],
      toolExecutions: [],
      resultPreview: st.detail,
      dependsOn: depIds,
      dependents: idx < steps.length - 1 ? [`mission_step_${session.id}_${idx + 2}`] : [],
      linkedEntityIds: linked,
      dagDepth: idx + 1,
    }
  })

  const rootNode: MissionGraphNode = {
    id: rootId,
    nodeKind: 'mission_root',
    stepId: null,
    stepIndex: null,
    totalSteps: taskNodes.length,
    title: compactTitle(session.title, 44),
    description: session.summary || session.errorContext || session.title,
    status: rootStatus,
    statusLabel: MISSION_STATUS_META[rootStatus].label,
    assignee: 'Eva',
    uses: ['self_heal_code'],
    toolExecutions: [],
    resultPreview: session.summary,
    dependsOn: [],
    dependents: taskNodes[0] ? [taskNodes[0].id] : [],
    linkedEntityIds: matchGBrainEntitiesForTask(
      { assignee: 'Eva', uses: ['self_heal_code'], description: session.title, toolsExecuted: [] },
      gbrainNodes
    ),
    dagDepth: 0,
  }

  const edges: MissionGraphEdge[] = []
  for (const t of taskNodes) {
    for (const depId of t.dependsOn) {
      const upstream = depId === rootId ? rootNode : taskNodes.find((n) => n.id === depId)
      edges.push({
        id: `medge_${depId}_${t.id}`,
        sourceId: depId,
        targetId: t.id,
        relation: depId === rootId ? 'decomposes_into' : 'depends_on',
        edgeKind: depId === rootId ? 'decomposes_into' : 'depends_on',
        status: upstream?.status ?? t.status,
      })
    }
    for (const entId of t.linkedEntityIds) {
      edges.push({
        id: `mbridge_${t.id}_${entId}`,
        sourceId: t.id,
        targetId: entId,
        relation: 'uses_entity',
        edgeKind: 'knowledge_bridge',
        status: t.status,
      })
    }
  }

  const completed = taskNodes.filter((n) => n.status === 'done').length
  const running = taskNodes.filter((n) => n.status === 'running').length
  const failed = taskNodes.filter((n) => n.status === 'failed').length
  const blocked = taskNodes.filter((n) => n.status === 'blocked').length
  const pending = taskNodes.filter((n) => n.status === 'pending').length
  const percent =
    taskNodes.length === 0 ? 0 : phase === 'done' ? 100 : Math.round(((completed + running * 0.35) / taskNodes.length) * 100)

  const linkedEntityIds = Array.from(
    new Set([rootNode, ...taskNodes].flatMap((n) => n.linkedEntityIds))
  )

  return {
    hasMission: true,
    source: 'self_heal',
    runId: session.id,
    missionTitle: session.title,
    analysis: session.summary || 'Autonomous self-healing session',
    phase,
    phaseLabel: phase === 'done' ? 'Verified' : phase === 'error' ? 'Failed' : 'Repairing',
    percent,
    total: taskNodes.length,
    completed,
    running,
    failed,
    blocked,
    pending,
    toolCalls: session.patches.length,
    nodes: [rootNode, ...taskNodes],
    edges,
    linkedEntityIds,
  }
}

function buildFromReasoningChain(
  chain: ReasoningChain,
  gbrainNodes: Pick<GBrainNodeDTO, 'id' | 'name' | 'variants'>[]
): MissionOverlayGraph {
  const rootId = `mission_root_${chain.id}`
  const phase: MissionPhase =
    chain.status === 'completed' || chain.status === 'corrected'
      ? 'done'
      : chain.status === 'failed'
        ? 'error'
        : 'running'
  const rootStatus = phaseToTaskStatus(phase)

  const stepNodesRaw = chain.nodes.filter((n) => n.kind !== 'goal').slice(0, 8)
  const taskNodes: MissionGraphNode[] = stepNodesRaw.map((n, idx) => {
    const isLast = idx === stepNodesRaw.length - 1
    let status: MissionTaskStatus = 'done'
    if (n.kind === 'verification' && n.verified === false) status = 'failed'
    else if (isLast && phase === 'running') status = 'running'
    else if (isLast && phase === 'error') status = 'failed'

    const nodeId = `mission_step_${chain.id}_${idx + 1}`
    const depIds = idx === 0 ? [rootId] : [`mission_step_${chain.id}_${idx}`]
    const linked = matchGBrainEntitiesForTask(
      {
        assignee: n.actor || chain.actor,
        uses: n.tool ? [n.tool] : [],
        description: `${n.title} ${n.detail}`,
        toolsExecuted: n.tool ? [n.tool] : [],
      },
      gbrainNodes
    )
    return {
      id: nodeId,
      nodeKind: 'mission_task',
      stepId: idx + 1,
      stepIndex: idx + 1,
      totalSteps: stepNodesRaw.length,
      title: compactTitle(n.title, 42),
      description: n.detail || n.title,
      status,
      statusLabel: MISSION_STATUS_META[status].label,
      assignee: n.actor || chain.actor || 'Eva',
      uses: n.tool ? [n.tool] : [],
      toolExecutions: n.tool ? [{ tool: n.tool, summary: compactTitle(n.detail || n.title, 90), ok: status !== 'failed' }] : [],
      resultPreview: n.detail,
      dependsOn: depIds,
      dependents: idx < stepNodesRaw.length - 1 ? [`mission_step_${chain.id}_${idx + 2}`] : [],
      linkedEntityIds: linked,
      dagDepth: idx + 1,
    }
  })

  const rootNode: MissionGraphNode = {
    id: rootId,
    nodeKind: 'mission_root',
    stepId: null,
    stepIndex: null,
    totalSteps: taskNodes.length,
    title: compactTitle(chain.goal, 44),
    description: chain.goal,
    status: rootStatus,
    statusLabel: MISSION_STATUS_META[rootStatus].label,
    assignee: chain.actor || 'Eva',
    uses: [],
    toolExecutions: [],
    dependsOn: [],
    dependents: taskNodes[0] ? [taskNodes[0].id] : [],
    linkedEntityIds: matchGBrainEntitiesForTask(
      { assignee: chain.actor || 'Eva', uses: [], description: chain.goal, toolsExecuted: [] },
      gbrainNodes
    ),
    dagDepth: 0,
  }

  const edges: MissionGraphEdge[] = []
  for (const t of taskNodes) {
    for (const depId of t.dependsOn) {
      const upstream = depId === rootId ? rootNode : taskNodes.find((n) => n.id === depId)
      edges.push({
        id: `medge_${depId}_${t.id}`,
        sourceId: depId,
        targetId: t.id,
        relation: depId === rootId ? 'decomposes_into' : 'depends_on',
        edgeKind: depId === rootId ? 'decomposes_into' : 'depends_on',
        status: upstream?.status ?? t.status,
      })
    }
    for (const entId of t.linkedEntityIds) {
      edges.push({
        id: `mbridge_${t.id}_${entId}`,
        sourceId: t.id,
        targetId: entId,
        relation: 'uses_entity',
        edgeKind: 'knowledge_bridge',
        status: t.status,
      })
    }
  }

  const completed = taskNodes.filter((n) => n.status === 'done').length
  const running = taskNodes.filter((n) => n.status === 'running').length
  const failed = taskNodes.filter((n) => n.status === 'failed').length
  const percent =
    taskNodes.length === 0 ? 0 : phase === 'done' ? 100 : Math.round(((completed + running * 0.35) / taskNodes.length) * 100)

  return {
    hasMission: true,
    source: 'reasoning',
    runId: chain.id,
    missionTitle: chain.goal,
    analysis: `${chain.decisionCount} decisions · ${chain.correctionCount} self-corrections`,
    phase,
    phaseLabel: phase === 'done' ? 'Completed' : phase === 'error' ? 'Failed' : 'Active',
    percent,
    total: taskNodes.length,
    completed,
    running,
    failed,
    blocked: 0,
    pending: 0,
    toolCalls: taskNodes.filter((n) => n.uses.length > 0).length,
    nodes: [rootNode, ...taskNodes],
    edges,
    linkedEntityIds: Array.from(new Set([rootNode, ...taskNodes].flatMap((n) => n.linkedEntityIds))),
  }
}

/**
 * Pure, deterministic builder transforming the active/recent Mission Run (or active Self-Heal /
 * Reasoning Chain) into a live DAG of dynamic Agentic Task nodes, dependency edges, and
 * GBrain knowledge entity bridges.
 */
export function buildMissionOverlayGraph(input: {
  run: RunDTO | null
  live?: boolean
  reasoningChain?: ReasoningChain | null
  selfHealSession?: SelfHealSession | null
  gbrainNodes?: Pick<GBrainNodeDTO, 'id' | 'name' | 'variants'>[]
}): MissionOverlayGraph {
  const gbrainNodes = input.gbrainNodes ?? []

  if (!input.run) {
    if (input.selfHealSession && input.selfHealSession.steps.length > 0) {
      return buildFromSelfHeal(input.selfHealSession, gbrainNodes)
    }
    if (input.reasoningChain && input.reasoningChain.nodes.length > 1) {
      return buildFromReasoningChain(input.reasoningChain, gbrainNodes)
    }
    return {
      hasMission: false,
      source: 'none',
      runId: null,
      missionTitle: 'No active mission',
      analysis: '',
      phase: 'idle',
      phaseLabel: 'Idle',
      percent: 0,
      total: 0,
      completed: 0,
      running: 0,
      failed: 0,
      blocked: 0,
      pending: 0,
      toolCalls: 0,
      nodes: [],
      edges: [],
      linkedEntityIds: [],
    }
  }

  const run = input.run
  const progress = extractMissionProgress(run, Boolean(input.live))
  const events = [...(run.events ?? [])].sort((a, b) => a.seq - b.seq)
  const analysisEv = events.find((e) => e.type === 'analysis')
  const analysisData = analysisEv
    ? readEventData<{
        analysis?: string
        steps?: RawStepPayload[]
        subagents?: RawSubagentPayload[]
      }>(analysisEv)
    : null

  const rawSteps: RawStepPayload[] =
    Array.isArray(analysisData?.steps) && analysisData.steps.length > 0
      ? analysisData.steps.filter((s) => s && typeof s.id === 'number' && typeof s.description === 'string')
      : progress.subtasks.map((st) => ({
          id: st.id,
          description: st.description,
          assignee: st.assignee,
          uses: [],
        }))

  const subagentRoleByName = new Map<string, string>()
  for (const sa of analysisData?.subagents ?? []) {
    if (sa?.name && sa?.role) {
      subagentRoleByName.set(sa.name.trim().toLowerCase(), sa.role)
    }
  }

  // Collect per-step tool calls & results from ordered run event stream
  const toolExecsByStep = new Map<number, MissionToolExecution[]>()
  const resultByStep = new Map<number, string>()
  let currentStepId: number | null = rawSteps[0]?.id ?? null

  for (const ev of events) {
    if (ev.type === 'step_start') {
      const sid = readEventData<{ stepId?: number }>(ev).stepId
      if (typeof sid === 'number') currentStepId = sid
    } else if (ev.type === 'subagent_spawn') {
      const d = readEventData<{ name?: string; role?: string }>(ev)
      if (d.name && d.role) subagentRoleByName.set(d.name.trim().toLowerCase(), d.role)
    } else if (ev.type === 'tool_result') {
      const d = readEventData<{ tool?: string; summary?: string; ok?: boolean; stepId?: number }>(ev)
      const targetStep = typeof d.stepId === 'number' ? d.stepId : currentStepId
      if (targetStep !== null && d.tool) {
        const list = toolExecsByStep.get(targetStep) ?? []
        list.push({
          tool: String(d.tool),
          summary: String(d.summary ?? (d.ok === false ? 'Failed' : 'Completed')),
          ok: d.ok !== false,
        })
        toolExecsByStep.set(targetStep, list)
      }
    } else if (ev.type === 'step_done') {
      const d = readEventData<{ stepId?: number; result?: string }>(ev)
      if (typeof d.stepId === 'number' && typeof d.result === 'string' && d.result.trim()) {
        resultByStep.set(d.stepId, d.result.trim().slice(0, 360))
      }
    }
  }

  const rootId = `mission_root_${run.id}`
  const stepNodeId = (stepId: number) => `mission_step_${run.id}_${stepId}`
  const depStepIdsMap = inferStepDependencies(rawSteps)

  // Compute initial status per step from extractMissionProgress
  const baseStatusByStep = new Map<number, MissionTaskStatus>()
  for (const st of progress.subtasks) {
    baseStatusByStep.set(st.id, st.status)
  }

  // Propagate 'blocked' status to any pending downstream task whose upstream dependency failed or is blocked
  const finalStatusByStep = new Map<number, MissionTaskStatus>()
  const dagDepthByStep = new Map<number, number>()

  for (const step of rawSteps) {
    const parentStepIds = depStepIdsMap.get(step.id) ?? []
    let depth = 1
    let upstreamFailed = false
    for (const pid of parentStepIds) {
      depth = Math.max(depth, (dagDepthByStep.get(pid) ?? 1) + 1)
      const ps = finalStatusByStep.get(pid) ?? baseStatusByStep.get(pid) ?? 'pending'
      if (ps === 'failed' || ps === 'blocked') upstreamFailed = true
    }
    dagDepthByStep.set(step.id, depth)

    const base = baseStatusByStep.get(step.id) ?? 'pending'
    const resolved: MissionTaskStatus = base === 'pending' && upstreamFailed ? 'blocked' : base
    finalStatusByStep.set(step.id, resolved)
  }

  // Build MissionGraphNode array
  const dependentsMap = new Map<string, string[]>()
  const taskNodes: MissionGraphNode[] = rawSteps.map((step, idx) => {
    const nodeId = stepNodeId(step.id)
    const parentStepIds = depStepIdsMap.get(step.id) ?? []
    const dependsOn = parentStepIds.length > 0 ? parentStepIds.map(stepNodeId) : [rootId]
    for (const depId of dependsOn) {
      const list = dependentsMap.get(depId) ?? []
      list.push(nodeId)
      dependentsMap.set(depId, list)
    }

    const status = finalStatusByStep.get(step.id) ?? 'pending'
    const assignee = (step.assignee || 'Eva').trim() || 'Eva'
    const uses = Array.isArray(step.uses) ? step.uses.filter((u): u is string => typeof u === 'string') : []
    const toolExecutions = toolExecsByStep.get(step.id) ?? []
    const linkedEntityIds = matchGBrainEntitiesForTask(
      {
        assignee,
        uses,
        description: step.description,
        toolsExecuted: toolExecutions.map((t) => t.tool),
      },
      gbrainNodes
    )

    return {
      id: nodeId,
      nodeKind: 'mission_task',
      stepId: step.id,
      stepIndex: idx + 1,
      totalSteps: rawSteps.length,
      title: compactTitle(step.description, 42),
      description: step.description,
      status,
      statusLabel: MISSION_STATUS_META[status].label,
      assignee,
      assigneeRole: subagentRoleByName.get(assignee.toLowerCase()),
      uses,
      toolExecutions,
      resultPreview: resultByStep.get(step.id),
      dependsOn,
      dependents: [],
      linkedEntityIds,
      dagDepth: dagDepthByStep.get(step.id) ?? 1,
    }
  })

  for (const t of taskNodes) {
    t.dependents = dependentsMap.get(t.id) ?? []
  }

  const rootStatus = phaseToTaskStatus(progress.phase)
  const rootNode: MissionGraphNode = {
    id: rootId,
    nodeKind: 'mission_root',
    stepId: null,
    stepIndex: null,
    totalSteps: taskNodes.length,
    title: compactTitle(progress.title, 46),
    description: progress.title,
    status: rootStatus,
    statusLabel: progress.phaseLabel,
    assignee: 'Eva',
    assigneeRole: 'Mission Orchestrator',
    uses: Array.from(new Set(taskNodes.flatMap((t) => t.uses))).slice(0, 6),
    toolExecutions: [],
    resultPreview: analysisData?.analysis,
    dependsOn: [],
    dependents: dependentsMap.get(rootId) ?? [],
    linkedEntityIds: matchGBrainEntitiesForTask(
      {
        assignee: 'Eva',
        uses: [],
        description: progress.title,
        toolsExecuted: [],
      },
      gbrainNodes
    ),
    dagDepth: 0,
  }

  const allNodes = [rootNode, ...taskNodes]
  const nodeById = new Map(allNodes.map((n) => [n.id, n]))

  // Build directed dependency + knowledge-bridge edges
  const edges: MissionGraphEdge[] = []
  for (const t of taskNodes) {
    for (const depId of t.dependsOn) {
      const upstream = nodeById.get(depId)
      const isRootEdge = depId === rootId
      const edgeStatus: MissionTaskStatus =
        t.status === 'blocked'
          ? 'blocked'
          : upstream?.status === 'failed'
            ? 'failed'
            : upstream?.status === 'done' && (t.status === 'done' || t.status === 'running')
              ? t.status
              : upstream?.status === 'running'
                ? 'running'
                : 'pending'
      edges.push({
        id: `medge_${depId}_${t.id}`,
        sourceId: depId,
        targetId: t.id,
        relation: isRootEdge ? 'decomposes_into' : 'depends_on',
        edgeKind: isRootEdge ? 'decomposes_into' : 'depends_on',
        status: edgeStatus,
      })
    }

    for (const entId of t.linkedEntityIds) {
      edges.push({
        id: `mbridge_${t.id}_${entId}`,
        sourceId: t.id,
        targetId: entId,
        relation: 'uses_entity',
        edgeKind: 'knowledge_bridge',
        status: t.status,
      })
    }
  }

  const completed = taskNodes.filter((n) => n.status === 'done').length
  const running = taskNodes.filter((n) => n.status === 'running').length
  const failed = taskNodes.filter((n) => n.status === 'failed').length
  const blocked = taskNodes.filter((n) => n.status === 'blocked').length
  const pending = taskNodes.filter((n) => n.status === 'pending').length

  return {
    hasMission: true,
    source: 'run',
    runId: run.id,
    missionTitle: progress.title,
    analysis: analysisData?.analysis ?? '',
    phase: progress.phase,
    phaseLabel: progress.phaseLabel,
    percent: progress.percent,
    total: taskNodes.length,
    completed,
    running,
    failed,
    blocked,
    pending,
    toolCalls: progress.toolCalls,
    nodes: allNodes,
    edges,
    linkedEntityIds: Array.from(new Set(allNodes.flatMap((n) => n.linkedEntityIds))),
  }
}

/**
 * Deterministic left-to-right topological DAG layout for the Active Mission Path & Agentic Tasks.
 * - In overlay mode (alongside GBrain clusters): anchors neatly in a framed zone above the
 *   knowledge graph with generous clearance so zero cards overlap.
 * - In focused `'mission'` mode: centers cleanly in the viewport canvas.
 */
export function computeMissionOverlayLayout(
  mission: MissionOverlayGraph,
  anchorBounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null,
  focusedMode = false
): MissionOverlayLayout {
  if (!mission.hasMission || mission.nodes.length === 0) {
    return {
      nodes: [],
      zone: null,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
    }
  }

  // Group nodes by topological DAG depth (0 = mission root, 1..N = sub-goal dependency layers)
  const columns = new Map<number, MissionGraphNode[]>()
  for (const n of mission.nodes) {
    const col = columns.get(n.dagDepth) ?? []
    col.push(n)
    columns.set(n.dagDepth, col)
  }

  const depths = Array.from(columns.keys()).sort((a, b) => a - b)
  const colGapX = 248
  const rowGapY = 92
  const maxRows = Math.max(1, ...depths.map((d) => columns.get(d)!.length))

  const totalDagW = (depths.length - 1) * colGapX + MISSION_ROOT_W
  const totalDagH = (maxRows - 1) * rowGapY + MISSION_ROOT_H

  const centerX = anchorBounds && !focusedMode ? anchorBounds.minX + anchorBounds.width / 2 : 640
  const startX = centerX - totalDagW / 2 + MISSION_ROOT_W / 2

  const zonePadX = 32
  const zonePadTop = 52
  const zonePadBottom = 26
  const zoneH = totalDagH + zonePadTop + zonePadBottom

  const zoneY =
    anchorBounds && !focusedMode
      ? anchorBounds.minY - zoneH - 56
      : 120

  const centerY = zoneY + zonePadTop + totalDagH / 2

  const laid: LaidMissionNode[] = []
  depths.forEach((depth, colIdx) => {
    const items = columns.get(depth)!
    const colH = (items.length - 1) * rowGapY
    const colStartY = centerY - colH / 2
    items.forEach((node, rowIdx) => {
      const isRoot = node.nodeKind === 'mission_root'
      laid.push({
        node,
        x: startX + colIdx * colGapX,
        y: colStartY + rowIdx * rowGapY,
        width: isRoot ? MISSION_ROOT_W : MISSION_TASK_W,
        height: isRoot ? MISSION_ROOT_H : MISSION_TASK_H,
      })
    })
  })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const l of laid) {
    minX = Math.min(minX, l.x - l.width / 2)
    minY = Math.min(minY, l.y - l.height / 2)
    maxX = Math.max(maxX, l.x + l.width / 2)
    maxY = Math.max(maxY, l.y + l.height / 2)
  }

  const zone = {
    x: minX - zonePadX,
    y: minY - zonePadTop,
    width: maxX - minX + zonePadX * 2,
    height: maxY - minY + zonePadTop + zonePadBottom,
  }

  return {
    nodes: laid,
    zone,
    bounds: {
      minX: zone.x - 24,
      minY: zone.y - 24,
      maxX: zone.x + zone.width + 24,
      maxY: zone.y + zone.height + 24,
      width: zone.width + 48,
      height: zone.height + 48,
    },
  }
}
