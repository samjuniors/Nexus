export type TicketStatus =
  | 'backlog'
  | 'queued'
  | 'in_progress'
  | 'needs_approval'
  | 'done'
  | 'blocked'

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

export type CompanyDepartment =
  | 'Executive'
  | 'Sales'
  | 'Marketing'
  | 'Hiring & HR'
  | 'Product & Development'
  | 'Customer Support'
  | 'Finance & Ops'
  | 'Operations'

export const CORE_BUSINESS_DEPARTMENTS: CompanyDepartment[] = [
  'Sales',
  'Marketing',
  'Hiring & HR',
  'Product & Development',
  'Customer Support',
  'Finance & Ops',
]

export type CompanyStage = 'idea' | 'early' | 'growth' | 'scale'
export type ProductKind = 'product' | 'service' | 'project'
export type ProductStage = 'idea' | 'building' | 'launched' | 'scaling'
export type ProductSourceType = 'brief' | 'website' | 'document' | 'repo_folder'

export interface ProductSource {
  id: string
  type: ProductSourceType
  label: string
  uriOrPath: string
  summary: string
  content: string
  status: 'ready' | 'error'
  errorMessage?: string
  ingestedAt: string
}

export interface CompanyProduct {
  id: string
  companyId: string
  name: string
  tagline: string
  kind: ProductKind
  stage: ProductStage
  brief: string
  targetAudience: string
  goals: string[]
  sources: ProductSource[]
  createdAt: string
  updatedAt: string
}

export interface HiringProposal {
  id: string
  companyId: string
  productId: string | null
  proposedBy: string
  name: string
  title: string
  department: CompanyDepartment | string
  kind: 'employee' | 'bot' | 'subagent'
  role: string
  systemPrompt: string
  skills: string[]
  tools: string[]
  monthlyBudgetUsd: number
  rationale: string
  status: 'pending' | 'approved' | 'rejected'
  founderNote: string | null
  createdAt: string
  decidedAt: string | null
  createdEmployeeId: string | null
}

export interface SpendApprovalRequest {
  id: string
  companyId: string
  productId: string | null
  requestedBy: string
  title: string
  category: 'budget_increase' | 'vendor_spend' | 'campaign_spend' | 'external_action'
  amountUsd: number
  rationale: string
  status: 'pending' | 'approved' | 'rejected'
  founderNote: string | null
  createdAt: string
  decidedAt: string | null
}

export interface ExecutiveBriefing {
  id: string
  companyId: string
  productId: string | null
  headline: string
  summary: string
  highlights: string[]
  blockers: string[]
  nextActions: string[]
  createdAt: string
}

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
  companyId?: string
  productId?: string | null
  productName?: string | null
  department?: string
  goalLink?: string | null
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  assigneeId: string | null
  assigneeName: string
  requiresApproval: boolean
  approvalReason?: string | null
  estimatedSpendUsd?: number
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
  companyId?: string
  productId?: string | null
  agentId: string
  agentName: string
  department?: string
  ticketId: string | null
  ticketKey: string | null
  status: 'ok' | 'throttled' | 'idle' | 'error'
  summary: string
  tokensUsed: number
  costUsd: number
  via: 'gemini' | 'byoa' | 'local'
  ranAt: string
}

/** Legacy v1 shape preserved for backward compatibility with existing tests and components */
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

export interface CompanyRecord extends PaperclipCompanyState {
  id: string
  slug: string
  industry: string
  stage: CompanyStage
  ticketPrefix: string
  founderApprovalRequired: boolean
  products: CompanyProduct[]
  hiringProposals: HiringProposal[]
  spendRequests: SpendApprovalRequest[]
  briefings: ExecutiveBriefing[]
  employeeIds: string[]
  createdAt: string
}

export interface CompanyRegistryState {
  version: 2
  activeCompanyId: string
  activeProductId: string | null
  companies: CompanyRecord[]
  updatedAt: string
}

export interface DepartmentRoleBlueprint {
  key: string
  department: CompanyDepartment
  keywords: RegExp
  name: string
  title: string
  kind: 'employee' | 'bot' | 'subagent'
  role: string
  systemPrompt: string
  skills: string[]
  tools: string[]
  budgetUsd: number
  defaultTicketRequiresApproval: boolean
}

