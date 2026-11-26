import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCompanionAnchor } from './companion-anchor'
import {
  approveCompanyTicket,
  autoHireForTask,
  createCompanyTicket,
  deleteCompanyTicket,
  ensureAgentConfig,
  isAgentOverBudget,
  loadCompanyState,
  saveCompanyState,
  updateAgentPaperclipConfig,
} from './paperclip-company'

test('resolveCompanionAnchor repositions Eva cleanly by task context', () => {
  const idle = resolveCompanionAnchor({
    splitOpen: false,
    splitMode: 'browser',
    activeTab: 'agent',
    isWorking: false,
    visionActive: false,
  })
  assert.equal(idle.slot, 'bottom-right')
  assert.equal(idle.offsetX, 0)
  assert.equal(idle.offsetY, 0)

  const browser = resolveCompanionAnchor({
    splitOpen: true,
    splitMode: 'browser',
    activeTab: 'agent',
    isWorking: false,
    visionActive: false,
  })
  assert.equal(browser.slot, 'bottom-center-left')
  assert.ok(browser.offsetX < 0)

  const reasoning = resolveCompanionAnchor({
    splitOpen: true,
    splitMode: 'reasoning',
    activeTab: 'agent',
    isWorking: false,
    visionActive: false,
  })
  assert.equal(reasoning.slot, 'top-right-split')
  assert.ok(reasoning.offsetY < 0)

  const vision = resolveCompanionAnchor({
    splitOpen: false,
    splitMode: 'browser',
    activeTab: 'agent',
    isWorking: false,
    visionActive: true,
  })
  assert.equal(vision.slot, 'bottom-right-elevated')
  assert.ok(vision.offsetY < 0)
})

test('Paperclip tickets support queue, approval gate, and deletion lifecycle', () => {
  const ticket = createCompanyTicket({
    title: 'Verify production telemetry pipeline',
    priority: 'high',
    requiresApproval: true,
    status: 'needs_approval',
  })
  assert.match(ticket.key, /^[A-Z]{2,5}-\d+$/)
  assert.equal(ticket.status, 'needs_approval')

  const approved = approveCompanyTicket(ticket.id, 'Board')
  assert.ok(approved)
  assert.equal(approved.approvedBy, 'Board')
  assert.equal(approved.status, 'queued')

  const removed = deleteCompanyTicket(ticket.id)
  assert.equal(removed, true)
})

test('Paperclip budget policy enforces auto-throttle when agent exceeds monthly USD cap', () => {
  const state = loadCompanyState()
  const cfg = ensureAgentConfig(state, 'agent_budget_test', {
    monthlyBudgetUsd: 10,
    spentUsd: 10.25,
    autoThrottle: true,
  })
  const check = isAgentOverBudget(cfg, state)
  assert.equal(check.over, true)
  assert.match(check.reason ?? '', /exhausted/i)

  const relaxed = updateAgentPaperclipConfig('agent_budget_test', { autoThrottle: false })
  assert.equal(isAgentOverBudget(relaxed, state).over, false)
  delete state.agentConfigs['agent_budget_test']
  saveCompanyState(state)
})

test('Paperclip autoHireForTask recruits specialist agents and opens tracked tickets', async () => {
  const res = await autoHireForTask(
    'Build a new Next.js UI dashboard and audit security tests for API endpoints',
    { maxNewHires: 2, createTickets: true, force: true }
  )
  assert.ok(res.hired.length + res.matchedExisting.length >= 2)
  assert.ok(res.ticketsCreated.length >= 2)
  // Clean up test tickets
  for (const t of res.ticketsCreated) {
    deleteCompanyTicket(t.id)
  }
})
