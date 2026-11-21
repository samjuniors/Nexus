'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Play,
  Plus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, type AutomationDTO } from '@/lib/agent/client'
import { useApp } from '@/lib/agent/store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface AutomationTemplate {
  label: string
  name: string
  description: string
  triggerType: 'interval' | 'cron'
  schedule: string
  prompt: string
}

const TEMPLATES: AutomationTemplate[] = [
  {
    label: 'Project Brain Sync',
    name: 'Hourly Project Index Sync',
    description: 'Re-scans repo structure, schemas, and APIs into portable GBrain memory.',
    triggerType: 'interval',
    schedule: '60',
    prompt: 'Run inspect_project with indexIntoBrain=true and summarize any newly discovered routes or schema changes.',
  },
  {
    label: 'Morning AI Briefing',
    name: 'Daily AI & Engineering Digest',
    description: 'Runs every morning at 09:00 UTC using web_search.',
    triggerType: 'cron',
    schedule: '0 9 * * *',
    prompt: 'Search web for the top 3 developer & AI agent engineering releases today and save the top key insight to memory.',
  },
  {
    label: 'Knowledge Graph Audit',
    name: 'Knowledge Graph Health Check',
    description: 'Checks graph connectivity, hubs, and memory gaps every 6 hours.',
    triggerType: 'interval',
    schedule: '360',
    prompt: 'Use graph_query stats mode to audit the knowledge graph and report top hubs, orphan gaps, and next memory priorities.',
  },
]