export const BUSINESS_DEPARTMENT_BLUEPRINTS: DepartmentRoleBlueprint[] = [
  {
    key: 'sales',
    department: 'Sales',
    keywords: /\b(sales|lead|leads|outreach|prospect|crm|pipeline|deal|pricing|demo|revenue|client|b2b|pitch|cold email)\b/i,
    name: 'Atlas Sales Lead',
    title: 'Head of Sales & Pipeline',
    kind: 'employee',
    role: 'Qualify ideal customers, draft tailored outreach & follow-up sequences, prepare pricing proposals, and track conversion pipeline.',
    systemPrompt:
      'You are Atlas, Head of Sales reporting to Eva CEO. Produce concrete ICP criteria, sharp outbound/follow-up drafts, objection-handling playbooks, and pipeline next steps grounded strictly in the attached company and product facts.',
    skills: ['deep-research'],
    tools: ['web_search', 'read_url', 'doc_write', 'save_memory'],
    budgetUsd: 35,
    defaultTicketRequiresApproval: false,
  },
  {
    key: 'marketing',
    department: 'Marketing',
    keywords: /\b(marketing|brand|launch|seo|content|social|campaign|copy|landing|growth|newsletter|ads|positioning|audience)\b/i,
    name: 'Nova Growth Marketer',
    title: 'Head of Marketing & Positioning',
    kind: 'employee',
    role: 'Craft positioning, landing-page messaging, launch campaigns, content calendars, and competitor benchmarks.',
    systemPrompt:
      'You are Nova, Head of Marketing reporting to Eva CEO. Write crisp, high-converting positioning, campaign briefs, and content plans tailored to the active product without hype or invented metrics. Flag paid ad spend for Founder approval.',
    skills: ['deep-research'],
    tools: ['web_search', 'read_url', 'doc_write', 'save_memory'],
    budgetUsd: 35,
    defaultTicketRequiresApproval: false,
  },
  {
    key: 'hiring_hr',
    department: 'Hiring & HR',
    keywords: /\b(hir(e|ing)|recruit|talent|hr|team|staff|onboard|role|headcount|employee|people|org)\b/i,
    name: 'Kira People & Hiring Lead',
    title: 'Talent & AI Workforce Partner',
    kind: 'employee',
    role: 'Identify capability bottlenecks, draft role charters and onboarding rubrics, and prepare Hiring Proposals for Eva CEO & Founder approval.',
    systemPrompt:
      'You are Kira, Talent & AI Workforce Partner reporting to Eva CEO. Define clear role scopes, deliverables, monthly budget justifications, and onboarding checklists. Never finalize a hire without Founder approval.',
    skills: ['project-intelligence'],
    tools: ['manage_org', 'doc_write', 'save_memory'],
    budgetUsd: 20,
    defaultTicketRequiresApproval: true,
  },
  {
    key: 'product_dev',
    department: 'Product & Development',
    keywords: /\b(product|feature|roadmap|prd|dev|development|build|ui|ux|frontend|backend|api|app|software|bug|qa|test|code|repo|release)\b/i,
    name: 'Orion Product & Build Lead',
    title: 'Head of Product & Engineering',
    kind: 'employee',
    role: 'Own product specs, roadmaps, architecture reviews, QA verification, and repo-linked engineering execution when products include software.',
    systemPrompt:
      'You are Orion, Head of Product & Engineering reporting to Eva CEO. Turn product briefs and customer insights into clear milestones, acceptance criteria, and verified deliverables. Never mark work complete without verification.',
    skills: ['project-intelligence', 'code-helper', 'verification-qa'],
    tools: ['inspect_project', 'run_code', 'doc_write', 'save_memory'],
    budgetUsd: 40,
    defaultTicketRequiresApproval: false,
  },
  {
    key: 'support',
    department: 'Customer Support',
    keywords: /\b(support|customer|help|faq|ticket|churn|feedback|onboard|success|issue|complaint|docs|knowledge base)\b/i,
    name: 'Sera Customer Success Lead',
    title: 'Head of Customer Support & Success',
    kind: 'employee',
    role: 'Triage customer questions, maintain FAQs and help docs, draft empathetic replies, and surface recurring product friction to Eva CEO.',
    systemPrompt:
      'You are Sera, Head of Customer Support reporting to Eva CEO. Deliver accurate, helpful troubleshooting guides, FAQ updates, and customer response templates strictly grounded in attached product documentation.',
    skills: ['project-intelligence'],
    tools: ['doc_write', 'save_memory', 'read_url'],
    budgetUsd: 25,
    defaultTicketRequiresApproval: false,
  },
  {
    key: 'finance_ops',
    department: 'Finance & Ops',
    keywords: /\b(finance|budget|spend|cost|burn|invoice|pricing|margin|ops|operations|legal|compliance|vendor|cash|unit economics|kpi)\b/i,
    name: 'Vance Finance & Ops Controller',
    title: 'Head of Finance & Operations',
    kind: 'employee',
    role: 'Track monthly burn vs. caps, model pricing and unit economics, review vendor spend requests, and prepare Founder financial summaries.',
    systemPrompt:
      'You are Vance, Head of Finance & Operations reporting to Eva CEO. Maintain strict budget discipline, present tabular cost/ROI breakdowns, and route any spend commitment or budget increase to the Founder Approval Queue.',
    skills: ['project-intelligence'],
    tools: ['run_code', 'doc_write', 'save_memory'],
    budgetUsd: 25,
    defaultTicketRequiresApproval: true,
  },
]

export interface CompanySummaryDTO {
  id: string
  slug: string
  name: string
  industry: string
  stage: CompanyStage
  mission: string
  monthlyBudgetUsd: number
  spentUsd: number
  productCount: number
  pendingApprovalsCount: number
  products: { id: string; name: string; stage: ProductStage; kind: ProductKind }[]
}

export interface CompanyHqSnapshotDTO {
  /** Backward-compatible active company summary */
  company: {
    id: string
    slug: string
    companyName: string
    industry: string
    stage: CompanyStage
    mission: string
    monthlyBudgetUsd: number
    autoHireEnabled: boolean
    founderApprovalRequired: boolean
    updatedAt: string
  }
  activeCompanyId: string
  activeProductId: string | null
  companies: CompanySummaryDTO[]
  products: CompanyProduct[]
  hiringProposals: HiringProposal[]
  spendRequests: SpendApprovalRequest[]
  briefings: ExecutiveBriefing[]
  departments: {
    name: CompanyDepartment
    headcount: number
    openTickets: number
    pendingProposals: number
  }[]
  metrics: {
    totalSpentUsd: number
    monthlyBudgetUsd: number
    budgetUtilizationPct: number
    totalTokens: number
    openTickets: number
    approvalPending: number
    pendingHires: number
    pendingSpendRequests: number
    totalFounderApprovals: number
    totalHeartbeats: number
    activeAgents: number
    byoaAgents: number
    productCount: number
  }
  agentConfigs: Record<string, PaperclipAgentConfig>
  tickets: PaperclipTicket[]
  heartbeats: HeartbeatRun[]
  employees?: unknown[]
}
