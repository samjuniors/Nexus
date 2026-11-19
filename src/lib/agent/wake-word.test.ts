import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WAKE_PHRASE,
  matchSleepCommand,
  matchWakeWord,
  matchWakeWordCandidates,
  shouldSuspendWakeWord,
} from './wake-word'
import {
  WAKE_VAD_SAMPLE_RATE,
  computeRmsLevel,
  downsampleMonoFloat32,
  encodePcm16ToWavBase64,
  encodePcm16ToWavBytes,
} from './audio-wake'
import { evaluateOrgRoster } from './org-review'

test('matchWakeWord recognizes Hey Eva variations and captures trailing command', () => {
  const m1 = matchWakeWord('Hey Eva, check the deployment status')
  assert.equal(m1.matched, true)
  assert.equal(m1.trailingCommand, 'check the deployment status')

  const m2 = matchWakeWord('hey eva')
  assert.equal(m2.matched, true)
  assert.equal(m2.trailingCommand, '')

  const m3 = matchWakeWord('okay ava hire a security auditor bot')
  assert.equal(m3.matched, true)
  assert.equal(m3.trailingCommand, 'hire a security auditor bot')

  const m4 = matchWakeWord('hey, Eva! create a research subagent')
  assert.equal(m4.matched, true)
  assert.equal(m4.trailingCommand, 'create a research subagent')

  const m5 = matchWakeWord('hey ever open the org tab')
  assert.equal(m5.matched, true)
  assert.equal(m5.trailingCommand, 'open the org tab')

  const m6 = matchWakeWord('hey evo')
  assert.equal(m6.matched, true)
  assert.equal(m6.trailingCommand, '')
})

test('matchWakeWordCandidates checks multiple ASR alternatives and rolling split chunks', () => {
  const altMatch = matchWakeWordCandidates([
    'a fever check status',
    'hey iva check status',
    'hey eva check status',
  ])
  assert.equal(altMatch.matched, true)
  assert.equal(altMatch.trailingCommand, 'check status')

  const splitMatch = matchWakeWordCandidates(['Eva', 'Hey Eva review team'])
  assert.equal(splitMatch.matched, true)
  assert.equal(splitMatch.trailingCommand, 'review team')

  const noMatch = matchWakeWordCandidates(['hello world', 'how are you'])
  assert.equal(noMatch.matched, false)
})

test('matchWakeWord avoids substring false positives and supports custom phrases', () => {
  assert.equal(matchWakeWord('whatever happened yesterday').matched, false)
  assert.equal(matchWakeWord('medieval history summary').matched, false)
  assert.equal(matchWakeWord('   ').matched, false)

  const custom = matchWakeWord('Hey Jarvis run diagnostics', 'Hey Jarvis')
  assert.equal(custom.matched, true)
  assert.equal(custom.trailingCommand, 'run diagnostics')
  assert.equal(DEFAULT_WAKE_PHRASE, 'Hey Eva')
})

test('matchSleepCommand recognizes spoken sleep mode requests cleanly', () => {
  assert.equal(matchSleepCommand('Eva go to sleep'), true)
  assert.equal(matchSleepCommand('hey eva enter sleep mode'), true)
  assert.equal(matchSleepCommand('goodnight Eva'), true)
  assert.equal(matchSleepCommand('sleep mode'), true)
  assert.equal(matchSleepCommand('Hey Eva create a sleeping beauty image'), false)
})

test('shouldSuspendWakeWord stays always-on unless sleeping or in active voice', () => {
  assert.equal(shouldSuspendWakeWord({ sleepMode: true, voiceStatus: 'idle' }), true)
  assert.equal(shouldSuspendWakeWord({ sleepMode: false, voiceStatus: 'idle' }), false)
  assert.equal(shouldSuspendWakeWord({ sleepMode: false, voiceStatus: 'error' }), false)
  assert.equal(shouldSuspendWakeWord({ sleepMode: false, voiceStatus: 'connecting' }), true)
  assert.equal(shouldSuspendWakeWord({ sleepMode: false, voiceStatus: 'connected' }), true)
  assert.equal(shouldSuspendWakeWord({ wakeEnabled: false, voiceStatus: 'idle' }), true)
})

test('audio-wake utilities compute RMS, downsample to 16kHz, and encode valid RIFF/WAVE PCM16', () => {
  assert.equal(computeRmsLevel(new Float32Array(0)), 0)
  assert.ok(Math.abs(computeRmsLevel(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-6)

  const input48k = new Float32Array(4800)
  for (let i = 0; i < input48k.length; i++) {
    input48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.4
  }
  const down16k = downsampleMonoFloat32(input48k, 48000, WAKE_VAD_SAMPLE_RATE)
  assert.equal(down16k.length, 1600)

  const wavBytes = encodePcm16ToWavBytes(down16k, WAKE_VAD_SAMPLE_RATE)
  assert.equal(wavBytes.length, 44 + down16k.length * 2)
  assert.equal(String.fromCharCode(...wavBytes.subarray(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...wavBytes.subarray(8, 12)), 'WAVE')
  assert.equal(String.fromCharCode(...wavBytes.subarray(36, 40)), 'data')

  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  assert.equal(view.getUint16(20, true), 1) // PCM
  assert.equal(view.getUint16(22, true), 1) // Mono
  assert.equal(view.getUint32(24, true), WAKE_VAD_SAMPLE_RATE)
  assert.equal(view.getUint16(34, true), 16) // 16-bit

  const b64 = encodePcm16ToWavBase64(down16k, WAKE_VAD_SAMPLE_RATE)
  assert.ok(b64.startsWith('UklGR')) // "RIFF" in base64
})

test('evaluateOrgRoster reviews team balance and recommends missing AI hires/bots', () => {
  const emptyReview = evaluateOrgRoster([], 'build UI dashboard and verify security')
  assert.equal(emptyReview.total, 0)
  assert.ok(emptyReview.recommendations.length >= 3)
  assert.ok(emptyReview.summaryText.includes('EVA ORG REVIEW'))

  const staffedReview = evaluateOrgRoster([
    {
      id: '1',
      name: 'Atlas Architect',
      title: 'Principal Engineer',
      department: 'Engineering',
      kind: 'employee',
      role: 'Build full-stack TypeScript code',
      status: 'active',
      tasksCompleted: 4,
    },
    {
      id: '2',
      name: 'QA Bot',
      title: 'Auditor',
      department: 'QA',
      kind: 'bot',
      role: 'Verify tests and security',
      status: 'active',
      tasksCompleted: 0,
    },
  ])
  assert.equal(staffedReview.total, 2)
  assert.equal(staffedReview.employees, 1)
  assert.equal(staffedReview.bots, 1)
  assert.deepEqual(staffedReview.underutilized, ['QA Bot (bot, QA)'])
  assert.ok(staffedReview.recommendations.some((r) => r.department === 'Research'))
})
