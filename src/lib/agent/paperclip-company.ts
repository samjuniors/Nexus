import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { db } from '@/lib/db'
import { chatText } from '@/lib/agent/zai'
import {
  BUSINESS_DEPARTMENT_BLUEPRINTS,
  CORE_BUSINESS_DEPARTMENTS,
  type CompanyDepartment,
  type CompanyHqSnapshotDTO,
  type CompanyProduct,
  type CompanyRecord,
  type CompanyRegistryState,
  type CompanyStage,
  type CompanySummaryDTO,
  type DepartmentRoleBlueprint,
  type ExecutiveBriefing,
  type HeartbeatRun,
  type HiringProposal,
  type PaperclipAgentConfig,
  type PaperclipCompanyState,
  type PaperclipTicket,
  type ProductKind,
  type ProductSource,
  type ProductStage,
  type SpendApprovalRequest,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/agent/company-types'

export type {
  CompanyDepartment,
  CompanyHqSnapshotDTO,
  CompanyProduct,
  CompanyRecord,
  CompanyRegistryState,
  CompanyStage,
  CompanySummaryDTO,
  ExecutiveBriefing,
  HeartbeatRun,
  HiringProposal,
  PaperclipAgentConfig,
  PaperclipCompanyState,
  PaperclipTicket,
  ProductKind,
  ProductSource,
  ProductStage,
  SpendApprovalRequest,
  TicketPriority,
  TicketStatus,
}

const STORE_FILE = path.join(process.cwd(), '.nexus-company.json')
const COST_PER_1K_TOKENS_USD = 0.00045

function makeSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'company'
  )
}

function makeTicketPrefix(name: string): string {
  const letters = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
  if (letters.length >= 2) return letters.slice(0, 4)
  const fallback = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3)
  return fallback || 'CMP'
}

function createDefaultCompany(overrides?: Partial<CompanyRecord>): CompanyRecord {
  const now = new Date().toISOString()
  const name = overrides?.companyName?.trim() || 'Nexus Autonomous Company'
  const id = overrides?.id || 'cmp_default'
  return {
    id,
    slug: overrides?.slug || makeSlug(name),
    companyName: name,
    industry: overrides?.industry || 'AI & Software Ventures',
    stage: overrides?.stage || 'early',
    mission:
      overrides?.mission ||
      'Operate a founder-led AI company where Eva serves as CEO running Sales, Marketing, Hiring, Product, Customer Support, and Finance under Founder governance.',
    monthlyBudgetUsd: overrides?.monthlyBudgetUsd ?? 250,
    autoHireEnabled: overrides?.autoHireEnabled ?? true,
    founderApprovalRequired: overrides?.founderApprovalRequired ?? true,
    ticketSeq: overrides?.ticketSeq ?? 3,
    ticketPrefix: overrides?.ticketPrefix || 'NEX',
    agentConfigs: overrides?.agentConfigs ?? {},
    employeeIds: overrides?.employeeIds ?? [],
    products: overrides?.products ?? [],
    hiringProposals: overrides?.hiringProposals ?? [],
    spendRequests: overrides?.spendRequests ?? [],
    briefings: overrides?.briefings ?? [],
    tickets: overrides?.tickets ?? [
      {
        id: 'tkt_seed_1',
        key: 'NEX-1',
        companyId: id,
        productId: null,
        productName: null,
        department: 'Executive',
        goalLink: 'Company Operating Readiness',
        title: 'Define flagship product brief & initial Q2 growth objectives',
        description:
          'Attach your first product or project under Company HQ so Eva CEO can propose department staffing and launch autonomous workstreams.',
        status: 'queued',
        priority: 'high',
        assigneeId: null,
        assigneeName: 'Eva (CEO)',
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
        companyId: id,
        productId: null,
        productName: null,
        department: 'Finance & Ops',
        goalLink: 'Budget Governance',
        title: 'Review monthly AI department budget allocation & spend guardrails',
        description:
          'Confirm monthly USD caps across Sales, Marketing, Hiring, Product, Support, and Finance before activating autonomous cycles.',
        status: 'backlog',
        priority: 'medium',
        assigneeId: null,
        assigneeName: 'Eva (CEO)',
        requiresApproval: true,
        approvalReason: 'Requires Founder approval for department budget ceiling',
        estimatedSpendUsd: 0,
        approvedBy: null,
        approvedAt: null,
        tokensSpent: 0,
        costUsd: 0,
        outputSummary: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    heartbeats: overrides?.heartbeats ?? [],
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  }
}

function defaultRegistry(): CompanyRegistryState {
  const now = new Date().toISOString()
  const primary = createDefaultCompany()
  return {
    version: 2,
    activeCompanyId: primary.id,
    activeProductId: null,
    companies: [primary],
    updatedAt: now,
  }
}

function migrateToRegistry(rawParsed: unknown): CompanyRegistryState {
  const parsed = rawParsed as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return defaultRegistry()
  }

  // Already v2 multi-company registry
  if (parsed.version === 2 && Array.isArray(parsed.companies) && parsed.companies.length > 0) {
    const companies = (parsed.companies as Partial<CompanyRecord>[]).map((c, idx) =>
      createDefaultCompany({
        ...c,
        id: typeof c.id === 'string' && c.id ? c.id : `cmp_${idx + 1}`,
        companyName: typeof c.companyName === 'string' && c.companyName ? c.companyName : 'Untitled Company',
        ticketPrefix:
          typeof c.ticketPrefix === 'string' && c.ticketPrefix
            ? c.ticketPrefix
            : makeTicketPrefix(typeof c.companyName === 'string' ? c.companyName : 'CMP'),
        agentConfigs: c.agentConfigs ?? {},
        tickets: Array.isArray(c.tickets) ? c.tickets : [],
        heartbeats: Array.isArray(c.heartbeats) ? c.heartbeats : [],
        products: Array.isArray(c.products) ? c.products : [],
        hiringProposals: Array.isArray(c.hiringProposals) ? c.hiringProposals : [],
        spendRequests: Array.isArray(c.spendRequests) ? c.spendRequests : [],
        briefings: Array.isArray(c.briefings) ? c.briefings : [],
        employeeIds: Array.isArray(c.employeeIds) ? c.employeeIds : [],
      })
    )
    const activeCompanyId =
      typeof parsed.activeCompanyId === 'string' &&
      companies.some((c) => c.id === parsed.activeCompanyId)
        ? parsed.activeCompanyId
        : companies[0].id
    const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? companies[0]
    const activeProductId =
      typeof parsed.activeProductId === 'string' &&
      activeCompany.products.some((p) => p.id === parsed.activeProductId)
        ? parsed.activeProductId
        : null

    return {
      version: 2,
      activeCompanyId,
      activeProductId,
      companies,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  }

  // Legacy v1 flat PaperclipCompanyState -> migrate cleanly into Company #1
  const v1 = parsed as Partial<PaperclipCompanyState>
  const migrated = createDefaultCompany({
    id: 'cmp_default',
    companyName: v1.companyName || 'Nexus Autonomous Company',
    mission: v1.mission,
    monthlyBudgetUsd: v1.monthlyBudgetUsd ?? 250,
    autoHireEnabled: v1.autoHireEnabled ?? true,
    ticketSeq: v1.ticketSeq ?? 3,
    ticketPrefix: 'NEX',
    agentConfigs: v1.agentConfigs ?? {},
    tickets: Array.isArray(v1.tickets)
      ? v1.tickets.map((t) => ({ ...t, companyId: t.companyId ?? 'cmp_default' }))
      : undefined,
    heartbeats: Array.isArray(v1.heartbeats)
      ? v1.heartbeats.map((h) => ({ ...h, companyId: h.companyId ?? 'cmp_default' }))
      : [],
    updatedAt: v1.updatedAt ?? new Date().toISOString(),
  })

  return {
    version: 2,
    activeCompanyId: migrated.id,
    activeProductId: null,
    companies: [migrated],
    updatedAt: new Date().toISOString(),
  }
}

const globalCompany = globalThis as unknown as {
  __nexusCompanyRegistry?: CompanyRegistryState
}

export function loadCompanyRegistry(): CompanyRegistryState {
  if (globalCompany.__nexusCompanyRegistry) {
    return globalCompany.__nexusCompanyRegistry
  }
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8')
      const registry = migrateToRegistry(JSON.parse(raw))
      globalCompany.__nexusCompanyRegistry = registry
      return registry
    }
  } catch {
    /* fallback to default in-memory state */
  }
  const fresh = defaultRegistry()
  globalCompany.__nexusCompanyRegistry = fresh
  return fresh
}

