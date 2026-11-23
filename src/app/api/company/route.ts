import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  approveCompanyTicket,
  autoHireForTask,
  createCompanyTicket,
  deleteCompanyTicket,
  getCompanySnapshot,
  loadCompanyState,
  runAgentHeartbeat,
  saveCompanyState,
  updateAgentPaperclipConfig,
  updateCompanyTicket,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/agent/paperclip-company'

export async function GET() {
  try {
    const snapshot = await getCompanySnapshot()
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

    if (action === 'update_company') {
      const state = loadCompanyState()
      if (typeof body.companyName === 'string' && body.companyName.trim()) {
        state.companyName = body.companyName.trim().slice(0, 80)
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
      saveCompanyState(state)
      return NextResponse.json(await getCompanySnapshot())
    }

    if (action === 'create_ticket') {
      const title = String(body.title ?? '').trim()
      if (!title) {
        return NextResponse.json({ error: 'Ticket title is required' }, { status: 400 })
      }
      const assigneeId = typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null
      let assigneeName = 'Eva (Unassigned)'
      if (assigneeId) {
        const emp = await db.aiEmployee.findUnique({ where: { id: assigneeId } })
        if (emp) assigneeName = emp.name
      }
      const ticket = createCompanyTicket({
        title,
        description: typeof body.description === 'string' ? body.description : '',
        priority: (body.priority as TicketPriority) ?? 'medium',
        assigneeId,
        assigneeName,
        requiresApproval: Boolean(body.requiresApproval),
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
      if (typeof body.requiresApproval === 'boolean') patch.requiresApproval = body.requiresApproval
      if (body.assigneeId !== undefined) {
        const assigneeId = typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null
        patch.assigneeId = assigneeId
        if (assigneeId) {
          const emp = await db.aiEmployee.findUnique({ where: { id: assigneeId } })
          patch.assigneeName = emp?.name ?? 'Eva (Unassigned)'
        } else {
          patch.assigneeName = 'Eva (Unassigned)'
        }
      }
      const ticket = updateCompanyTicket(id, patch)
      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ticket, snapshot: await getCompanySnapshot() })
    }

    if (action === 'approve_ticket') {
      const id = String(body.id ?? '')
      const ticket = approveCompanyTicket(id, typeof body.approver === 'string' ? body.approver : 'Owner')
      if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ticket, snapshot: await getCompanySnapshot() })
    }

    if (action === 'delete_ticket') {
      const id = String(body.id ?? '')
      const deleted = deleteCompanyTicket(id)
      if (!deleted) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      return NextResponse.json({ ok: true, snapshot: await getCompanySnapshot() })
    }

    if (action === 'update_agent_config') {
      const agentId = String(body.agentId ?? '')
      if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
      const config = updateAgentPaperclipConfig(agentId, {
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
      })
      return NextResponse.json({ config, snapshot: await getCompanySnapshot() })
    }

    if (action === 'register_byoa') {
      const name = String(body.name ?? '').trim()
      const webhookUrl = String(body.webhookUrl ?? '').trim()
      if (!name || !webhookUrl) {
        return NextResponse.json({ error: 'name and webhookUrl are required' }, { status: 400 })
      }
      if (!/^https?:\/\//i.test(webhookUrl)) {
        return NextResponse.json({ error: 'webhookUrl must start with http:// or https://' }, { status: 400 })
      }
      const slugBase = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'byoa-agent'
      const slug = `${slugBase}-${Date.now().toString(36)}`
      const employee = await db.aiEmployee.create({
        data: {
          slug: slugBase + '-' + randomUUID().slice(0, 8),

          name: name.slice(0, 60),
          title: String(body.title ?? 'External BYOA Runtime Agent').slice(0, 80),
          department: String(body.department ?? 'External Runtimes').slice(0, 48),
          kind: 'bot',
          role: String(body.role ?? 'External Bring-Your-Own-Agent webhook worker').slice(0, 300),
          systemPrompt: `External BYOA HTTP agent powered by ${String(body.provider ?? 'Custom Webhook')}`,
          status: 'active',
          autonomy: 'autonomous',
          icon: 'bot',
        },
      })
      const config = updateAgentPaperclipConfig(employee.id, {
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
      })
      return NextResponse.json({ employee, config, snapshot: await getCompanySnapshot() })
    }

    if (action === 'run_heartbeat') {
      const agentId = String(body.agentId ?? '')
      if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
      const result = await runAgentHeartbeat(agentId)
      return NextResponse.json({ ...result, snapshot: await getCompanySnapshot() })
    }

    if (action === 'run_all_heartbeats') {
      const employees = await db.aiEmployee.findMany({ where: { status: 'active' } })
      const state = loadCompanyState()
      const results: Awaited<ReturnType<typeof runAgentHeartbeat>>[] = []
      for (const emp of employees) {
        const cfg = state.agentConfigs[emp.id]
        if (cfg && !cfg.heartbeatEnabled) continue
        results.push(await runAgentHeartbeat(emp.id))
      }
      return NextResponse.json({ results, snapshot: await getCompanySnapshot() })
    }

    if (action === 'auto_hire') {
      const goal = String(body.goal ?? '').trim()
      if (!goal) return NextResponse.json({ error: 'Goal prompt is required for auto-hiring' }, { status: 400 })
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
