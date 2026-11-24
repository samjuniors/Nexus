import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  addSourceToProduct,
  approveCompanyTicket,
  attachProductToCompany,
  autoHireForTask,
  createCompany,
  createCompanyTicket,
  createHiringProposal,
  createSpendRequest,
  decideHiringProposal,
  decideSpendRequest,
  deleteCompany,
  deleteCompanyTicket,
  deleteProductFromCompany,
  generateCeoExecutiveBriefing,
  getCompanyRecord,
  getCompanySnapshot,
  loadCompanyRegistry,
  proposeDepartmentPlanAndHires,
  removeSourceFromProduct,
  runAgentHeartbeat,
  saveCompanyRegistry,
  setActiveCompanyContext,
  updateAgentPaperclipConfig,
  updateCompanyTicket,
  type CompanyDepartment,
  type CompanyStage,
  type ProductKind,
  type ProductSource,
  type ProductStage,
  type SpendApprovalRequest,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/agent/paperclip-company'
import {
  buildDocumentSource,
  ingestRepoOrFolderSource,
  ingestWebsiteSource,
  validateExternalWebsiteUrl,
} from '@/lib/agent/product-source-ingest'

export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get('companyId') || undefined
    const productParam = req.nextUrl.searchParams.get('productId')
    const productId = productParam === null ? undefined : productParam || null
    const snapshot = await getCompanySnapshot({ companyId, productId })
    return NextResponse.json(snapshot)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load company state' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '')
    const targetCompanyId =
      typeof body.companyId === 'string' && body.companyId.trim()
        ? body.companyId.trim()
        : undefined

    if (action === 'switch_company') {
      const id = String(body.companyId ?? '').trim()
      if (!id) return NextResponse.json({ error: 'companyId is required' }, { status: 400 })
      const productId =
        body.productId === undefined
          ? undefined
          : typeof body.productId === 'string' && body.productId.trim()
            ? body.productId.trim()
            : null
      setActiveCompanyContext(id, productId)
      return NextResponse.json(await getCompanySnapshot())
    }

    if (action === 'create_company') {
      const companyName = String(body.companyName ?? '').trim()
      if (!companyName) {
        return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
      }
      const created = createCompany({
        companyName,
        industry: typeof body.industry === 'string' ? body.industry : undefined,
        stage: (body.stage as CompanyStage) ?? 'early',
        mission: typeof body.mission === 'string' ? body.mission : undefined,
        monthlyBudgetUsd:
          body.monthlyBudgetUsd !== undefined ? Number(body.monthlyBudgetUsd) : 250,
        founderApprovalRequired: body.founderApprovalRequired !== false,
      })
      return NextResponse.json({ company: created, snapshot: await getCompanySnapshot() })
    }

    if (action === 'delete_company') {
      const id = String(body.companyId ?? '').trim()
      if (!id) return NextResponse.json({ error: 'companyId is required' }, { status: 400 })
      const deleted = deleteCompany(id)
      if (!deleted) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
      return NextResponse.json({ ok: true, snapshot: await getCompanySnapshot() })
    }

    if (action === 'update_company') {
      const registry = loadCompanyRegistry()
      const state = getCompanyRecord(targetCompanyId)
      if (typeof body.companyName === 'string' && body.companyName.trim()) {
        state.companyName = body.companyName.trim().slice(0, 80)
      }
      if (typeof body.industry === 'string' && body.industry.trim()) {
        state.industry = body.industry.trim().slice(0, 80)
      }
      if (typeof body.stage === 'string') {
        state.stage = body.stage as CompanyStage
      }
      if (typeof body.mission === 'string') {
        state.mission = body.mission.trim().slice(0, 600)
      }
      if (body.monthlyBudgetUsd !== undefined) {
        state.monthlyBudgetUsd = Math.max(0, Number(body.monthlyBudgetUsd) || 0)
      }
      if (typeof body.autoHireEnabled === 'boolean') {
        state.autoHireEnabled = body.autoHireEnabled
      }
      if (typeof body.founderApprovalRequired === 'boolean') {
        state.founderApprovalRequired = body.founderApprovalRequired
      }
      saveCompanyRegistry(registry)
      return NextResponse.json(await getCompanySnapshot())
    }

    if (action === 'attach_product') {
      const company = getCompanyRecord(targetCompanyId)
      const name = String(body.name ?? '').trim()
      if (!name) {
        return NextResponse.json({ error: 'Product or project name is required' }, { status: 400 })
      }

      const sources: ProductSource[] = []

      // Optional Website URL source (SSRF protected)
      if (typeof body.websiteUrl === 'string' && body.websiteUrl.trim()) {
        const webSrc = await ingestWebsiteSource(body.websiteUrl.trim())
        sources.push(webSrc)
      }

      // Optional Document text source
      if (typeof body.documentContent === 'string' && body.documentContent.trim()) {
        const docSrc = buildDocumentSource({
          label:
            typeof body.documentLabel === 'string' && body.documentLabel.trim()
              ? body.documentLabel.trim()
              : `${name} Specification Doc`,
          content: body.documentContent,
        })
        sources.push(docSrc)
      }

      // Optional Local Folder or GitHub Repo source (workspace confined)
      if (typeof body.repoOrFolder === 'string' && body.repoOrFolder.trim()) {
        const repoSrc = ingestRepoOrFolderSource(body.repoOrFolder.trim())
        sources.push(repoSrc)
      }

      const rawGoals = Array.isArray(body.goals)
        ? body.goals.map(String)
        : typeof body.goals === 'string'
          ? body.goals.split(/\r?\n|;/).map((s) => s.trim())
          : []

      const product = attachProductToCompany(company.id, {
        name,
        tagline: typeof body.tagline === 'string' ? body.tagline : '',
        kind: (body.kind as ProductKind) ?? 'product',
        stage: (body.stage as ProductStage) ?? 'building',
        brief: typeof body.brief === 'string' ? body.brief : '',
        targetAudience: typeof body.targetAudience === 'string' ? body.targetAudience : '',
        goals: rawGoals.filter(Boolean),
        sources,
      })

      let kickoff: Awaited<ReturnType<typeof proposeDepartmentPlanAndHires>> | null = null
      if (body.autoPlanByEva === true) {
        kickoff = await proposeDepartmentPlanAndHires(company.id, {
          productId: product.id,
          maxProposals: 4,
        })
      }

      return NextResponse.json({
        product,
        kickoff,
        snapshot: await getCompanySnapshot(),
      })
    }

    if (action === 'add_product_source') {
      const company = getCompanyRecord(targetCompanyId)
      const productId = String(body.productId ?? '').trim()
      const sourceType = String(body.sourceType ?? '')
      if (!productId) {
        return NextResponse.json({ error: 'productId is required' }, { status: 400 })
      }

      let source: ProductSource
      if (sourceType === 'website') {
        source = await ingestWebsiteSource(
          String(body.uriOrPath ?? ''),
          typeof body.label === 'string' ? body.label : undefined
        )
      } else if (sourceType === 'document') {
        source = buildDocumentSource({
          label: String(body.label ?? 'Attached Document'),
          content: String(body.content ?? ''),
          uriOrPath: typeof body.uriOrPath === 'string' ? body.uriOrPath : undefined,
        })
      } else if (sourceType === 'repo_folder') {
        source = ingestRepoOrFolderSource(
          String(body.uriOrPath ?? ''),
          typeof body.label === 'string' ? body.label : undefined
        )
      } else {
        return NextResponse.json({ error: 'Unsupported sourceType' }, { status: 400 })
      }

      const product = addSourceToProduct(company.id, productId, source)
      return NextResponse.json({ product, source, snapshot: await getCompanySnapshot() })
    }

    if (action === 'remove_product_source') {
      const company = getCompanyRecord(targetCompanyId)
      const productId = String(body.productId ?? '').trim()
      const sourceId = String(body.sourceId ?? '').trim()
      if (!productId || !sourceId) {
        return NextResponse.json({ error: 'productId and sourceId are required' }, { status: 400 })
      }
      const product = removeSourceFromProduct(company.id, productId, sourceId)
      return NextResponse.json({ product, snapshot: await getCompanySnapshot() })
    }

    if (action === 'delete_product') {
      const company = getCompanyRecord(targetCompanyId)
      const productId = String(body.productId ?? '').trim()
      if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
      const ok = deleteProductFromCompany(company.id, productId)
      if (!ok) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      return NextResponse.json({ ok: true, snapshot: await getCompanySnapshot() })
    }

    if (action === 'eva_plan_product') {
      const company = getCompanyRecord(targetCompanyId)
      const productId =
        typeof body.productId === 'string' && body.productId.trim() ? body.productId.trim() : null
      const departments = Array.isArray(body.departments)
        ? (body.departments.map(String) as CompanyDepartment[])
        : undefined
      const result = await proposeDepartmentPlanAndHires(company.id, {
        productId,
        goal: typeof body.goal === 'string' ? body.goal : undefined,
        departments,
        maxProposals: body.maxProposals !== undefined ? Number(body.maxProposals) : 5,
      })
      return NextResponse.json({ ...result, snapshot: await getCompanySnapshot() })
    }

    if (action === 'create_hiring_proposal') {
      const company = getCompanyRecord(targetCompanyId)
      const name = String(body.name ?? '').trim()
      const title = String(body.title ?? '').trim()
      const department = String(body.department ?? 'Operations').trim()
      if (!name || !title) {
        return NextResponse.json({ error: 'name and title are required' }, { status: 400 })
      }
      const proposal = createHiringProposal(company.id, {
        productId: typeof body.productId === 'string' && body.productId ? body.productId : null,
        proposedBy: typeof body.proposedBy === 'string' ? body.proposedBy : 'Eva (CEO)',
        name,
        title,
        department,
        kind: (body.kind as 'employee' | 'bot' | 'subagent') ?? 'employee',
        role: String(body.role ?? `${title} in ${department}`),
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
        skills: Array.isArray(body.skills) ? body.skills.map(String) : [],
        tools: Array.isArray(body.tools) ? body.tools.map(String) : [],
        monthlyBudgetUsd:
          body.monthlyBudgetUsd !== undefined ? Number(body.monthlyBudgetUsd) : 30,
        rationale: String(
          body.rationale ?? `Proposed by Eva CEO to expand ${department} execution capacity.`
        ),
      })
      return NextResponse.json({ proposal, snapshot: await getCompanySnapshot() })
    }

    if (action === 'decide_hiring_proposal') {
      const company = getCompanyRecord(targetCompanyId)
      const proposalId = String(body.proposalId ?? '').trim()
      const decision = body.decision === 'reject' ? 'reject' : 'approve'
      if (!proposalId) {
        return NextResponse.json({ error: 'proposalId is required' }, { status: 400 })
      }
      const result = await decideHiringProposal(company.id, proposalId, {
        decision,
        adjustedBudgetUsd:
          body.adjustedBudgetUsd !== undefined ? Number(body.adjustedBudgetUsd) : undefined,
        founderNote: typeof body.founderNote === 'string' ? body.founderNote : undefined,
      })
      return NextResponse.json({ ...result, snapshot: await getCompanySnapshot() })
    }

    if (action === 'create_spend_request') {
      const company = getCompanyRecord(targetCompanyId)
      const title = String(body.title ?? '').trim()
      if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
      const request = createSpendRequest(company.id, {
        productId: typeof body.productId === 'string' && body.productId ? body.productId : null,
        requestedBy: typeof body.requestedBy === 'string' ? body.requestedBy : 'Eva (CEO)',
        title,
        category: (body.category as SpendApprovalRequest['category']) ?? 'vendor_spend',
        amountUsd: Number(body.amountUsd ?? 0),
        rationale: String(body.rationale ?? 'Requested for company operations.'),
      })
      return NextResponse.json({ request, snapshot: await getCompanySnapshot() })
    }

    if (action === 'decide_spend_request') {
      const company = getCompanyRecord(targetCompanyId)
      const requestId = String(body.requestId ?? '').trim()
      const decision = body.decision === 'reject' ? 'reject' : 'approve'
      if (!requestId) {
        return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
      }
      const request = decideSpendRequest(company.id, requestId, {
        decision,
        founderNote: typeof body.founderNote === 'string' ? body.founderNote : undefined,
      })
      return NextResponse.json({ request, snapshot: await getCompanySnapshot() })
    }

    if (action === 'generate_ceo_briefing') {
      const company = getCompanyRecord(targetCompanyId)
      const productId =
        typeof body.productId === 'string' && body.productId.trim() ? body.productId.trim() : null
      const briefing = await generateCeoExecutiveBriefing(company.id, productId)
      return NextResponse.json({ briefing, snapshot: await getCompanySnapshot() })
    }

    if (action === 'create_ticket') {
      const title = String(body.title ?? '').trim()
      if (!title) {
        return NextResponse.json({ error: 'Ticket title is required' }, { status: 400 })
      }
      const assigneeId =
        typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null
      let assigneeName = 'Eva (CEO)'
      if (assigneeId) {
        const emp = await db.aiEmployee.findUnique({ where: { id: assigneeId } })
        if (emp) assigneeName = emp.name
      }
      const ticket = createCompanyTicket({
        companyId: targetCompanyId,
        productId: typeof body.productId === 'string' && body.productId ? body.productId : null,
        department: typeof body.department === 'string' ? body.department : 'Executive',
        goalLink: typeof body.goalLink === 'string' ? body.goalLink : null,
        title,
        description: typeof body.description === 'string' ? body.description : '',
        priority: (body.priority as TicketPriority) ?? 'medium',
        assigneeId,
        assigneeName,
        requiresApproval: Boolean(body.requiresApproval),
        approvalReason: typeof body.approvalReason === 'string' ? body.approvalReason : null,
        estimatedSpendUsd:
          body.estimatedSpendUsd !== undefined ? Number(body.estimatedSpendUsd) : 0,
        status: (body.status as TicketStatus) ?? 'queued',
      })
      return NextResponse.json({ ticket, snapshot: await getCompanySnapshot() })
    }

    if (action === 'update_ticket') {
      const id = String(body.id ?? '')
      if (!id) return NextResponse.json({ error: 'Ticket id required' }, { status: 400 })
      const patch: Record<string, unknown> = {}
      if (typeof body.status === 'string') patch.status = body.status
      if (typeof body.priority === 'string') patch.priority = body.priority
      if (typeof body.title === 'string') patch.title = body.title
      if (typeof body.description === 'string') patch.description = body.description
      if (typeof body.department === 'string') patch.department = body.department
      if (typeof body.requiresApproval === 'boolean') patch.requiresApproval = body.requiresApproval
      if (body.assigneeId !== undefined) {
        const assigneeId =
          typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null
        patch.assigneeId = assigneeId
        if (assigneeId) {
          const emp = await db.aiEmployee.findUnique({ where: { id: assigneeId } })
          patch.assigneeName = emp?.name ?? 'Eva (CEO)'
        } else {
          patch.assigneeName = 'Eva (CEO)'
        }
      }
      const ticket = updateCompanyTicket(id, patch, targetCompanyId)
      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ticket, snapshot: await getCompanySnapshot() })
    }

    if (action === 'approve_ticket') {
      const id = String(body.id ?? '')
      const ticket = approveCompanyTicket(
        id,
        typeof body.approver === 'string' ? body.approver : 'Founder',
        targetCompanyId
      )
      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ticket, snapshot: await getCompanySnapshot() })
    }

    if (action === 'delete_ticket') {
      const id = String(body.id ?? '')
      const deleted = deleteCompanyTicket(id, targetCompanyId)
      if (!deleted) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ok: true, snapshot: await getCompanySnapshot() })
    }

    if (action === 'update_agent_config') {
      const agentId = String(body.agentId ?? '')
      if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
      const config = updateAgentPaperclipConfig(
        agentId,
        {
          monthlyBudgetUsd:
            body.monthlyBudgetUsd !== undefined ? Number(body.monthlyBudgetUsd) : undefined,
          heartbeatIntervalMin:
            body.heartbeatIntervalMin !== undefined ? Number(body.heartbeatIntervalMin) : undefined,
          heartbeatEnabled:
            typeof body.heartbeatEnabled === 'boolean' ? body.heartbeatEnabled : undefined,
          autoThrottle: typeof body.autoThrottle === 'boolean' ? body.autoThrottle : undefined,
          byoaWebhookUrl:
            body.byoaWebhookUrl !== undefined
              ? typeof body.byoaWebhookUrl === 'string' && body.byoaWebhookUrl.trim()
                ? body.byoaWebhookUrl.trim()
                : null
              : undefined,
          byoaProvider:
            body.byoaProvider !== undefined
              ? typeof body.byoaProvider === 'string' && body.byoaProvider.trim()
                ? body.byoaProvider.trim()
                : null
              : undefined,
          byoaSecretHeader:
            body.byoaSecretHeader !== undefined
              ? typeof body.byoaSecretHeader === 'string' && body.byoaSecretHeader.trim()
                ? body.byoaSecretHeader.trim()
                : null
              : undefined,
        },
        targetCompanyId
      )
      return NextResponse.json({ config, snapshot: await getCompanySnapshot() })
    }

    if (action === 'register_byoa') {
      const name = String(body.name ?? '').trim()
      const webhookUrl = String(body.webhookUrl ?? '').trim()
      if (!name || !webhookUrl) {
        return NextResponse.json({ error: 'name and webhookUrl are required' }, { status: 400 })
      }
      const check = validateExternalWebsiteUrl(webhookUrl)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      const slugBase =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'byoa-agent'
      const employee = await db.aiEmployee.create({
        data: {
          slug: slugBase + '-' + randomUUID().slice(0, 8),
          name: name.slice(0, 60),
          title: String(body.title ?? 'External BYOA Runtime Agent').slice(0, 80),
          department: String(body.department ?? 'Operations').slice(0, 48),
          kind: 'bot',
          role: String(body.role ?? 'External Bring-Your-Own-Agent webhook worker').slice(0, 300),
          systemPrompt: `External BYOA HTTP agent powered by ${String(body.provider ?? 'Custom Webhook')}`,
          status: 'active',
          autonomy: 'autonomous',
          icon: 'bot',
        },
      })
      const registry = loadCompanyRegistry()
      const activeCompany = getCompanyRecord(targetCompanyId)
      if (activeCompany.employeeIds.length > 0 && !activeCompany.employeeIds.includes(employee.id)) {
        activeCompany.employeeIds.push(employee.id)
        saveCompanyRegistry(registry)
      }
      const config = updateAgentPaperclipConfig(
        employee.id,
        {
          monthlyBudgetUsd: Number(body.monthlyBudgetUsd ?? 40),
          heartbeatIntervalMin: Number(body.heartbeatIntervalMin ?? 15),
          heartbeatEnabled: true,
          autoThrottle: true,
          byoaWebhookUrl: webhookUrl,
          byoaProvider: String(body.provider ?? 'Custom HTTP Agent').slice(0, 48),
          byoaSecretHeader:
            typeof body.secretHeader === 'string' && body.secretHeader.trim()
              ? body.secretHeader.trim()
              : null,
        },
        targetCompanyId
      )
      return NextResponse.json({ employee, config, snapshot: await getCompanySnapshot() })
    }

    if (action === 'run_heartbeat') {
      const agentId = String(body.agentId ?? '')
      if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
      const result = await runAgentHeartbeat(agentId, targetCompanyId)
      return NextResponse.json({ ...result, snapshot: await getCompanySnapshot() })
    }

    if (action === 'run_all_heartbeats') {
      const state = getCompanyRecord(targetCompanyId)
      const allEmployees = await db.aiEmployee.findMany({ where: { status: 'active' } })
      const scoped =
        state.employeeIds.length > 0
          ? allEmployees.filter((e) => state.employeeIds.includes(e.id))
          : allEmployees
      const results: Awaited<ReturnType<typeof runAgentHeartbeat>>[] = []
      for (const emp of scoped) {
        const cfg = state.agentConfigs[emp.id]
        if (cfg && !cfg.heartbeatEnabled) continue
        results.push(await runAgentHeartbeat(emp.id, state.id))
      }
      return NextResponse.json({ results, snapshot: await getCompanySnapshot() })
    }

    if (action === 'auto_hire') {
      const goal = String(body.goal ?? '').trim()
      if (!goal) {
        return NextResponse.json({ error: 'Goal prompt is required' }, { status: 400 })
      }
      const company = getCompanyRecord(targetCompanyId)
      // Respect Founder governance by default: queue Hiring Proposals unless explicitly bypassed
      if (company.founderApprovalRequired && body.bypassFounderApproval !== true) {
        const plan = await proposeDepartmentPlanAndHires(company.id, {
          productId: typeof body.productId === 'string' && body.productId ? body.productId : null,
          goal,
          maxProposals: Number(body.maxNewHires ?? 4),
        })
        return NextResponse.json({
          ...plan,
          governanceMode: 'founder_approval_queued',
          snapshot: await getCompanySnapshot(),
        })
      }
      const result = await autoHireForTask(goal, {
        maxNewHires: Number(body.maxNewHires ?? 3),
        createTickets: body.createTickets !== false,
        force: true,
      })
      return NextResponse.json({ ...result, snapshot: await getCompanySnapshot() })
    }

    return NextResponse.json({ error: `Unknown company action: ${action}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Company action failed' },
      { status: 500 }
    )
  }
}