export function saveCompanyRegistry(registry: CompanyRegistryState): void {
  registry.updatedAt = new Date().toISOString()
  globalCompany.__nexusCompanyRegistry = registry
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(registry, null, 2), 'utf8')
  } catch {
    /* sandboxed fs fallback — memory state remains authoritative */
  }
}

export function getCompanyRecord(companyId?: string): CompanyRecord {
  const registry = loadCompanyRegistry()
  if (companyId) {
    const found = registry.companies.find((c) => c.id === companyId)
    if (found) return found
  }
  const active = registry.companies.find((c) => c.id === registry.activeCompanyId)
  return active ?? registry.companies[0]
}

/** Backward-compatible accessor returning the active CompanyRecord (extends PaperclipCompanyState) */
export function loadCompanyState(): CompanyRecord {
  return getCompanyRecord()
}

/** Backward-compatible saver writing active CompanyRecord back into the registry */
export function saveCompanyState(state: PaperclipCompanyState): void {
  const registry = loadCompanyRegistry()
  const idx = registry.companies.findIndex((c) => c.id === registry.activeCompanyId)
  const targetIdx = idx === -1 ? 0 : idx
  const existing = registry.companies[targetIdx]
  registry.companies[targetIdx] = {
    ...existing,
    ...state,
    updatedAt: new Date().toISOString(),
  }
  saveCompanyRegistry(registry)
}

export function setActiveCompanyContext(
  companyId: string,
  productId?: string | null
): CompanyRecord {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId)
  if (!company) {
    throw new Error('Company not found')
  }
  registry.activeCompanyId = company.id
  if (productId !== undefined) {
    registry.activeProductId =
      productId && company.products.some((p) => p.id === productId) ? productId : null
  } else if (
    registry.activeProductId &&
    !company.products.some((p) => p.id === registry.activeProductId)
  ) {
    registry.activeProductId = null
  }
  saveCompanyRegistry(registry)
  return company
}

export function createCompany(input: {
  companyName: string
  industry?: string
  stage?: CompanyStage
  mission?: string
  monthlyBudgetUsd?: number
  founderApprovalRequired?: boolean
}): CompanyRecord {
  const registry = loadCompanyRegistry()
  const name = input.companyName.trim().slice(0, 80)
  if (!name) throw new Error('Company name is required')

  const now = new Date().toISOString()
  const id = `cmp_${randomUUID().slice(0, 8)}`
  const prefix = makeTicketPrefix(name)

  const record = createDefaultCompany({
    id,
    slug: `${makeSlug(name)}-${id.slice(-4)}`,
    companyName: name,
    industry: input.industry?.trim().slice(0, 80) || 'General Business',
    stage: input.stage ?? 'early',
    mission:
      input.mission?.trim().slice(0, 600) ||
      `Build and scale ${name} with Eva as CEO coordinating Sales, Marketing, Hiring, Product, Customer Support, and Finance under Founder approvals.`,
    monthlyBudgetUsd: Math.max(0, Number(input.monthlyBudgetUsd ?? 250) || 250),
    founderApprovalRequired: input.founderApprovalRequired ?? true,
    ticketSeq: 1,
    ticketPrefix: prefix,
    tickets: [
      {
        id: `tkt_${randomUUID().slice(0, 8)}`,
        key: `${prefix}-1`,
        companyId: id,
        productId: null,
        productName: null,
        department: 'Executive',
        goalLink: `${name} Launch Charter`,
        title: `Attach first product or project for ${name} and kick off Eva CEO staffing plan`,
        description:
          'Provide a business brief, website URL, documents, or repository so Eva CEO can decompose workstreams across departments.',
        status: 'queued',
        priority: 'high',
        assigneeId: null,
        assigneeName: 'Eva (CEO)',
        requiresApproval: false,
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
    products: [],
    hiringProposals: [],
    spendRequests: [],
    briefings: [],
    employeeIds: [],
    createdAt: now,
    updatedAt: now,
  })

  registry.companies.push(record)
  registry.activeCompanyId = record.id
  registry.activeProductId = null
  saveCompanyRegistry(registry)
  return record
}

export function deleteCompany(companyId: string): boolean {
  const registry = loadCompanyRegistry()
  if (registry.companies.length <= 1) {
    throw new Error('Cannot delete the only remaining company')
  }
  const before = registry.companies.length
  registry.companies = registry.companies.filter((c) => c.id !== companyId)
  if (registry.companies.length === before) return false
  if (registry.activeCompanyId === companyId) {
    registry.activeCompanyId = registry.companies[0].id
    registry.activeProductId = null
  }
  saveCompanyRegistry(registry)
  return true
}

export function attachProductToCompany(
  companyId: string,
  input: {
    name: string
    tagline?: string
    kind?: ProductKind
    stage?: ProductStage
    brief?: string
    targetAudience?: string
    goals?: string[]
    sources?: ProductSource[]
  }
): CompanyProduct {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId)
  if (!company) throw new Error('Company not found')

  const name = input.name.trim().slice(0, 90)
  if (!name) throw new Error('Product or project name is required')

  const now = new Date().toISOString()
  const sources: ProductSource[] = [...(input.sources ?? [])]
  const cleanBrief = (input.brief ?? '').trim().slice(0, 6_000)

  if (cleanBrief && !sources.some((s) => s.type === 'brief')) {
    sources.unshift({
      id: `src_${randomUUID().slice(0, 8)}`,
      type: 'brief',
      label: `${name} Business Brief`,
      uriOrPath: 'Founder Brief',
      summary: cleanBrief.slice(0, 400),
      content: cleanBrief,
      status: 'ready',
      ingestedAt: now,
    })
  }

  const product: CompanyProduct = {
    id: `prd_${randomUUID().slice(0, 8)}`,
    companyId: company.id,
    name,
    tagline: (input.tagline ?? '').trim().slice(0, 160),
    kind: input.kind ?? 'product',
    stage: input.stage ?? 'building',
    brief: cleanBrief,
    targetAudience: (input.targetAudience ?? '').trim().slice(0, 300),
    goals: (input.goals ?? [])
      .map((g) => g.trim().slice(0, 180))
      .filter(Boolean)
      .slice(0, 10),
    sources,
    createdAt: now,
    updatedAt: now,
  }

  company.products.unshift(product)
  company.updatedAt = now
  registry.activeProductId = product.id
  saveCompanyRegistry(registry)
  return product
}

export function addSourceToProduct(
  companyId: string,
  productId: string,
  source: ProductSource
): CompanyProduct {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId)
  if (!company) throw new Error('Company not found')
  const product = company.products.find((p) => p.id === productId)
  if (!product) throw new Error('Product not found')

  product.sources.unshift(source)
  product.updatedAt = new Date().toISOString()
  company.updatedAt = product.updatedAt
  saveCompanyRegistry(registry)
  return product
}

