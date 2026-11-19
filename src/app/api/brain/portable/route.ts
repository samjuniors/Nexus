import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getBrain } from '@/lib/agent/brain-host'

export interface PortableBrainBundle {
  format: 'nexus-portable-brain'
  version: 1
  exportedAt: string
  brainState: {
    personality: string
    appPrefsJson: string
  }
  memories: Array<{
    content: string
    type: string
    kind?: string
    source?: string
    importance?: number
    strength?: number
    truth?: string | null
    alwaysLoad?: boolean
    corePriority?: number | null
    metaJson?: string
  }>
  entities: Array<{
    name: string
    type: string
    variants?: string
    origin?: string
  }>
  edges: Array<{
    fromName: string
    toName: string
    kind: string
    weight?: number
  }>
}

/**
 * GET /api/brain/portable
 * Exports the entire NEXUS Brain (preferences, memories, entities, and graph edges)
 * as a self-contained portable JSON bundle that can be plugged into another instance.
 */
export async function GET() {
  try {
    const [brainState, memories, entities, edges] = await Promise.all([
      db.brainState.findFirst(),
      db.memory.findMany({ orderBy: { createdAt: 'asc' } }),
      db.memoryEntity.findMany({ orderBy: { createdAt: 'asc' } }),
      db.memoryEdge.findMany({ orderBy: { createdAt: 'asc' } }),
    ])

    const entityNameById = new Map(entities.map((e) => [e.id, e.name]))

    const bundle: PortableBrainBundle = {
      format: 'nexus-portable-brain',
      version: 1,
      exportedAt: new Date().toISOString(),
      brainState: {
        personality: brainState?.personality ?? 'NEXUS',
        appPrefsJson: brainState?.appPrefsJson ?? '{}',
      },
      memories: memories.map((m) => ({
        content: m.content,
        type: m.type,
        kind: m.kind,
        source: m.source,
        importance: m.importance,
        strength: m.strength,
        truth: m.truth,
        alwaysLoad: m.alwaysLoad,
        corePriority: m.corePriority,
        metaJson: m.metaJson,
      })),
      entities: entities.map((e) => ({
        name: e.name,
        type: e.type,
        variants: e.variants,
        origin: e.origin,
      })),
      edges: edges
        .map((ed) => {
          const fromName = entityNameById.get(ed.fromId)
          const toName = entityNameById.get(ed.toId)
          if (!fromName || !toName) return null
          return {
            fromName,
            toName,
            kind: ed.kind,
            weight: ed.weight,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    }

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="nexus-brain-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to export portable brain' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/brain/portable
 * Imports a portable `.nexus-brain.json` bundle, restores memories/entities/edges without
 * duplicating existing entries, restores preferences, and attaches the Brain automatically.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PortableBrainBundle>
    if (body.format !== 'nexus-portable-brain' || !Array.isArray(body.memories)) {
      return NextResponse.json(
        { error: 'Invalid portable brain file. Expected format: "nexus-portable-brain".' },
        { status: 400 }
      )
    }

    const existingMemories = await db.memory.findMany()
    const existingContents = new Set(existingMemories.map((m) => m.content.trim().toLowerCase()))

    let memoriesImported = 0
    for (const mem of body.memories) {
      const content = String(mem.content ?? '').trim()
      if (!content || existingContents.has(content.toLowerCase())) continue
      await db.memory.create({
        data: {
          content,
          type: String(mem.type ?? 'note'),
          kind: String(mem.kind ?? 'episodic'),
          source: String(mem.source ?? 'portable_import'),
          importance: Number(mem.importance ?? 3),
          strength: Number(mem.strength ?? 0.5),
          truth: mem.truth ?? null,
          alwaysLoad: Boolean(mem.alwaysLoad),
          corePriority: mem.corePriority ?? null,
          metaJson: typeof mem.metaJson === 'string' ? mem.metaJson : '{}',
        },
      })
      existingContents.add(content.toLowerCase())
      memoriesImported += 1
    }

    const existingEntities = await db.memoryEntity.findMany()
    const entityIdByLower = new Map(existingEntities.map((e) => [e.name.toLowerCase(), e.id]))

    let entitiesImported = 0
    if (Array.isArray(body.entities)) {
      for (const ent of body.entities) {
        const name = String(ent.name ?? '').trim()
        if (!name || entityIdByLower.has(name.toLowerCase())) continue
        const created = await db.memoryEntity.create({
          data: {
            name,
            type: String(ent.type ?? 'concept'),
            variants: typeof ent.variants === 'string' ? ent.variants : '[]',
            origin: String(ent.origin ?? 'portable_import'),
          },
        })
        entityIdByLower.set(name.toLowerCase(), created.id)
        entitiesImported += 1
      }
    }

    let edgesImported = 0
    if (Array.isArray(body.edges)) {
      const existingEdges = await db.memoryEdge.findMany()
      const edgeKeys = new Set(existingEdges.map((e) => `${e.fromId}:${e.toId}:${e.kind}`))
      for (const ed of body.edges) {
        const fromId = entityIdByLower.get(String(ed.fromName ?? '').toLowerCase())
        const toId = entityIdByLower.get(String(ed.toName ?? '').toLowerCase())
        const kind = String(ed.kind ?? 'INFERRED')
        if (!fromId || !toId || fromId === toId) continue
        const key = `${fromId}:${toId}:${kind}`
        if (edgeKeys.has(key)) continue
        await db.memoryEdge.create({
          data: {
            fromId,
            toId,
            kind,
            weight: Number(ed.weight ?? 1),
          },
        })
        edgeKeys.add(key)
        edgesImported += 1
      }
    }

    // Restore preferences and attach the Brain
    if (body.brainState?.appPrefsJson) {
      const row = await db.brainState.findFirst()
      if (row) {
        await db.brainState.update({
          where: { id: row.id },
          data: {
            personality: body.brainState.personality ?? row.personality,
            appPrefsJson: body.brainState.appPrefsJson,
            connected: true,
            connectedAt: new Date(),
          },
        })
      }
    }

    const brain = getBrain()
    await brain.connect()

    return NextResponse.json({
      ok: true,
      imported: {
        memories: memoriesImported,
        entities: entitiesImported,
        edges: edgesImported,
      },
      status: await brain.status(),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to import portable brain' },
      { status: 500 }
    )
  }
}
