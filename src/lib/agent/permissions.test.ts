import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type WebSocket from 'ws'
import { db } from '@/lib/db'
import { controlBus } from '@/lib/agent/control-bus'
import {
  hasPendingPermissionForAutomation,
  listPendingPermissionRequests,
  listPermissionGrants,
  requireCapabilityPermission,
  resolvePermissionDecision,
  runWithPermissionContext,
  setPermissionPolicy,
} from '@/lib/agent/permissions'
import { GET as permissionsGet, POST as permissionsPost } from '@/app/api/permissions/route'
import { executeTool } from '@/lib/agent/tools'
import { liveBrowser } from '@/lib/agent/browser-manager'

function attachMockUiClient() {
  const sent: unknown[] = []
  const listeners = new Map<string, Array<() => void>>()
  const fakeWs = {
    readyState: 1,
    send: (raw: string) => {
      try {
        sent.push(JSON.parse(raw))
      } catch {
        sent.push(raw)
      }
    },
    on: (ev: string, cb: () => void) => {
      const list = listeners.get(ev) ?? []
      list.push(cb)
      listeners.set(ev, list)
      return fakeWs
    },
  } as unknown as WebSocket
  controlBus.registerUiClient(fakeWs)
  return {
    sent,
    cleanup: () => {
      ;(fakeWs as unknown as { readyState: number }).readyState = 3
      for (const cb of listeners.get('close') ?? []) cb()
    },
  }
}