export function removeSourceFromProduct(
  companyId: string,
  productId: string,
  sourceId: string
): CompanyProduct {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId)
  if (!company) throw new Error('Company not found')
  const product = company.products.find((p) => p.id === productId)
  if (!product) throw new Error('Product not found')

  product.sources = product.sources.filter((s) => s.id !== sourceId)
  product.updatedAt = new Date().toISOString()
  company.updatedAt = product.updatedAt
  saveCompanyRegistry(registry)
  return product
}

export function deleteProductFromCompany(companyId: string, productId: string): boolean {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId)
  if (!company) return false
  const before = company.products.length
  company.products = company.products.filter((p) => p.id !== productId)
  if (company.products.length === before) return false
  if (registry.activeProductId === productId) {
    registry.activeProductId = null
  }
  company.updatedAt = new Date().toISOString()
  saveCompanyRegistry(registry)
  return true
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

function getScopedEmployees<T extends { id: string }>(company: CompanyRecord, allEmployees: T[], isPrimaryCompany: boolean): T[] {
  if (company.employeeIds.length === 0) {
    // Primary company inherits existing org employees automatically for seamless migration
    return isPrimaryCompany ? allEmployees : []
  }
  const set = new Set(company.employeeIds)
  return allEmployees.filter((e) => set.has(e.id))
}

function countPendingApprovals(company: CompanyRecord): {
  pendingHires: number
  pendingSpendRequests: number
  approvalTickets: number
  total: number
} {
  const pendingHires = company.hiringProposals.filter((p) => p.status === 'pending').length
  const pendingSpendRequests = company.spendRequests.filter((r) => r.status === 'pending').length
  const approvalTickets = company.tickets.filter((t) => t.status === 'needs_approval').length
  return {
    pendingHires,
    pendingSpendRequests,
    approvalTickets,
    total: pendingHires + pendingSpendRequests + approvalTickets,
  }
}

export async function getCompanySnapshot(options?: {
  companyId?: string
  productId?: string | null
}): Promise<CompanyHqSnapshotDTO> {
  const registry = loadCompanyRegistry()
  const activeCompany = options?.companyId
    ? registry.companies.find((c) => c.id === options.companyId) ?? getCompanyRecord()
    : getCompanyRecord()

  const activeProductId =
    options?.productId !== undefined
      ? options.productId && activeCompany.products.some((p) => p.id === options.productId)
        ? options.productId
        : null
      : registry.activeProductId && activeCompany.products.some((p) => p.id === registry.activeProductId)
        ? registry.activeProductId
        : null

  const allEmployees = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })
  const isPrimaryCompany = activeCompany.id === registry.companies[0]?.id
  const employees = getScopedEmployees(activeCompany, allEmployees, isPrimaryCompany)

  let mutated = false
  for (const emp of employees) {
    if (!activeCompany.agentConfigs[emp.id]) {
      ensureAgentConfig(activeCompany, emp.id)
      mutated = true
    }
  }
  if (mutated) saveCompanyRegistry(registry)

  const scopedTickets = activeProductId
    ? activeCompany.tickets.filter((t) => t.productId === activeProductId)
    : activeCompany.tickets

  const totalSpentUsd = Object.values(activeCompany.agentConfigs).reduce((sum, c) => sum + c.spentUsd, 0)
  const totalTokens = Object.values(activeCompany.agentConfigs).reduce((sum, c) => sum + c.tokensUsed, 0)
  const openTickets = scopedTickets.filter((t) => t.status !== 'done').length
  const approvals = countPendingApprovals(activeCompany)

  const companiesSummary: CompanySummaryDTO[] = registry.companies.map((c) => {
    const spent = Object.values(c.agentConfigs).reduce((s, cfg) => s + cfg.spentUsd, 0)
    const pending = countPendingApprovals(c)
    return {
      id: c.id,
      slug: c.slug,
      name: c.companyName,
      industry: c.industry,
      stage: c.stage,
      mission: c.mission,
      monthlyBudgetUsd: c.monthlyBudgetUsd,
      spentUsd: Number(spent.toFixed(4)),
      productCount: c.products.length,
      pendingApprovalsCount: pending.total,
      products: c.products.map((p) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        kind: p.kind,
      })),
    }
  })

  const departments = CORE_BUSINESS_DEPARTMENTS.map((deptName) => {
    const deptLower = deptName.toLowerCase()
    const headcount = employees.filter((e) => {
      const empDept = e.department.toLowerCase()
      if (empDept === deptLower) return true
      if (deptName === 'Product & Development' && (empDept === 'engineering' || empDept === 'product' || empDept === 'qa')) {
        return true
      }
      if (deptName === 'Finance & Ops' && (empDept === 'operations' || empDept === 'finance')) {
        return true
      }
      return false
    }).length

    const deptOpenTickets = scopedTickets.filter(
      (t) => t.status !== 'done' && (t.department ?? '').toLowerCase() === deptLower
    ).length

    const pendingProposals = activeCompany.hiringProposals.filter(
      (p) => p.status === 'pending' && p.department.toLowerCase() === deptLower
    ).length

    return {
      name: deptName,
      headcount,
      openTickets: deptOpenTickets,
      pendingProposals,
    }
  })

  return {
    company: {
      id: activeCompany.id,
      slug: activeCompany.slug,
      companyName: activeCompany.companyName,
      industry: activeCompany.industry,
      stage: activeCompany.stage,
      mission: activeCompany.mission,
      monthlyBudgetUsd: activeCompany.monthlyBudgetUsd,
      autoHireEnabled: activeCompany.autoHireEnabled,
      founderApprovalRequired: activeCompany.founderApprovalRequired,
      updatedAt: activeCompany.updatedAt,
    },
    activeCompanyId: activeCompany.id,
    activeProductId,
    companies: companiesSummary,
    products: activeCompany.products,
    hiringProposals: activeCompany.hiringProposals,
    spendRequests: activeCompany.spendRequests,
    briefings: activeCompany.briefings.slice(0, 10),
    departments,
    metrics: {
      totalSpentUsd: Number(totalSpentUsd.toFixed(4)),
      monthlyBudgetUsd: activeCompany.monthlyBudgetUsd,
      budgetUtilizationPct:
        activeCompany.monthlyBudgetUsd > 0
          ? Math.min(100, Math.round((totalSpentUsd / activeCompany.monthlyBudgetUsd) * 100))
          : 0,
      totalTokens,
      openTickets,
      approvalPending: approvals.approvalTickets,
      pendingHires: approvals.pendingHires,
      pendingSpendRequests: approvals.pendingSpendRequests,
      totalFounderApprovals: approvals.total,
      totalHeartbeats: activeCompany.heartbeats.length,
      activeAgents: employees.filter((e) => e.status === 'active').length,
      byoaAgents: Object.values(activeCompany.agentConfigs).filter((c) => Boolean(c.byoaWebhookUrl)).length,
      productCount: activeCompany.products.length,
    },
    agentConfigs: activeCompany.agentConfigs,
    tickets: scopedTickets,
    heartbeats: activeCompany.heartbeats.slice(0, 40),
    employees,
  }
}

