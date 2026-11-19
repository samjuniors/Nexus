import assert from 'node:assert/strict'
import test from 'node:test'
import { extractMissionProgress } from './mission-progress'
import type { RunDTO } from './client'

function makeRun(partial: Partial<RunDTO>): RunDTO {
  return {
    id: partial.id ?? 'run-1',
    status: partial.status ?? 'running',
    userMessage: partial.userMessage ?? 'Research fusion energy breakthroughs',
    events: partial.events ?? [],
    createdAt: partial.createdAt ?? new Date().toISOString(),
  }
}

test('extractMissionProgress returns idle snapshot when no run exists', () => {
  const snap = extractMissionProgress(null, false)
  assert.equal(snap.hasMission, false)
  assert.equal(snap.phase, 'idle')
  assert.equal(snap.total, 0)
  assert.equal(snap.completed, 0)
  assert.equal(snap.percent, 0)
  assert.deepEqual(snap.subtasks, [])
})

test('extractMissionProgress synthesizes planning step when run has no analysis yet', () => {
  const snap = extractMissionProgress(makeRun({ status: 'planning', events: [] }), true)
  assert.equal(snap.hasMission, true)
  assert.equal(snap.phase, 'planning')
  assert.equal(snap.total, 1)
  assert.equal(snap.running, 1)
  assert.equal(snap.subtasks[0]?.status, 'running')
})

test('extractMissionProgress maps step_start and step_done into accurate subtask completion', () => {
  const run = makeRun({
    status: 'running',
    events: [
      {
        id: 'e1',
        seq: 1,
        type: 'analysis',
        createdAt: new Date().toISOString(),
        data: {
          steps: [
            { id: 1, description: 'Search papers', assignee: 'Researcher' },
            { id: 2, description: 'Cross-check metrics', assignee: 'Eva' },
            { id: 3, description: 'Synthesize summary', assignee: 'Eva' },
            { id: 4, description: 'Verify citations', assignee: 'Reviewer' },
          ],
        },
      },
      { id: 'e2', seq: 2, type: 'step_start', createdAt: new Date().toISOString(), data: { stepId: 1 } },
      { id: 'e3', seq: 3, type: 'step_done', createdAt: new Date().toISOString(), data: { stepId: 1 } },
      { id: 'e4', seq: 4, type: 'step_start', createdAt: new Date().toISOString(), data: { stepId: 2 } },
    ],
  })

  const snap = extractMissionProgress(run, true)
  assert.equal(snap.total, 4)
  assert.equal(snap.completed, 1)
  assert.equal(snap.running, 1)
  assert.equal(snap.pending, 2)
  assert.equal(snap.failed, 0)
  assert.equal(snap.subtasks[0]?.status, 'done')
  assert.equal(snap.subtasks[1]?.status, 'running')
  assert.equal(snap.subtasks[2]?.status, 'pending')
  assert.ok(snap.percent > 25 && snap.percent < 50)
})

test('extractMissionProgress marks failed active step when run errors', () => {
  const run = makeRun({
    status: 'error',
    events: [
      {
        id: 'e1',
        seq: 1,
        type: 'analysis',
        createdAt: new Date().toISOString(),
        data: {
          steps: [
            { id: 1, description: 'Open site', assignee: 'Eva' },
            { id: 2, description: 'Submit form', assignee: 'Eva' },
          ],
        },
      },
      { id: 'e2', seq: 2, type: 'step_start', createdAt: new Date().toISOString(), data: { stepId: 1 } },
      { id: 'e3', seq: 3, type: 'step_done', createdAt: new Date().toISOString(), data: { stepId: 1 } },
      { id: 'e4', seq: 4, type: 'step_start', createdAt: new Date().toISOString(), data: { stepId: 2 } },
      { id: 'e5', seq: 5, type: 'error', createdAt: new Date().toISOString(), data: { message: 'Timeout' } },
    ],
  })

  const snap = extractMissionProgress(run, false)
  assert.equal(snap.phase, 'error')
  assert.equal(snap.completed, 1)
  assert.equal(snap.failed, 1)
  assert.equal(snap.subtasks[1]?.status, 'failed')
})

test('extractMissionProgress normalizes completed runs to 100%', () => {
  const run = makeRun({
    status: 'done',
    events: [
      {
        id: 'e1',
        seq: 1,
        type: 'analysis',
        createdAt: new Date().toISOString(),
        data: {
          steps: [
            { id: 1, description: 'Step A', assignee: 'Eva' },
            { id: 2, description: 'Step B', assignee: 'Eva' },
          ],
        },
      },
      { id: 'e2', seq: 2, type: 'step_done', createdAt: new Date().toISOString(), data: { stepId: 1 } },
    ],
  })

  const snap = extractMissionProgress(run, false)
  assert.equal(snap.phase, 'done')
  assert.equal(snap.percent, 100)
  assert.equal(snap.completed, 2)
  assert.equal(snap.subtasks.every((s) => s.status === 'done'), true)
})
