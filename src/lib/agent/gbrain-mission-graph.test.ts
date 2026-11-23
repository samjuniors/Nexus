import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationDTO, GBrainNodeDTO, RunDTO, RunEventDTO } from './client'
import {
  buildMissionOverlayGraph,
  computeMissionOverlayLayout,
  selectActiveMissionRun,
} from './gbrain-mission-graph'
import type { ReasoningChain } from './reasoning-chain'
import type { SelfHealSession } from './self-heal'

function ev(seq: number, type: string, data: Record<string, unknown>): RunEventDTO {
  return {
    id: `ev-${seq}`,
    seq,
    type,
    data,
    createdAt: '2026-11-22T10:00:00.000Z',
  }
}

function makeRun(overrides: Partial<RunDTO> = {}): RunDTO {
  return {
    id: overrides.id ?? 'run-1',
    userMessage: overrides.userMessage ?? 'Audit codebase and generate release notes',
    status: overrides.status ?? 'executing',
    createdAt: overrides.createdAt ?? '2026-11-22T10:00:00.000Z',
    events: overrides.events ?? [],
  }
}

function makeConv(id: string, runs: RunDTO[], updatedAt = '2026-11-22T10:00:00.000Z'): ConversationDTO {
  return {
    id,
    title: id,
    messages: [],
    runs,
    suggestions: [],
    updatedAt,
  }
}

const sampleGBrainNodes: Pick<GBrainNodeDTO, 'id' | 'name' | 'variants'>[] = [
  { id: 'ent-eva', name: 'Eva', variants: ['cat:agents', 'orchestrator'] },
  { id: 'ent-researcher', name: 'Researcher', variants: ['cat:agents'] },
  { id: 'ent-web', name: 'web_search', variants: ['cat:tools', 'web search'] },
  { id: 'ent-shell', name: 'run_shell', variants: ['cat:tools', 'powershell'] },
  { id: 'ent-heal', name: 'self_heal_code', variants: ['cat:tools', 'self heal'] },
]

