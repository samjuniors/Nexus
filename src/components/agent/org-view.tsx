'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  GitFork,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
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
import { api, type AiEmployeeDTO } from '@/lib/agent/client'
import { Markdown } from '@/components/agent/markdown'
import { MochiEyes } from '@/components/agent/mochi-eyes'
import {
  PAPERCLIP_SUBTABS,
  PaperclipByoaAndAutoHire,
  PaperclipHeartbeatsBudgets,
  PaperclipTaskBoard,
  type CompanySnapshotDTO,
} from '@/components/agent/paperclip-company-tabs'
import { useEva } from '@/components/agent/eva-provider'
import { pickEmployeeEyeArchetype } from '@/lib/agent/mochi-eyes'
import { useApp } from '@/lib/agent/store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface RoleTemplate {
  label: string
  name: string
  title: string
  department: string
  kind: 'employee' | 'bot' | 'subagent'
  role: string
  systemPrompt: string
  skills: string[]
  tools: string[]
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    label: 'Full-Stack Builder',
    name: 'Systems Builder',
    title: 'Senior Full-Stack AI Engineer',
    department: 'Engineering',
    kind: 'employee',
    role: 'Design and implement modular TypeScript, Next.js, and API features cleanly.',
    systemPrompt:
      'You are Systems Builder, a Senior Full-Stack AI Engineer. Inspect existing files first, write strict TypeScript without any, and verify edge cases before reporting completion.',
    skills: ['project-intelligence', 'code-helper'],
    tools: ['inspect_project', 'run_code', 'computer_use'],
  },
  {
    label: 'Research & Docs Bot',
    name: 'Research Bot',
    title: 'Autonomous Web & Docs Synthesizer',
    department: 'Research',
    kind: 'bot',
    role: 'Continuously gather verified web, Wikipedia, and repository documentation.',
    systemPrompt:
      'You are Research Bot. Always cite sources, verify claims with web_search or read_url, and return concise executive briefs.',
    skills: ['deep-research'],
    tools: ['web_search', 'read_url', 'wikipedia_search', 'save_memory'],
  },
  {
    label: 'Security & QA Auditor',
    name: 'Audit Bot',
    title: 'Security & Verification Specialist',
    department: 'QA',
    kind: 'bot',
    role: 'Verify implementations, catch regressions, validate schemas, and enforce safe boundaries.',
    systemPrompt:
      'You are Audit Bot. Verify every requirement with concrete checks. Never mark work complete without evidence.',
    skills: ['verification-qa'],
    tools: ['inspect_project', 'run_code', 'graph_query'],
  },
  {
    label: 'Product Architect',
    name: 'Spec Architect',
    title: 'Technical Product Manager',
    department: 'Product',
    kind: 'employee',
    role: 'Translate product ideas into PRDs, dependency trees, milestones, and acceptance gates.',
    systemPrompt:
      'You are Spec Architect. Preserve project hierarchy (Milestone -> Gate -> Feature -> Task -> Verification) and highlight blockers clearly.',
    skills: ['project-intelligence'],
    tools: ['doc_write', 'graph_query', 'save_memory'],
  },
]

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function OrgView() {
  const { toast } = useToast()
  const { evaExpression } = useEva()
  const { employees, skills, tools, refreshOrg, refreshPlugins, refreshTools } = useApp()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [companyTab, setCompanyTab] = useState<'org' | 'board' | 'heartbeats' | 'byoa'>('org')
  const [companySnapshot, setCompanySnapshot] = useState<CompanySnapshotDTO | null>(null)
  const [companyBusy, setCompanyBusy] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'grid'>('tree')
  const [kindFilter, setKindFilter] = useState<'all' | 'employee' | 'bot'>('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Hire / Create Bot modal state
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formName, setFormName] = useState('')
  const [formTitle, setFormTitle] = useState('')
  const [formDept, setFormDept] = useState('Engineering')
  const [formKind, setFormKind] = useState<'employee' | 'bot' | 'subagent'>('employee')
  const [formRole, setFormRole] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formReportsTo, setFormReportsTo] = useState<string>('')
  const [formSkills, setFormSkills] = useState<string[]>([])
  const [formTools, setFormTools] = useState<string[]>([])

  // Delegation runner state inside Inspector
  const [delegateTask, setDelegateTask] = useState('')
  const [delegating, setDelegating] = useState(false)
  const [delegateOutput, setDelegateOutput] = useState<string | null>(null)

  // Eva Org Review state
  const [reviewing, setReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState<{
    scopeLabel: string
    assessment: string
    review: Awaited<ReturnType<typeof api.orgReview>>['review']
  } | null>(null)

  const refreshCompany = useCallback(async () => {
    try {
      const res = await fetch('/api/company', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as CompanySnapshotDTO
      setCompanySnapshot(data)
    } catch {
      /* ignore transient fetch error */
    }
  }, [])

  const runCompanyAction = useCallback(
    async (payload: Record<string, unknown>, successMsg?: string) => {
      setCompanyBusy(true)
      try {
        const res = await fetch('/api/company', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json()) as {
          error?: string
          snapshot?: CompanySnapshotDTO
        } & Partial<CompanySnapshotDTO>
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.snapshot) setCompanySnapshot(data.snapshot)
        else if (data.company && data.metrics) setCompanySnapshot(data as CompanySnapshotDTO)
        await Promise.all([refreshOrg(), refreshTools()])
        if (successMsg) toast({ title: successMsg })
      } catch (e) {
        toast({
          title: 'Company action failed',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        })
      } finally {
        setCompanyBusy(false)
      }
    },
    [refreshOrg, refreshTools, toast]
  )

  useEffect(() => {
    void refreshOrg()
    void refreshCompany()
  }, [refreshOrg, refreshCompany])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (kindFilter === 'employee' && e.kind !== 'employee') return false
      if (kindFilter === 'bot' && e.kind !== 'bot' && e.kind !== 'subagent') return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q)
      )
    })
  }, [employees, kindFilter, query])

  const selected = useMemo(
    () => employees.find((e) => e.id === selectedId) ?? filtered[0] ?? null,
    [employees, selectedId, filtered]
  )

  const stats = useMemo(() => {
    const activeCount = employees.filter((e) => e.status === 'active').length
    const botCount = employees.filter((e) => e.kind === 'bot' || e.kind === 'subagent').length
    const completed = employees.reduce((acc, e) => acc + (e.tasksCompleted || 0), 0)
    return { total: employees.length, activeCount, botCount, completed }
  }, [employees])

  const childrenMap = useMemo(() => {
    const map = new Map<string, AiEmployeeDTO[]>()
    const visibleIds = new Set(filtered.map((e) => e.id))
    for (const e of filtered) {
      const parentKey = e.reportsToId && visibleIds.has(e.reportsToId) ? e.reportsToId : 'ROOT'
      const arr = map.get(parentKey) ?? []
      arr.push(e)
      map.set(parentKey, arr)
    }
    return map
  }, [filtered])

  const applyTemplate = (tpl: RoleTemplate) => {
    setFormName(tpl.name)
    setFormTitle(tpl.title)
    setFormDept(tpl.department)
    setFormKind(tpl.kind)
    setFormRole(tpl.role)
    setFormPrompt(tpl.systemPrompt)
    setFormSkills(tpl.skills)
    setFormTools(tpl.tools)
  }

  const resetForm = () => {
    setFormName('')
    setFormTitle('')
    setFormDept('Engineering')
    setFormKind('employee')
    setFormRole('')
    setFormPrompt('')
    setFormReportsTo('')
    setFormSkills([])
    setFormTools([])
  }

  const handleCreate = async () => {
    if (!formName.trim() || !formRole.trim()) return
    setCreating(true)
    try {
      const { employee } = await api.orgCreate({
        name: formName.trim(),
        title: formTitle.trim() || undefined,
        department: formDept.trim() || 'Engineering',
        kind: formKind,
        role: formRole.trim(),
        reportsToId: formReportsTo || null,
        systemPrompt: formPrompt.trim() || undefined,
        skills: formSkills,
        tools: formTools,
      })
      await Promise.all([refreshOrg(), refreshPlugins(), refreshTools()])
      setSelectedId(employee.id)
      setCreateOpen(false)
      resetForm()
      toast({ title: `${employee.kind === 'bot' ? 'Bot created' : 'AI employee hired'}: ${employee.name}` })
    } catch (e) {
      toast({
        title: 'Could not add team member',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  const handleToggleStatus = async (emp: AiEmployeeDTO) => {
    const nextStatus = emp.status === 'active' ? 'paused' : 'active'
    setBusyId(emp.id)
    try {
      await api.orgUpdate({ id: emp.id, status: nextStatus })
      await refreshOrg()
      toast({ title: `${emp.name} ${nextStatus}` })
    } catch (e) {
      toast({
        title: 'Update failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleUpdateReportsTo = async (empId: string, reportsToId: string | null) => {
    setBusyId(empId)
    try {
      await api.orgUpdate({ id: empId, reportsToId })
      await refreshOrg()
      toast({ title: 'Reporting line updated' })
    } catch (e) {
      toast({
        title: 'Hierarchy update failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (emp: AiEmployeeDTO) => {
    setBusyId(emp.id)
    try {
      await api.orgDelete(emp.id)
      await refreshOrg()
      if (selectedId === emp.id) setSelectedId(null)
      toast({ title: `Removed ${emp.name} from Org` })
    } catch (e) {
      toast({
        title: 'Remove failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDelegate = async () => {
    if (!selected || !delegateTask.trim()) return
    setDelegating(true)
    setDelegateOutput(null)
    try {
      const res = await api.orgDelegate(selected.id, delegateTask.trim())
      setDelegateOutput(res.output)
      await refreshOrg()
    } catch (e) {
      toast({
        title: 'Delegation failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setDelegating(false)
    }
  }

  const handleReviewOrg = async (member?: AiEmployeeDTO) => {
    setReviewing(true)
    try {
      const res = await api.orgReview(member ? { id: member.id } : undefined)
      setReviewResult({
        scopeLabel: member ? `${member.name} (${member.title})` : 'Full AI Organization & Bots',
        assessment: res.assessment,
        review: res.review,
      })
    } catch (e) {
      toast({
        title: 'Eva review failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setReviewing(false)
    }
  }

  const applyRecommendationToModal = (rec: {
    suggestedKind: 'employee' | 'bot' | 'subagent'
    suggestedName: string
    department: string
    reason: string
  }) => {
    resetForm()
    setFormName(rec.suggestedName)
    setFormKind(rec.suggestedKind)
    setFormDept(rec.department)
    setFormTitle(
      rec.suggestedKind === 'bot'
        ? `Autonomous ${rec.department} Bot`
        : rec.suggestedKind === 'subagent'
          ? `${rec.department} Specialist Subagent`
          : `${rec.department} AI Specialist`
    )
    setFormRole(rec.reason)
    setCreateOpen(true)
  }

  const renderTreeNodes = (parentId: string, depth: number): React.ReactNode => {
    const nodes = childrenMap.get(parentId) ?? []
    if (nodes.length === 0) return null
    return (
      <div className={cn('space-y-2', depth > 0 && 'ml-5 border-l border-white/[0.08] pl-4')}>
        {nodes.map((emp) => {
          const isSelected = selected?.id === emp.id
          const reports = childrenMap.get(emp.id) ?? []
          return (
            <div key={emp.id} className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedId(emp.id)
                  setDelegateOutput(null)
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/[0.08] bg-black/25 hover:border-white/[0.16] hover:bg-white/[0.03]'
                )}
              >
                <MochiEyes
                  expression={
                    delegating && selected?.id === emp.id
                      ? 'working'
                      : emp.status === 'active'
                        ? 'idle'
                        : 'sleeping'
                  }
                  archetype={pickEmployeeEyeArchetype(emp.kind, emp.department, emp.role, emp.name)}
                  size="xs"
                  trackGaze={false}
                  label={`${emp.name} eyes`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-zinc-100">{emp.name}</span>
                    <Badge
                      variant="outline"
                      className="h-4 border-white/15 bg-white/[0.04] px-1.5 text-[9.5px] text-zinc-300"
                    >
                      {emp.kind}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-4 px-1.5 text-[9.5px]',
                        emp.status === 'active'
                          ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                          : 'border-amber-400/25 bg-amber-400/10 text-amber-300'
                      )}
                    >
                      {emp.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {emp.title} · {emp.department}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  <div>{emp.tasksCompleted} tasks</div>
                  {reports.length > 0 && (
                    <div className="text-[9.5px] text-zinc-500">{reports.length} reports</div>
                  )}
                </div>
              </button>
              {renderTreeNodes(emp.id, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="nice-scroll h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">AI Organization &amp; Bots</h1>
              <Badge variant="outline" className="border-white/15 bg-white/[0.04] font-mono text-[10px]">
                {stats.activeCount} active
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Persistent AI employees, subagents, and autonomous bots under Eva (Lead Agent). Eva &amp; subagents can review, hire, or spin up new bots automatically based on task needs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-white/15 bg-white/[0.04] text-xs"
              disabled={reviewing}
              onClick={() => void handleReviewOrg()}
            >
              {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
              Eva Review
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                resetForm()
                setCreateOpen(true)
              }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Hire AI / Create Bot
            </Button>
          </div>
        </header>

        {/* Eva Org Review Card */}
        {reviewResult && (
          <section
            aria-label="Eva Org Review"
            className="space-y-3 rounded-xl border border-primary/25 bg-primary/[0.05] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Eva Org Review — {reviewResult.scopeLabel}</h2>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {reviewResult.review.active} active / {reviewResult.review.total} total ({reviewResult.review.employees} employees · {reviewResult.review.bots} bots · {reviewResult.review.subagents} subagents · {reviewResult.review.totalTasksCompleted} tasks)
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss Eva review"
                onClick={() => setReviewResult(null)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="md-body rounded-lg border border-white/[0.08] bg-black/30 p-3 text-xs leading-relaxed text-zinc-200">
              <Markdown>{reviewResult.assessment}</Markdown>
            </div>

            {reviewResult.review.recommendations.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Recommended Hires &amp; Bots
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {reviewResult.review.recommendations.map((rec) => (
                    <div
                      key={`${rec.suggestedKind}-${rec.suggestedName}`}
                      className="flex flex-col justify-between gap-2 rounded-lg border border-white/[0.08] bg-black/25 p-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-zinc-100">{rec.suggestedName}</span>
                          <Badge variant="outline" className="h-4 border-white/15 px-1.5 text-[9.5px]">
                            {rec.suggestedKind}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{rec.reason}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full gap-1 border-white/15 bg-white/[0.04] text-[11px]"
                        onClick={() => applyRecommendationToModal(rec)}
                      >
                        <UserPlus className="h-3 w-3" />
                        Hire / Create {rec.suggestedKind}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Metrics Strip — Paperclip Company Control Plane */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {stats.activeCount} / {stats.total}
            </div>
            <div className="text-[11px] text-muted-foreground">Active Agents &amp; Bots</div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {companySnapshot?.metrics.openTickets ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Open Machine Tickets
              {(companySnapshot?.metrics.approvalPending ?? 0) > 0
                ? ` · ${companySnapshot?.metrics.approvalPending} gate`
                : ''}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
              ${(companySnapshot?.metrics.totalSpentUsd ?? 0).toFixed(2)}
              <span className="text-xs font-normal text-muted-foreground">
                {' '}/ ${companySnapshot?.metrics.monthlyBudgetUsd ?? 250}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">Monthly Company Spend</div>
          </div>
          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {companySnapshot?.metrics.totalHeartbeats ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground">Heartbeats Executed</div>
          </div>
        </div>

        {/* Paperclip Control Plane Sub-Tabs */}
        <div
          role="tablist"
          aria-label="Paperclip company sections"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2"
        >
          <div className="flex flex-wrap items-center gap-1">
            {PAPERCLIP_SUBTABS.map(({ id, label, icon: Icon }) => {
              const active = companyTab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-paperclip-tab={id}
                  onClick={() => setCompanyTab(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={companyBusy || employees.length === 0}
            onClick={() =>
              void runCompanyAction(
                { action: 'run_all_heartbeats' },
                'Paperclip heartbeat wave completed'
              )
            }
            className="h-7 gap-1.5 whitespace-nowrap text-[11px]"
          >
            {companyBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Activity className="h-3 w-3 text-emerald-500" />
            )}
            Pulse Company
          </Button>
        </div>

        {companyTab === 'board' && companySnapshot && (
          <PaperclipTaskBoard
            snapshot={companySnapshot}
            employees={employees}
            busy={companyBusy}
            onAction={runCompanyAction}
          />
        )}

        {companyTab === 'heartbeats' && companySnapshot && (
          <PaperclipHeartbeatsBudgets
            snapshot={companySnapshot}
            employees={employees}
            busy={companyBusy}
            onAction={runCompanyAction}
          />
        )}

        {companyTab === 'byoa' && companySnapshot && (
          <PaperclipByoaAndAutoHire
            snapshot={companySnapshot}
            busy={companyBusy}
            onAction={runCompanyAction}
          />
        )}

        {companyTab === 'org' && (
          <>
        {/* Filter & View Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, role, title, department..."
              aria-label="Search Org members"
              className="h-8 border-white/[0.08] bg-black/30 pl-8 text-xs"
            />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-black/25">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'employee', label: 'AI Employees' },
                { id: 'bot', label: 'Bots & Subagents' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setKindFilter(f.id)}
                className={cn(
                  'px-3 py-1.5 text-[11px] font-medium transition-colors',
                  kindFilter === f.id
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-white/[0.08] bg-black/25">
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              aria-label="Org tree view"
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 text-[11px]',
                viewMode === 'tree' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <GitFork className="h-3.5 w-3.5" />
              Org Chart
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Directory grid view"
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 text-[11px]',
                viewMode === 'grid' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Directory
            </button>
          </div>
        </div>

        {/* Main Workspace Split */}
        {employees.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/20 p-10 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <h2 className="mt-3 text-sm font-medium">No AI employees or bots yet</h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Hire specialized AI engineers, researchers, QA auditors, or autonomous bots that report under Eva (Lead Agent).
            </p>
            <Button size="sm" className="mt-4 gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Hire First Team Member
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-black/20 p-8 text-center">
            <p className="text-xs text-muted-foreground">No Org members match your current filter.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12">
            {/* Left: Hierarchy / Grid */}
            <div className="space-y-3 lg:col-span-7">
              {viewMode === 'tree' ? (
                <div className="space-y-3 rounded-xl border border-white/[0.08] bg-black/20 p-4">
                  {/* Lead Root */}
                  <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
                    <MochiEyes
                      expression={evaExpression}
                      archetype="eva"
                      size="sm"
                      trackGaze={false}
                      label={`Eva Lead Agent eyes (${evaExpression})`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-zinc-100">Eva — Lead Agent</span>
                        <Badge variant="outline" className="h-4 border-primary/30 text-[9px] text-primary">
                          root orchestrator
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Plans missions, reviews roster performance, hires specialists, and coordinates all Org departments.
                      </p>
                    </div>
                  </div>
                  <div className="ml-4 border-l border-white/[0.08] pl-4">{renderTreeNodes('ROOT', 0)}</div>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {filtered.map((emp) => {
                    const isSelected = selected?.id === emp.id
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(emp.id)
                          setDelegateOutput(null)
                        }}
                        className={cn(
                          'flex flex-col rounded-xl border p-3.5 text-left transition-colors',
                          isSelected
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-white/[0.08] bg-black/25 hover:border-white/[0.16]'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <MochiEyes
                              expression={
                                delegating && selected?.id === emp.id
                                  ? 'working'
                                  : emp.status === 'active'
                                    ? 'idle'
                                    : 'sleeping'
                              }
                              archetype={pickEmployeeEyeArchetype(emp.kind, emp.department, emp.role, emp.name)}
                              size="xs"
                              trackGaze={false}
                              label={`${emp.name} eyes`}
                            />
                            <span className="text-[13px] font-medium text-zinc-100">{emp.name}</span>
                          </div>
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              emp.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-600'
                            )}
                          />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {emp.title} · {emp.department}
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-zinc-400">{emp.role}</p>
                        <div className="mt-auto pt-2.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {emp.tasksCompleted} completed · {emp.kind}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right: Selected Member Inspector & Direct Task Runner */}
            <div className="lg:col-span-5">
              {selected ? (
                <div className="space-y-4 rounded-xl border border-white/[0.08] bg-black/25 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-white/[0.06] pb-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <MochiEyes
                        expression={
                          delegating
                            ? 'working'
                            : selected.status === 'active'
                              ? 'idle'
                              : 'sleeping'
                        }
                        archetype={pickEmployeeEyeArchetype(
                          selected.kind,
                          selected.department,
                          selected.role,
                          selected.name
                        )}
                        size="sm"
                        trackGaze
                        label={`${selected.name} live eyes`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-zinc-100">{selected.name}</h2>
                          <Badge variant="outline" className="h-4 border-white/15 text-[9.5px]">
                            {selected.kind}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {selected.title} · {selected.department}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-white/15 bg-white/[0.04] px-2 text-[10.5px]"
                        disabled={reviewing}
                        onClick={() => void handleReviewOrg(selected)}
                        title={`Have Eva review ${selected.name}`}
                      >
                        <ClipboardCheck className="h-3 w-3" />
                        Review
                      </Button>
                      <Switch
                        checked={selected.status === 'active'}
                        disabled={busyId === selected.id}
                        aria-label={`Toggle ${selected.name} active state`}
                        onCheckedChange={() => void handleToggleStatus(selected)}
                      />
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-zinc-300">{selected.role}</p>

                  {/* Reporting line selector */}
                  <div className="space-y-1.5">
                    <Label htmlFor="org-reports-to" className="text-[11px] text-muted-foreground">
                      Reports To
                    </Label>
                    <select
                      id="org-reports-to"
                      value={selected.reportsToId ?? ''}
                      disabled={busyId === selected.id}
                      onChange={(e) => void handleUpdateReportsTo(selected.id, e.target.value || null)}
                      className="h-8 w-full rounded-lg border border-white/[0.1] bg-black/40 px-2.5 text-xs text-zinc-200 focus:border-primary focus:outline-none"
                    >
                      <option value="">Eva — Lead Agent (Top-Level)</option>
                      {employees
                        .filter((other) => other.id !== selected.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name} ({other.title})
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Assigned Skills & Tools */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3" /> Skills
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {parseJsonArray(selected.skillsJson).length > 0 ? (
                          parseJsonArray(selected.skillsJson).map((s) => (
                            <span
                              key={s}
                              className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                            >
                              {s}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">Default team skills</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Wrench className="h-3 w-3" /> Preferred Tools
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {parseJsonArray(selected.toolsJson).length > 0 ? (
                          parseJsonArray(selected.toolsJson).map((t) => (
                            <span
                              key={t}
                              className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                            >
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground/60">All armed tools</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* System Instructions preview */}
                  {selected.systemPrompt && (
                    <div className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">Operating Instructions</div>
                      <p className="rounded-lg border border-white/[0.06] bg-black/35 p-2.5 font-mono text-[10.5px] leading-relaxed text-zinc-400">
                        {selected.systemPrompt}
                      </p>
                    </div>
                  )}

                  {/* Quick Delegate Runner */}
                  <div className="space-y-2 border-t border-white/[0.06] pt-3">
                    <Label htmlFor="delegate-task" className="text-[11px] font-medium text-zinc-200">
                      Delegate Direct Task to {selected.name}
                    </Label>
                    <Textarea
                      id="delegate-task"
                      value={delegateTask}
                      onChange={(e) => setDelegateTask(e.target.value)}
                      placeholder={`Ask ${selected.name} to review, analyze, or draft something...`}
                      rows={3}
                      className="resize-none border-white/[0.1] bg-black/40 text-xs"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        disabled={busyId === selected.id}
                        onClick={() => void handleDelete(selected)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={delegating || !delegateTask.trim() || selected.status !== 'active'}
                        onClick={() => void handleDelegate()}
                      >
                        {delegating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Run Task
                      </Button>
                    </div>
                    {delegateOutput && (
                      <div className="max-h-60 overflow-y-auto rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] p-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-200 nice-scroll">
                        {delegateOutput}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.08] bg-black/20 p-6 text-center text-xs text-muted-foreground">
                  Select an AI employee or bot to inspect and run delegated tasks.
                </div>
              )}
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* Hire / Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-zinc-950 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Hire AI Employee or Create Bot
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add a persistent specialist or automated bot to your Org hierarchy. Bots also register a callable tool.
            </DialogDescription>
          </DialogHeader>

          {/* 1-click starter templates */}
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">Quick Role Templates</div>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 py-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-name" className="text-xs">Name</Label>
              <Input
                id="emp-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Atlas Architect"
                className="h-8 border-white/10 bg-black/40 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-kind" className="text-xs">Type</Label>
              <select
                id="emp-kind"
                value={formKind}
                onChange={(e) => setFormKind(e.target.value as 'employee' | 'bot' | 'subagent')}
                className="h-8 w-full rounded-md border border-white/10 bg-black/40 px-2.5 text-xs text-zinc-200"
              >
                <option value="employee">AI Employee</option>
                <option value="bot">Autonomous Bot (+callable tool)</option>
                <option value="subagent">Specialist Subagent</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-title" className="text-xs">Job Title</Label>
              <Input
                id="emp-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Principal Backend Engineer"
                className="h-8 border-white/10 bg-black/40 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-dept" className="text-xs">Department</Label>
              <Input
                id="emp-dept"
                value={formDept}
                onChange={(e) => setFormDept(e.target.value)}
                placeholder="Engineering, QA, Research..."
                className="h-8 border-white/10 bg-black/40 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="emp-manager" className="text-xs">Reports To</Label>
            <select
              id="emp-manager"
              value={formReportsTo}
              onChange={(e) => setFormReportsTo(e.target.value)}
              className="h-8 w-full rounded-md border border-white/10 bg-black/40 px-2.5 text-xs text-zinc-200"
            >
              <option value="">Eva — Lead Agent (Top-Level)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {e.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="emp-role" className="text-xs">Role &amp; Responsibilities</Label>
            <Input
              id="emp-role"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
              placeholder="What outcomes is this AI team member accountable for?"
              className="h-8 border-white/10 bg-black/40 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="emp-prompt" className="text-xs">System Instructions</Label>
            <Textarea
              id="emp-prompt"
              value={formPrompt}
              onChange={(e) => setFormPrompt(e.target.value)}
              rows={3}
              placeholder="Detailed operating prompt, constraints, and verification expectations..."
              className="border-white/10 bg-black/40 text-xs"
            />
          </div>

          {skills.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Assign Skills</div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {skills.filter((s) => s.enabled).map((s) => {
                  const active = formSkills.includes(s.slug)
                  return (
                    <button
                      key={s.slug}
                      type="button"
                      onClick={() =>
                        setFormSkills((prev) =>
                          prev.includes(s.slug) ? prev.filter((x) => x !== s.slug) : [...prev, s.slug]
                        )
                      }
                      className={cn(
                        'rounded border px-2 py-0.5 font-mono text-[10px] transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-white/10 bg-black/30 text-zinc-400'
                      )}
                    >
                      {s.slug}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {tools.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Preferred Tools</div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {tools.filter((t) => t.enabled).map((t) => {
                  const active = formTools.includes(t.slug)
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() =>
                        setFormTools((prev) =>
                          prev.includes(t.slug) ? prev.filter((x) => x !== t.slug) : [...prev, t.slug]
                        )
                      }
                      className={cn(
                        'rounded border px-2 py-0.5 font-mono text-[10px] transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-white/10 bg-black/30 text-zinc-400'
                      )}
                    >
                      {t.slug}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={creating || !formName.trim() || !formRole.trim()}
              onClick={() => void handleCreate()}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {formKind === 'bot' ? 'Create Bot' : 'Hire Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
