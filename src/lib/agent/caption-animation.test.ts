import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPTION_ANIMATION_OPTIONS,
  computeTypewriterStartIndex,
  isCaptionAnimationStyle,
  splitCaptionTokens,
} from './caption-animation'

test('CAPTION_ANIMATION_OPTIONS includes typewriter, fade, and bounce with labels', () => {
  const ids = CAPTION_ANIMATION_OPTIONS.map((o) => o.id)
  assert.deepEqual(ids, ['typewriter', 'fade', 'bounce'])
  for (const opt of CAPTION_ANIMATION_OPTIONS) {
    assert.ok(opt.label.length > 0)
    assert.ok(opt.description.length > 0)
  }
})

test('isCaptionAnimationStyle strictly validates allowed styles', () => {
  assert.equal(isCaptionAnimationStyle('typewriter'), true)
  assert.equal(isCaptionAnimationStyle('fade'), true)
  assert.equal(isCaptionAnimationStyle('bounce'), true)
  assert.equal(isCaptionAnimationStyle('zoom'), false)
  assert.equal(isCaptionAnimationStyle(null), false)
})

test('computeTypewriterStartIndex preserves prefix on streaming appends and resets on new sentence', () => {
  assert.equal(computeTypewriterStartIndex('Hello', 'Hello world', 5), 5)
  assert.equal(computeTypewriterStartIndex('Hello', 'Hello world', 3), 3)
  assert.equal(computeTypewriterStartIndex('Hello', 'Completely different', 5), 0)
  assert.equal(computeTypewriterStartIndex('Hello', '', 5), 0)
})

test('splitCaptionTokens cleanly splits caption words for bounce animation', () => {
  assert.deepEqual(splitCaptionTokens('  Eva is speaking live!  '), [
    'Eva',
    'is',
    'speaking',
    'live!',
  ])
  assert.deepEqual(splitCaptionTokens('   '), [])
})
