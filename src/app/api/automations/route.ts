import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { computeNextRunAt, executeAutomation, startScheduler } from '@/lib/agent/scheduler'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSeeded()
    startScheduler()
    const automations = await db.automation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assignee: true,
        runs: { orderBy: { startedAt: 'desc' }, take: 8 },
      },
    })
    return NextResponse.json({ ok: true, automations })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureSeeded()
    startScheduler()
    const body = (await request.json()) as {
      action?: string
      id?: string
      name?: string
      description?: string
      prompt?: string
      triggerType?: string
      schedule?: string
      assigneeId?: string | null
      enabled?: boolean
    }

    if (body.action === 'run') {
      const id = String(body.id ?? '').trim()
      if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
      const result = await executeAutomation(id)
      const automation = await db.automation.findUnique({
        where: { id },
        include: { assignee: true, runs: { orderBy: { startedAt: 'desc' }, take: 8 } },
      })
      return NextResponse.json({ ok: result.ok, result, automation })
    }

    const name = String(body.name ?? '').trim()
    const prompt = String(body.prompt ?? '').trim()
    if (!name || !prompt) {
      return NextResponse.json({ ok: false, error: 'name and prompt are required' }, { status: 400 })
    }

    const triggerType = ['interval', 'cron', 'once'].includes(String(body.triggerType))
      ? String(body.triggerType)
      : 'interval'
    const schedule = String(body.schedule ?? (triggerType === 'cron' ? '0 9 * * *' : '60')).trim()
    const enabled = body.enabled !== false

    let assigneeId: string | null = null
    if (typeof body.assigneeId === 'string' && body.assigneeId.trim()) {
      const emp = await db.aiEmployee.findUnique({ where: { id: body.assigneeId.trim() } })
      if (emp) assigneeId = emp.id
    }

    const nextRunAt = enabled ? computeNextRunAt(triggerType, schedule) : null
    const created = await db.automation.create({
      data: {
        name: name.slice(0, 100),
        description: String(body.description ?? '').slice(0, 300),
        prompt: prompt.slice(0, 2000),
        triggerType,
        schedule,
        assigneeId,
        enabled,
        nextRunAt,
      },
      include: { assignee: true, runs: { orderBy: { startedAt: 'desc' }, take: 8 } },
    })
    return NextResponse.json({ ok: true, automation: created })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string
      name?: string
      description?: string
      prompt?: string
      triggerType?: string
      schedule?: string
      assigneeId?: string | null
      enabled?: boolean
    }
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    const existing = await db.automation.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Automation not found' }, { status: 404 })

    const nextTrigger = ['interval', 'cron', 'once'].includes(String(body.triggerType))
      ? String(body.triggerType)
      : existing.triggerType
    const nextSchedule = typeof body.schedule === 'string' && body.schedule.trim()
      ? body.schedule.trim()
      : existing.schedule
    const nextEnabled = typeof body.enabled === 'boolean' ? body.enabled : existing.enabled

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 100)
    if (typeof body.description === 'string') patch.description = body.description.slice(0, 300)
    if (typeof body.prompt === 'string' && body.prompt.trim()) patch.prompt = body.prompt.trim().slice(0, 2000)
    if (body.triggerType !== undefined) patch.triggerType = nextTrigger
    if (body.schedule !== undefined) patch.schedule = nextSchedule
    if (body.enabled !== undefined) patch.enabled = nextEnabled
    if (body.assigneeId !== undefined) patch.assigneeId = body.assigneeId || null

    if (
      body.enabled !== undefined ||
      body.triggerType !== undefined ||
      body.schedule !== undefined
    ) {
      patch.nextRunAt = nextEnabled ? computeNextRunAt(nextTrigger, nextSchedule) : null
    }

    const automation = await db.automation.update({
      where: { id },
      data: patch,
      include: { assignee: true, runs: { orderBy: { startedAt: 'desc' }, take: 8 } },
    })
    return NextResponse.json({ ok: true, automation })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    await db.automation.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
