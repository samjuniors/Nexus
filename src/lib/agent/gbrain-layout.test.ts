import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeGBrainLayout,
  type GBrainLayoutEdgeInput,
  type GBrainLayoutMode,
  type GBrainLayoutNodeInput,
} from './gbrain-layout'

function buildSampleGraph(count: number): {
  nodes: GBrainLayoutNodeInput[]
  edges: GBrainLayoutEdgeInput[]
} {
  const origins = ['memory', 'dream', 'manual']
  const nodes: GBrainLayoutNodeInput[] = []
  const edges: GBrainLayoutEdgeInput[] = []

  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `ent_${i}`,
      name: `Entity ${i}`,
      degree: 0,
      origin: origins[i % origins.length],
    })
  }

  let edgeId = 0
  // Connect top hubs to clusters, leaving last ~15% as orphans
  const connectedLimit = Math.max(1, Math.floor(count * 0.85))
  for (let i = 1; i < connectedLimit; i++) {
    const hubIdx = i % Math.min(4, count)
    if (hubIdx !== i) {
      edges.push({
        id: `e_${edgeId++}`,
        sourceId: nodes[hubIdx].id,
        targetId: nodes[i].id,
        relation: 'related_to',
        kind: i % 3 === 0 ? 'INFERRED' : 'EXTRACTED',
      })
      nodes[hubIdx].degree += 1
      nodes[i].degree += 1
    }
    if (i > 4 && i % 4 === 0) {
      edges.push({
        id: `e_${edgeId++}`,
        sourceId: nodes[i - 1].id,
        targetId: nodes[i].id,
        relation: 'depends_on',
        kind: 'EXTRACTED',
      })
      nodes[i - 1].degree += 1
      nodes[i].degree += 1
    }
  }

  return { nodes, edges }
}

describe('computeGBrainLayout', () => {
  it('handles empty graphs cleanly across all layout modes', () => {
    const modes: GBrainLayoutMode[] = ['clustered', 'hierarchy', 'force']
    for (const mode of modes) {
      const res = computeGBrainLayout([], [], mode, { width: 1000, height: 600 })
      assert.equal(res.nodes.length, 0)
      assert.equal(res.clusters.length, 0)
      assert.equal(res.bounds.width, 1000)
      assert.equal(res.bounds.height, 600)
    }
  })

  it('produces identical deterministic coordinates on repeated invocations', () => {
    const { nodes, edges } = buildSampleGraph(28)
    const modes: GBrainLayoutMode[] = ['clustered', 'hierarchy', 'force']

    for (const mode of modes) {
      const first = computeGBrainLayout(nodes, edges, mode)
      const second = computeGBrainLayout(nodes, edges, mode)

      assert.equal(first.nodes.length, nodes.length)
      assert.equal(second.nodes.length, nodes.length)

      for (let i = 0; i < first.nodes.length; i++) {
        assert.equal(first.nodes[i].node.id, second.nodes[i].node.id)
        assert.equal(first.nodes[i].x, second.nodes[i].x)
        assert.equal(first.nodes[i].y, second.nodes[i].y)
        assert.equal(first.nodes[i].r, second.nodes[i].r)
      }
    }
  })

  it('produces finite, collision-free node placements and valid bounds for dense graphs', () => {
    const { nodes, edges } = buildSampleGraph(42)
    const modes: GBrainLayoutMode[] = ['clustered', 'hierarchy', 'force']

    for (const mode of modes) {
      const res = computeGBrainLayout(nodes, edges, mode, { width: 1200, height: 760 })
      assert.equal(res.nodes.length, 42)
      assert.ok(Number.isFinite(res.bounds.minX))
      assert.ok(Number.isFinite(res.bounds.maxX))
      assert.ok(res.bounds.width >= 240)
      assert.ok(res.bounds.height >= 200)

      for (const item of res.nodes) {
        assert.ok(Number.isFinite(item.x), `${mode}: x must be finite`)
        assert.ok(Number.isFinite(item.y), `${mode}: y must be finite`)
        assert.ok(item.r >= 8, `${mode}: radius must be >= 8`)
        assert.ok(item.x >= res.bounds.minX && item.x <= res.bounds.maxX)
        assert.ok(item.y >= res.bounds.minY && item.y <= res.bounds.maxY)
      }

      // Check zero physical node overlaps
      for (let i = 0; i < res.nodes.length; i++) {
        for (let j = i + 1; j < res.nodes.length; j++) {
          const a = res.nodes[i]
          const b = res.nodes[j]
          const dist = Math.hypot(b.x - a.x, b.y - a.y)
          assert.ok(
            dist >= a.r + b.r - 0.5,
            `${mode}: nodes ${a.node.id} and ${b.node.id} overlap (dist=${dist.toFixed(2)}, min=${(a.r + b.r).toFixed(2)})`
          )
        }
      }
    }
  })

  it('builds semantic cluster halos in clustered orbital mode and stratified rows in hierarchy mode', () => {
    const { nodes, edges } = buildSampleGraph(24)

    const clustered = computeGBrainLayout(nodes, edges, 'clustered')
    assert.ok(clustered.clusters.length >= 2)
    assert.ok(clustered.clusters.some((c) => c.key === 'core'))
    const totalClusterCount = clustered.clusters.reduce((acc, c) => acc + c.count, 0)
    assert.equal(totalClusterCount, nodes.length)

    const hierarchy = computeGBrainLayout(nodes, edges, 'hierarchy')
    assert.equal(hierarchy.clusters.length, 0)
    const distinctY = new Set(hierarchy.nodes.map((n) => Math.round(n.y)))
    assert.ok(distinctY.size >= 2, 'hierarchy mode should arrange nodes into multiple horizontal strata')
  })

  it('classifies entities into semantic categories, honors explicit cat tags, and spaces structured cards without overlap', async () => {
    const { classifyGBrainEntity, visibleAliases } = await import('./gbrain-categories')
    assert.equal(classifyGBrainEntity('Eva Lead Agent'), 'agents')
    assert.equal(classifyGBrainEntity('Playwright Browser Tool'), 'tools')
    assert.equal(classifyGBrainEntity('Nexus Agent OS'), 'projects')
    assert.equal(classifyGBrainEntity('Permission Policy Rule'), 'facts')
    assert.equal(classifyGBrainEntity('Custom Entity', ['cat:people', 'Founder']), 'people')
    assert.deepEqual(visibleAliases(['cat:people', 'Founder', 'CEO']), ['Founder', 'CEO'])

    const categorized = buildSampleGraph(18)
    const cats = ['agents', 'projects', 'tools', 'concepts', 'people', 'facts'] as const
    const typedNodes = categorized.nodes.map((n, i) => ({
      ...n,
      category: cats[i % cats.length],
    }))
    const cardRes = computeGBrainLayout(typedNodes, categorized.edges, 'clustered', {
      width: 1280,
      height: 820,
      cardSpacing: true,
    })
    assert.equal(cardRes.nodes.length, 18)
    assert.ok(cardRes.clusters.some((c) => c.category !== undefined))
  })
})
