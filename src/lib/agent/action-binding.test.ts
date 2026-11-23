import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeActionHash, verifyActionHash } from './action-binding'

test('hash is deterministic across object insertion order', () => {
  const first = computeActionHash({
    actionName: 'browser.navigate',
    target: { device: 'alpha', origin: 'https://example.com' },
    payload: { b: 2, a: [{ z: 3, x: 1 }] },
  })
  const second = computeActionHash({
    actionName: 'browser.navigate',
    payload: { a: [{ x: 1, z: 3 }], b: 2 },
    target: { origin: 'https://example.com', device: 'alpha' },
  })
  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('hash binds action name, exact target and full payload', () => {
  const original = { actionName: 'desktop.write', target: { deviceId: 'pc1' }, payload: { path: '/tmp/a', text: 'ok' } }
  const hash = computeActionHash(original)
  assert.equal(verifyActionHash(hash, original), true)
  assert.equal(verifyActionHash(hash, { ...original, actionName: 'desktop.delete' }), false)
  assert.equal(verifyActionHash(hash, { ...original, target: { deviceId: 'pc2' } }), false)
  assert.equal(verifyActionHash(hash, { ...original, payload: { path: '/tmp/b', text: 'ok' } }), false)
})

test('missing or malformed approved hash is rejected', () => {
  assert.equal(verifyActionHash('', { actionName: 'desktop.write' }), false)
  assert.equal(verifyActionHash('0'.repeat(64).toUpperCase(), { actionName: 'desktop.write' }), false)
})

test('rejects non-finite and non-JSON arguments, circular objects and unsafe keys', () => {
  assert.throws(() => computeActionHash({ actionName: 'a', payload: { n: NaN } }), /non-finite/)
  assert.throws(() => computeActionHash({ actionName: 'a', payload: { n: Infinity } }), /non-finite/)
  assert.throws(() => computeActionHash({ actionName: 'a', payload: { handler: () => undefined } }), /non-JSON/)
  assert.throws(() => computeActionHash({ actionName: 'a', payload: { created: new Date() } }), /plain JSON/)
  const cycle: { self?: unknown } = {}
  cycle.self = cycle
  assert.throws(() => computeActionHash({ actionName: 'a', payload: cycle }), /Circular/)
  const protoKey = Object.create(null) as Record<string, unknown>
  Object.defineProperty(protoKey, '__proto__', { value: 'evil', enumerable: true })
  assert.throws(() => computeActionHash({ actionName: 'a', payload: protoKey }), /Unsupported action payload key/)
})

test('rejects oversized payloads and excessively deep nesting', () => {
  assert.throws(() => computeActionHash({ actionName: 'a', payload: 'x'.repeat(140_000) }), /maximum size/)
  let payload: unknown = 1
  for (let i = 0; i < 40; i++) payload = [payload]
  assert.throws(() => computeActionHash({ actionName: 'a', payload }), /depth limit/)
})
