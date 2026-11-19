'use client'

import { useState } from 'react'
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  ListTodo,
  Loader2,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AiEmployeeDTO } from '@/lib/agent/client'
import type {
  HeartbeatRun,
  PaperclipAgentConfig,
  PaperclipTicket,
  TicketPriority,
  TicketStatus,
} from '@/lib/agent/paperclip-company'
import { cn } from '@/lib/utils'

export interface CompanySnapshotDTO {
  company: {
    companyName: string
    mission: string
    monthlyBudgetUsd: number
    autoHireEnabled: boolean
    updatedAt: string
  }
  metrics: {
    totalSpentUsd: number
    monthlyBudgetUsd: number
    budgetUtilizationPct: number
    totalTokens: number
    openTickets: number
    approvalPending: number
    totalHeartbeats: number
    activeAgents: number
    byoaAgents: number
  }
  agentConfigs: Record<string, PaperclipAgentConfig>
  tickets: PaperclipTicket[]
  heartbeats: HeartbeatRun[]
}

const STATUS_COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'needs_approval', label: 'Approval Gate' },
  { id: 'done', label: 'Completed' },
]

export function PaperclipTaskBoard({
  snapshot,
  employees,
  busy,
  onAction,
}: {
  snapshot: CompanySnapshotDTO
  employees: AiEmployeeDTO[]
  busy: boolean
  onAction: (payload: Record<string, unknown>, successMsg?: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [assigneeId, setAssigneeId] = useState('')
  const [requiresApproval, setRequiresApproval] = useState(false)

  const submitTicket = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await onAction(
      {
        action: 'create_ticket',
        title: title.trim(),
        description: description.trim(),
        priority,
        assigneeId: assigneeId || null,
        requiresApproval,
      },
      'Ticket added to Paperclip Task Board'
    )
    setTitle('')
    setDescription('')
    setRequiresApproval(false)
  }

  return (
    <div data-paperclip-board="1" className="space-y-4">
      {/* Compact ticket composer */}
      <form
        onSubmit={submitTicket}
        className="grid gap-3 rounded-xl border border-border bg-card/50 p-4 md:grid-cols-12"
      >
        <div className="space-y-1.5 md:col-span-5">
          <Label htmlFor="pc-ticket-title" className="text-[11px] text-muted-foreground">
            New Machine Ticket
          </Label>
          <Input
            id="pc-ticket-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Build nightly release check & report regressions"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="pc-ticket-assignee" className="text-[11px] text-muted-foreground">
            Assignee
          </Label>
          <select
            id="pc-ticket-assignee"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="">Any active agent</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.department})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="pc-ticket-prio" className="text-[11px] text-muted-foreground">
            Priority
          </Label>
          <select
            id="pc-ticket-prio"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex items-end gap-2 md:col-span-2">
          <Button type="submit" size="sm" disabled={busy || !title.trim()} className="h-8 w-full gap-1 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Queue
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-12">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional acceptance criteria or verification notes..."
            aria-label="Ticket description"
            className="h-8 flex-1 text-xs"
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
              className="rounded border-border"
            />
            Require Governance Approval Gate
          </label>
        </div>
      </form>

      {/* 4-column flat machine ticket board */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STATUS_COLUMNS.map((col) => {
          const colTickets = snapshot.tickets.filter((t) =>
            col.id === 'queued'
              ? t.status === 'queued' || t.status === 'backlog'
              : t.status === col.id
          )
          return (
            <div
              key={col.id}
              className="flex flex-col rounded-xl border border-border bg-card/40 p-3"
            >
              <div className="mb-2.5 flex items-center justify-between border-b border-border/70 pb-2">
                <span className="text-xs font-semibold text-foreground">{col.label}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {colTickets.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {colTickets.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-muted-foreground/70">No tickets</p>
                ) : (
                  colTickets.map((t) => (
                    <div
                      key={t.id}
                      className="space-y-2 rounded-lg border border-border/80 bg-background/80 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10.5px] font-semibold text-sky-600 dark:text-sky-400">
                          {t.key}
                        </span>
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {t.priority}
                        </span>
                      </div>
                      <div className="text-xs font-medium leading-snug text-foreground">
                        {t.title}
                      </div>
                      {t.outputSummary && (
                        <p className="line-clamp-3 rounded border border-border/60 bg-muted/40 p-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          {t.outputSummary}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-1 pt-1 text-[10.5px] text-muted-foreground">
                        <span className="truncate">{t.assigneeName}</span>
                        <span className="shrink-0 font-mono tabular-nums">
                          ${t.costUsd.toFixed(4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1 border-t border-border/60 pt-2">
                        {t.status === 'needs_approval' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onAction(
                                { action: 'approve_ticket', id: t.id },
                                `Approved ${t.key}`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/12 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Approve
                          </button>
                        ) : t.assigneeId && t.status !== 'done' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void onAction(
                                { action: 'run_heartbeat', agentId: t.assigneeId },
                                `Heartbeat triggered for ${t.assigneeName}`
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                          >
                            <Play className="h-3 w-3" />
                            Wake Agent
                          </button>
                        ) : (
                          <span className="text-[10.5px] text-muted-foreground">
                            {t.requiresApproval ? 'Governed' : 'Autonomous'}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void onAction({ action: 'delete_ticket', id: t.id }, `Deleted ${t.key}`)
                          }
                          aria-label={`Delete ticket ${t.key}`}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PaperclipHeartbeatsBudgets({
  snapshot,
  employees,
  busy,
  onAction,
}: {
  snapshot: CompanySnapshotDTO
  employees: AiEmployeeDTO[]
  busy: boolean
  onAction: (payload: Record<string, unknown>, successMsg?: string) => Promise<void>
}) {
  const [companyBudget, setCompanyBudget] = useState(String(snapshot.company.monthlyBudgetUsd))

  return (
    <div data-paperclip-heartbeats="1" className="space-y-4">
      {/* Company Ceiling + Run All Heartbeats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/50 p-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CircleDollarSign className="h-4 w-4 text-sky-500" />
            Company Budget Ceiling &amp; Heartbeat Dispatcher
          </div>
          <p className="text-xs text-muted-foreground">
            Agents wake on schedule or on demand, claim queued tickets, log token spend, and auto-throttle if they hit their monthly USD cap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1">
            <span className="font-mono text-[11px] text-muted-foreground">Cap USD</span>
            <input
              type="number"
              min={0}
              step={10}
              value={companyBudget}
              onChange={(e) => setCompanyBudget(e.target.value)}
              aria-label="Company monthly budget USD"
              className="w-16 bg-transparent font-mono text-xs tabular-nums text-foreground outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onAction(
                  { action: 'update_company', monthlyBudgetUsd: Number(companyBudget) || 0 },
                  'Updated company monthly budget cap'
                )
              }
              className="rounded border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
            >
              Save
            </button>
          </div>
          <Button
            size="sm"
            disabled={busy || employees.length === 0}
            onClick={() =>
              void onAction({ action: 'run_all_heartbeats' }, 'Executed company heartbeat wave')
            }
            className="h-8 gap-1.5 whitespace-nowrap text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Run All Heartbeats
          </Button>
        </div>
      </div>

      {/* Per-agent budget & heartbeat table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card/40">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-muted/30 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3.5 py-2.5">Agent</th>
              <th className="px-3.5 py-2.5">Runtime</th>
              <th className="px-3.5 py-2.5">Heartbeat</th>
              <th className="px-3.5 py-2.5 text-right">Tokens</th>
              <th className="px-3.5 py-2.5 text-right">Spent / Cap</th>
              <th className="px-3.5 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {employees.map((emp) => {
              const cfg = snapshot.agentConfigs[emp.id]
              const spent = cfg?.spentUsd ?? 0
              const cap = cfg?.monthlyBudgetUsd ?? 25
              const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
              return (
                <tr key={emp.id} className="hover:bg-muted/20">
                  <td className="px-3.5 py-2.5">
                    <div className="font-medium text-foreground">{emp.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {emp.title} · {emp.department}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
                    {cfg?.byoaWebhookUrl ? cfg.byoaProvider || 'BYOA HTTP' : 'Gemini Native'}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    Every {cfg?.heartbeatIntervalMin ?? 30}m
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-[11px] tabular-nums text-foreground">
                    {(cfg?.tokensUsed ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-[11px] tabular-nums">
                    <span className={cn(pct >= 90 ? 'text-destructive' : 'text-foreground')}>
                      ${spent.toFixed(4)}
                    </span>
                    <span className="text-muted-foreground"> / ${cap.toFixed(0)}</span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    <button
                      type="button"
                      disabled={busy || emp.status !== 'active'}
                      onClick={() =>
                        void onAction(
                          { action: 'run_heartbeat', agentId: emp.id },
                          `Heartbeat completed for ${emp.name}`
                        )
                      }
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" />
                      Pulse
                    </button>
                  </td>
                </tr>
              )
            })}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No agents yet — use Auto-Hire or Hire AI to assemble your company roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Heartbeat execution log */}
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground">Recent Heartbeat Ledger</h3>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {snapshot.heartbeats.length} runs
          </span>
        </div>
        {snapshot.heartbeats.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No heartbeats executed yet. Click &ldquo;Pulse&rdquo; or &ldquo;Run All Heartbeats&rdquo; to wake agents.
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {snapshot.heartbeats.slice(0, 12).map((hb) => (
              <div key={hb.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{hb.agentName}</span>
                    {hb.ticketKey && (
                      <span className="font-mono text-[10.5px] text-sky-600 dark:text-sky-400">
                        {hb.ticketKey}
                      </span>
                    )}
                    <span
                      className={cn(
                        'font-mono text-[10px] uppercase',
                        hb.status === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : hb.status === 'throttled' || hb.status === 'error'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      )}
                    >
                      {hb.status} · {hb.via}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    {hb.summary}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  <div>{hb.tokensUsed.toLocaleString()} tok</div>
                  <div>${hb.costUsd.toFixed(4)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PaperclipByoaAndAutoHire({
  snapshot,
  busy,
  onAction,
}: {
  snapshot: CompanySnapshotDTO
  busy: boolean
  onAction: (payload: Record<string, unknown>, successMsg?: string) => Promise<void>
}) {
  const [goal, setGoal] = useState('')
  const [byoaName, setByoaName] = useState('')
  const [byoaProvider, setByoaProvider] = useState('Claude Code / OpenClaw / Custom')
  const [byoaUrl, setByoaUrl] = useState('')
  const [byoaDept, setByoaDept] = useState('External Runtimes')
  const [byoaBudget, setByoaBudget] = useState('40')

  const handleAutoHire = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal.trim()) return
    await onAction(
      { action: 'auto_hire', goal: goal.trim(), maxNewHires: 3, createTickets: true },
      'Eva analyzed the goal, hired missing specialists, and queued tickets'
    )
    setGoal('')
  }

  const handleRegisterByoa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!byoaName.trim() || !byoaUrl.trim()) return
    await onAction(
      {
        action: 'register_byoa',
        name: byoaName.trim(),
        provider: byoaProvider.trim(),
        webhookUrl: byoaUrl.trim(),
        department: byoaDept.trim(),
        monthlyBudgetUsd: Number(byoaBudget) || 40,
      },
      `Connected external BYOA agent: ${byoaName.trim()}`
    )
    setByoaName('')
    setByoaUrl('')
  }

  return (
    <div data-paperclip-byoa="1" className="grid gap-4 lg:grid-cols-2">
      {/* Autonomous Auto-Hiring Engine */}
      <form
        onSubmit={handleAutoHire}
        className="space-y-3 rounded-xl border border-border bg-card/50 p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-sky-500" />
              Eva Autonomous Auto-Hire
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Describe a product goal or project. Eva inspects your current roster, automatically hires missing specialist subagents/bots, assigns budgets, and opens machine tickets.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={snapshot.company.autoHireEnabled}
            onClick={() =>
              void onAction(
                { action: 'update_company', autoHireEnabled: !snapshot.company.autoHireEnabled },
                snapshot.company.autoHireEnabled ? 'Paused mission auto-hire' : 'Enabled mission auto-hire'
              )
            }
            className={cn(
              'shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors',
              snapshot.company.autoHireEnabled
                ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                : 'border-border bg-muted/40 text-muted-foreground'
            )}
          >
            {snapshot.company.autoHireEnabled ? 'Auto-Hire On' : 'Manual Only'}
          </button>
        </div>

        <Textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="e.g. Build a Stripe billing API, audit security regressions, and automate weekly competitor research reports..."
          aria-label="Mission goal for autonomous auto-hiring"
          className="text-xs"
        />

        <Button
          type="submit"
          size="sm"
          disabled={busy || !goal.trim()}
          className="w-full gap-1.5 text-xs"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          Auto-Hire Missing Specialists &amp; Open Tickets
        </Button>
      </form>

      {/* BYOA Interoperability Adapter (Paperclip-compatible HTTP runtime) */}
      <form
        onSubmit={handleRegisterByoa}
        className="space-y-3 rounded-xl border border-border bg-card/50 p-4"
      >
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Webhook className="h-4 w-4 text-emerald-500" />
              Bring Your Own Agent (BYOA)
            </div>
            <a
              href="https://github.com/paperclipai/paperclip"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground hover:text-foreground"
            >
              Paperclip spec
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plug any external agent runtime (OpenClaw, Claude Code, Codex, Cursor, or custom HTTP bot) into Eva&apos;s org chart, heartbeats, and budget ceilings.
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="byoa-name" className="text-[11px] text-muted-foreground">
              Agent Name
            </Label>
            <Input
              id="byoa-name"
              value={byoaName}
              onChange={(e) => setByoaName(e.target.value)}
              placeholder="e.g. Codex Worker"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="byoa-provider" className="text-[11px] text-muted-foreground">
              Runtime / Provider
            </Label>
            <Input
              id="byoa-provider"
              value={byoaProvider}
              onChange={(e) => setByoaProvider(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="byoa-url" className="text-[11px] text-muted-foreground">
              Heartbeat Webhook URL
            </Label>
            <Input
              id="byoa-url"
              value={byoaUrl}
              onChange={(e) => setByoaUrl(e.target.value)}
              placeholder="https://your-agent-runner.example/heartbeat"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="byoa-dept" className="text-[11px] text-muted-foreground">
              Department
            </Label>
            <Input
              id="byoa-dept"
              value={byoaDept}
              onChange={(e) => setByoaDept(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="byoa-budget" className="text-[11px] text-muted-foreground">
              Monthly Cap (USD)
            </Label>
            <Input
              id="byoa-budget"
              type="number"
              min={0}
              value={byoaBudget}
              onChange={(e) => setByoaBudget(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>

        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || !byoaName.trim() || !byoaUrl.trim()}
          className="w-full gap-1.5 text-xs"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Connect External BYOA Agent
        </Button>
      </form>
    </div>
  )
}

export const PAPERCLIP_SUBTABS = [
  { id: 'org', label: 'Org Chart', icon: Bot },
  { id: 'board', label: 'Task Board', icon: ListTodo },
  { id: 'heartbeats', label: 'Heartbeats & Budgets', icon: Activity },
  { id: 'byoa', label: 'BYOA & Auto-Hire', icon: Webhook },
] as const