export function createCompanyTicket(input: {
  companyId?: string
  productId?: string | null
  productName?: string | null
  department?: string
  goalLink?: string | null
  title: string
  description?: string
  priority?: TicketPriority
  assigneeId?: string | null
  assigneeName?: string
  requiresApproval?: boolean
  approvalReason?: string | null
  estimatedSpendUsd?: number
  status?: TicketStatus
}): PaperclipTicket {
  const registry = loadCompanyRegistry()
  const company = input.companyId
    ? registry.companies.find((c) => c.id === input.companyId) ?? getCompanyRecord()
    : getCompanyRecord()

  company.ticketSeq += 1
  const now = new Date().toISOString()
  const linkedProduct = input.productId
    ? company.products.find((p) => p.id === input.productId) ?? null
    : null

  const ticket: PaperclipTicket = {
    id: `tkt_${Date.now().toString(36)}_${company.ticketSeq}`,
    key: `${company.ticketPrefix || 'NEX'}-${company.ticketSeq}`,
    companyId: company.id,
    productId: linkedProduct?.id ?? input.productId ?? null,
    productName: linkedProduct?.name ?? input.productName ?? null,
    department: input.department?.trim().slice(0, 48) || 'Executive',
    goalLink: input.goalLink?.trim().slice(0, 140) || null,
    title: input.title.trim().slice(0, 140),
    description: (input.description ?? '').trim().slice(0, 1600),
    status: input.status ?? 'queued',
    priority: input.priority ?? 'medium',
    assigneeId: input.assigneeId ?? null,
    assigneeName: input.assigneeName ?? 'Eva (CEO)',
    requiresApproval: Boolean(input.requiresApproval),
    approvalReason: input.approvalReason ?? null,
    estimatedSpendUsd: Math.max(0, Number(input.estimatedSpendUsd ?? 0) || 0),
    approvedBy: null,
    approvedAt: null,
    tokensSpent: 0,
    costUsd: 0,
    outputSummary: '',
    createdAt: now,
    updatedAt: now,
  }
  company.tickets.unshift(ticket)
  company.updatedAt = now
  saveCompanyRegistry(registry)
  return ticket
}

