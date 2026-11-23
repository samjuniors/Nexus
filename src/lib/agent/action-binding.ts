import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Nexus adapter of SamjuniorsOS src/lib/server/authorization/payload-binding.ts.
 * This module hashes an exact action/target/payload tuple. It neither approves
 * an action nor replaces the owner-session or capability gate.
 */
export interface BoundAction {
  actionName: string
  target?: unknown
  payload?: unknown
}

function canonicalJson(value: unknown, depth: number, active: WeakSet<object>): unknown {
  if (depth > 32) throw new Error('Action payload exceeds canonical depth limit')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Action payload contains non-finite number')
    return value
  }
  if (Array.isArray(value)) {
    if (active.has(value)) throw new Error('Circular action payload')
    active.add(value)
    try { return value.map((entry) => canonicalJson(entry, depth + 1, active)) }
    finally { active.delete(value) }
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const proto = Object.getPrototypeOf(record)
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('Action payload requires plain JSON objects')
    }
    if (active.has(record)) throw new Error('Circular action payload')
    active.add(record)
    try {
      const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      for (const key of Object.keys(record).sort()) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new Error('Unsupported action payload key')
        }
        const v = record[key]
        if (v === undefined) continue
        sorted[key] = canonicalJson(v, depth + 1, active)
      }
      return sorted
    } finally { active.delete(record) }
  }
  throw new Error('Unsupported non-JSON action payload value')
}

export function computeActionHash(action: BoundAction): string {
  if (typeof action.actionName !== 'string' || !action.actionName.trim()) {
    throw new Error('Action name is required')
  }
  const serialized = JSON.stringify(canonicalJson({
    actionName: action.actionName.trim(),
    target: action.target ?? null,
    payload: action.payload ?? null,
  }, 0, new WeakSet<object>()))
  if (Buffer.byteLength(serialized, 'utf8') > 128 * 1024) {
    throw new Error('Action payload exceeds maximum size')
  }
  return createHash('sha256').update(serialized).digest('hex')
}

export function verifyActionHash(expectedHash: string, action: BoundAction): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false
  const expected = Buffer.from(expectedHash, 'hex')
  const actual = Buffer.from(computeActionHash(action), 'hex')
  return timingSafeEqual(expected, actual)
}
