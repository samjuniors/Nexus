import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiresSingleUseApproval } from './permission-policy'

test('consequential capabilities do not permit standing Always grants', () => {
  for (const capability of ['self_install', 'mobile_control', 'workspace_shell', 'desktop_bridge', 'self_code_edit']) {
    assert.equal(requiresSingleUseApproval(capability), true, capability)
  }
})

test('ordinary app navigation remains eligible for user-configured policy', () => {
  assert.equal(requiresSingleUseApproval('app_ui'), false)
  assert.equal(requiresSingleUseApproval('unknown_capability'), false)
})
