import type { RunDTO, RunEventDTO } from '@/lib/agent/client'

export type SubtaskStatus = 'done' | 'running' | 'failed' | 'pending'

export type MissionPhase = 'idle' | 'planning' | 'running' | 'synthesizing' | 'done' | 'error' | 'stopped'

export interface MissionSubtaskItem {
  id: number
  index: number
  description: string
  assignee: string
  status: SubtaskStatus
}

export interface MissionProgressSnapshot {
  hasMission: boolean
  runId: string | null
  title: string
  phase: MissionPhase
  phaseLabel: string
  total: number
  completed: number
  running: number
  failed: number
  pending: number
  percent: number
  toolCalls: number
  subtasks: MissionSubtaskItem[]
}

interface PlanStepPayload {
  id: number
  description: string
  assignee?: string
}

function readData<T>(e: RunEventDTO): T {
  return (e.data ?? {}) as T
}

function derivePhase(run: RunDTO, live: boolean): { phase: MissionPhase; label: string } {
  const s = run.status
  if (s === 'done') return { phase: 'done', label: 'Completed' }
  if (s === 'error') return { phase: 'error', label: 'Failed' }
  if (s === 'stopped') return { phase: 'stopped', label: 'Stopped' }
  if (s === 'synthesizing') return { phase: 'synthesizing', label: 'Synthesizing' }
  if (s === 'planning' || s === 'pending' || s === 'queued') {
    return { phase: 'planning', label: live ? 'Planning' : 'Queued' }
  }
  return { phase: 'running', label: live ? 'Running' : 'Active' }
}

/**
 * Pure, deterministic extractor mapping a RunDTO and its ordered event stream
 * into a structured MissionProgressSnapshot consumed by the D3 Mission Progress bar.
 */
export function extractMissionProgress(run: RunDTO | null, live = false): MissionProgressSnapshot {
  if (!run) {
    return {
      hasMission: false,
      runId: null,
      title: 'No active mission',
      phase: 'idle',
      phaseLabel: 'Idle',
      total: 0,
      completed: 0,
      running: 0,
      failed: 0,
      pending: 0,
      percent: 0,
      toolCalls: 0,
      subtasks: [],
    }
  }

  const events = [...(run.events ?? [])].sort((a, b) => a.seq - b.seq)
  const analysisEv = events.find((e) => e.type === 'analysis')
  const analysisData = analysisEv
    ? readData<{ steps?: PlanStepPayload[]; task?: string }>(analysisEv)
    : null

  const rawSteps: PlanStepPayload[] = Array.isArray(analysisData?.steps)
    ? analysisData.steps.filter((s) => s && typeof s.id === 'number' && typeof s.description === 'string')
    : []

  const startedIds = new Set<number>()
  const doneIds = new Set<number>()
  const failedIds = new Set<number>()

  for (const e of events) {
    if (e.type === 'step_start') {
      const id = readData<{ stepId?: number }>(e).stepId
      if (typeof id === 'number') startedIds.add(id)
    } else if (e.type === 'step_done') {
      const id = readData<{ stepId?: number; ok?: boolean }>(e).stepId
      const ok = readData<{ ok?: boolean }>(e).ok
      if (typeof id === 'number') {
        if (ok === false) failedIds.add(id)
        else doneIds.add(id)
      }
    } else if (e.type === 'step_error') {
      const id = readData<{ stepId?: number }>(e).stepId
      if (typeof id === 'number') failedIds.add(id)
    }
  }

  const toolCalls = events.filter((e) => e.type === 'tool_call').length
  const hasErrorEvent = events.some((e) => e.type === 'error')
  const { phase, label: phaseLabel } = derivePhase(
    hasErrorEvent && run.status !== 'done' ? { ...run, status: 'error' } : run,
    live
  )

  let subtasks: MissionSubtaskItem[] = []

  if (rawSteps.length > 0) {
    let assignedFallbackFailure = false
    subtasks = rawSteps.map((step, idx) => {
      let status: SubtaskStatus = 'pending'
      if (failedIds.has(step.id)) {
        status = 'failed'
      } else if (doneIds.has(step.id)) {
        status = 'done'
      } else if (phase === 'done') {
        status = 'done'
      } else if (startedIds.has(step.id)) {
        status = phase === 'error' ? 'failed' : phase === 'stopped' ? 'pending' : 'running'
        if (status === 'failed') assignedFallbackFailure = true
      }
      return {
        id: step.id,
        index: idx + 1,
        description: step.description,
        assignee: step.assignee || 'Eva',
        status,
      }
    })

    // If run failed without a specific step marked failed, mark the first incomplete step as failed
    if (phase === 'error' && !assignedFallbackFailure && !subtasks.some((t) => t.status === 'failed')) {
      const firstIncomplete = subtasks.find((t) => t.status !== 'done')
      if (firstIncomplete) firstIncomplete.status = 'failed'
    }
  } else {
    // Run exists without explicit analysis steps yet — synthesize a concise 1-step lifecycle indicator
    const synthStatus: SubtaskStatus =
      phase === 'done'
        ? 'done'
        : phase === 'error'
          ? 'failed'
          : phase === 'stopped'
            ? 'pending'
            : 'running'
    subtasks = [
      {
        id: 1,
        index: 1,
        description:
          phase === 'planning'
            ? 'Analyzing objective & decomposing sub-tasks'
            : phase === 'synthesizing'
              ? 'Synthesizing final response'
              : phase === 'done'
                ? 'Mission completed'
                : phase === 'error'
                  ? 'Mission encountered an error'
                  : 'Executing mission task',
        assignee: 'Eva',
        status: synthStatus,
      },
    ]
  }

  const total = subtasks.length
  const completed = subtasks.filter((s) => s.status === 'done').length
  const running = subtasks.filter((s) => s.status === 'running').length
  const failed = subtasks.filter((s) => s.status === 'failed').length
  const pending = subtasks.filter((s) => s.status === 'pending').length

  const rawPercent =
    total === 0
      ? 0
      : phase === 'done'
        ? 100
        : Math.round(((completed + running * 0.35) / total) * 100)
  const percent = Math.max(0, Math.min(100, rawPercent))

  const title = (run.userMessage || analysisData?.task || 'Current mission').trim()

  return {
    hasMission: true,
    runId: run.id,
    title,
    phase,
    phaseLabel,
    total,
    completed,
    running,
    failed,
    pending,
    percent,
    toolCalls,
    subtasks,
  }
}
