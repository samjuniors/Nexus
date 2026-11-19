import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EVA_EMOTIONS,
  EVA_EMOTION_LIST,
  deriveEvaEmotion,
  deriveEvaSenses,
  type DeriveEmotionInput,
} from './eva-emotions'

const BASE_INPUT: DeriveEmotionInput = {
  manualEmotion: null,
  sleepMode: false,
  hasError: false,
  pendingPermissionCount: 0,
  isWorking: false,
  isThinking: false,
  isSpeaking: false,
  voiceActive: false,
  visionActive: false,
}

test('EVA_EMOTIONS covers every emotion in EVA_EMOTION_LIST', () => {
  assert.equal(EVA_EMOTION_LIST.length, 9)
  for (const id of EVA_EMOTION_LIST) {
    const meta = EVA_EMOTIONS[id]
    assert.ok(meta.label.length > 0)
    assert.ok(meta.shortLabel.length > 0)
    assert.ok(meta.feelingLine.length > 0)
    assert.ok(meta.accentHex.startsWith('#'))
  }
})

test('deriveEvaEmotion prioritizes sleep mode over everything else', () => {
  const res = deriveEvaEmotion({
    ...BASE_INPUT,
    sleepMode: true,
    manualEmotion: 'excited',
    isSpeaking: true,
    isWorking: true,
  })
  assert.equal(res.id, 'sleepy')
  assert.equal(res.isManual, false)
})

test('deriveEvaEmotion respects manual override when awake', () => {
  const res = deriveEvaEmotion({
    ...BASE_INPUT,
    manualEmotion: 'proud',
    isWorking: true,
  })
  assert.equal(res.id, 'proud')
  assert.equal(res.isManual, true)
})

test('deriveEvaEmotion surfaces concern on errors or pending approvals', () => {
  const err = deriveEvaEmotion({
    ...BASE_INPUT,
    hasError: true,
    isSpeaking: true,
  })
  assert.equal(err.id, 'concerned')

  const perm = deriveEvaEmotion({
    ...BASE_INPUT,
    pendingPermissionCount: 2,
  })
  assert.equal(perm.id, 'concerned')
  assert.match(perm.reason, /2 action/)
})

test('deriveEvaEmotion maps working tasks to focused and vision eyes to curious', () => {
  const working = deriveEvaEmotion({ ...BASE_INPUT, isWorking: true })
  assert.equal(working.id, 'focused')

  const seeing = deriveEvaEmotion({ ...BASE_INPUT, visionActive: true })
  assert.equal(seeing.id, 'curious')
})

test('deriveEvaEmotion attunes to user sentiment and completion state', () => {
  const happy = deriveEvaEmotion({
    ...BASE_INPUT,
    recentUserText: 'Thank you, that looks amazing!',
  })
  assert.equal(happy.id, 'happy')

  const empathetic = deriveEvaEmotion({
    ...BASE_INPUT,
    recentUserText: 'I am stressed and stuck on a bug',
  })
  assert.equal(empathetic.id, 'empathetic')

  const excited = deriveEvaEmotion({
    ...BASE_INPUT,
    recentUserText: 'Let us build a brand new feature!',
  })
  assert.equal(excited.id, 'excited')

  const proud = deriveEvaEmotion({
    ...BASE_INPUT,
    justCompleted: true,
  })
  assert.equal(proud.id, 'proud')
})

test('deriveEvaSenses tracks all 4 embodied senses accurately', () => {
  const active = deriveEvaSenses({
    cameraActive: true,
    screenActive: false,
    browserSplitActive: false,
    sleepMode: false,
    wakeListening: true,
    voiceActive: true,
    voiceMuted: false,
    isSpeaking: true,
    isWorking: true,
    activeToolName: 'browser_open',
  })

  assert.equal(active.eyes.status, 'active')
  assert.equal(active.ears.status, 'active')
  assert.equal(active.mouth.status, 'active')
  assert.equal(active.hands.status, 'active')
  assert.equal(active.hands.detail, 'Using browser_open')
  assert.equal(active.activeCount, 4)

  const sleeping = deriveEvaSenses({
    cameraActive: false,
    screenActive: false,
    browserSplitActive: false,
    sleepMode: true,
    wakeListening: false,
    voiceActive: false,
    voiceMuted: true,
    isSpeaking: false,
    isWorking: false,
  })
  assert.equal(sleeping.eyes.status, 'ready')
  assert.equal(sleeping.ears.status, 'off')
  assert.equal(sleeping.mouth.status, 'off')
  assert.equal(sleeping.hands.status, 'ready')
  assert.equal(sleeping.activeCount, 0)
})
