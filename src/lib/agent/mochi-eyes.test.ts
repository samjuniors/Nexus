import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveEvaEyeExpression,
  getEyeGeometrySpec,
  pickEmployeeEyeArchetype,
  EYE_ARCHETYPE_PALETTES,
  type EyeExpression,
} from './mochi-eyes'
import { CAPABILITY_SPECS, isValidCapability, isValidPolicy } from './permissions'

describe('Mochi/Coucou procedural eyes engine', () => {
  it('prioritizes error > pending permission > transient mood > sleep > speaking > working > thinking > listening > idle', () => {
    assert.equal(deriveEvaEyeExpression({ hasError: true, pendingPermissionCount: 2 }), 'error')
    assert.equal(deriveEvaEyeExpression({ pendingPermissionCount: 1, isSpeaking: true }), 'curious')
    assert.equal(deriveEvaEyeExpression({ transientMood: 'happy', sleepMode: true }), 'happy')
    assert.equal(deriveEvaEyeExpression({ sleepMode: true, voiceActive: false }), 'sleeping')
    assert.equal(deriveEvaEyeExpression({ sleepMode: true, voiceActive: true, isSpeaking: true }), 'speaking')
    assert.equal(deriveEvaEyeExpression({ isWorking: true, isThinking: true }), 'working')
    assert.equal(deriveEvaEyeExpression({ isThinking: true, voiceActive: true }), 'thinking')
    assert.equal(deriveEvaEyeExpression({ voiceActive: true }), 'listening')
    assert.equal(deriveEvaEyeExpression({}), 'idle')
  })

  it('assigns distinct eye archetypes by AI employee/bot role and department', () => {
    assert.equal(pickEmployeeEyeArchetype('employee', 'QA', 'Security & Verification Specialist'), 'auditor')
    assert.equal(pickEmployeeEyeArchetype('bot', 'Research', 'Web & Docs Synthesizer'), 'researcher')
    assert.equal(pickEmployeeEyeArchetype('bot', 'Ops', 'Cron scheduler'), 'bot')
    assert.equal(pickEmployeeEyeArchetype('employee', 'Engineering', 'Full-Stack Builder'), 'engineer')
    assert.equal(pickEmployeeEyeArchetype('employee', 'Leadership', 'Lead Agent', 'Eva Lead'), 'eva')
  })

  it('produces valid geometry specs for all 10 eye expressions', () => {
    const expressions: EyeExpression[] = [
      'idle',
      'wake',
      'listening',
      'thinking',
      'working',
      'speaking',
      'happy',
      'curious',
      'sleeping',
      'error',
    ]
    for (const expr of expressions) {
      const spec = getEyeGeometrySpec(expr, 0.5)
      assert.ok(spec.leftScaleX > 0 && spec.rightScaleX > 0, `invalid scale for ${expr}`)
      assert.ok(spec.leftScaleY > 0 && spec.rightScaleY > 0, `invalid height scale for ${expr}`)
    }
    assert.equal(getEyeGeometrySpec('happy').mode, 'happy-arc')
    assert.equal(getEyeGeometrySpec('sleeping').mode, 'sleep-line')
    assert.equal(getEyeGeometrySpec('error').mode, 'error-x')
    assert.equal(Object.keys(EYE_ARCHETYPE_PALETTES).length, 5)
  })
})

describe('Permission Vault capabilities and policy validation', () => {
  it('defines all 5 autonomous capabilities with valid specs', () => {
    assert.equal(CAPABILITY_SPECS.length, 5)
    for (const cap of ['app_ui', 'self_install', 'browser_control', 'workspace_shell', 'desktop_bridge']) {
      assert.equal(isValidCapability(cap), true, `expected ${cap} to be valid`)
    }
    assert.equal(isValidCapability('unknown_cap'), false)
  })

  it('validates always, ask, and deny policies strictly', () => {
    assert.equal(isValidPolicy('always'), true)
    assert.equal(isValidPolicy('ask'), true)
    assert.equal(isValidPolicy('deny'), true)
    assert.equal(isValidPolicy('once'), false)
    assert.equal(isValidPolicy(''), false)
  })
})