export function updateCompanyTicket(
  id: string,
  patch: Partial<
    Pick<
      PaperclipTicket,
      | 'title'
      | 'description'
      | 'status'
      | 'priority'
      | 'assigneeId'
      | 'assigneeName'
      | 'requiresApproval'
      | 'outputSummary'
      | 'department'
      | 'productId'
      | 'productName'
    >
  >,
  companyId?: string
): PaperclipTicket | null {
  const registry = loadCompanyRegistry()
  const company = companyId
    ? registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
    : getCompanyRecord()
  const idx = company.tickets.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const updated: PaperclipTicket = {
    ...company.tickets[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  company.tickets[idx] = updated
  saveCompanyRegistry(registry)
  return updated
}

export function approveCompanyTicket(
  id: string,
  approver = 'Founder',
  companyId?: string
): PaperclipTicket | null {
  const registry = loadCompanyRegistry()
  const company = companyId
    ? registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
    : getCompanyRecord()
  const idx = company.tickets.findIndex((t) => t.id === id)
  if (idx === -1) return null
  const current = company.tickets[idx]
  const nextStatus: TicketStatus = current.outputSummary ? 'done' : 'queued'
  const updated: PaperclipTicket = {
    ...current,
    status: nextStatus,
    approvedBy: approver,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  company.tickets[idx] = updated
  saveCompanyRegistry(registry)
  return updated
}

export function deleteCompanyTicket(id: string, companyId?: string): boolean {
  const registry = loadCompanyRegistry()
  const company = companyId
    ? registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
    : getCompanyRecord()
  const before = company.tickets.length
  company.tickets = company.tickets.filter((t) => t.id !== id)
  if (company.tickets.length !== before) {
    saveCompanyRegistry(registry)
    return true
  }
  return false
}

export function createHiringProposal(
  companyId: string,
  input: {
    productId?: string | null
    proposedBy?: string
    name: string
    title: string
    department: string
    kind?: 'employee' | 'bot' | 'subagent'
    role: string
    systemPrompt?: string
    skills?: string[]
    tools?: string[]
    monthlyBudgetUsd?: number
    rationale: string
  }
): HiringProposal {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const now = new Date().toISOString()

  const proposal: HiringProposal = {
    id: `hire_${randomUUID().slice(0, 8)}`,
    companyId: company.id,
    productId: input.productId ?? null,
    proposedBy: input.proposedBy || 'Eva (CEO)',
    name: input.name.trim().slice(0, 60),
    title: input.title.trim().slice(0, 80),
    department: input.department.trim().slice(0, 48) || 'Operations',
    kind: input.kind ?? 'employee',
    role: input.role.trim().slice(0, 400),
    systemPrompt:
      input.systemPrompt?.trim().slice(0, 1400) ||
      `You are ${input.name}, ${input.title} in ${input.department} at ${company.companyName}, reporting to Eva CEO.`,
    skills: input.skills ?? [],
    tools: input.tools ?? [],
    monthlyBudgetUsd: Math.max(5, Math.min(5000, Number(input.monthlyBudgetUsd ?? 30) || 30)),
    rationale: input.rationale.trim().slice(0, 500),
    status: 'pending',
    founderNote: null,
    createdAt: now,
    decidedAt: null,
    createdEmployeeId: null,
  }

  company.hiringProposals.unshift(proposal)
  company.updatedAt = now
  saveCompanyRegistry(registry)
  return proposal
}

/**
 * Founder Governance Decision on a Hiring Proposal:
 * Approving provisions the real AI Employee in Prisma, attaches them to the company,
 * sets their budget/heartbeat config, and assigns any unassigned queued tickets for their department.
 */
export async function decideHiringProposal(
  companyId: string,
  proposalId: string,
  input: {
    decision: 'approve' | 'reject'
    adjustedBudgetUsd?: number
    founderNote?: string
  }
): Promise<{
  proposal: HiringProposal
  employee: { id: string; name: string; title: string; department: string } | null
}> {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const proposal = company.hiringProposals.find((p) => p.id === proposalId)
  if (!proposal) throw new Error('Hiring proposal not found')
  if (proposal.status !== 'pending') {
    throw new Error(`Proposal has already been ${proposal.status}`)
  }

  const now = new Date().toISOString()
  proposal.founderNote = input.founderNote?.trim().slice(0, 300) || null
  proposal.decidedAt = now

  if (input.decision === 'reject') {
    proposal.status = 'rejected'
    company.updatedAt = now
    saveCompanyRegistry(registry)
    return { proposal, employee: null }
  }

  if (input.adjustedBudgetUsd !== undefined && Number.isFinite(Number(input.adjustedBudgetUsd))) {
    proposal.monthlyBudgetUsd = Math.max(0, Number(input.adjustedBudgetUsd))
  }

  const empSlugBase =
    proposal.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'ai-employee'

  const created = await db.aiEmployee.create({
    data: {
      slug: `${empSlugBase}-${randomUUID().slice(0, 8)}`,
      name: proposal.name,
      title: proposal.title,
      department: proposal.department,
      kind: proposal.kind,
      role: proposal.role,
      systemPrompt: proposal.systemPrompt,
      skillsJson: JSON.stringify(proposal.skills),
      toolsJson: JSON.stringify(proposal.tools),
      status: 'active',
      autonomy: 'autonomous',
      icon: proposal.kind === 'bot' ? 'bot' : 'users',
    },
  })

  if (!company.employeeIds.includes(created.id)) {
    company.employeeIds.push(created.id)
  }

  ensureAgentConfig(company, created.id, {
    monthlyBudgetUsd: proposal.monthlyBudgetUsd,
    heartbeatIntervalMin: proposal.kind === 'bot' ? 15 : 30,
    heartbeatEnabled: true,
    autoThrottle: true,
  })

  // Assign unassigned queued tickets in this department (and optional product) to the new hire
  for (const ticket of company.tickets) {
    const deptMatches =
      (ticket.department ?? '').toLowerCase() === proposal.department.toLowerCase()
    const productMatches = !proposal.productId || ticket.productId === proposal.productId
    if (!ticket.assigneeId && ticket.status === 'queued' && deptMatches && productMatches) {
      ticket.assigneeId = created.id
      ticket.assigneeName = created.name
      ticket.updatedAt = now
    }
  }

  proposal.status = 'approved'
  proposal.createdEmployeeId = created.id
  company.updatedAt = now
  saveCompanyRegistry(registry)

  return {
    proposal,
    employee: {
      id: created.id,
      name: created.name,
      title: created.title,
      department: created.department,
    },
  }
}

export function createSpendRequest(
  companyId: string,
  input: {
    productId?: string | null
    requestedBy?: string
    title: string
    category: SpendApprovalRequest['category']
    amountUsd: number
    rationale: string
  }
): SpendApprovalRequest {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const now = new Date().toISOString()

  const req: SpendApprovalRequest = {
    id: `spd_${randomUUID().slice(0, 8)}`,
    companyId: company.id,
    productId: input.productId ?? null,
    requestedBy: input.requestedBy || 'Eva (CEO)',
    title: input.title.trim().slice(0, 120),
    category: input.category,
    amountUsd: Math.max(0, Number(input.amountUsd) || 0),
    rationale: input.rationale.trim().slice(0, 500),
    status: 'pending',
    founderNote: null,
    createdAt: now,
    decidedAt: null,
  }

  company.spendRequests.unshift(req)
  company.updatedAt = now
  saveCompanyRegistry(registry)
  return req
}

export function decideSpendRequest(
  companyId: string,
  requestId: string,
  input: {
    decision: 'approve' | 'reject'
    founderNote?: string
  }
): SpendApprovalRequest {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const req = company.spendRequests.find((r) => r.id === requestId)
  if (!req) throw new Error('Spend approval request not found')
  if (req.status !== 'pending') {
    throw new Error(`Spend request has already been ${req.status}`)
  }

  const now = new Date().toISOString()
  req.status = input.decision === 'approve' ? 'approved' : 'rejected'
  req.founderNote = input.founderNote?.trim().slice(0, 300) || null
  req.decidedAt = now

  if (input.decision === 'approve' && req.category === 'budget_increase') {
    company.monthlyBudgetUsd = Number((company.monthlyBudgetUsd + req.amountUsd).toFixed(2))
  }

  company.updatedAt = now
  saveCompanyRegistry(registry)
  return req
}

/**
 * Eva CEO Strategic Planning & Staffing Flow (Founder Governance Compliant):
 * Analyzes an attached Product/Project and goal, creates concrete multi-department
 * tickets (Sales, Marketing, Hiring & HR, Product & Development, Customer Support, Finance & Ops),
 * and queues Hiring Proposals for any unstaffed departments into the Founder Approval Queue.
 */
export async function proposeDepartmentPlanAndHires(
  companyId: string,
  input: {
    productId?: string | null
    goal?: string
    departments?: CompanyDepartment[]
    maxProposals?: number
  }
): Promise<{
  proposalsCreated: HiringProposal[]
  ticketsCreated: PaperclipTicket[]
  spendRequestCreated: SpendApprovalRequest | null
  matchedEmployees: { id: string; name: string; department: string }[]
}> {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const product = input.productId
    ? company.products.find((p) => p.id === input.productId) ?? null
    : null

  const goalText =
    input.goal?.trim() ||
    (product
      ? `Launch and operate ${product.name}: ${product.tagline || product.brief.slice(0, 180) || 'execute cross-department company plan'}`
      : `Execute core company operations for ${company.companyName}`)

  const allEmployees = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })
  const isPrimaryCompany = company.id === registry.companies[0]?.id
  const companyEmployees = getScopedEmployees(company, allEmployees, isPrimaryCompany)

  let selectedBlueprints: DepartmentRoleBlueprint[]
  if (input.departments && input.departments.length > 0) {
    const wanted = new Set(input.departments.map((d) => d.toLowerCase()))
    selectedBlueprints = BUSINESS_DEPARTMENT_BLUEPRINTS.filter((bp) =>
      wanted.has(bp.department.toLowerCase())
    )
  } else {
    const matched = BUSINESS_DEPARTMENT_BLUEPRINTS.filter((bp) => bp.keywords.test(goalText))
    // For a real company product launch, ensure cross-functional business coverage (Marketing, Sales, Product, Support, Finance)
    selectedBlueprints =
      matched.length >= 2
        ? matched
        : [
            BUSINESS_DEPARTMENT_BLUEPRINTS.find((b) => b.key === 'marketing')!,
            BUSINESS_DEPARTMENT_BLUEPRINTS.find((b) => b.key === 'sales')!,
            BUSINESS_DEPARTMENT_BLUEPRINTS.find((b) => b.key === 'product_dev')!,
            BUSINESS_DEPARTMENT_BLUEPRINTS.find((b) => b.key === 'support')!,
            BUSINESS_DEPARTMENT_BLUEPRINTS.find((b) => b.key === 'finance_ops')!,
          ]
  }

  const maxProposals = Math.max(1, Math.min(6, input.maxProposals ?? 4))
  const proposalsCreated: HiringProposal[] = []
  const ticketsCreated: PaperclipTicket[] = []
  const matchedEmployees: { id: string; name: string; department: string }[] = []

  const productContextSnippet = product
    ? `Product: ${product.name}${product.tagline ? ` (${product.tagline})` : ''}. Sources attached: ${product.sources.length}.`
    : `Company: ${company.companyName} (${company.industry}).`

  const deptTaskTemplates: Record<string, { title: string; desc: string; priority: TicketPriority }> = {
    sales: {
      title: `Build ICP target list & 3-step outbound playbook${product ? ` for ${product.name}` : ''}`,
      desc: `Define ideal buyer persona, draft personalized outreach & follow-up messages, and list qualification criteria. ${productContextSnippet}`,
      priority: 'high',
    },
    marketing: {
      title: `Craft positioning, messaging hierarchy & launch campaign${product ? ` for ${product.name}` : ''}`,
      desc: `Synthesize attached product brief/website into crisp value proposition, hero copy, and 2-week distribution plan. ${productContextSnippet}`,
      priority: 'high',
    },
    hiring_hr: {
      title: `Audit department capacity & draft AI role charters${product ? ` for ${product.name}` : ''}`,
      desc: `Identify skill gaps across departments, refine job charters, and recommend next hires for Founder review. ${productContextSnippet}`,
      priority: 'medium',
    },
    product_dev: {
      title: `Create prioritized roadmap & acceptance criteria${product ? ` for ${product.name}` : ''}`,
      desc: `Translate product goals and attached docs/repo context into milestones, deliverable checklists, and QA gates. ${productContextSnippet}`,
      priority: 'high',
    },
    support: {
      title: `Prepare customer FAQ, onboarding guide & triage macros${product ? ` for ${product.name}` : ''}`,
      desc: `Anticipate top customer questions from product docs and publish clean response templates and escalation rules. ${productContextSnippet}`,
      priority: 'medium',
    },
    finance_ops: {
      title: `Build monthly budget forecast & unit-economics guardrail sheet${product ? ` for ${product.name}` : ''}`,
      desc: `Allocate monthly AI spend caps across active departments, estimate campaign/vendor costs, and flag approvals. ${productContextSnippet}`,
      priority: 'medium',
    },
  }

  for (const bp of selectedBlueprints) {
    const existingEmp = companyEmployees.find(
      (e) =>
        e.status === 'active' &&
        (e.department.toLowerCase() === bp.department.toLowerCase() ||
          e.name.toLowerCase() === bp.name.toLowerCase())
    )

    let assigneeId: string | null = null
    let assigneeName = 'Eva (CEO — Pending Hire)'

    if (existingEmp) {
      assigneeId = existingEmp.id
      assigneeName = existingEmp.name
      matchedEmployees.push({
        id: existingEmp.id,
        name: existingEmp.name,
        department: existingEmp.department,
      })
    } else if (proposalsCreated.length < maxProposals) {
      const alreadyPending = company.hiringProposals.some(
        (p) =>
          p.status === 'pending' &&
          p.department.toLowerCase() === bp.department.toLowerCase()
      )
      if (!alreadyPending) {
        const proposal = createHiringProposal(company.id, {
          productId: product?.id ?? null,
          proposedBy: 'Eva (CEO)',
          name: bp.name,
          title: bp.title,
          department: bp.department,
          kind: bp.kind,
          role: bp.role,
          systemPrompt: `${bp.systemPrompt}\n\nCompany: ${company.companyName}. Mission: ${company.mission}${product ? `\nActive Product: ${product.name} — ${product.brief.slice(0, 400)}` : ''}`,
          skills: bp.skills,
          tools: bp.tools,
          monthlyBudgetUsd: bp.budgetUsd,
          rationale: `Needed to own ${bp.department} execution for "${goalText.slice(0, 140)}". Auto-capped at $${bp.budgetUsd}/mo until Founder adjusts.`,
        })
        proposalsCreated.push(proposal)
      }
    }

    const tpl = deptTaskTemplates[bp.key] ?? {
      title: `[${bp.department}] ${goalText.slice(0, 90)}`,
      desc: `${goalText}. ${productContextSnippet}`,
      priority: 'medium' as TicketPriority,
    }

    const ticket = createCompanyTicket({
      companyId: company.id,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      department: bp.department,
      goalLink: product ? `${product.name} Launch` : goalText.slice(0, 80),
      title: tpl.title,
      description: tpl.desc,
      priority: tpl.priority,
      assigneeId,
      assigneeName,
      requiresApproval: bp.defaultTicketRequiresApproval,
      approvalReason: bp.defaultTicketRequiresApproval
        ? `${bp.department} output impacts company spend or headcount — Founder sign-off required`
        : null,
      status: 'queued',
    })
    ticketsCreated.push(ticket)
  }

  let spendRequestCreated: SpendApprovalRequest | null = null
  const wantsBudgetCheck = /\b(ads|campaign|launch|paid|sponsor|vendor|budget|scale)\b/i.test(goalText)
  if (wantsBudgetCheck) {
    const existingPendingSpend = company.spendRequests.some(
      (r) => r.status === 'pending' && r.productId === (product?.id ?? null)
    )
    if (!existingPendingSpend) {
      spendRequestCreated = createSpendRequest(company.id, {
        productId: product?.id ?? null,
        requestedBy: 'Eva (CEO)',
        title: `Initial launch & marketing test budget${product ? ` for ${product.name}` : ''}`,
        category: 'campaign_spend',
        amountUsd: 50,
        rationale: `Proposed starter validation budget for ${product?.name ?? company.companyName} outbound/campaign experiments. Paused pending Founder sign-off.`,
      })
    }
  }

  return {
    proposalsCreated,
    ticketsCreated,
    spendRequestCreated,
    matchedEmployees,
  }
}

export async function generateCeoExecutiveBriefing(
  companyId: string,
  productId?: string | null
): Promise<ExecutiveBriefing> {
  const registry = loadCompanyRegistry()
  const company = registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
  const product = productId
    ? company.products.find((p) => p.id === productId) ?? null
    : null
  const approvals = countPendingApprovals(company)
  const spent = Object.values(company.agentConfigs).reduce((s, c) => s + c.spentUsd, 0)
  const scopedTickets = product
    ? company.tickets.filter((t) => t.productId === product.id)
    : company.tickets
  const completedCount = scopedTickets.filter((t) => t.status === 'done').length
  const openCount = scopedTickets.filter((t) => t.status !== 'done').length

  const now = new Date().toISOString()
  let headline = `${company.companyName} — CEO Operations Brief`
  let summary = ''
  const highlights: string[] = [
    `${company.products.length} attached product(s), ${openCount} open task(s), ${completedCount} completed.`,
    `Monthly spend at $${spent.toFixed(2)} of $${company.monthlyBudgetUsd.toFixed(2)} cap.`,
  ]
  const blockers: string[] = []
  if (approvals.pendingHires > 0) {
    blockers.push(`${approvals.pendingHires} AI employee hiring proposal(s) awaiting Founder approval.`)
  }
  if (approvals.pendingSpendRequests > 0) {
    blockers.push(`${approvals.pendingSpendRequests} spend request(s) paused in Founder Approval Queue.`)
  }
  if (approvals.approvalTickets > 0) {
    blockers.push(`${approvals.approvalTickets} deliverable(s) waiting at the Founder approval gate.`)
  }
  const nextActions: string[] = [
    approvals.total > 0
      ? 'Review and decide pending items in the Founder Approval Queue to unlock department autonomy.'
      : 'Run a CEO & Department Heartbeat cycle to advance top-priority queued work.',
    company.products.length === 0
      ? 'Attach your first Product or Project (brief, website URL, docs, or repo) so Eva can staff departments.'
      : `Review deliverables for ${product?.name ?? company.products[0].name} across Sales, Marketing, and Product.`,
  ]

  try {
    const llmBrief = await chatText(
      [
        {
          role: 'system',
          content:
            'You are Eva, CEO of an autonomous AI company reporting concisely to the Founder (Boss). Write a crisp 3-sentence executive summary grounded ONLY in the provided facts. No fluff, no invented numbers.',
        },
        {
          role: 'user',
          content: [
            `Company: ${company.companyName} (${company.industry}, stage: ${company.stage})`,
            `Mission: ${company.mission}`,
            product ? `Focused Product: ${product.name} (${product.stage}) — ${product.tagline || product.brief.slice(0, 200)}` : `Products (${company.products.length}): ${company.products.map((p) => p.name).join(', ') || 'None attached yet'}`,
            `Spend: $${spent.toFixed(2)} / $${company.monthlyBudgetUsd.toFixed(2)}`,
            `Tickets: ${openCount} open, ${completedCount} completed`,
            `Pending Founder Approvals: ${approvals.pendingHires} hires, ${approvals.pendingSpendRequests} spend requests, ${approvals.approvalTickets} gated tickets`,
            `Recent Heartbeats: ${company.heartbeats.slice(0, 3).map((h) => `${h.agentName}: ${h.summary.slice(0, 80)}`).join(' | ') || 'None yet'}`,
          ].join('\n'),
        },
      ],
      { temperature: 0.25, maxTokens: 220 }
    )
    if (llmBrief.trim()) {
      summary = llmBrief.trim().slice(0, 700)
    }
  } catch {
    /* deterministic fallback below */
  }

  if (!summary) {
    summary = `${company.companyName} currently tracks ${company.products.length} product(s) with ${openCount} active workstream task(s) and $${spent.toFixed(2)} spent against the $${company.monthlyBudgetUsd.toFixed(2)} monthly budget. ${approvals.total > 0 ? `${approvals.total} governance decision(s) are waiting in your Founder Approval Queue.` : 'All governance queues are clear and departments are ready for autonomous heartbeat execution.'}`
  }

  if (product) {
    headline = `${product.name} — Eva CEO Briefing`
  }

  const briefing: ExecutiveBriefing = {
    id: `brf_${randomUUID().slice(0, 8)}`,
    companyId: company.id,
    productId: product?.id ?? null,
    headline,
    summary,
    highlights,
    blockers,
    nextActions,
    createdAt: now,
  }

  company.briefings.unshift(briefing)
  company.briefings = company.briefings.slice(0, 15)
  company.updatedAt = now
  saveCompanyRegistry(registry)
  return briefing
}

/**
 * Compact active Company & Product context string injected into Eva Chat & Mission Orchestrator
 * so Eva operates as an informed CEO for whichever company and product the Founder selected.
 */
export function getActiveCompanyPromptContext(): string {
  try {
    const registry = loadCompanyRegistry()
    const company = getCompanyRecord()
    const activeProduct = registry.activeProductId
      ? company.products.find((p) => p.id === registry.activeProductId) ?? null
      : null
    const approvals = countPendingApprovals(company)
    const spent = Object.values(company.agentConfigs).reduce((s, c) => s + c.spentUsd, 0)

    const lines: string[] = [
      `ACTIVE COMPANY CONTEXT (You are Eva, CEO reporting to the Founder/Boss):`,
      `- Company: ${company.companyName} (${company.industry} · ${company.stage})`,
      `- Mission: ${company.mission}`,
      `- Monthly Budget: $${spent.toFixed(2)} spent / $${company.monthlyBudgetUsd.toFixed(2)} cap · Governance: Autonomous execution, Founder approves hires & spend`,
      `- Pending Founder Approvals: ${approvals.pendingHires} hire proposal(s), ${approvals.pendingSpendRequests} spend request(s), ${approvals.approvalTickets} gated deliverable(s)`,
    ]

    if (activeProduct) {
      lines.push(
        `- Focused Product/Project: ${activeProduct.name} (${activeProduct.kind} · ${activeProduct.stage})${activeProduct.tagline ? ` — ${activeProduct.tagline}` : ''}`
      )
      if (activeProduct.targetAudience) {
        lines.push(`- Target Audience: ${activeProduct.targetAudience}`)
      }
      if (activeProduct.goals.length > 0) {
        lines.push(`- Product Goals: ${activeProduct.goals.join(' | ')}`)
      }
      if (activeProduct.sources.length > 0) {
        const srcSummary = activeProduct.sources
          .slice(0, 3)
          .map((s) => `[${s.type}: ${s.label}] ${s.summary.slice(0, 220)}`)
          .join('\n  ')
        lines.push(`- Attached Product Knowledge:\n  ${srcSummary}`)
      }
    } else if (company.products.length > 0) {
      lines.push(
        `- Attached Products (${company.products.length}): ${company.products.map((p) => `${p.name} (${p.stage})`).join(', ')}`
      )
    }

    return lines.join('\n')
  } catch {
    return ''
  }
}

export function updateAgentPaperclipConfig(
  agentId: string,
  patch: Partial<Omit<PaperclipAgentConfig, 'agentId'>>,
  companyId?: string
): PaperclipAgentConfig {
  const registry = loadCompanyRegistry()
  const company = companyId
    ? registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
    : getCompanyRecord()
  const current = ensureAgentConfig(company, agentId)
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
  company.agentConfigs[agentId] = next
  saveCompanyRegistry(registry)
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
 * Enforces budget auto-throttle, picks the top queued ticket (injecting active Company + Product context),
 * runs via BYOA webhook or server-side Gemini, logs token + USD spend, and respects Founder approval gates.
 */
export async function runAgentHeartbeat(
  agentId: string,
  companyId?: string
): Promise<{
  run: HeartbeatRun
  ticket: PaperclipTicket | null
  config: PaperclipAgentConfig
}> {
  const registry = loadCompanyRegistry()
  const state = companyId
    ? registry.companies.find((c) => c.id === companyId) ?? getCompanyRecord()
    : getCompanyRecord()
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
      companyId: state.id,
      agentId: emp.id,
      agentName: emp.name,
      department: emp.department,
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
    saveCompanyRegistry(registry)
    return { run, ticket: null, config: cfg }
  }

  // 2. Select highest-priority queued ticket for this agent (or unassigned matching department ticket)
  const candidates = state.tickets
    .filter((t) => {
      if (t.status !== 'queued') return false
      if (t.assigneeId === emp.id) return true
      if (!t.assigneeId && emp.status === 'active') {
        if (!t.department || t.department === 'Executive') return true
        return t.department.toLowerCase() === emp.department.toLowerCase()
      }
      return false
    })
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])

  const ticket = candidates[0] ?? null
  if (!ticket) {
    const run: HeartbeatRun = {
      id: `hb_${Date.now().toString(36)}`,
      companyId: state.id,
      agentId: emp.id,
      agentName: emp.name,
      department: emp.department,
      ticketId: null,
      ticketKey: null,
      status: 'idle',
      summary: `${emp.name} (${emp.department}) woke up on heartbeat — no queued tickets waiting.`,
      tokensUsed: 0,
      costUsd: 0,
      via: 'local',
      ranAt: now,
    }
    state.heartbeats.unshift(run)
    state.heartbeats = state.heartbeats.slice(0, 80)
    saveCompanyRegistry(registry)
    return { run, ticket: null, config: cfg }
  }

  const linkedProduct = ticket.productId
    ? state.products.find((p) => p.id === ticket.productId) ?? null
    : null

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
      via = 'byoa'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cfg.byoaSecretHeader) {
        headers['X-Paperclip-Signature'] = cfg.byoaSecretHeader
      }
      const res = await fetch(cfg.byoaWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          company: { id: state.id, name: state.companyName, mission: state.mission },
          product: linkedProduct
            ? { id: linkedProduct.id, name: linkedProduct.name, stage: linkedProduct.stage }
            : null,
          agent: { id: emp.id, name: emp.name, title: emp.title, department: emp.department },
          ticket: {
            id: ticket.id,
            key: ticket.key,
            department: ticket.department,
            title: ticket.title,
            description: ticket.description,
          },
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
      const productContext = linkedProduct
        ? `\nProduct: ${linkedProduct.name} (${linkedProduct.kind} · ${linkedProduct.stage})\nTagline: ${linkedProduct.tagline || 'N/A'}\nBrief: ${linkedProduct.brief.slice(0, 600)}\nSources:\n${linkedProduct.sources
            .slice(0, 3)
            .map((s) => `- [${s.type}] ${s.label}: ${s.summary.slice(0, 220)}`)
            .join('\n')}`
        : ''

      const prompt = `Company: ${state.companyName} (${state.industry})
Mission: ${state.mission}${productContext}

Ticket ${ticket.key} [${ticket.department ?? emp.department}]: ${ticket.title}
Priority: ${ticket.priority}
Details: ${ticket.description || 'Execute according to your department role.'}

Produce a concrete, actionable business deliverable or execution report for Eva CEO and the Founder (max 200 words). Include clear next steps and note if any spend or external launch requires Founder approval.`

      output = await chatText(
        [
          {
            role: 'system',
            content:
              emp.systemPrompt ||
              `You are ${emp.name} (${emp.title}, ${emp.department}) operating inside ${state.companyName}, reporting to Eva CEO. Role: ${emp.role}. Be direct, grounded in the company/product brief, and practical.`,
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 450 }
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (via === 'byoa') {
      status = 'error'
      output = `BYOA dispatch failed: ${msg}`
    } else {
      via = 'local'
      output = `Heartbeat deliverable logged by ${emp.name} (${emp.department}) for ${ticket.key}: structured execution checklist for "${ticket.title}"${linkedProduct ? ` (${linkedProduct.name})` : ''} and surfaced for Eva CEO review.`
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
    companyId: state.id,
    productId: ticket.productId ?? null,
    agentId: emp.id,
    agentName: emp.name,
    department: emp.department,
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
  saveCompanyRegistry(registry)

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

/** Combined business + technical blueprints used by legacy autoHireForTask */
const DISCIPLINE_BLUEPRINTS: DisciplineBlueprint[] = [
  ...BUSINESS_DEPARTMENT_BLUEPRINTS.map((bp) => ({
    key: bp.key,
    keywords: bp.keywords,
    name: bp.name,
    title: bp.title,
    department: bp.department,
    kind: bp.kind,
    role: bp.role,
    systemPrompt: bp.systemPrompt,
    skills: bp.skills,
    tools: bp.tools,
    budgetUsd: bp.budgetUsd,
  })),
  {
    key: 'qa',
    keywords: /\b(test|qa|audit|security|verify|bug|fix|regression|playwright|lint|quality)\b/i,
    name: 'QA Sentinel Bot',
    title: 'Autonomous Verification & Security Bot',
    department: 'Product & Development',
    kind: 'bot',
    role: 'Verify builds, write automated tests, audit edge cases, and block unverified releases.',
    systemPrompt:
      'You are QA Sentinel Bot. No task is complete without concrete verification evidence. Catch regressions early.',
    skills: ['verification-qa'],
    tools: ['inspect_project', 'run_code', 'self_heal_code'],
    budgetUsd: 20,
  },
]

/**
 * Backward-compatible Paperclip Auto-Hiring helper (preserved for existing tests & tools).
 * When called with `founderApprovalOnly: true`, queues HiringProposals instead of immediate hiring.
 */
export async function autoHireForTask(
  goal: string,
  options?: { maxNewHires?: number; createTickets?: boolean; force?: boolean }
): Promise<{
  hired: { id: string; name: string; title: string; kind: string; department: string }[]
  matchedExisting: { id: string; name: string; department: string }[]
  ticketsCreated: PaperclipTicket[]
}> {
  const registry = loadCompanyRegistry()
  const state = getCompanyRecord()
  if (!state.autoHireEnabled && !options?.force) {
    return { hired: [], matchedExisting: [], ticketsCreated: [] }
  }

  const maxNewHires = options?.maxNewHires ?? 2
  const shouldCreateTickets = options?.createTickets ?? true
  const existing = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })

  const needed = DISCIPLINE_BLUEPRINTS.filter((bp) => bp.keywords.test(goal))
  if (needed.length === 0 && options?.force) {
    needed.push(DISCIPLINE_BLUEPRINTS[0], DISCIPLINE_BLUEPRINTS[1])
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
      if (state.employeeIds.length > 0 && !state.employeeIds.includes(already.id)) {
        state.employeeIds.push(already.id)
      }
      ensureAgentConfig(state, already.id, { monthlyBudgetUsd: bp.budgetUsd })
    } else if (hired.length < maxNewHires) {
      const empSlugBase =
        bp.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'ai-employee'
      const created = await db.aiEmployee.create({
        data: {
          slug: empSlugBase + '-' + randomUUID().slice(0, 8),
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

      if (state.employeeIds.length > 0 && !state.employeeIds.includes(created.id)) {
        state.employeeIds.push(created.id)
      }

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
        companyId: state.id,
        department: bp.department,
        title: `[${bp.department}] ${shortGoal}`,
        description: `Auto-generated by Eva CEO Orchestrator for goal: "${goal.trim().slice(0, 400)}"`,
        priority: bp.key === 'qa' ? 'high' : 'medium',
        assigneeId: targetId,
        assigneeName: targetName,
        requiresApproval: bp.key === 'finance_ops' || bp.key === 'hiring_hr',
        status: 'queued',
      })
      ticketsCreated.push(ticket)
    }
  }

  saveCompanyRegistry(registry)
  return { hired, matchedExisting, ticketsCreated }
}