describe('Permission vault, fail-closed audit, and replay/expiry enforcement', () => {
  it('defaults desktop_bridge and workspace_shell to ask, permits Allow Always once approved, and rejects Always on single-use capabilities', async () => {
    const grants = await listPermissionGrants()
    const desktop = grants.find((g) => g.capability === 'desktop_bridge')
    const shell = grants.find((g) => g.capability === 'workspace_shell')
    assert.ok(desktop)
    assert.ok(shell)
    assert.equal(desktop.policy, 'ask')
    assert.equal(shell.policy, 'ask')
    await assert.rejects(
      setPermissionPolicy('self_code_edit', 'always'),
      /requires per-action approval/i
    )

    try {
      await setPermissionPolicy('desktop_bridge', 'always')
      await setPermissionPolicy('workspace_shell', 'always')

      const desktopRes = await requireCapabilityPermission({
        capability: 'desktop_bridge',
        actionSummary: 'Launch Chrome after Allow Always',
        actor: 'Eva',
        actionName: 'desktop.open_app',
        target: 'local_host',
        payload: { app: 'chrome.exe' },
      })
      assert.equal(desktopRes.allowed, true)
      assert.equal(desktopRes.decision, 'always')

      const shellRes = await requireCapabilityPermission({
        capability: 'workspace_shell',
        actionSummary: 'Run shell command after Allow Always',
        actor: 'Eva',
        actionName: 'terminal.exec',
        target: 'host',
        payload: { command: 'echo ok' },
      })
      assert.equal(shellRes.allowed, true)
      assert.equal(shellRes.decision, 'always')
    } finally {
      await setPermissionPolicy('desktop_bridge', 'ask')
      await setPermissionPolicy('workspace_shell', 'ask')
    }
  })

  it('enforces single-flight resolution, hash binding, expiry, and fail-closed audit', async () => {
    const ui = attachMockUiClient()
    try {
      // 1. Single-flight resolution & replay prevention
      const binding = { actionName: 'workspace.shell', target: 'host', payload: { command: 'npm test' } }
      const permPromise = requireCapabilityPermission({
        capability: 'workspace_shell',
        actionSummary: 'Run unit test command',
        actor: 'Eva',
        timeoutMs: 5000,
        ...binding,
      })

      await new Promise((r) => setTimeout(r, 15))
      const pending = controlBus.getPendingPermissions().find((p) => p.actionSummary === 'Run unit test command')
      assert.ok(pending, 'expected pending permission request')

      // Wrong hash must be rejected without resolving
      const wrongHash = await resolvePermissionDecision(pending.requestId, 'once', '0'.repeat(64))
      assert.equal(wrongHash.ok, false)

      const beforeAuditCount = await db.permissionAuditLog.count()
      const [first, second] = await Promise.all([
        resolvePermissionDecision(pending.requestId, 'once', pending.actionHash),
        resolvePermissionDecision(pending.requestId, 'once', pending.actionHash),
      ])
      assert.equal(first.ok, true)
      assert.equal(second.ok, false)
      const afterAuditCount = await db.permissionAuditLog.count()
      assert.equal(afterAuditCount - beforeAuditCount, 1)

      const result = await permPromise
      assert.equal(result.allowed, true)
      assert.equal(result.decision, 'once')

      // 2. Expired permission request cannot be approved
      const expiredReqId = 'perm_expired_' + Date.now()
      const expiredWait = controlBus.waitForPermission(
        {
          requestId: expiredReqId,
          actionHash: pending.actionHash,
          capability: 'workspace_shell',
          title: 'Expired Test',
          description: 'Expired test',
          actionSummary: 'Expired action',
          actor: 'Eva',
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        5000
      )
      const expiredResolve = await resolvePermissionDecision(expiredReqId, 'once', pending.actionHash)
      assert.equal(expiredResolve.ok, false)
      assert.equal(await expiredWait, 'timeout')

      // 3. Fail-closed durable audit: if audit write throws, permission is NOT released
      const origCreate = db.permissionAuditLog.create
      ;(db.permissionAuditLog as unknown as { create: unknown }).create = async () => {
        throw new Error('Audit storage offline')
      }
      const failClosedPromise = requireCapabilityPermission({
        capability: 'workspace_shell',
        actionSummary: 'Fail-closed audit test',
        actor: 'Eva',
        timeoutMs: 250,
        actionName: 'workspace.shell',
        target: 'host',
        payload: { command: 'whoami' },
      })
      await new Promise((r) => setTimeout(r, 15))
      const failPending = controlBus.getPendingPermissions().find((p) => p.actionSummary === 'Fail-closed audit test')
      assert.ok(failPending)
      await assert.rejects(
        resolvePermissionDecision(failPending.requestId, 'once', failPending.actionHash),
        /Audit storage offline/
      )
      ;(db.permissionAuditLog as unknown as { create: unknown }).create = origCreate
      const failResult = await failClosedPromise
      assert.equal(failResult.allowed, false)
    } finally {
      ui.cleanup()
    }
  })

  it('closes live device socket immediately on unregisterDevice revocation', () => {
    let closed = false
    const fakeSock = {
      readyState: 1,
      send: () => undefined,
      close: () => { closed = true },
      terminate: () => { closed = true },
      on: () => fakeSock,
    } as unknown as WebSocket
    controlBus.registerDevice({
      deviceId: 'dev_revoke_test',
      name: 'Revoke Test PC',
      platform: 'windows',
      capabilities: ['system_info'],
      ws: fakeSock,
      connectedAt: new Date().toISOString(),
    })
    assert.equal(controlBus.isDeviceOnline('dev_revoke_test'), true)
    controlBus.unregisterDevice('dev_revoke_test')
    assert.equal(controlBus.isDeviceOnline('dev_revoke_test'), false)
    assert.equal(closed, true)
  })

  it('queues offline automation approvals, consumes single-use leases once, and blocks replay/expiry/tampering', async () => {
    const autoId = 'auto_durable_' + Date.now()
    const runId = 'run_durable_' + Date.now()
    const binding = {
      actionName: 'self_heal.patch',
      target: 'src/app/page.tsx',
      payload: { patchId: 'p1', nonce: Date.now() },
    }

    // 1. Offline background automation call defers instead of hanging, while failing closed
    const deferred = await runWithPermissionContext({ automationId: autoId, runId }, () =>
      requireCapabilityPermission({
        capability: 'self_code_edit',
        actionSummary: 'Deferred self-heal patch',
        actor: 'Scheduler',
        ...binding,
      })
    )
    assert.equal(deferred.allowed, false)
    assert.equal(deferred.deferred, true)
    assert.ok(deferred.requestId)
    assert.equal(await hasPendingPermissionForAutomation(autoId), true)

    // 2. GET /api/permissions surfaces the deferred pending approval
    const getRes = await permissionsGet()
    assert.equal(getRes.status, 200)
    const getJson = (await getRes.json()) as { pending: { requestId: string; automationId?: string | null }[] }
    const listed = getJson.pending.find((p) => p.requestId === deferred.requestId)
    assert.ok(listed, 'expected deferred approval to appear in /api/permissions')
    assert.equal(listed.automationId, autoId)

    // 3. Single-use capability cannot be resolved as "always" even via durable path
    const alwaysRejected = await resolvePermissionDecision(deferred.requestId!, 'always', deferred.actionHash)
    assert.equal(alwaysRejected.ok, false)

    // 4. Fail-closed audit on durable resolution: DB error leaves request pending
    const origCreate = db.permissionAuditLog.create
    ;(db.permissionAuditLog as unknown as { create: unknown }).create = async () => {
      throw new Error('Audit storage down')
    }
    await assert.rejects(
      resolvePermissionDecision(deferred.requestId!, 'once', deferred.actionHash),
      /Audit storage down/
    )
    ;(db.permissionAuditLog as unknown as { create: unknown }).create = origCreate
    assert.equal(await hasPendingPermissionForAutomation(autoId), true)

    // 5. Approve once via /api/permissions POST
    const postRes = await permissionsPost(
      new Request('http://127.0.0.1:3000/api/permissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'respond',
          requestId: deferred.requestId,
          actionHash: deferred.actionHash,
          decision: 'once',
        }),
      })
    )
    assert.equal(postRes.status, 200)
    const postJson = (await postRes.json()) as { ok: boolean; pending: { requestId: string }[] }
    assert.equal(postJson.ok, true)
    assert.equal(postJson.pending.some((p) => p.requestId === deferred.requestId), false)

    // 6. Tampered payload (different actionHash) is NOT authorized by that lease
    const tampered = await requireCapabilityPermission({
      capability: 'self_code_edit',
      actionSummary: 'Tampered patch',
      actor: 'Scheduler',
      actionName: 'self_heal.patch',
      target: 'src/app/page.tsx',
      payload: { patchId: 'malicious', nonce: binding.payload.nonce },
    })
    assert.equal(tampered.allowed, false)

    // 7. Exact matching action consumes the durable lease once
    const firstUse = await requireCapabilityPermission({
      capability: 'self_code_edit',
      actionSummary: 'Deferred self-heal patch',
      actor: 'Scheduler',
      ...binding,
    })
    assert.equal(firstUse.allowed, true)
    assert.equal(firstUse.decision, 'once')

    // 8. Replay of the same exact action is blocked (lease already consumed)
    const replayUse = await requireCapabilityPermission({
      capability: 'self_code_edit',
      actionSummary: 'Deferred self-heal patch',
      actor: 'Scheduler',
      ...binding,
    })
    assert.equal(replayUse.allowed, false)

    // 9. Expired persisted request cannot be approved
    const expiredId = 'perm_db_expired_' + Date.now()
    await db.permissionRequest.create({
      data: {
        requestId: expiredId,
        actionHash: deferred.actionHash,
        capability: 'self_code_edit',
        actionSummary: 'Expired durable request',
        status: 'pending',
        expiresAt: new Date(Date.now() - 5000),
      },
    })
    const expiredRes = await resolvePermissionDecision(expiredId, 'once', deferred.actionHash)
    assert.equal(expiredRes.ok, false)
    assert.equal(expiredRes.decision, 'timeout')
    const activePending = await listPendingPermissionRequests()
    assert.equal(activePending.some((p) => p.requestId === expiredId), false)
  })
})

