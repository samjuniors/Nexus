import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { executeRunLoop } from '@/lib/agent/orchestrator'
import { chatText } from '@/lib/agent/zai'
import {
  findNextQueuedTicketForAgent,
  getCompanyScopedEmployees,
  isAgentOverBudget,
  loadCompanyRegistry,
  runAgentHeartbeat,
} from '@/lib/agent/paperclip-company'
import {
  hasPendingPermissionForAutomation,
  runWithPermissionContext,
} from '@/lib/agent/permissions'

const globalScheduler = globalThis as unknown as {
  __nexusSchedulerStarted?: boolean
  __nexusSchedulerTimer?: ReturnType<typeof setInterval>
  __nexusRunningAutomations?: Set<string>
  __nexusRunningHeartbeats?: Set<string>
}

const runningAutomations =
  globalScheduler.__nexusRunningAutomations ??
  (globalScheduler.__nexusRunningAutomations = new Set<string>())

const runningHeartbeats =
  globalScheduler.__nexusRunningHeartbeats ??
  (globalScheduler.__nexusRunningHeartbeats = new Set<string>())

// Parse a cron field expression (e.g. "*", step/15, "0,30", "1-5") against a number.
function matchCronField(expr: string, value: number, min: number, max: number): boolean {
  const parts = expr.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (trimmed === '*') return true
    const stepMatch = /^\*\/(\d+)$/.exec(trimmed)
    if (stepMatch) {
      const step = Math.max(1, Number(stepMatch[1]))
      if ((value - min) % step === 0) return true
      continue
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      if (value >= a && value <= b && value >= min && value <= max) return true
      continue
    }
    if (/^\d+$/.test(trimmed) && Number(trimmed) === value) return true
  }
  return false
}

/** Compute the next execution timestamp for an interval, 5-field cron, or one-shot schedule. */
export function computeNextRunAt(triggerType: string, schedule: string, from = new Date()): Date | null {
  const clean = schedule.trim()
  if (triggerType === 'once') {
    const ts = Date.parse(clean)
    if (!Number.isFinite(ts)) return new Date(from.getTime() + 60_000)
    return new Date(ts)
  }

  if (triggerType === 'cron') {
    const fields = clean.split(/\s+/)
    if (fields.length === 5) {
      const [mExpr, hExpr, domExpr, monExpr, dowExpr] = fields
      // Scan forward minute-by-minute up to 7 days (10,080 minutes)
      const cursor = new Date(from.getTime())
      cursor.setSeconds(0, 0)
      for (let i = 1; i <= 10080; i++) {
        cursor.setMinutes(cursor.getMinutes() + 1)
        if (
          matchCronField(mExpr, cursor.getMinutes(), 0, 59) &&
          matchCronField(hExpr, cursor.getHours(), 0, 23) &&
          matchCronField(domExpr, cursor.getDate(), 1, 31) &&
          matchCronField(monExpr, cursor.getMonth() + 1, 1, 12) &&
          matchCronField(dowExpr, cursor.getDay(), 0, 6)
        ) {
          return cursor
        }
      }
    }
    // Fallback if non-standard cron string: 60 minutes
    return new Date(from.getTime() + 60 * 60_000)
  }

  // Default: interval in minutes (minimum 1 minute)
  const mins = Math.max(1, Number.parseFloat(clean) || 60)
  return new Date(from.getTime() + mins * 60_000)
}

