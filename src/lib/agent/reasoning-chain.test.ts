import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ReasoningChainManager,
  summarizeReasoningChain,
  type ReasoningChain,
} from './reasoning-chain'

describe('ReasoningChainManager', () => {
  it('starts a chain with a root goal node and tracks runId lookup', () => {
    const mgr = new ReasoningChainManager()
    const chain = mgr.startChain({
      source: 'browser_autopilot',
      goal: 'Open YouTube and play Rafta Rafta',
      actor: 'Eva',
      runId: 'run-101',
      url: 'https://www.youtube.com',
    })

    assert.equal(chain.status, 'active')
    assert.equal(chain.source, 'browser_autopilot')
    assert.equal(chain.goal, 'Open YouTube and play Rafta Rafta')
    assert.equal(chain.nodes.length, 1)
    assert.equal(chain.nodes[0].kind, 'goal')
    assert.equal(chain.nodes[0].seq, 1)
    assert.equal(chain.nodes[0].url, 'https://www.youtube.com')
    assert.equal(chain.decisionCount, 0)
    assert.equal(chain.correctionCount, 0)
    assert.equal(chain.verificationPassed, null)

    const byRun = mgr.getChainByRunId('run-101')
    assert.ok(byRun)
    assert.equal(byRun.id, chain.id)
  })

  it('records decision, observation, self_correction, and verification nodes and transitions status to corrected', () => {
    const mgr = new ReasoningChainManager()
    const chain = mgr.startChain({
      source: 'browser_autopilot',
      goal: 'Play Rafta Rafta on YouTube',
    })

    const decision = mgr.addNode(chain.id, {
      kind: 'decision',
      title: 'Search YouTube directly',
      detail: 'Navigating to YouTube search results for Rafta Rafta.',
      tool: 'browser_play_media',
      url: 'https://www.youtube.com/results?search_query=Rafta+Rafta',
    })
    assert.ok(decision)
    assert.equal(decision.seq, 2)

    const observation = mgr.addNode(chain.id, {
      kind: 'observation',
      title: 'Overlay blocked click',
      detail: 'Consent overlay intercepted the primary result tile.',
    })
    assert.ok(observation)
    assert.equal(observation.seq, 3)

    const correction = mgr.addNode(chain.id, {
      kind: 'self_correction',
      title: 'Pivot to direct watch URL extraction',
      detail: 'Bypassed overlay by parsing the top /watch?v= anchor directly.',
      correction: {
        whatFailed: 'Primary click selector timed out under consent banner',
        pivotStrategy: 'Extract watch URL from DOM and navigate directly with autoplay trigger',
      },
    })
    assert.ok(correction)
    assert.equal(correction.correction?.whatFailed, 'Primary click selector timed out under consent banner')
    assert.equal(
      correction.correction?.pivotStrategy,
      'Extract watch URL from DOM and navigate directly with autoplay trigger'
    )

    const completed = mgr.completeChain(chain.id, {
      ok: true,
      verificationDetail: 'HTML5 video element advancing (currentTime > 1.5s).',
      url: 'https://www.youtube.com/watch?v=example',
    })

    assert.ok(completed)
    assert.equal(completed.status, 'corrected')
    assert.equal(completed.decisionCount, 1)
    assert.equal(completed.correctionCount, 1)
    assert.equal(completed.verificationPassed, true)
    assert.ok(completed.completedAt)
    assert.equal(completed.nodes.length, 5)
    assert.equal(completed.nodes[4].kind, 'verification')
    assert.equal(completed.nodes[4].verified, true)

    const summary = summarizeReasoningChain(completed)
    assert.equal(summary.id, chain.id)
    assert.equal(summary.status, 'corrected')
    assert.equal(summary.decisionCount, 1)
    assert.equal(summary.correctionCount, 1)
    assert.equal(summary.verificationPassed, true)
    assert.equal(summary.latestNode?.kind, 'verification')
  })

  it('marks clean runs without self-corrections as completed and failed runs as failed', () => {
    const mgr = new ReasoningChainManager()
    const clean = mgr.startChain({ source: 'mission', goal: 'Summarize repository health' })
    mgr.addNode(clean.id, { kind: 'decision', title: 'Inspect files', detail: 'Reading docs' })
    const cleanDone = mgr.completeChain(clean.id, {
      ok: true,
      verificationDetail: 'Summary delivered with evidence.',
    })
    assert.equal(cleanDone?.status, 'completed')

    const failed = mgr.startChain({ source: 'voice_live', goal: 'Trigger unavailable tool' })
    const failDone = mgr.completeChain(failed.id, {
      ok: false,
      verificationDetail: 'Permission denied by user.',
    })
    assert.equal(failDone?.status, 'failed')
    assert.equal(failDone?.verificationPassed, false)
  })

  it('notifies subscribers on update and clear and honors unsubscribe', () => {
    const mgr = new ReasoningChainManager()
    const events: string[] = []
    const unsub = mgr.subscribe((ev) => {
      events.push(ev.type === 'update' ? `update:${ev.chain.status}:${ev.chain.nodes.length}` : 'clear')
    })

    const chain = mgr.startChain({ source: 'mission', goal: 'Track telemetry' })
    mgr.addNode(chain.id, { kind: 'decision', title: 'Step 1', detail: 'Executing' })
    mgr.completeChain(chain.id, { ok: true })
    mgr.clearChains()

    assert.deepEqual(events, ['update:active:1', 'update:active:2', 'update:completed:2', 'clear'])

    unsub()
    mgr.startChain({ source: 'mission', goal: 'After unsubscribe' })
    assert.equal(events.length, 4)
  })

  it('enforces bounded chain retention (max 40) and bounded node retention (max 80) while preserving root goal', () => {
    const mgr = new ReasoningChainManager()
    let firstId = ''
    for (let i = 0; i < 45; i++) {
      const c = mgr.startChain({ source: 'mission', goal: `Goal ${i}` })
      if (i === 0) firstId = c.id
    }

    const listed = mgr.listChains(100)
    assert.equal(listed.length, 40)
    assert.equal(mgr.getChain(firstId), null)

    const dense = mgr.startChain({ source: 'browser_autopilot', goal: 'Long navigation' })
    for (let i = 0; i < 95; i++) {
      mgr.addNode(dense.id, {
        kind: 'decision',
        title: `Decision ${i}`,
        detail: `Detail ${i}`,
      })
    }

    const loaded = mgr.getChain(dense.id) as ReasoningChain
    assert.equal(loaded.nodes.length, 80)
    assert.equal(loaded.nodes[0].kind, 'goal')
    assert.equal(loaded.decisionCount, 95)
  })

  it('returns defensive clones so external mutations do not corrupt internal state', () => {
    const mgr = new ReasoningChainManager()
    const chain = mgr.startChain({ source: 'voice_live', goal: 'Open GBrain' })
    chain.goal = 'MUTATED'
    chain.nodes.push({
      id: 'fake',
      seq: 99,
      kind: 'decision',
      title: 'Injected',
      detail: 'Should not persist',
      actor: 'Unknown',
      createdAt: new Date().toISOString(),
    })

    const fresh = mgr.getChain(chain.id)
    assert.ok(fresh)
    assert.equal(fresh.goal, 'Open GBrain')
    assert.equal(fresh.nodes.length, 1)
  })
})
