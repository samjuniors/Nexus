import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VOICE_AGENT_STATES,
  computeDynamicHaloScale,
  computeEqualizerBarHeight,
  deriveEffectiveComposerState,
  deriveVoiceAgentState,
  getVoiceStateMeta,
} from './voice-state'

test('deriveVoiceAgentState resolves all 9 states with expected priority', () => {
  assert.equal(
    deriveVoiceAgentState({
      status: 'error',
      activeTool: { tool: 'spawn' },
      isSpeaking: true,
      isThinking: true,
      muted: true,
      isUserSpeaking: true,
    }),
    'error'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connecting',
      activeTool: null,
      isSpeaking: false,
      isThinking: false,
      muted: false,
      isUserSpeaking: false,
    }),
    'connecting'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'idle',
      activeTool: null,
      isSpeaking: false,
      isThinking: false,
      muted: false,
      isUserSpeaking: false,
    }),
    'idle'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: { tool: 'spawn_subagent' },
      isSpeaking: true,
      isThinking: true,
      muted: true,
      isUserSpeaking: true,
    }),
    'executing'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: null,
      isSpeaking: true,
      isThinking: true,
      muted: false,
      isUserSpeaking: false,
    }),
    'speaking'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: null,
      isSpeaking: false,
      isThinking: true,
      muted: false,
      isUserSpeaking: false,
    }),
    'thinking'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: null,
      isSpeaking: false,
      isThinking: false,
      muted: true,
      isUserSpeaking: true,
    }),
    'muted'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: null,
      isSpeaking: false,
      isThinking: false,
      muted: false,
      isUserSpeaking: true,
    }),
    'hearing'
  )
  assert.equal(
    deriveVoiceAgentState({
      status: 'connected',
      activeTool: null,
      isSpeaking: false,
      isThinking: false,
      muted: false,
      isUserSpeaking: false,
    }),
    'listening'
  )
})

test('deriveEffectiveComposerState unifies voice and text execution states', () => {
  assert.equal(
    deriveEffectiveComposerState({
      isActive: false,
      voiceStatus: 'idle',
      voiceAgentState: 'idle',
      activeTool: null,
      isSpeaking: false,
      isRunning: false,
      isThinking: true,
      isSending: false,
    }),
    'thinking'
  )
  assert.equal(
    deriveEffectiveComposerState({
      isActive: false,
      voiceStatus: 'idle',
      voiceAgentState: 'idle',
      activeTool: null,
      isSpeaking: false,
      isRunning: true,
      isThinking: false,
      isSending: false,
    }),
    'executing'
  )
  assert.equal(
    deriveEffectiveComposerState({
      isActive: true,
      voiceStatus: 'connected',
      voiceAgentState: 'listening',
      activeTool: null,
      isSpeaking: false,
      isRunning: true,
      isThinking: false,
      isSending: false,
    }),
    'executing'
  )
  assert.equal(
    deriveEffectiveComposerState({
      isActive: false,
      voiceStatus: 'idle',
      voiceAgentState: 'idle',
      activeTool: null,
      isSpeaking: false,
      isRunning: false,
      isThinking: false,
      isSending: false,
      wakeStatus: 'armed',
    }),
    'wake'
  )
  assert.equal(
    deriveEffectiveComposerState({
      isActive: false,
      voiceStatus: 'idle',
      voiceAgentState: 'idle',
      activeTool: null,
      isSpeaking: false,
      isRunning: false,
      isThinking: false,
      isSending: false,
      wakeStatus: 'sleeping',
      isSleeping: true,
    }),
    'sleeping'
  )
  assert.equal(
    deriveEffectiveComposerState({
      isActive: false,
      voiceStatus: 'error',
      voiceAgentState: 'error',
      activeTool: null,
      isSpeaking: false,
      isRunning: false,
      isThinking: false,
      isSending: false,
    }),
    'error'
  )
})

test('getVoiceStateMeta returns unique aura classes for every voice agent state', () => {
  const auras = new Set<string>()
  for (const state of VOICE_AGENT_STATES) {
    const meta = getVoiceStateMeta(state, 'Zephyr', 'create_bot', 'Hey Eva')
    assert.ok(meta.auraClass.startsWith('voice-aura-'))
    assert.ok(meta.label.length > 0)
    assert.ok(meta.hint.length > 0)
    auras.add(meta.auraClass)
  }
  assert.equal(auras.size, VOICE_AGENT_STATES.length)
  assert.equal(getVoiceStateMeta('executing', 'Kore', 'create_bot').label, 'Running · create_bot')
  assert.equal(getVoiceStateMeta('wake', 'Zephyr', undefined, 'Hey Eva').label, 'Wake · "Hey Eva"')
})

test('reactive geometry helpers stay bounded', () => {
  assert.equal(computeDynamicHaloScale('idle', 0.9), 1)
  assert.equal(computeDynamicHaloScale('speaking', 0), 1.02)
  assert.equal(computeDynamicHaloScale('hearing', 0.5), 1.04)
  assert.equal(computeDynamicHaloScale('hearing', 10), 1.06)

  assert.equal(computeEqualizerBarHeight('muted', 1, 0.9), 22)
  assert.equal(computeEqualizerBarHeight('error', 1, 0.9), 22)
  assert.equal(computeEqualizerBarHeight('hearing', 1, 1), 100)
  assert.equal(computeEqualizerBarHeight('listening', 1, 0), 22)
})
