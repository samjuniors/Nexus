import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { evaluateOrgRoster } from '@/lib/agent/org-review'
import { chatText } from '@/lib/agent/zai'

export const runtime = 'nodejs'

function slugify(s: string, fallback = 'member'): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback
  )
}

export async function GET() {
  try {
    await ensureSeeded()
    const [employees, skills, tools] = await Promise.all([
      db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } }),
      db.skill.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      db.tool.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    ])
    return NextResponse.json({
      ok: true,
      employees,
      availableSkills: skills.map((s) => ({ slug: s.slug, name: s.name })),
      availableTools: tools.map((t) => ({ slug: t.slug, name: t.name })),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      action?: string
      id?: string
      task?: string
      focus?: string
      name?: string
      title?: string
      department?: string
      kind?: string
      role?: string
      reportsToId?: string | null
      systemPrompt?: string
      skills?: string[]
      tools?: string[]
      autonomy?: string
      icon?: string
    }

    // Eva reviews the AI organization, subagents, bots, or a specific team member
    if (body.action === 'review') {
      const targetId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null
      const focus = typeof body.focus === 'string' ? body.focus.trim() : ''
      const allMembers = await db.aiEmployee.findMany({ orderBy: { createdAt: 'asc' } })
      const members = targetId ? allMembers.filter((m) => m.id === targetId) : allMembers
      if (targetId && members.length === 0) {
        return NextResponse.json({ ok: false, error: 'Org member not found' }, { status: 404 })
      }

      const review = evaluateOrgRoster(members, focus)
      let assessment = review.summaryText
      try {
        assessment = await chatText(
          [
            {
              role: 'system',
              content:
                'You are Eva, Lead Agent of NEXUS. Deliver a concise, decisive executive review of the AI employees, subagents, and bots below. Highlight strengths, utilization, capability gaps, and exact hiring or bot creation recommendations in 4-6 clean bullet points.',
            },
            {
              role: 'user',
              content: `${review.summaryText}${focus ? `\n\nREVIEW FOCUS: ${focus}` : ''}`,
            },
          ],
          { temperature: 0.3, maxTokens: 600 }
        )
      } catch {
        /* retain deterministic structural review summary */
      }

      return NextResponse.json({ ok: true, review, assessment })
    }

    // Delegate a focused task directly to an AI Employee / Bot
    if (body.action === 'delegate') {
      const id = String(body.id ?? '').trim()
      const task = String(body.task ?? '').trim()
      if (!id || !task) {
        return NextResponse.json({ ok: false, error: 'id and task are required' }, { status: 400 })
      }
      const emp = await db.aiEmployee.findUnique({ where: { id } })
      if (!emp) {
        return NextResponse.json({ ok: false, error: 'Org member not found' }, { status: 404 })
      }

      let skillSlugs: string[] = []
      try {
        skillSlugs = JSON.parse(emp.skillsJson) as string[]
      } catch {
        skillSlugs = []
      }
      const skillRows = skillSlugs.length
        ? await db.skill.findMany({ where: { enabled: true } })
        : []
      const loadedSkillPrompts = skillRows
        .filter((s) => skillSlugs.includes(s.slug) || skillSlugs.includes(s.name))
        .map((s) => `SKILL "${s.name}": ${s.prompt}`)
        .join('\n')

      const output = await chatText(
        [
          {
            role: 'system',
            content: `You are ${emp.name}, ${emp.title} in ${emp.department} (${emp.kind}), reporting to Eva (Lead Agent).\nRole: ${emp.role}\n${emp.systemPrompt}\n${loadedSkillPrompts ? `\n${loadedSkillPrompts}` : ''}\nDeliver a crisp, structured, production-grade response.`,
          },
          { role: 'user', content: task },
        ],
        { temperature: 0.4, maxTokens: 1000 }
      )

      const updated = await db.aiEmployee.update({
        where: { id: emp.id },
        data: { tasksCompleted: { increment: 1 }, lastActiveAt: new Date() },
      })

      return NextResponse.json({ ok: true, output, employee: updated })
    }

    // Create / hire a new AI Employee, Bot, or Subagent
    const name = String(body.name ?? '').trim()
    const role = String(body.role ?? '').trim()
    if (!name || !role) {
      return NextResponse.json({ ok: false, error: 'name and role are required' }, { status: 400 })
    }

    const kind = ['employee', 'bot', 'subagent'].includes(String(body.kind)) ? String(body.kind) : 'employee'
    const title = String(body.title ?? (kind === 'bot' ? 'Autonomous Bot' : 'AI Specialist')).trim()
    const department = String(body.department ?? (kind === 'bot' ? 'Automation' : 'Engineering')).trim()
    const autonomy = body.autonomy === 'supervised' ? 'supervised' : 'autonomous'
    const icon = String(body.icon ?? 'bot').trim() || 'bot'
    const skills = Array.isArray(body.skills) ? body.skills.map(String) : []
    const tools = Array.isArray(body.tools) ? body.tools.map(String) : []
    const systemPrompt = String(body.systemPrompt ?? `You are ${name}, ${title}. ${role}`).trim()

    let reportsToId: string | null = null
    if (typeof body.reportsToId === 'string' && body.reportsToId.trim()) {
      const mgr = await db.aiEmployee.findUnique({ where: { id: body.reportsToId.trim() } })
      if (mgr) reportsToId = mgr.id
    }

    const baseSlug = slugify(name, kind)
    const existing = await db.aiEmployee.findUnique({ where: { slug: baseSlug } })
    const slug = existing ? `${baseSlug}-${Date.now().toString(36).slice(-4)}` : baseSlug

    const employee = await db.aiEmployee.create({
      data: {
        slug,
        name: name.slice(0, 80),
        title: title.slice(0, 80),
        department: department.slice(0, 50),
        kind,
        role: role.slice(0, 400),
        reportsToId,
        systemPrompt: systemPrompt.slice(0, 3000),
        skillsJson: JSON.stringify(skills),
        toolsJson: JSON.stringify(tools),
        autonomy,
        status: 'active',
        icon,
      },
    })

    // Bots also expose a callable x_<slug> tool so pipelines and voice can invoke them directly
    if (kind === 'bot') {
      const toolSlug = `x_${slug}`
      await db.plugin.upsert({
        where: { slug },
        update: { installed: true, enabled: true, toolSlug, description: role.slice(0, 300) },
        create: {
          slug,
          name: employee.name,
          description: role.slice(0, 300),
          category: 'automation',
          icon: 'bot',
          source: 'custom',
          installed: true,
          enabled: true,
          toolSlug,
          configJson: JSON.stringify({
            type: 'llm',
            instructions: employee.systemPrompt,
            endpoint: '',
            inputHint: '{"input": string}',
          }),
        },
      })
      await db.tool.upsert({
        where: { slug: toolSlug },
        update: { name: employee.name, description: `${role.slice(0, 200)} Args: {"input": string}`, source: `plugin:${slug}`, enabled: true },
        create: { slug: toolSlug, name: employee.name, description: `${role.slice(0, 200)} Args: {"input": string}`, source: `plugin:${slug}`, enabled: true },
      })
    }

    return NextResponse.json({ ok: true, employee })
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
      title?: string
      department?: string
      kind?: string
      role?: string
      reportsToId?: string | null
      systemPrompt?: string
      skills?: string[]
      tools?: string[]
      autonomy?: string
      status?: string
    }
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

    const existing = await db.aiEmployee.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Org member not found' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80)
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 80)
    if (typeof body.department === 'string' && body.department.trim()) patch.department = body.department.trim().slice(0, 50)
    if (typeof body.kind === 'string' && ['employee', 'bot', 'subagent'].includes(body.kind)) patch.kind = body.kind
    if (typeof body.role === 'string' && body.role.trim()) patch.role = body.role.trim().slice(0, 400)
    if (typeof body.systemPrompt === 'string') patch.systemPrompt = body.systemPrompt.slice(0, 3000)
    if (Array.isArray(body.skills)) patch.skillsJson = JSON.stringify(body.skills.map(String))
    if (Array.isArray(body.tools)) patch.toolsJson = JSON.stringify(body.tools.map(String))
    if (body.autonomy === 'supervised' || body.autonomy === 'autonomous') patch.autonomy = body.autonomy
    if (body.status === 'active' || body.status === 'paused') patch.status = body.status

    if (body.reportsToId !== undefined) {
      if (body.reportsToId === null || body.reportsToId === '') {
        patch.reportsToId = null
      } else {
        const nextMgrId = String(body.reportsToId).trim()
        if (nextMgrId === id) {
          return NextResponse.json({ ok: false, error: 'Cannot report to self' }, { status: 400 })
        }
        // Prevent reporting cycles by walking ancestor chain
        const all = await db.aiEmployee.findMany()
        const byId = new Map(all.map((e) => [e.id, e]))
        let cursor: string | null = nextMgrId
        const visited = new Set<string>()
        while (cursor) {
          if (cursor === id) {
            return NextResponse.json({ ok: false, error: 'Circular reporting hierarchy detected' }, { status: 400 })
          }
          if (visited.has(cursor)) break
          visited.add(cursor)
          cursor = byId.get(cursor)?.reportsToId ?? null
        }
        patch.reportsToId = nextMgrId
      }
    }

    const employee = await db.aiEmployee.update({ where: { id }, data: patch })
    return NextResponse.json({ ok: true, employee })
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
    await db.aiEmployee.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