/** Execute one automation immediately and record its AutomationRun log. */
export async function executeAutomation(automationId: string): Promise<{
  ok: boolean
  status: 'success' | 'error' | 'awaiting_approval'
  summary: string
  runId?: string
}> {
  if (runningAutomations.has(automationId)) {
    return { ok: false, status: 'error', summary: 'Automation is already running.' }
  }
  runningAutomations.add(automationId)

  const startedAt = new Date()
  let logRowId = ''
  try {
    await ensureSeeded()
    const auto = await db.automation.findUnique({ where: { id: automationId } })
    if (!auto) {
      return { ok: false, status: 'error', summary: 'Automation not found.' }
    }

    const assignee = auto.assigneeId
      ? await db.aiEmployee.findUnique({ where: { id: auto.assigneeId } })
      : null

    const logRow = await db.automationRun.create({
      data: {
        automationId: auto.id,
        status: 'running',
        startedAt,
      },
    })
    logRowId = logRow.id

    await db.automation.update({
      where: { id: auto.id },
      data: { lastStatus: 'running' },
    })

    // Create a dedicated conversation + run so full mission history is preserved
    const conv = await db.conversation.create({
      data: { title: `Automation · ${auto.name}`.slice(0, 60) },
    })
    const effectivePrompt = assignee
      ? `[Scheduled Automation: ${auto.name} | Assigned to ${assignee.name} (${assignee.title})] ${auto.prompt}`
      : `[Scheduled Automation: ${auto.name}] ${auto.prompt}`

    const run = await db.run.create({
      data: {
        conversationId: conv.id,
        userMessage: effectivePrompt,
        status: 'planning',
        phase: 'plan',
      },
    })
    await db.message.create({
      data: { conversationId: conv.id, role: 'user', content: effectivePrompt, runId: run.id },
    })

    const loopResult = await runWithPermissionContext(
      { automationId: auto.id, runId: run.id },
      () => executeRunLoop(run.id, { maxSteps: 36, pollMs: 500 })
    )

    let { finalAnswer, stepErr } = loopResult
    let status: 'success' | 'error' | 'awaiting_approval' = loopResult.status
    let summary = ''

    if (await hasPendingPermissionForAutomation(auto.id)) {
      status = 'awaiting_approval'
      summary = 'Paused awaiting owner approval in Permissions Vault.'
    } else {
      if (!finalAnswer && status === 'success') {
        finalAnswer = await chatText(
          [
            {
              role: 'system',
              content: assignee
                ? `You are ${assignee.name} (${assignee.title}). ${assignee.systemPrompt}`
                : 'You are NEXUS, an autonomous agent.',
            },
            { role: 'user', content: auto.prompt },
          ],
          { maxTokens: 600 }
        ).catch(() => 'Automation completed.')
      }

      summary = (status === 'error' ? stepErr || 'Automation execution failed.' : finalAnswer || 'Completed.')
        .replace(/\s+/g, ' ')
        .slice(0, 800)
    }

    const finishedAt = new Date()
    const isOnce = auto.triggerType === 'once'
    const nextRun =
      status === 'awaiting_approval'
        ? auto.nextRunAt
        : isOnce
          ? null
          : computeNextRunAt(auto.triggerType, auto.schedule, finishedAt)

    await db.automationRun.update({
      where: { id: logRow.id },
      data: {
        status,
        runId: run.id,
        summary: status === 'success' || status === 'awaiting_approval' ? summary : '',
        error: status === 'error' ? summary : '',
        finishedAt,
      },
    })

    await db.automation.update({
      where: { id: auto.id },
      data: {
        lastRunAt: finishedAt,
        nextRunAt: nextRun,
        lastStatus: status,
        lastResult: summary,
        runCount: { increment: 1 },
        ...(isOnce && status !== 'awaiting_approval' ? { enabled: false } : {}),
      },
    })

    if (assignee && status === 'success') {
      await db.aiEmployee.update({
        where: { id: assignee.id },
        data: { tasksCompleted: { increment: 1 }, lastActiveAt: finishedAt },
      }).catch(() => undefined)
    }

    return { ok: status === 'success', status, summary, runId: run.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (logRowId) {
      await db.automationRun.update({
        where: { id: logRowId },
        data: { status: 'error', error: msg.slice(0, 800), finishedAt: new Date() },
      }).catch(() => undefined)
    }
    await db.automation.update({
      where: { id: automationId },
      data: { lastStatus: 'error', lastResult: msg.slice(0, 800), lastRunAt: new Date() },
    }).catch(() => undefined)
    return { ok: false, status: 'error', summary: msg }
  } finally {
    runningAutomations.delete(automationId)
  }
}

/** Check all enabled automations and fire any whose nextRunAt has passed. */
export async function tickDueAutomations(): Promise<number> {
  try {
    await ensureSeeded()
    const now = new Date()
    const all = await db.automation.findMany({ where: { enabled: true } })
    let triggered = 0
    for (const a of all) {
      if (a.lastStatus === 'running' || a.lastStatus === 'awaiting_approval' || runningAutomations.has(a.id)) continue
      if (!a.nextRunAt) {
        const next = computeNextRunAt(a.triggerType, a.schedule, now)
        await db.automation.update({ where: { id: a.id }, data: { nextRunAt: next } })
        continue
      }
      if (new Date(a.nextRunAt).getTime() <= now.getTime()) {
        triggered++
        void executeAutomation(a.id)
      }
    }
    return triggered
  } catch {
    return 0
  }
}

/** Wake company employees whose heartbeat interval is due and have eligible queued tickets. */
export async function tickDueCompanyHeartbeats(): Promise<number> {
  try {
    await ensureSeeded()
    const registry = loadCompanyRegistry()
    const activeEmployees = await db.aiEmployee.findMany({ where: { status: 'active' } })
    if (activeEmployees.length === 0) return 0

    const nowMs = Date.now()
    let triggered = 0

    for (const company of registry.companies) {
      const scopedEmployees = getCompanyScopedEmployees(registry, company, activeEmployees)

      for (const emp of scopedEmployees) {
        const lockKey = `${company.id}:${emp.id}`
        if (runningHeartbeats.has(lockKey)) continue

        const cfg = company.agentConfigs[emp.id]
        if (cfg && !cfg.heartbeatEnabled) continue
        if (cfg && isAgentOverBudget(cfg, company).over) continue

        const intervalMin = Math.max(1, cfg?.heartbeatIntervalMin ?? 30)
        const lastRunMs = cfg?.lastHeartbeatAt ? Date.parse(cfg.lastHeartbeatAt) : 0
        if (Number.isFinite(lastRunMs) && lastRunMs > 0 && nowMs - lastRunMs < intervalMin * 60_000) {
          continue
        }

        const nextTicket = findNextQueuedTicketForAgent(company.tickets, emp)
        if (!nextTicket) continue

        triggered++
        runningHeartbeats.add(lockKey)
        void runAgentHeartbeat(emp.id, company.id)
          .catch(() => undefined)
          .finally(() => {
            runningHeartbeats.delete(lockKey)
          })
      }
    }
    return triggered
  } catch {
    return 0
  }
}

/** Start the background scheduler loop (idempotent across hot reloads). */
export function startScheduler() {
  if (globalScheduler.__nexusSchedulerStarted) return
  globalScheduler.__nexusSchedulerStarted = true
  // Initial check shortly after boot, then every 30s
  const runTick = () => {
    void tickDueAutomations()
    void tickDueCompanyHeartbeats()
  }
  setTimeout(runTick, 5000)
  globalScheduler.__nexusSchedulerTimer = setInterval(runTick, 30_000)
}
