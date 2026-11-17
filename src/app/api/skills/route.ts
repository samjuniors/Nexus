import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded, DEFAULT_SKILLS } from '@/lib/agent/seed'

export const runtime = 'nodejs'

export async function GET() {
  try {
    await ensureSeeded()
    const skills = await db.skill.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json({ ok: true, skills })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; enabled?: boolean }
    if (!body.id || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'id and enabled required' }, { status: 400 })
    }
    const skill = await db.skill.update({ where: { id: body.id }, data: { enabled: body.enabled } })
    return NextResponse.json({ ok: true, skill })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Create a custom skill, or restore the default skill set
export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      restoreDefaults?: boolean
      name?: string
      description?: string
      category?: string
      icon?: string
      prompt?: string
    }

    if (body.restoreDefaults) {
      const existing = await db.skill.findMany({ select: { slug: true } })
      const have = new Set(existing.map((s) => s.slug))
      const missing = DEFAULT_SKILLS.filter((s) => !have.has(s.slug))
      for (const s of missing) {
        await db.skill.create({ data: { ...s, enabled: true } })
      }
      const skills = await db.skill.findMany({ orderBy: { name: 'asc' } })
      return NextResponse.json({ ok: true, restored: missing.length, skills })
    }

    const name = (body.name ?? '').trim()
    const prompt = (body.prompt ?? '').trim()
    if (!name) return NextResponse.json({ ok: false, error: 'Skill name is required' }, { status: 400 })
    if (!prompt) return NextResponse.json({ ok: false, error: 'Skill prompt is required' }, { status: 400 })

    let slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'skill'
    if (await db.skill.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    }

    const skill = await db.skill.create({
      data: {
        slug,
        name: name.slice(0, 80),
        description: (body.description ?? 'Custom skill').slice(0, 300),
        category: (body.category ?? 'custom').slice(0, 40),
        icon: (body.icon ?? 'sparkles').slice(0, 30),
        prompt: prompt.slice(0, 4000),
        enabled: true,
      },
    })
    return NextResponse.json({ ok: true, skill })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Uninstall (delete) a skill — works for defaults and custom skills
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
    const skill = await db.skill.findUnique({ where: { id } })
    if (!skill) return NextResponse.json({ ok: false, error: 'Skill not found' }, { status: 404 })
    await db.skill.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