describe('gbrain-mission-graph', () => {
  it('selectActiveMissionRun prioritizes runningRunId > activeConvId > latest run', () => {
    const convA = makeConv(
      'conv-a',
      [
        makeRun({ id: 'run-old', createdAt: '2026-11-22T08:00:00.000Z', status: 'done' }),
        makeRun({ id: 'run-active', createdAt: '2026-11-22T09:00:00.000Z', status: 'done' }),
      ],
      '2026-11-22T09:00:00.000Z'
    )
    const convB = makeConv(
      'conv-b',
      [makeRun({ id: 'run-streaming', createdAt: '2026-11-22T11:00:00.000Z', status: 'executing' })],
      '2026-11-22T11:00:00.000Z'
    )

    const byRunning = selectActiveMissionRun([convA, convB], 'conv-a', 'run-streaming')
    assert.equal(byRunning.run?.id, 'run-streaming')
    assert.equal(byRunning.live, true)

    const byConv = selectActiveMissionRun([convA, convB], 'conv-a', null)
    assert.equal(byConv.run?.id, 'run-active')
    assert.equal(byConv.live, false)

    const byLatest = selectActiveMissionRun([convA, convB], null, null)
    assert.equal(byLatest.run?.id, 'run-streaming')
    assert.equal(byLatest.live, true)
  })

  it('builds sequential mission DAG with live done/running/pending statuses and tool executions', () => {
    const run = makeRun({
      status: 'executing',
      events: [
        ev(1, 'analysis', {
          analysis: 'Run diagnostics then summarize findings',
          steps: [
            { id: 1, description: 'Search docs for latest API spec', assignee: 'Eva', uses: ['web_search'] },
            { id: 2, description: 'Run local shell verification', assignee: 'Eva', uses: ['run_shell'] },
            { id: 3, description: 'Summarize final report', assignee: 'Eva', uses: [] },
          ],
          subagents: [],
        }),
        ev(2, 'step_start', { stepId: 1 }),
        ev(3, 'tool_result', { stepId: 1, tool: 'web_search', summary: 'Found 4 docs', ok: true }),
        ev(4, 'step_done', { stepId: 1, result: 'Collected latest spec.' }),
        ev(5, 'step_start', { stepId: 2 }),
      ],
    })

    const graph = buildMissionOverlayGraph({ run, live: true, gbrainNodes: sampleGBrainNodes })
    assert.equal(graph.hasMission, true)
    assert.equal(graph.source, 'run')
    assert.equal(graph.nodes.length, 4) // 1 root + 3 tasks
    assert.equal(graph.completed, 1)
    assert.equal(graph.running, 1)
    assert.equal(graph.pending, 1)

    const step1 = graph.nodes.find((n) => n.stepId === 1)!
    const step2 = graph.nodes.find((n) => n.stepId === 2)!
    const step3 = graph.nodes.find((n) => n.stepId === 3)!

    assert.equal(step1.status, 'done')
    assert.equal(step1.toolExecutions.length, 1)
    assert.equal(step1.resultPreview, 'Collected latest spec.')
    assert.equal(step2.status, 'running')
    assert.deepEqual(step2.dependsOn, [step1.id])
    assert.equal(step3.status, 'pending')
    assert.deepEqual(step3.dependsOn, [step2.id])

    // Knowledge bridges link web_search & run_shell into GBrain entities
    assert.ok(step1.linkedEntityIds.includes('ent-web'))
    assert.ok(step2.linkedEntityIds.includes('ent-shell'))
    assert.ok(graph.edges.some((e) => e.edgeKind === 'knowledge_bridge' && e.targetId === 'ent-web'))
  })

  it('propagates blocked status to downstream dependent tasks when an upstream task fails', () => {
    const run = makeRun({
      status: 'error',
      events: [
        ev(1, 'analysis', {
          analysis: 'Deploy pipeline',
          steps: [
            { id: 1, description: 'Build artifacts', assignee: 'Eva', uses: ['run_shell'] },
            { id: 2, description: 'Run integration tests', assignee: 'Eva', uses: ['run_shell'] },
            { id: 3, description: 'Publish release', assignee: 'Eva', uses: [] },
          ],
        }),
        ev(2, 'step_start', { stepId: 1 }),
        ev(3, 'error', { message: 'Build compilation failed' }),
      ],
    })

    const graph = buildMissionOverlayGraph({ run, live: false, gbrainNodes: sampleGBrainNodes })
    const step1 = graph.nodes.find((n) => n.stepId === 1)!
    const step2 = graph.nodes.find((n) => n.stepId === 2)!
    const step3 = graph.nodes.find((n) => n.stepId === 3)!

    assert.equal(step1.status, 'failed')
    assert.equal(step2.status, 'blocked')
    assert.equal(step3.status, 'blocked')
    assert.equal(graph.failed, 1)
    assert.equal(graph.blocked, 2)
  })

  it('builds parallel multi-subagent fan-out and convergence DAG edges', () => {
    const run = makeRun({
      status: 'executing',
      events: [
        ev(1, 'analysis', {
          analysis: 'Parallel specialist research and audit',
          steps: [
            { id: 1, description: 'Scope mission requirements', assignee: 'Eva', uses: [] },
            { id: 2, description: 'Research external benchmarks', assignee: 'Researcher', uses: ['web_search'] },
            { id: 3, description: 'Audit local repository tests', assignee: 'Engineer', uses: ['run_shell'] },
            { id: 4, description: 'Synthesize final recommendation', assignee: 'Eva', uses: [] },
          ],
          subagents: [
            { name: 'Researcher', role: 'Web Analyst', steps: [2] },
            { name: 'Engineer', role: 'Code Auditor', steps: [3] },
          ],
        }),
      ],
    })

    const graph = buildMissionOverlayGraph({ run, live: true, gbrainNodes: sampleGBrainNodes })
    const step1 = graph.nodes.find((n) => n.stepId === 1)!
    const step2 = graph.nodes.find((n) => n.stepId === 2)!
    const step3 = graph.nodes.find((n) => n.stepId === 3)!
    const step4 = graph.nodes.find((n) => n.stepId === 4)!

    // Both specialist steps branch off Step 1 in parallel at depth 2
    assert.deepEqual(step2.dependsOn, [step1.id])
    assert.deepEqual(step3.dependsOn, [step1.id])
    assert.equal(step2.dagDepth, 2)
    assert.equal(step3.dagDepth, 2)
    assert.equal(step2.assigneeRole, 'Web Analyst')

    // Synthesis Step 4 converges both parallel lanes at depth 3
    assert.deepEqual(step4.dependsOn.sort(), [step2.id, step3.id].sort())
    assert.equal(step4.dagDepth, 3)
  })

  it('honors explicit dependsOn arrays on plan steps', () => {
    const run = makeRun({
      status: 'executing',
      events: [
        ev(1, 'analysis', {
          steps: [
            { id: 1, description: 'Fetch schema', assignee: 'Eva', uses: [] },
            { id: 2, description: 'Fetch metrics', assignee: 'Eva', uses: [], dependsOn: [] },
            { id: 3, description: 'Join schema and metrics', assignee: 'Eva', uses: [], dependsOn: [1, 2] },
          ],
        }),
      ],
    })

    const graph = buildMissionOverlayGraph({ run, live: true })
    const root = graph.nodes.find((n) => n.nodeKind === 'mission_root')!
    const step1 = graph.nodes.find((n) => n.stepId === 1)!
    const step2 = graph.nodes.find((n) => n.stepId === 2)!
    const step3 = graph.nodes.find((n) => n.stepId === 3)!

    assert.deepEqual(step1.dependsOn, [root.id])
    assert.deepEqual(step2.dependsOn, [root.id])
    assert.deepEqual(step3.dependsOn.sort(), [step1.id, step2.id].sort())
  })

  it('computes collision-free finite DAG layout in both overlay and focused mission modes', () => {
    const run = makeRun({
      status: 'executing',
      events: [
        ev(1, 'analysis', {
          steps: [
            { id: 1, description: 'Plan scope', assignee: 'Eva', uses: [] },
            { id: 2, description: 'Branch A', assignee: 'Researcher', uses: [] },
            { id: 3, description: 'Branch B', assignee: 'Engineer', uses: [] },
            { id: 4, description: 'Synthesize result', assignee: 'Eva', uses: [] },
          ],
        }),
      ],
    })

    const graph = buildMissionOverlayGraph({ run, live: true })
    const anchor = { minX: 100, minY: 200, maxX: 1100, maxY: 900, width: 1000, height: 700 }
    const overlay = computeMissionOverlayLayout(graph, anchor, false)
    const focused = computeMissionOverlayLayout(graph, null, true)

    assert.ok(overlay.zone)
    assert.ok(overlay.zone.y + overlay.zone.height < anchor.minY, 'Overlay zone should sit cleanly above GBrain anchor')
    assert.equal(overlay.nodes.length, 5)
    assert.equal(focused.nodes.length, 5)

    for (const layout of [overlay, focused]) {
      for (const item of layout.nodes) {
        assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y))
      }
      // Verify zero pairwise overlap
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          const a = layout.nodes[i]
          const b = layout.nodes[j]
          const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2
          const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2
          assert.equal(overlapX && overlapY, false, `Overlap between ${a.node.id} and ${b.node.id}`)
        }
      }
    }
  })

  it('falls back cleanly to SelfHealSession or ReasoningChain when no active chat run exists', () => {
    const session: SelfHealSession = {
      id: 'heal-1',
      trigger: 'user_request',
      title: 'Repair broken TypeScript import',
      status: 'verified',
      createdAt: '2026-11-22T10:00:00.000Z',
      updatedAt: '2026-11-22T10:00:05.000Z',
      patches: [],
      verification: null,
      snapshotId: null,
      canRollback: false,
      steps: [
        { id: 's1', phase: 'diagnose', label: 'Diagnose error trace', timestamp: '2026-11-22T10:00:01.000Z' },
        { id: 's2', phase: 'verify', label: 'Verify typecheck passes', timestamp: '2026-11-22T10:00:04.000Z' },
      ],
      summary: 'Patched missing import',
    }
    const healGraph = buildMissionOverlayGraph({
      run: null,
      selfHealSession: session,
      gbrainNodes: sampleGBrainNodes,
    })
    assert.equal(healGraph.hasMission, true)
    assert.equal(healGraph.source, 'self_heal')
    assert.equal(healGraph.completed, 2)
    assert.ok(healGraph.linkedEntityIds.includes('ent-heal'))

    const chain: ReasoningChain = {
      id: 'chain-1',
      source: 'mission',
      goal: 'Investigate latency regression',
      actor: 'Eva',
      status: 'active',
      startedAt: '2026-11-22T10:00:00.000Z',
      updatedAt: '2026-11-22T10:00:02.000Z',
      decisionCount: 2,
      correctionCount: 0,
      verificationPassed: null,
      nodes: [
        { id: 'n0', seq: 1, kind: 'goal', title: 'Investigate latency', detail: '', actor: 'Eva', createdAt: '2026-11-22T10:00:00.000Z' },
        { id: 'n1', seq: 2, kind: 'decision', title: 'Check DB indexes', detail: 'Query p99 spike', actor: 'Eva', tool: 'run_shell', createdAt: '2026-11-22T10:00:01.000Z' },
      ],
    }
    const chainGraph = buildMissionOverlayGraph({
      run: null,
      reasoningChain: chain,
      gbrainNodes: sampleGBrainNodes,
    })
    assert.equal(chainGraph.hasMission, true)
    assert.equal(chainGraph.source, 'reasoning')
    assert.equal(chainGraph.nodes.length, 2)
  })
})
