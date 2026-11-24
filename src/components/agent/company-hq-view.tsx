'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  FileText,
  FolderGit2,
  Globe,
  Layers,
  ListTodo,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AttachProductDialog,
  NewCompanyDialog,
} from '@/components/agent/company-hq-modals'
import {
  PaperclipHeartbeatsBudgets,
  type CompanySnapshotDTO,
} from '@/components/agent/paperclip-company-tabs'
import {
  BUSINESS_DEPARTMENT_BLUEPRINTS,
  CORE_BUSINESS_DEPARTMENTS,
  type CompanyDepartment,
  type CompanyProduct,
  type ProductSourceType,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/agent/company-types'
import { useCompanyStore } from '@/lib/agent/company-store'
import { useApp } from '@/lib/agent/store'
import type { AiEmployeeDTO } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type HqTab = 'overview' | 'products' | 'departments' | 'workstreams' | 'heartbeats'

const HQ_TABS: { id: HqTab; label: string; icon: typeof Building2 }[] = [
  { id: 'overview', label: 'Founder Inbox & CEO', icon: Crown },
  { id: 'products', label: 'Products & Sources', icon: Layers },
  { id: 'departments', label: 'Departments & Org', icon: Users },
  { id: 'workstreams', label: 'Workstreams', icon: ListTodo },
  { id: 'heartbeats', label: 'Heartbeats & Budgets', icon: Activity },
]

function sourceIcon(type: ProductSourceType) {
  if (type === 'website') return Globe
  if (type === 'document') return FileText
  if (type === 'repo_folder') return FolderGit2
  return Sparkles
}

const TICKET_COLUMNS: { id: TicketStatus; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'needs_approval', label: 'Founder Approval' },
  { id: 'done', label: 'Completed' },
]

