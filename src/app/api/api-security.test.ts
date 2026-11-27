import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NextRequest } from 'next/server'
import { POST as terminalPost } from './terminal/route'
import { POST as computerControlPost } from './computer-control/route'
import { POST as browserPost } from './browser/route'
import { POST as mobilePost } from './mobile/route'
import { POST as selfHealPost } from './self-heal/route'
import { POST as pluginsPost } from './plugins/route'
import { GET as filesGet } from './files/route'
import { POST as permissionsPost } from './permissions/route'
import { GET as connectGet, POST as connectPost } from './connect/route'
import { executeTool } from '@/lib/agent/tools'

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('HTTP API route security & fail-closed permission boundaries', () => {
  it('denies /api/terminal exec and pair_windows without interactive owner approval', async () => {
    const execRes = await terminalPost(
      jsonRequest('http://127.0.0.1:3000/api/terminal', { action: 'exec', command: 'whoami' })
    )
    assert.equal(execRes.status, 403)
    const execJson = (await execRes.json()) as { ok: boolean }
    assert.equal(execJson.ok, false)

    const pairRes = await terminalPost(
      jsonRequest('http://127.0.0.1:3000/api/terminal', {
        action: 'pair_windows',
        deviceName: 'Test Box',
        platform: 'windows',
      })
    )
    assert.equal(pairRes.status, 403)
  })

  it('denies /api/computer-control desktop actions without approval and rejects unsupported commands', async () => {
    const unsupported = await computerControlPost(
      jsonRequest('http://127.0.0.1:3000/api/computer-control', {
        action: 'windows_action',
        bridgeAction: 'nonexistent_cmd',
      })
    )
    assert.equal(unsupported.status, 400)

    const denied = await computerControlPost(
      jsonRequest('http://127.0.0.1:3000/api/computer-control', {
        action: 'windows_action',
        bridgeAction: 'system_info',
      })
    )
    assert.equal(denied.status, 403)
  })

  it('denies /api/browser and /api/mobile mutations without owner approval', async () => {
    const browserRes = await browserPost(
      jsonRequest('http://127.0.0.1:3000/api/browser', {
        action: 'navigate',
        url: 'https://example.com',
      })
    )
    assert.equal(browserRes.status, 403)

    const mobileRes = await mobilePost(
      jsonRequest('http://127.0.0.1:3000/api/mobile', {
        action: 'open_app',
        app: 'settings',
      })
    )
    assert.equal(mobileRes.status, 403)
  })

  it('denies /api/self-heal patch and rollback without owner approval', async () => {
    const patchReq = new NextRequest('http://127.0.0.1:3000/api/self-heal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'patch', title: 'Unauthorized', edits: [] }),
    })
    const patchRes = await selfHealPost(patchReq)
    assert.equal(patchRes.status, 403)

    const rollbackReq = new NextRequest('http://127.0.0.1:3000/api/self-heal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rollback', sessionId: 'sh_fake' }),
    })
    const rollbackRes = await selfHealPost(rollbackReq)
    assert.equal(rollbackRes.status, 403)
  })

  it('blocks SSRF endpoints when creating custom HTTP plugins via /api/plugins', async () => {
    for (const endpoint of ['http://127.0.0.1:3000/api/health', 'http://169.254.169.254/latest/meta-data/']) {
      const res = await pluginsPost(
        jsonRequest('http://127.0.0.1:3000/api/plugins', {
          name: 'SSRF Probe',
          config: { type: 'http', endpoint },
        })
      )
      assert.equal(res.status, 400)
    }
  })

  it('rejects path traversal on /api/files and enforces sensitive permission policies on /api/permissions', async () => {
    const fileRes = await filesGet(new Request('http://127.0.0.1:3000/api/files?name=../../.env'))
    assert.equal(fileRes.status, 400)

    const alwaysSensitive = await permissionsPost(
      jsonRequest('http://127.0.0.1:3000/api/permissions', {
        capability: 'self_code_edit',
        policy: 'always',
      })
    )
    assert.equal(alwaysSensitive.status, 400)

    const alwaysDesktop = await permissionsPost(
      jsonRequest('http://127.0.0.1:3000/api/permissions', {
        capability: 'desktop_bridge',
        policy: 'always',
      })
    )
    assert.equal(alwaysDesktop.status, 200)
    await permissionsPost(
      jsonRequest('http://127.0.0.1:3000/api/permissions', {
        capability: 'desktop_bridge',
        policy: 'ask',
      })
    )

    const missingHash = await permissionsPost(
      jsonRequest('http://127.0.0.1:3000/api/permissions', {
        action: 'respond',
        requestId: 'perm_missing_hash',
        decision: 'once',
      })
    )
    assert.equal(missingHash.status, 400)
  })

  it('validates /api/connect SSRF bounds, masks stored secrets, and gates Composio execution', async () => {
    const ssrfComposio = await connectPost(
      jsonRequest('http://127.0.0.1:3000/api/connect', {
        action: 'save_composio',
        mcpUrl: 'http://127.0.0.1:3000/api/health',
      })
    )
    assert.equal(ssrfComposio.status, 400)

    const ssrfSvc = await connectPost(
      jsonRequest('http://127.0.0.1:3000/api/connect', {
        action: 'add_service',
        kind: 'http',
        name: 'Bad Hook',
        endpoint: 'http://169.254.169.254/latest/meta-data/',
      })
    )
    assert.equal(ssrfSvc.status, 400)

    const saveRes = await connectPost(
      jsonRequest('http://127.0.0.1:3000/api/connect', {
        action: 'save_composio',
        apiKey: 'ak_test_secret_9876',
        toolkits: ['gmail', 'slack'],
      })
    )
    assert.equal(saveRes.status, 200)

    const getRes = await connectGet()
    assert.equal(getRes.status, 200)
    const getText = await getRes.text()
    assert.equal(getText.includes('ak_test_secret_9876'), false)
    const getJson = JSON.parse(getText) as {
      composio: { configured: boolean; apiKeyMasked: string; toolkits: string[] }
    }
    assert.equal(getJson.composio.configured, true)
    assert.equal(getJson.composio.apiKeyMasked, '••••••9876')
    assert.deepEqual(getJson.composio.toolkits, ['gmail', 'slack'])

    // Executing a Composio tool must fail closed without interactive owner approval
    const execDenied = await executeTool(
      'composio_action',
      { action: 'execute', toolSlug: 'GMAIL_SEND_EMAIL', input: { to: 'a@example.com' } },
      '',
      null
    )
    assert.equal(execDenied.ok, false)

    // Clean up
    const discRes = await connectPost(
      jsonRequest('http://127.0.0.1:3000/api/connect', { action: 'disconnect_composio' })
    )
    assert.equal(discRes.status, 200)
  })
})
