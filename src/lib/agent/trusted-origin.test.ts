import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getTrustedNexusOrigin } from './trusted-origin'

function withPublicOrigin(value: string | undefined, callback: () => void) {
  const original = process.env.NEXUS_PUBLIC_ORIGIN
  try {
    if (value === undefined) delete process.env.NEXUS_PUBLIC_ORIGIN
    else process.env.NEXUS_PUBLIC_ORIGIN = value
    callback()
  } finally {
    if (original === undefined) delete process.env.NEXUS_PUBLIC_ORIGIN
    else process.env.NEXUS_PUBLIC_ORIGIN = original
  }
}

test('local-only origin is accepted without a remote configuration', () => {
  withPublicOrigin(undefined, () => {
    assert.equal(getTrustedNexusOrigin(new Request('http://localhost:3000/api/devices/runner')), 'http://localhost:3000')
    assert.equal(getTrustedNexusOrigin(new Request('http://127.0.0.1:3000/api/devices/runner')), 'http://127.0.0.1:3000')
  })
})

test('raw LAN, public HTTP or unconfigured external origins are rejected', () => {
  withPublicOrigin(undefined, () => {
    assert.throws(() => getTrustedNexusOrigin(new Request('http://192.168.1.20:3000/api/devices/runner')), /trusted NEXUS_PUBLIC_ORIGIN/)
    assert.throws(() => getTrustedNexusOrigin(new Request('https://evil.example/api/devices/runner')), /trusted NEXUS_PUBLIC_ORIGIN/)
  })
})

test('configured HTTPS public origin controls generated pairing links', () => {
  withPublicOrigin('https://nexus.example.com', () => {
    const request = new Request('http://localhost:3000/api/devices/runner', {
      headers: { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' },
    })
    assert.equal(getTrustedNexusOrigin(request), 'https://nexus.example.com')
  })
})

test('invalid public origin cannot be used for pairing', () => {
  withPublicOrigin('http://nexus.example.com', () => {
    assert.throws(() => getTrustedNexusOrigin(new Request('http://localhost:3000')), /Invalid NEXUS_PUBLIC_ORIGIN/)
  })
})
