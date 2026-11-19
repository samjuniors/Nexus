import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applySelfHealPatch,
  buildUnifiedDiff,
  resolveSafeAppPath,
  rollbackSelfHealSession,
} from './self-heal'
import { brainTrace } from './brain-trace'
import { runBrainTruthAudit } from './brain-truth-audit'
import {
  createContextPack,
  deleteContextPack,
  listContextPacks,
  toggleContextPack,
} from './brain-context-packs'

describe('Self-Heal path guardrails and unified diff engine', () => {
  it('allows app source paths and blocks traversal, env secrets, and protected directories', () => {
    const okSrc = resolveSafeAppPath('src/components/agent/self-heal-panel.tsx')
    assert.equal(okSrc.rel, 'src/components/agent/self-heal-panel.tsx')
    assert.equal(resolveSafeAppPath('package.json').rel, 'package.json')
    assert.equal(resolveSafeAppPath('brain/core/gate.ts').rel, 'brain/core/gate.ts')

    assert.throws(() => resolveSafeAppPath('.env'), /Protected environment file/i)
    assert.throws(() => resolveSafeAppPath('.env.local'), /Protected environment file/i)
    assert.throws(() => resolveSafeAppPath('../outside.ts'), /Invalid or unsafe path/i)
    assert.throws(() => resolveSafeAppPath('node_modules/foo/index.js'), /Protected directory/i)
    assert.throws(() => resolveSafeAppPath('.git/config'), /Protected directory/i)
    assert.throws(() => resolveSafeAppPath('README.md'), /scoped to app source directories/i)
  })

  it('produces accurate unified diffs with added and removed counts', () => {
    const before = 'const a = 1\nconst b = 2\nconst c = 3\n'
    const after = 'const a = 1\nconst b = 20\nconst b2 = 21\nconst c = 3\n'
    const res = buildUnifiedDiff('src/sample.ts', before, after)
    assert.equal(res.addedLines, 2)
    assert.equal(res.removedLines, 1)
    assert.ok(res.diff.includes('--- a/src/sample.ts'))
    assert.ok(res.diff.includes('+++ b/src/sample.ts'))
    assert.ok(res.diff.includes('-const b = 2'))
    assert.ok(res.diff.includes('+const b = 20'))
    assert.ok(res.diff.includes('+const b2 = 21'))
  })

  it('creates automatic backup snapshot on patch and restores original file on rollback', async () => {
    const rel = `src/lib/agent/__self_heal_tmp_${Date.now().toString(36)}.ts`
    const abs = path.join(process.cwd(), rel)
    const snapshotDir = path.join(process.cwd(), '.nexus-snapshots')
    const original = 'export const HEAL_MARKER = "before"\n'
    await fs.writeFile(abs, original, 'utf8')
    let snapshotId: string | null = null

    try {
      const patched = await applySelfHealPatch({
        trigger: 'agent_tool',
        title: 'Unit test surgical patch',
        edits: [
          {
            path: rel,
            mode: 'replace',
            target: '"before"',
            replacement: '"after"',
            summary: 'Flip marker to after',
          },
        ],
        verify: false,
      })

      assert.equal(patched.ok, true)
      assert.equal(patched.session.status, 'verified')
      assert.equal(patched.session.canRollback, true)
      assert.equal(patched.session.patches.length, 1)
      assert.equal(patched.session.patches[0].addedLines, 1)
      assert.equal(patched.session.patches[0].removedLines, 1)
      snapshotId = patched.session.snapshotId

      const afterDisk = await fs.readFile(abs, 'utf8')
      assert.equal(afterDisk, 'export const HEAL_MARKER = "after"\n')

      const rolled = await rollbackSelfHealSession(patched.session.id)
      assert.equal(rolled.ok, true)
      assert.equal(rolled.session.status, 'rolled_back')
      assert.equal(rolled.session.canRollback, false)

      const restoredDisk = await fs.readFile(abs, 'utf8')
      assert.equal(restoredDisk, original)
    } finally {
      await fs.rm(abs, { force: true })
      if (snapshotId) {
        await fs.rm(path.join(snapshotDir, `${snapshotId}.json`), { force: true })
      }
    }
  })
})

describe('GBrain Intelligence: Working Memory Trace, Truth Audit, and Scoped Context Packs', () => {
  it('pushes, lists, and clears live Working Memory Trace events cleanly', () => {
    brainTrace.clear()
    const ev = brainTrace.push({
      operation: 'recall',
      nodeIds: ['ent_1', 'ent_2', 'ent_1'],
      nodeNames: ['Eva Lead Agent', 'GBrain'],
      summary: 'Recalled core architecture context',
    })
    assert.equal(ev.operation, 'recall')
    assert.deepEqual(ev.nodeIds, ['ent_1', 'ent_2'])
    assert.equal(brainTrace.list(10).length, 1)

    brainTrace.clear()
    assert.equal(brainTrace.list(10).length, 0)
  })

  it('runs deterministic Truth Audit returning a structured report', async () => {
    const report = await runBrainTruthAudit({ deep: false })
    assert.equal(typeof report.scannedEntities, 'number')
    assert.equal(typeof report.scannedMemories, 'number')
    assert.equal(Array.isArray(report.findings), true)
    assert.equal(report.counts.total, report.findings.length)
  })

  it('creates, toggles, and deletes custom Scoped Brain Context Packs', async () => {
    const initial = await listContextPacks()
    assert.ok(initial.length >= 3, 'expected built-in context packs')

    const created = await createContextPack({
      name: 'Test Verification Pack',
      description: 'Temporary pack for unit test',
      categories: ['projects', 'facts'],
      active: true,
    })
    assert.equal(created.pack.name, 'Test Verification Pack')
    assert.equal(created.pack.active, true)

    const toggled = await toggleContextPack(created.pack.id, false)
    assert.equal(toggled.pack.active, false)

    const afterDelete = await deleteContextPack(created.pack.id)
    assert.equal(
      afterDelete.some((p) => p.id === created.pack.id),
      false
    )
  })
})
