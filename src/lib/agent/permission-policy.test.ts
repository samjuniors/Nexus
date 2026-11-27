import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiresSingleUseApproval } from './permission-policy'

test('single-use capabilities do not permit standing Always grants', () => {
  for (const capability of ['self_install', 'mobile_control', 'self_code_edit']) {
    assert.equal(requiresSingleUseApproval(capability), true, capability)
  }
})

test('user-configurable capabilities remain eligible for Allow Always policy', () => {
  assert.equal(requiresSingleUseApproval('app_ui'), false)
  assert.equal(requiresSingleUseApproval('browser_control'), false)
  assert.equal(requiresSingleUseApproval('desktop_bridge'), false)
  assert.equal(requiresSingleUseApproval('workspace_shell'), false)
  assert.equal(requiresSingleUseApproval('unknown_capability'), false)
})