describe('Tool sandbox, SSRF, and privilege escalation boundaries', () => {
  it('blocks VM prototype-chain escapes in run_code', async () => {
    const res = await executeTool(
      'run_code',
      { code: "const p = console.log.constructor('return process')(); return p ? 'ESCAPED' : 'SAFE';" },
      '',
      null
    )
    assert.equal(res.ok, false)
    assert.doesNotMatch(res.raw, /ESCAPED/)
  })

  it('blocks Windows shell escapes and enforces fail-closed permission in computer_use', async () => {
    const ps = await executeTool('computer_use', { action: 'shell', command: 'PowerShell.exe -Command whoami' }, '', null)
    assert.equal(ps.ok, false)
    assert.match(ps.raw, /never-run list/i)

    const nodeCmd = await executeTool('computer_use', { action: 'shell', command: 'node -e "console.log(1)"' }, '', null)
    assert.equal(nodeCmd.ok, false)

    const safeWhoami = await executeTool('computer_use', { action: 'shell', command: 'whoami' }, '', null)
    assert.equal(safeWhoami.ok, true)
    assert.match(safeWhoami.summary, /exited 0 \[read\]/)
  })

  it('blocks SSRF against loopback, private IPs, metadata endpoints, and file:// URLs', async () => {
    const r1 = await executeTool('read_url', { url: 'http://127.0.0.1:3000/api/health' }, '', null)
    assert.equal(r1.ok, false)

    const r2 = await executeTool('computer_use', { action: 'open_url', url: 'http://169.254.169.254/latest/meta-data/' }, '', null)
    assert.equal(r2.ok, false)

    const nav = await liveBrowser.navigate('file:///etc/passwd')
    assert.equal(nav.ok, false)
    assert.match(nav.error ?? '', /Only http:\/\/ and https:\/\//i)
  })

  it('blocks SSRF redirects in read_url, browse_site, and computer_use open_url before hitting target', async () => {
    const originalFetch = globalThis.fetch
    const seenUrls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrls.push(String(input))
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:3000/api/company' },
      })
    }) as typeof fetch

    try {
      const rRead = await executeTool('read_url', { url: 'https://93.184.216.34/doc' }, '', null)
      assert.equal(rRead.ok, false)
      assert.match(rRead.raw, /Private or loopback/i)

      const rOpen = await executeTool(
        'computer_use',
        { action: 'open_url', url: 'https://93.184.216.34/open' },
        '',
        null
      )
      assert.equal(rOpen.ok, false)
      assert.match(rOpen.raw, /Private or loopback/i)

      const rBrowse = await executeTool('browse_site', { url: 'https://93.184.216.34/site' }, '', null)
      assert.equal(rBrowse.ok, false)

      assert.deepEqual(seenUrls, [
        'https://93.184.216.34/doc',
        'https://93.184.216.34/open',
        'https://93.184.216.34/site',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('requires self_install approval for create_skill', async () => {
    const res = await executeTool(
      'create_skill',
      { name: 'Unauthorized Skill', prompt: 'Do something' },
      '',
      null
    )
    assert.equal(res.ok, false)
  })
})