function formatScheduleLabel(a: AutomationDTO): string {
  if (a.triggerType === 'cron') return `cron: ${a.schedule}`
  if (a.triggerType === 'once') return `once: ${a.schedule}`
  const mins = Number(a.schedule)
  if (Number.isFinite(mins)) {
    if (mins >= 1440 && mins % 1440 === 0) return `every ${mins / 1440}d`
    if (mins >= 60 && mins % 60 === 0) return `every ${mins / 60}h`
    return `every ${mins}m`
  }
  return `interval: ${a.schedule}`
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function AutomationsView() {
  const { toast } = useToast()
  const { automations, employees, refreshAutomations, refreshOrg, refreshMemories } = useApp()

  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [triggerType, setTriggerType] = useState<'interval' | 'cron' | 'once'>('interval')
  const [schedule, setSchedule] = useState('60')
  const [assigneeId, setAssigneeId] = useState('')

  useEffect(() => {
    void refreshAutomations()
  }, [refreshAutomations])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return automations.filter((a) => {
      if (filter === 'enabled' && !a.enabled) return false
      if (filter === 'paused' && a.enabled) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.prompt.toLowerCase().includes(q)
      )
    })
  }, [automations, filter, query])

  const stats = useMemo(() => {
    const enabledCount = automations.filter((a) => a.enabled).length
    const totalRuns = automations.reduce((acc, a) => acc + (a.runCount || 0), 0)
    return { total: automations.length, enabledCount, totalRuns }
  }, [automations])

  const applyTemplate = (t: AutomationTemplate) => {
    setName(t.name)
    setDescription(t.description)
    setTriggerType(t.triggerType)
    setSchedule(t.schedule)
    setPrompt(t.prompt)
  }

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return
    setCreating(true)
    try {
      await api.automationCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        prompt: prompt.trim(),
        triggerType,
        schedule: schedule.trim() || (triggerType === 'cron' ? '0 9 * * *' : '60'),
        assigneeId: assigneeId || null,
        enabled: true,
      })
      await refreshAutomations()
      setCreateOpen(false)
      setName('')
      setDescription('')
      setPrompt('')
      setAssigneeId('')
      toast({ title: 'Automation scheduled' })
    } catch (e) {
      toast({
        title: 'Failed to create automation',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (a: AutomationDTO) => {
    setBusyId(a.id)
    try {
      await api.automationUpdate({ id: a.id, enabled: !a.enabled })
      await refreshAutomations()
      toast({ title: `${a.name} ${!a.enabled ? 'enabled' : 'paused'}` })
    } catch (e) {
      toast({
        title: 'Toggle failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleRunNow = async (a: AutomationDTO) => {
    setRunningId(a.id)
    try {
      const res = await api.automationRunNow(a.id)
      await Promise.all([refreshAutomations(), refreshOrg(), refreshMemories()])
      setExpandedId(a.id)
      toast({
        title: res.ok ? `Executed: ${a.name}` : `Execution finished with error`,
        description: res.result.summary.slice(0, 140),
        variant: res.ok ? 'default' : 'destructive',
      })
    } catch (e) {
      toast({
        title: 'Run failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setRunningId(null)
    }
  }

  const handleDelete = async (a: AutomationDTO) => {
    setBusyId(a.id)
    try {
      await api.automationDelete(a.id)
      await refreshAutomations()
      toast({ title: `Deleted ${a.name}` })
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="nice-scroll h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <CalendarClock className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">Automations &amp; Scheduled Tasks</h1>
              <Badge variant="outline" className="border-white/15 bg-white/[0.04] font-mono text-[10px]">
                {stats.enabledCount} active
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Schedule recurring interval, 5-field cron, or one-shot engineering tasks delegated to Eva (Lead Agent) or any AI employee/bot.
            </p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Automation
          </Button>
        </header>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-zinc-100">{stats.total}</div>
            <div className="text-[11px] text-muted-foreground">Configured Schedules</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-zinc-100">{stats.enabledCount}</div>
            <div className="text-[11px] text-muted-foreground">Active Runners</div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-zinc-100">{stats.totalRuns}</div>
            <div className="text-[11px] text-muted-foreground">Completed Executions</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter automations by name or mission..."
              aria-label="Filter automations"
              className="h-8 border-white/[0.08] bg-black/30 pl-8 text-xs"
            />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-black/25">
            {(['all', 'enabled', 'paused'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-medium capitalize transition-colors',
                  filter === tab ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {automations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/20 p-10 text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <h2 className="mt-3 text-sm font-medium">No scheduled automations yet</h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Automate project indexing, knowledge graph audits, or recurring research briefs hands-free.
            </p>
            <Button size="sm" className="mt-4 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Create First Automation
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/20 p-8 text-center">
            <p className="text-xs text-muted-foreground">No automations match your filter.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((a) => {
              const isExpanded = expandedId === a.id
              const isRunning = runningId === a.id || a.lastStatus === 'running'
              return (
                <div key={a.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/25">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <Switch
                      checked={a.enabled}
                      disabled={busyId === a.id}
                      aria-label={`Toggle ${a.name}`}
                      onCheckedChange={() => void handleToggle(a)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[13.5px] font-medium text-zinc-100">{a.name}</h3>
                        <Badge variant="outline" className="h-4 border-white/15 font-mono text-[9.5px] text-zinc-300">
                          {formatScheduleLabel(a)}
                        </Badge>
                        {a.assignee && (
                          <Badge variant="outline" className="h-4 border-primary/25 bg-primary/10 text-[9.5px] text-primary">
                            {a.assignee.name}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-4 font-mono text-[9.5px]',
                            a.lastStatus === 'success'
                              ? 'border-emerald-400/25 text-emerald-300'
                              : a.lastStatus === 'error'
                                ? 'border-red-400/25 text-red-300'
                                : 'border-white/10 text-zinc-400'
                          )}
                        >
                          {isRunning ? 'running' : a.lastStatus}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {a.description || a.prompt}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[10px] tabular-nums text-muted-foreground/80">
                        <span>Runs: {a.runCount}</span>
                        <span>Last: {formatDateShort(a.lastRunAt)}</span>
                        <span>Next: {a.enabled ? formatDateShort(a.nextRunAt) : 'paused'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-white/15 bg-white/[0.04] px-2.5 text-[11px]"
                        disabled={isRunning}
                        onClick={() => void handleRunNow(a)}
                      >
                        {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Run Now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-zinc-200"
                        aria-label="Toggle run history"
                        onClick={() => setExpandedId(isExpanded ? null : a.id)}
                      >
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                        aria-label={`Delete ${a.name}`}
                        disabled={busyId === a.id}
                        onClick={() => void handleDelete(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 border-t border-white/[0.06] bg-black/30 p-4">
                      <div>
                        <div className="text-[11px] text-muted-foreground">Task Prompt</div>
                        <p className="mt-1 rounded-lg border border-white/[0.06] bg-black/40 p-2.5 font-mono text-[11px] text-zinc-300">
                          {a.prompt}
                        </p>
                      </div>

                      <div>
                        <div className="text-[11px] text-muted-foreground">Recent Execution History</div>
                        {a.runs && a.runs.length > 0 ? (
                          <div className="mt-1.5 space-y-1.5">
                            {a.runs.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/40 px-3 py-2 text-[11.5px]"
                              >
                                {r.status === 'success' ? (
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                ) : r.status === 'error' ? (
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                                ) : (
                                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                                    <span>{r.status}</span>
                                    <span className="tabular-nums">{formatDateShort(r.startedAt)}</span>
                                  </div>
                                  <p className="mt-0.5 text-zinc-300">{r.summary || r.error || 'Running...'}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground/70">No executions recorded yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" />
              Create Scheduled Automation
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure a recurring interval, 5-field cron schedule, or one-shot mission.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">Starter Templates</div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="auto-name" className="text-xs">Automation Name</Label>
              <Input
                id="auto-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Daily Repo Architecture Audit"
                className="h-8 border-white/10 bg-black/40 text-xs"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="auto-trigger" className="text-xs">Trigger Type</Label>
                <select
                  id="auto-trigger"
                  value={triggerType}
                  onChange={(e) => {
                    const next = e.target.value as 'interval' | 'cron' | 'once'
                    setTriggerType(next)
                    if (next === 'interval' && !/^\d+$/.test(schedule)) setSchedule('60')
                    if (next === 'cron' && /^\d+$/.test(schedule)) setSchedule('0 9 * * *')
                    if (next === 'once') setSchedule(new Date(Date.now() + 3600_000).toISOString().slice(0, 16))
                  }}
                  className="h-8 w-full rounded-md border border-white/10 bg-black/40 px-2.5 text-xs text-zinc-200"
                >
                  <option value="interval">Interval (minutes)</option>
                  <option value="cron">Cron (5-field)</option>
                  <option value="once">One-Shot (ISO Date/Time)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auto-schedule" className="text-xs">
                  {triggerType === 'interval'
                    ? 'Every N minutes'
                    : triggerType === 'cron'
                      ? 'Cron Expression (UTC)'
                      : 'Run At (ISO timestamp)'}
                </Label>
                <Input
                  id="auto-schedule"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder={triggerType === 'cron' ? '0 9 * * *' : '60'}
                  className="h-8 border-white/10 bg-black/40 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auto-assignee" className="text-xs">Assigned Agent / Bot</Label>
              <select
                id="auto-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-8 w-full rounded-md border border-white/10 bg-black/40 px-2.5 text-xs text-zinc-200"
              >
                <option value="">Eva — Lead Agent (Auto-route team)</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auto-desc" className="text-xs">Description (optional)</Label>
              <Input
                id="auto-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short summary of what this schedule maintains"
                className="h-8 border-white/10 bg-black/40 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auto-prompt" className="text-xs">Execution Prompt</Label>
              <Textarea
                id="auto-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Exact task instructions the agent will run on trigger..."
                className="border-white/10 bg-black/40 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={creating || !name.trim() || !prompt.trim()}
              onClick={() => void handleCreate()}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save Automation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