export function CompanyHqView() {
  const { toast } = useToast()
  const { employees: allOrgEmployees, refreshOrg } = useApp()

  const snapshot = useCompanyStore((s) => s.snapshot)
  const loading = useCompanyStore((s) => s.loading)
  const busy = useCompanyStore((s) => s.busy)
  const refreshCompany = useCompanyStore((s) => s.refreshCompany)
  const runCompanyAction = useCompanyStore((s) => s.runCompanyAction)
  const switchCompany = useCompanyStore((s) => s.switchCompany)
  const newCompanyModalOpen = useCompanyStore((s) => s.newCompanyModalOpen)
  const setNewCompanyModalOpen = useCompanyStore((s) => s.setNewCompanyModalOpen)

  const [hqTab, setHqTab] = useState<HqTab>('overview')
  const [attachOpen, setAttachOpen] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [deptFilter, setDeptFilter] = useState<string>('All')

  // Founder Inbox inline states
  const [budgetOverrides, setBudgetOverrides] = useState<Record<string, string>>({})
  const [ceoGoalPrompt, setCeoGoalPrompt] = useState('')
  const [spendModalOpen, setSpendModalOpen] = useState(false)
  const [spendTitle, setSpendTitle] = useState('')
  const [spendAmount, setSpendAmount] = useState('50')
  const [spendCategory, setSpendCategory] = useState<
    'budget_increase' | 'vendor_spend' | 'campaign_spend' | 'external_action'
  >('campaign_spend')
  const [spendRationale, setSpendRationale] = useState('')

  // Add source inline state (inside Products tab)
  const [newSrcType, setNewSrcType] = useState<'website' | 'document' | 'repo_folder'>('website')
  const [newSrcLabel, setNewSrcLabel] = useState('')
  const [newSrcUri, setNewSrcUri] = useState('')
  const [newSrcContent, setNewSrcContent] = useState('')

  // Quick ticket creator state (inside Workstreams tab)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')
  const [ticketDept, setTicketDept] = useState<CompanyDepartment>('Marketing')
  const [ticketPriority, setTicketPriority] = useState<TicketPriority>('medium')
  const [ticketProductId, setTicketProductId] = useState<string>('')
  const [ticketRequiresApproval, setTicketRequiresApproval] = useState(false)

  // Company profile settings state (inside Heartbeats & Budgets tab)
  const [editName, setEditName] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [editMission, setEditMission] = useState('')
  const [editBudget, setEditBudget] = useState('250')

  useEffect(() => {
    void refreshCompany()
  }, [refreshCompany])

  useEffect(() => {
    if (!snapshot) return
    setEditName(snapshot.company.companyName)
    setEditIndustry(snapshot.company.industry)
    setEditMission(snapshot.company.mission)
    setEditBudget(String(snapshot.company.monthlyBudgetUsd))
    if (
      snapshot.activeProductId &&
      snapshot.products.some((p) => p.id === snapshot.activeProductId)
    ) {
      setSelectedProductId(snapshot.activeProductId)
    } else if (
      snapshot.products.length > 0 &&
      (!selectedProductId || !snapshot.products.some((p) => p.id === selectedProductId))
    ) {
      setSelectedProductId(snapshot.products[0].id)
    }
  }, [snapshot, selectedProductId])

  const dispatchAction = useCallback(
    async (payload: Record<string, unknown>, successMsg?: string): Promise<boolean> => {
      const res = await runCompanyAction(payload)
      if (!res.ok) {
        toast({
          title: 'Company HQ action failed',
          description: res.error || 'Please try again.',
          variant: 'destructive',
        })
        return false
      }
      if (
        payload.action === 'decide_hiring_proposal' ||
        payload.action === 'register_byoa' ||
        payload.action === 'auto_hire'
      ) {
        await refreshOrg()
      }
      if (successMsg) {
        toast({ title: successMsg })
      }
      return true
    },
    [runCompanyAction, refreshOrg, toast]
  )

  const companyEmployees = useMemo<AiEmployeeDTO[]>(() => {
    if (Array.isArray(snapshot?.employees)) {
      return snapshot.employees as AiEmployeeDTO[]
    }
    return allOrgEmployees
  }, [snapshot?.employees, allOrgEmployees])

  const selectedProduct: CompanyProduct | null = useMemo(() => {
    if (!snapshot) return null
    return (
      snapshot.products.find((p) => p.id === selectedProductId) ??
      snapshot.products[0] ??
      null
    )
  }, [snapshot, selectedProductId])

  const pendingHires = useMemo(
    () => (snapshot?.hiringProposals ?? []).filter((p) => p.status === 'pending'),
    [snapshot?.hiringProposals]
  )
  const pendingSpend = useMemo(
    () => (snapshot?.spendRequests ?? []).filter((r) => r.status === 'pending'),
    [snapshot?.spendRequests]
  )
  const approvalTickets = useMemo(
    () => (snapshot?.tickets ?? []).filter((t) => t.status === 'needs_approval'),
    [snapshot?.tickets]
  )
  const latestBriefing = snapshot?.briefings?.[0] ?? null

  if (loading && !snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Unable to load Company HQ workspace.</p>
        <Button size="sm" onClick={() => void refreshCompany()}>
          Retry
        </Button>
      </div>
    )
  }

  const activeProductBanner = snapshot.activeProductId
    ? snapshot.products.find((p) => p.id === snapshot.activeProductId) ?? null
    : null

  const legacySnapshotForHeartbeats: CompanySnapshotDTO = {
    company: {
      companyName: snapshot.company.companyName,
      mission: snapshot.company.mission,
      monthlyBudgetUsd: snapshot.company.monthlyBudgetUsd,
      autoHireEnabled: snapshot.company.autoHireEnabled,
      updatedAt: snapshot.company.updatedAt,
    },
    metrics: {
      totalSpentUsd: snapshot.metrics.totalSpentUsd,
      monthlyBudgetUsd: snapshot.metrics.monthlyBudgetUsd,
      budgetUtilizationPct: snapshot.metrics.budgetUtilizationPct,
      totalTokens: snapshot.metrics.totalTokens,
      openTickets: snapshot.metrics.openTickets,
      approvalPending: snapshot.metrics.approvalPending,
      totalHeartbeats: snapshot.metrics.totalHeartbeats,
      activeAgents: snapshot.metrics.activeAgents,
      byoaAgents: snapshot.metrics.byoaAgents,
    },
    agentConfigs: snapshot.agentConfigs,
    tickets: snapshot.tickets,
    heartbeats: snapshot.heartbeats,
  }

  const handleCeoPlanGoal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ceoGoalPrompt.trim()) return
    const ok = await dispatchAction(
      {
        action: 'eva_plan_product',
        productId: snapshot.activeProductId,
        goal: ceoGoalPrompt.trim(),
        maxProposals: 4,
      },
      'Eva CEO drafted department tasks & queued AI hire proposals for your approval'
    )
    if (ok) setCeoGoalPrompt('')
  }

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProduct) return
    const payload: Record<string, unknown> = {
      action: 'add_product_source',
      productId: selectedProduct.id,
      sourceType: newSrcType,
      label: newSrcLabel.trim(),
      uriOrPath: newSrcUri.trim(),
      content: newSrcContent.trim(),
    }
    const ok = await dispatchAction(payload, 'Source attached to product knowledge')
    if (ok) {
      setNewSrcLabel('')
      setNewSrcUri('')
      setNewSrcContent('')
    }
  }

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticketTitle.trim()) return
    const ok = await dispatchAction(
      {
        action: 'create_ticket',
        title: ticketTitle.trim(),
        description: ticketDesc.trim(),
        department: ticketDept,
        priority: ticketPriority,
        productId: ticketProductId || snapshot.activeProductId || null,
        requiresApproval: ticketRequiresApproval,
      },
      'Workstream task created'
    )
    if (ok) {
      setTicketTitle('')
      setTicketDesc('')
      setTicketRequiresApproval(false)
    }
  }

  const handleCreateSpendRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!spendTitle.trim()) return
    const ok = await dispatchAction(
      {
        action: 'create_spend_request',
        productId: snapshot.activeProductId,
        title: spendTitle.trim(),
        category: spendCategory,
        amountUsd: Number(spendAmount) || 0,
        rationale: spendRationale.trim() || 'Requested for active company operations.',
      },
      'Spend request added to Founder Approval Queue'
    )
    if (ok) {
      setSpendTitle('')
      setSpendRationale('')
      setSpendModalOpen(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Compact Top Workspace Header */}
      <div className="shrink-0 border-b border-border bg-card/40 px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-primary" />
              <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                {snapshot.company.companyName}
              </h1>
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                · {snapshot.company.industry} · {snapshot.company.stage}
              </span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {snapshot.company.mission}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNewCompanyModalOpen(true)}
              className="h-8 gap-1.5 whitespace-nowrap text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              New Company
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAttachOpen(true)}
              className="h-8 gap-1.5 whitespace-nowrap text-xs"
            >
              <Layers className="h-3.5 w-3.5" />
              Attach Product
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void dispatchAction(
                  { action: 'run_all_heartbeats' },
                  'CEO & department heartbeat cycle completed'
                )
              }
              className="h-8 gap-1.5 whitespace-nowrap text-xs"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run Team Cycle
            </Button>
          </div>
        </div>

        {/* Active Product Context Filter Banner */}
        {activeProductBanner && (
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="font-medium text-foreground">
                Scoped to Product: {activeProductBanner.name}
              </span>
              <span className="hidden truncate text-muted-foreground sm:inline">
                · {activeProductBanner.stage} · {activeProductBanner.sources.length} source(s)
              </span>
            </div>
            <button
              type="button"
              onClick={() => void switchCompany(snapshot.activeCompanyId, null)}
              className="shrink-0 text-[11px] font-medium text-primary hover:underline"
            >
              Show All Products
            </button>
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <nav
          aria-label="Company HQ sections"
          className="mt-3 flex items-center gap-1 overflow-x-auto pb-0.5"
        >
          {HQ_TABS.map(({ id, label, icon: Icon }) => {
            const active = hqTab === id
            const count =
              id === 'overview'
                ? snapshot.metrics.totalFounderApprovals
                : id === 'products'
                  ? snapshot.metrics.productCount
                  : id === 'workstreams'
                    ? snapshot.metrics.openTickets
                    : id === 'departments'
                      ? snapshot.metrics.activeAgents
                      : undefined
            return (
              <button
                key={id}
                type="button"
                onClick={() => setHqTab(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary/35 bg-primary/10 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', active && 'text-primary')} />
                <span>{label}</span>
                {count !== undefined && count > 0 && (
                  <span
                    className={cn(
                      'font-mono text-[10px] tabular-nums',
                      id === 'overview'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* ===================== TAB 1: OVERVIEW & FOUNDER INBOX ===================== */}
          {hqTab === 'overview' && (
            <>
              {/* 4-Metric KPI Strip */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Founder Approvals</span>
                    <ShieldAlert
                      className={cn(
                        'h-3.5 w-3.5',
                        snapshot.metrics.totalFounderApprovals > 0
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                      )}
                    />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                    {snapshot.metrics.totalFounderApprovals}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {snapshot.metrics.pendingHires} hires · {snapshot.metrics.pendingSpendRequests} spend ·{' '}
                    {snapshot.metrics.approvalPending} tasks
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Attached Products</span>
                    <Layers className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                    {snapshot.metrics.productCount}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {snapshot.companies.length} compan{snapshot.companies.length === 1 ? 'y' : 'ies'} in Nexus
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Active AI Workforce</span>
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                    {snapshot.metrics.activeAgents}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    Eva CEO + {snapshot.metrics.openTickets} open task(s)
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Monthly AI Spend</span>
                    <CircleDollarSign className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                    ${snapshot.metrics.totalSpentUsd.toFixed(2)}
                    <span className="text-xs font-normal text-muted-foreground">
                      {' '}
                      / ${snapshot.metrics.monthlyBudgetUsd.toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full transition-all',
                        snapshot.metrics.budgetUtilizationPct >= 100
                          ? 'bg-destructive'
                          : snapshot.metrics.budgetUtilizationPct >= 80
                            ? 'bg-amber-500'
                            : 'bg-primary'
                      )}
                      style={{ width: `${Math.min(100, snapshot.metrics.budgetUtilizationPct)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Eva CEO Command Bar — Ask Eva to Plan Departments & Propose Hires */}
              <form
                onSubmit={handleCeoPlanGoal}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">
                      Direct Eva (CEO) — Launch a Company Initiative
                    </h2>
                  </div>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    Autonomous execution · Hires &amp; spend pause for Founder sign-off
                  </span>
                </div>
                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={ceoGoalPrompt}
                    onChange={(e) => setCeoGoalPrompt(e.target.value)}
                    placeholder="e.g., Launch Q2 B2B outbound sales campaign, publish customer FAQ, and review monthly burn..."
                    className="flex-1 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !ceoGoalPrompt.trim()}
                    className="h-9 gap-1.5 whitespace-nowrap text-xs"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Plan &amp; Propose Team
                  </Button>
                </div>
              </form>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* Founder Approval Queue (Left 7 cols) */}
                <section
                  aria-label="Founder Approval Queue"
                  className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-7"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2.5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <h2 className="text-sm font-semibold text-foreground">
                        Founder Approval Queue
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpendModalOpen((v) => !v)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      + Log Spend Request
                    </button>
                  </div>

                  {spendModalOpen && (
                    <form
                      onSubmit={handleCreateSpendRequest}
                      className="space-y-2.5 rounded-md border border-border bg-muted/25 p-3"
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <Input
                          required
                          value={spendTitle}
                          onChange={(e) => setSpendTitle(e.target.value)}
                          placeholder="Spend request title"
                          className="h-8 text-xs sm:col-span-2"
                        />
                        <Input
                          type="number"
                          min={0}
                          step={5}
                          value={spendAmount}
                          onChange={(e) => setSpendAmount(e.target.value)}
                          placeholder="Amount USD"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <select
                          value={spendCategory}
                          onChange={(e) =>
                            setSpendCategory(
                              e.target.value as
                                | 'budget_increase'
                                | 'vendor_spend'
                                | 'campaign_spend'
                                | 'external_action'
                            )
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="campaign_spend">Campaign Spend</option>
                          <option value="budget_increase">Monthly Budget Increase</option>
                          <option value="vendor_spend">Vendor / Tool Spend</option>
                          <option value="external_action">External Action</option>
                        </select>
                        <Input
                          value={spendRationale}
                          onChange={(e) => setSpendRationale(e.target.value)}
                          placeholder="Business justification"
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSpendModalOpen(false)}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={busy} className="h-7 text-xs">
                          Submit for Approval
                        </Button>
                      </div>
                    </form>
                  )}

                  {pendingHires.length === 0 &&
                  pendingSpend.length === 0 &&
                  approvalTickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border/80 py-8 text-center">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      <p className="mt-2 text-xs font-medium text-foreground">
                        Founder inbox is clear
                      </p>
                      <p className="mt-0.5 max-w-sm text-[11.5px] text-muted-foreground">
                        Attach a product or direct Eva CEO above to generate department hiring proposals and spend-gated plans.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Pending AI Hiring Proposals */}
                      {pendingHires.map((prop) => {
                        const overrideVal =
                          budgetOverrides[prop.id] ?? String(prop.monthlyBudgetUsd)
                        return (
                          <div
                            key={prop.id}
                            className="rounded-md border border-border/90 bg-background p-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                                  <span>Hire Proposal: {prop.name}</span>
                                </div>
                                <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                                  {prop.title} · {prop.department} · Proposed by {prop.proposedBy}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Label
                                  htmlFor={`cap-${prop.id}`}
                                  className="font-mono text-[10px] text-muted-foreground"
                                >
                                  Cap $/mo
                                </Label>
                                <Input
                                  id={`cap-${prop.id}`}
                                  type="number"
                                  min={0}
                                  step={5}
                                  value={overrideVal}
                                  onChange={(e) =>
                                    setBudgetOverrides((prev) => ({
                                      ...prev,
                                      [prop.id]: e.target.value,
                                    }))
                                  }
                                  className="h-7 w-20 font-mono text-xs tabular-nums"
                                />
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">{prop.role}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground/90">
                              <span className="font-medium text-foreground">Why Eva proposed:</span>{' '}
                              {prop.rationale}
                            </p>
                            <div className="mt-2.5 flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void dispatchAction(
                                    {
                                      action: 'decide_hiring_proposal',
                                      proposalId: prop.id,
                                      decision: 'reject',
                                    },
                                    `Rejected hire proposal for ${prop.name}`
                                  )
                                }
                                className="h-7 gap-1 text-xs"
                              >
                                <X className="h-3 w-3" />
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void dispatchAction(
                                    {
                                      action: 'decide_hiring_proposal',
                                      proposalId: prop.id,
                                      decision: 'approve',
                                      adjustedBudgetUsd: Number(overrideVal) || prop.monthlyBudgetUsd,
                                    },
                                    `Approved & hired ${prop.name} (${prop.department})`
                                  )
                                }
                                className="h-7 gap-1 text-xs"
                              >
                                <Check className="h-3 w-3" />
                                Approve &amp; Hire
                              </Button>
                            </div>
                          </div>
                        )
                      })}

                      {/* Pending Spend Requests */}
                      {pendingSpend.map((req) => (
                        <div
                          key={req.id}
                          className="rounded-md border border-border/90 bg-background p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                <CircleDollarSign className="h-3.5 w-3.5 text-amber-500" />
                                <span>Spend Request: {req.title}</span>
                              </div>
                              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                                {req.category.replace('_', ' ')} · Requested by {req.requestedBy}
                              </div>
                            </div>
                            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                              ${req.amountUsd.toFixed(2)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">{req.rationale}</p>
                          <div className="mt-2.5 flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void dispatchAction(
                                  {
                                    action: 'decide_spend_request',
                                    requestId: req.id,
                                    decision: 'reject',
                                  },
                                  `Rejected spend request: ${req.title}`
                                )
                              }
                              className="h-7 gap-1 text-xs"
                            >
                              <X className="h-3 w-3" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void dispatchAction(
                                  {
                                    action: 'decide_spend_request',
                                    requestId: req.id,
                                    decision: 'approve',
                                  },
                                  `Approved $${req.amountUsd.toFixed(2)} spend`
                                )
                              }
                              className="h-7 gap-1 text-xs"
                            >
                              <Check className="h-3 w-3" />
                              Approve Spend
                            </Button>
                          </div>
                        </div>
                      ))}

                      {/* Approval-Gated Tickets */}
                      {approvalTickets.map((tkt) => (
                        <div
                          key={tkt.id}
                          className="rounded-md border border-border/90 bg-background p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {tkt.key}
                                </span>
                                <span className="truncate">{tkt.title}</span>
                              </div>
                              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                                {tkt.department ?? 'Executive'} · {tkt.assigneeName}
                                {tkt.productName ? ` · ${tkt.productName}` : ''}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                void dispatchAction(
                                  { action: 'approve_ticket', id: tkt.id, approver: 'Founder' },
                                  `Approved ${tkt.key}`
                                )
                              }
                              className="h-7 shrink-0 gap-1 text-xs"
                            >
                              <Check className="h-3 w-3" />
                              Approve
                            </Button>
                          </div>
                          {tkt.outputSummary && (
                            <p className="mt-2 line-clamp-3 rounded bg-muted/40 p-2 text-[11.5px] text-muted-foreground">
                              {tkt.outputSummary}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Eva CEO Executive Briefing (Right 5 cols) */}
                <section
                  aria-label="Eva CEO Executive Briefing"
                  className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-5"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <h2 className="text-sm font-semibold text-foreground">
                        Eva CEO Briefing
                      </h2>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void dispatchAction(
                          {
                            action: 'generate_ceo_briefing',
                            productId: snapshot.activeProductId,
                          },
                          'Eva CEO generated a fresh executive briefing'
                        )
                      }
                      className="h-7 gap-1 text-xs"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Refresh Brief
                    </Button>
                  </div>

                  {latestBriefing ? (
                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="font-semibold text-foreground">
                          {latestBriefing.headline}
                        </div>
                        <p className="mt-1 leading-relaxed text-muted-foreground">
                          {latestBriefing.summary}
                        </p>
                      </div>

                      {latestBriefing.blockers.length > 0 && (
                        <div className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5">
                          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            Founder Attention Needed
                          </div>
                          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-foreground/90">
                            {latestBriefing.blockers.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {latestBriefing.nextActions.length > 0 && (
                        <div className="space-y-1">
                          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Recommended Next Moves
                          </div>
                          <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-muted-foreground">
                            {latestBriefing.nextActions.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/80 p-5 text-center">
                      <p className="text-xs text-muted-foreground">
                        No executive briefing yet for {snapshot.company.companyName}.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void dispatchAction(
                            {
                              action: 'generate_ceo_briefing',
                              productId: snapshot.activeProductId,
                            },
                            'Eva CEO briefing ready'
                          )
                        }
                        className="mt-2.5 h-7 text-xs"
                      >
                        Generate Eva CEO Briefing
                      </Button>
                    </div>
                  )}

                  {/* Department Snapshot Strip */}
                  <div className="border-t border-border/70 pt-3">
                    <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Department Pulse
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {snapshot.departments.map((d) => (
                        <button
                          key={d.name}
                          type="button"
                          onClick={() => {
                            setDeptFilter(d.name)
                            setHqTab('departments')
                          }}
                          className="flex items-center justify-between rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/60"
                        >
                          <span className="truncate font-medium text-foreground">{d.name}</span>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                            {d.headcount} AI · {d.openTickets}t
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}

          {/* ===================== TAB 2: PRODUCTS & 4-SOURCE CONTEXT ===================== */}
          {hqTab === 'products' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Product List (Left 4 cols) */}
              <div className="space-y-2.5 lg:col-span-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Attached Products ({snapshot.products.length})
                  </h2>
                  <Button size="sm" onClick={() => setAttachOpen(true)} className="h-7 gap-1 text-xs">
                    <Plus className="h-3 w-3" />
                    Attach
                  </Button>
                </div>

                {snapshot.products.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
                    <Layers className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-xs font-medium text-foreground">
                      No products or projects attached yet
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      Attach a product via business brief, website URL, documents, or folder/repo so Eva CEO can staff and operate it.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => setAttachOpen(true)}
                      className="mt-3 h-8 gap-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Attach First Product
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.products.map((prod) => {
                      const active = selectedProduct?.id === prod.id
                      return (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => setSelectedProductId(prod.id)}
                          className={cn(
                            'w-full rounded-lg border p-3 text-left transition-colors',
                            active
                              ? 'border-primary/45 bg-primary/5'
                              : 'border-border bg-card hover:bg-muted/40'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {prod.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                              {prod.stage}
                            </span>
                          </div>
                          {prod.tagline && (
                            <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground">
                              {prod.tagline}
                            </p>
                          )}
                          <div className="mt-2 font-mono text-[10px] text-muted-foreground">
                            {prod.kind} · {prod.sources.length} source(s) · {prod.goals.length} goal(s)
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Product Detail & 4-Source Knowledge Inspector (Right 8 cols) */}
              <div className="lg:col-span-8">
                {selectedProduct ? (
                  <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">
                            {selectedProduct.name}
                          </h3>
                          <span className="font-mono text-[10.5px] uppercase text-muted-foreground">
                            · {selectedProduct.kind} · {selectedProduct.stage}
                          </span>
                        </div>
                        {selectedProduct.tagline && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {selectedProduct.tagline}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void switchCompany(
                              snapshot.activeCompanyId,
                              snapshot.activeProductId === selectedProduct.id
                                ? null
                                : selectedProduct.id
                            )
                          }
                          className="h-7 text-xs"
                        >
                          {snapshot.activeProductId === selectedProduct.id
                            ? 'Active in Eva Chat'
                            : 'Focus Eva on Product'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void dispatchAction(
                              {
                                action: 'eva_plan_product',
                                productId: selectedProduct.id,
                                maxProposals: 4,
                              },
                              `Eva CEO created department tasks & hire proposals for ${selectedProduct.name}`
                            )
                          }
                          className="h-7 gap-1 text-xs"
                        >
                          <Sparkles className="h-3 w-3" />
                          Eva Plan &amp; Staff
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Delete ${selectedProduct.name}`}
                          onClick={() =>
                            void dispatchAction(
                              { action: 'delete_product', productId: selectedProduct.id },
                              `Removed ${selectedProduct.name}`
                            )
                          }
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {selectedProduct.brief && (
                      <div className="text-xs leading-relaxed text-foreground/90">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Business Brief
                        </span>
                        <p className="mt-1 whitespace-pre-wrap">{selectedProduct.brief}</p>
                      </div>
                    )}

                    {selectedProduct.goals.length > 0 && (
                      <div>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Product Goals
                        </span>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                          {selectedProduct.goals.map((g, i) => (
                            <li key={i}>{g}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Attached Context Sources */}
                    <div className="space-y-2">
                      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Attached Context Sources ({selectedProduct.sources.length})
                      </div>
                      <div className="space-y-2">
                        {selectedProduct.sources.map((src) => {
                          const Icon = sourceIcon(src.type)
                          return (
                            <div
                              key={src.id}
                              className="rounded-md border border-border/80 bg-background p-2.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="truncate text-xs font-medium text-foreground">
                                    {src.label}
                                  </span>
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                    · {src.type.replace('_', '/')}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Remove source ${src.label}`}
                                  onClick={() =>
                                    void dispatchAction(
                                      {
                                        action: 'remove_product_source',
                                        productId: selectedProduct.id,
                                        sourceId: src.id,
                                      },
                                      'Source removed'
                                    )
                                  }
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <p className="mt-1 line-clamp-3 text-[11.5px] text-muted-foreground">
                                {src.summary}
                              </p>
                              {src.status === 'error' && src.errorMessage && (
                                <p className="mt-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                                  Fetch note: {src.errorMessage}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Add Another Source Form */}
                    <form
                      onSubmit={handleAddSource}
                      className="space-y-2.5 rounded-md border border-border/80 bg-muted/20 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          Attach Additional Source
                        </span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { id: 'website', label: 'Website URL' },
                              { id: 'document', label: 'Document' },
                              { id: 'repo_folder', label: 'Folder / Repo' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setNewSrcType(opt.id)}
                              className={cn(
                                'rounded border px-2 py-0.5 text-[11px] font-medium transition-colors',
                                newSrcType === opt.id
                                  ? 'border-primary/40 bg-primary/10 text-foreground'
                                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={newSrcLabel}
                          onChange={(e) => setNewSrcLabel(e.target.value)}
                          placeholder="Label (optional)"
                          className="h-8 text-xs"
                        />
                        {newSrcType !== 'document' && (
                          <Input
                            required
                            value={newSrcUri}
                            onChange={(e) => setNewSrcUri(e.target.value)}
                            placeholder={
                              newSrcType === 'website'
                                ? 'https://example.com/pricing'
                                : 'https://github.com/org/repo or relative folder'
                            }
                            className="h-8 text-xs"
                          />
                        )}
                      </div>

                      {newSrcType === 'document' && (
                        <Textarea
                          required
                          rows={3}
                          value={newSrcContent}
                          onChange={(e) => setNewSrcContent(e.target.value)}
                          placeholder="Paste product spec, sales script, FAQ, or pricing notes..."
                          className="text-xs"
                        />
                      )}

                      <div className="flex justify-end">
                        <Button type="submit" size="sm" disabled={busy} className="h-7 text-xs">
                          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          Attach Source
                        </Button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
                    Select or attach a product on the left to inspect its brief, website snapshot, docs, and repo sources.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================== TAB 3: DEPARTMENTS & ORG CHART ===================== */}
          {hqTab === 'departments' && (
            <div className="space-y-4">
              {/* Hierarchy Banner: Founder -> Eva CEO -> 6 Business Departments */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <Crown className="h-3.5 w-3.5 text-amber-500" />
                      Founder (You · Boss)
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                      Eva (AI CEO)
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-muted-foreground">
                      6 Autonomous Business Departments
                    </span>
                  </div>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    New role proposals route to Founder Approval Queue
                  </span>
                </div>

                {/* Department Filter Bar */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(['All', ...CORE_BUSINESS_DEPARTMENTS] as const).map((dept) => {
                    const active = deptFilter === dept
                    const stats = snapshot.departments.find((d) => d.name === dept)
                    return (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setDeptFilter(dept)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border/80 bg-background text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <span>{dept}</span>
                        {stats && (
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            {stats.headcount}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Active AI Employees Grid */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {companyEmployees
                  .filter(
                    (emp) =>
                      deptFilter === 'All' ||
                      emp.department.toLowerCase() === deptFilter.toLowerCase() ||
                      (deptFilter === 'Product & Development' &&
                        ['engineering', 'product', 'qa'].includes(emp.department.toLowerCase())) ||
                      (deptFilter === 'Finance & Ops' &&
                        ['operations', 'finance'].includes(emp.department.toLowerCase()))
                  )
                  .map((emp) => {
                    const cfg = snapshot.agentConfigs[emp.id]
                    return (
                      <div
                        key={emp.id}
                        className="flex flex-col justify-between rounded-lg border border-border bg-card p-3.5"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-foreground">
                                {emp.name}
                              </div>
                              <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                                {emp.title} · {emp.department}
                              </div>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                              ${(cfg?.spentUsd ?? 0).toFixed(2)}/${cfg?.monthlyBudgetUsd ?? 25}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-[11.5px] text-muted-foreground">
                            {emp.role}
                          </p>
                        </div>

                        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {emp.tasksCompleted} done · every {cfg?.heartbeatIntervalMin ?? 30}m
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void dispatchAction(
                                { action: 'run_heartbeat', agentId: emp.id },
                                `Triggered heartbeat for ${emp.name}`
                              )
                            }
                            className="h-6 gap-1 px-2 text-[11px]"
                          >
                            <Play className="h-2.5 w-2.5" />
                            Run
                          </Button>
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* Department Role Templates — Propose Hire to Founder Queue */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Company Department Role Blueprints
                    </h3>
                  </div>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    Click to propose a hire into Founder Approval Queue
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                  {BUSINESS_DEPARTMENT_BLUEPRINTS.map((bp) => (
                    <div
                      key={bp.key}
                      className="flex flex-col justify-between rounded-md border border-border/80 bg-background p-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {bp.department}
                          </span>
                          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                            ${bp.budgetUsd}/mo
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] font-medium text-primary">
                          {bp.name} — {bp.title}
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted-foreground">{bp.role}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void dispatchAction(
                            {
                              action: 'create_hiring_proposal',
                              productId: snapshot.activeProductId,
                              name: bp.name,
                              title: bp.title,
                              department: bp.department,
                              kind: bp.kind,
                              role: bp.role,
                              systemPrompt: bp.systemPrompt,
                              skills: bp.skills,
                              tools: bp.tools,
                              monthlyBudgetUsd: bp.budgetUsd,
                              rationale: `Requested ${bp.department} leadership to run autonomous workflows for ${snapshot.company.companyName}.`,
                            },
                            `Proposed ${bp.name} — review in Founder Approval Queue`
                          )
                        }
                        className="mt-3 h-7 w-full gap-1 text-xs"
                      >
                        <UserPlus className="h-3 w-3" />
                        Propose Hire
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===================== TAB 4: WORKSTREAMS & TICKETS ===================== */}
          {hqTab === 'workstreams' && (
            <div className="space-y-4">
              {/* Quick Create Workstream Task */}
              <form
                onSubmit={handleCreateTicket}
                className="rounded-lg border border-border bg-card p-3.5"
              >
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
                  <Input
                    required
                    value={ticketTitle}
                    onChange={(e) => setTicketTitle(e.target.value)}
                    placeholder="New company task (e.g., Draft 5 outbound sales emails for launch leads)"
                    className="h-8 text-xs md:col-span-5"
                  />
                  <select
                    value={ticketDept}
                    onChange={(e) => setTicketDept(e.target.value as CompanyDepartment)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs md:col-span-2"
                  >
                    <option value="Executive">Executive (Eva)</option>
                    {CORE_BUSINESS_DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ticketProductId}
                    onChange={(e) => setTicketProductId(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs md:col-span-2"
                  >
                    <option value="">Company-wide</option>
                    {snapshot.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value as TicketPriority)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs md:col-span-1"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Med</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  <Button type="submit" size="sm" disabled={busy} className="h-8 gap-1 text-xs md:col-span-2">
                    <Plus className="h-3.5 w-3.5" />
                    Add Task
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <Input
                    value={ticketDesc}
                    onChange={(e) => setTicketDesc(e.target.value)}
                    placeholder="Optional brief, deliverable expectation, or success criteria"
                    className="h-7 max-w-xl text-xs"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={ticketRequiresApproval}
                      onChange={(e) => setTicketRequiresApproval(e.target.checked)}
                      className="rounded border-border"
                    />
                    Require Founder approval before completion
                  </label>
                </div>
              </form>

              {/* 4-Column Execution Board */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {TICKET_COLUMNS.map((col) => {
                  const colTickets = snapshot.tickets.filter((t) =>
                    col.id === 'queued'
                      ? t.status === 'queued' || t.status === 'backlog'
                      : t.status === col.id
                  )
                  return (
                    <div
                      key={col.id}
                      className="flex flex-col rounded-lg border border-border bg-card/60 p-2.5"
                    >
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-foreground">{col.label}</span>
                        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                          {colTickets.length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {colTickets.length === 0 ? (
                          <div className="rounded border border-dashed border-border/70 py-5 text-center text-[11px] text-muted-foreground">
                            Empty
                          </div>
                        ) : (
                          colTickets.map((t) => (
                            <div
                              key={t.id}
                              className="rounded-md border border-border bg-background p-2.5"
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {t.key} · {t.department ?? 'Executive'}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Delete ${t.key}`}
                                  onClick={() =>
                                    void dispatchAction(
                                      { action: 'delete_ticket', id: t.id },
                                      `Deleted ${t.key}`
                                    )
                                  }
                                  className="text-muted-foreground/70 hover:text-destructive"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="mt-1 text-xs font-medium leading-snug text-foreground">
                                {t.title}
                              </div>
                              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                                {t.assigneeName}
                                {t.productName ? ` · ${t.productName}` : ''}
                              </div>
                              {t.outputSummary && (
                                <p className="mt-2 line-clamp-3 rounded bg-muted/40 p-1.5 text-[11px] text-muted-foreground">
                                  {t.outputSummary}
                                </p>
                              )}
                              {t.status === 'needs_approval' && (
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void dispatchAction(
                                      { action: 'approve_ticket', id: t.id, approver: 'Founder' },
                                      `Approved ${t.key}`
                                    )
                                  }
                                  className="mt-2 h-6 w-full text-[11px]"
                                >
                                  Approve Deliverable
                                </Button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ===================== TAB 5: HEARTBEATS & BUDGETS ===================== */}
          {hqTab === 'heartbeats' && (
            <div className="space-y-4">
              {/* Company Charter & Budget Cap Editor */}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void dispatchAction(
                    {
                      action: 'update_company',
                      companyName: editName.trim(),
                      industry: editIndustry.trim(),
                      mission: editMission.trim(),
                      monthlyBudgetUsd: Number(editBudget) || 0,
                    },
                    'Company settings updated'
                  )
                }}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Company Operating Settings &amp; Spend Ceiling
                  </h2>
                  {snapshot.companies.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void dispatchAction(
                          { action: 'delete_company', companyId: snapshot.activeCompanyId },
                          `Deleted ${snapshot.company.companyName}`
                        )
                      }
                      className="h-7 text-xs text-destructive hover:text-destructive"
                    >
                      Delete Company
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="set-name" className="text-xs">
                      Company Name
                    </Label>
                    <Input
                      id="set-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="set-ind" className="text-xs">
                      Industry
                    </Label>
                    <Input
                      id="set-ind"
                      value={editIndustry}
                      onChange={(e) => setEditIndustry(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="set-cap" className="text-xs">
                      Monthly Budget Cap (USD)
                    </Label>
                    <Input
                      id="set-cap"
                      type="number"
                      min={0}
                      step={10}
                      value={editBudget}
                      onChange={(e) => setEditBudget(e.target.value)}
                      className="h-8 font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="set-mission" className="text-xs">
                    Mission Statement
                  </Label>
                  <Textarea
                    id="set-mission"
                    rows={2}
                    value={editMission}
                    onChange={(e) => setEditMission(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={busy} className="h-8 text-xs">
                    Save Company Profile
                  </Button>
                </div>
              </form>

              <PaperclipHeartbeatsBudgets
                snapshot={legacySnapshotForHeartbeats}
                employees={companyEmployees}
                busy={busy}
                onAction={async (payload, successMsg) => {
                  await dispatchAction(payload, successMsg)
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <NewCompanyDialog
        open={newCompanyModalOpen}
        onOpenChange={setNewCompanyModalOpen}
        busy={busy}
        onCreate={(payload) => dispatchAction(payload, 'New company workspace created')}
      />

      <AttachProductDialog
        open={attachOpen}
        onOpenChange={setAttachOpen}
        companyName={snapshot.company.companyName}
        busy={busy}
        onAttach={(payload) =>
          dispatchAction(payload, 'Product attached to company & ready for Eva CEO')
        }
      />
    </div>
  )
}
