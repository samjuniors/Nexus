import test from 'node:test'
import assert from 'node:assert/strict'
import { db } from '@/lib/db'
import {
  attachProductToCompany,
  createCompany,
  createSpendRequest,
  decideHiringProposal,
  decideSpendRequest,
  deleteCompany,
  deleteProductFromCompany,
  getActiveCompanyPromptContext,
  getCompanySnapshot,
  loadCompanyRegistry,
  proposeDepartmentPlanAndHires,
  setActiveCompanyContext,
} from './paperclip-company'
import {
  buildDocumentSource,
  fetchPublicExternalUrl,
  ingestRepoOrFolderSource,
  ingestWebsiteSource,
  SsrfBlockedError,
  validateExternalWebsiteUrl,
} from './product-source-ingest'

test('Product URL validator blocks SSRF loopback, private IPs, metadata endpoints, and non-HTTP schemes', () => {
  const blocked = [
    'http://localhost:3000',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://192.168.1.10/router',
    'http://172.16.0.2/service',
    'http://metadata.google.internal/computeMetadata/v1/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com',
  ]
  for (const url of blocked) {
    const res = validateExternalWebsiteUrl(url)
    assert.equal(res.ok, false, `Expected ${url} to be blocked`)
  }

  const allowed = validateExternalWebsiteUrl('https://example.com/product')
  assert.equal(allowed.ok, true)
})

test('fetchPublicExternalUrl and ingestWebsiteSource block SSRF redirects and POST redirects', async () => {
  const originalFetch = globalThis.fetch
  const requestedUrls: string[] = []
  try {
    // 1. GET redirect to loopback is blocked without fetching the redirect target
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = String(input)
      requestedUrls.push(target)
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:3000/api/company' },
      })
    }) as typeof fetch

    await assert.rejects(
      () => fetchPublicExternalUrl('https://93.184.216.34/start'),
      SsrfBlockedError
    )
    await assert.rejects(
      () => ingestWebsiteSource('https://93.184.216.34/page'),
      SsrfBlockedError
    )
    assert.deepEqual(requestedUrls, [
      'https://93.184.216.34/start',
      'https://93.184.216.34/page',
    ])

    // 2. POST redirect is always blocked even to a public IP
    requestedUrls.length = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input))
      return new Response(null, {
        status: 307,
        headers: { location: 'https://93.184.216.34/other' },
      })
    }) as typeof fetch

    await assert.rejects(
      () => fetchPublicExternalUrl('https://93.184.216.34/webhook', { method: 'POST', body: '{}' }),
      /Redirects are blocked for POST/
    )
    assert.deepEqual(requestedUrls, ['https://93.184.216.34/webhook'])

    // 3. Legitimate public GET redirect succeeds cleanly
    requestedUrls.length = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = String(input)
      requestedUrls.push(target)
      if (target.endsWith('/start')) {
        return new Response(null, {
          status: 302,
          headers: { location: '/final' },
        })
      }
      return new Response('<title>Public Product</title><body>Hello world</body>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    }) as typeof fetch

    const okSrc = await ingestWebsiteSource('https://93.184.216.34/start')
    assert.equal(okSrc.status, 'ready')
    assert.equal(okSrc.label, 'Public Product')
    assert.deepEqual(requestedUrls, [
      'https://93.184.216.34/start',
      'https://93.184.216.34/final',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Repo & folder source ingestion confines local paths strictly inside workspace and supports GitHub URLs', () => {
  assert.throws(
    () => ingestRepoOrFolderSource('../../etc/passwd'),
    /inside the authorized workspace/i
  )
  assert.throws(
    () => ingestRepoOrFolderSource('/etc'),
    /inside the authorized workspace/i
  )

  const localSrc = ingestRepoOrFolderSource('src')
  assert.equal(localSrc.type, 'repo_folder')
  assert.equal(localSrc.status, 'ready')
  assert.match(localSrc.content, /Workspace Folder: src/)

  const ghSrc = ingestRepoOrFolderSource('https://github.com/paperclipai/paperclip')
  assert.equal(ghSrc.type, 'repo_folder')
  assert.equal(ghSrc.status, 'ready')
  assert.match(ghSrc.uriOrPath, /github\.com\/paperclipai\/paperclip/)

  const docSrc = buildDocumentSource({
    label: 'Pricing Sheet',
    content: 'Starter: $29/mo\nPro: $99/mo\nEnterprise: Custom',
  })
  assert.equal(docSrc.type, 'document')
  assert.match(docSrc.summary, /Starter: \$29\/mo/)
})

test('Multi-company lifecycle, 4-source product attachment, Eva CEO planning, and Founder approval governance', async () => {
  const originalActiveId = loadCompanyRegistry().activeCompanyId
  const createdEmployeeIds: string[] = []

  // 1. Create an isolated new company
  const company = createCompany({
    companyName: 'Vanguard Wellness Co',
    industry: 'Consumer Health & Subscriptions',
    stage: 'early',
    mission: 'Grow subscription wellness products with autonomous Sales, Marketing, Support, and Finance.',
    monthlyBudgetUsd: 300,
    founderApprovalRequired: true,
  })
  assert.equal(company.companyName, 'Vanguard Wellness Co')
  assert.equal(company.founderApprovalRequired, true)

  try {
    // 2. Attach a product with brief, doc, and repo/folder sources
    const docSrc = buildDocumentSource({
      label: 'Launch Messaging',
      content: 'Daily hydration and recovery packs for remote athletes. 30-day money-back guarantee.',
    })
    const folderSrc = ingestRepoOrFolderSource('https://github.com/vanguard/storefront')

    const product = attachProductToCompany(company.id, {
      name: 'HydroPulse Pack',
      tagline: 'Clean electrolyte subscription for remote teams',
      kind: 'product',
      stage: 'launched',
      brief: 'Direct-to-consumer hydration subscription with B2B office wellness bundles.',
      targetAudience: 'Remote workers and fitness studios',
      goals: ['Reach 200 monthly subscribers', 'Launch B2B office pilot'],
      sources: [docSrc, folderSrc],
    })
    assert.equal(product.sources.length, 3) // auto-added brief + doc + repo
    assert.equal(product.goals.length, 2)

    // 3. Verify Eva's active prompt context reflects the active company & product
    const promptCtx = getActiveCompanyPromptContext()
    assert.match(promptCtx, /Vanguard Wellness Co/)
    assert.match(promptCtx, /HydroPulse Pack/)

    // 4. Ask Eva CEO to plan departments & propose hires (must queue for Founder approval, NOT silently hire)
    const plan = await proposeDepartmentPlanAndHires(company.id, {
      productId: product.id,
      goal: 'Launch paid marketing campaign, B2B sales outreach, customer support FAQ, and finance forecast',
      maxProposals: 3,
    })
    assert.ok(plan.proposalsCreated.length >= 2)
    assert.ok(plan.ticketsCreated.length >= 3)
    assert.ok(plan.spendRequestCreated, 'Expected campaign spend request to be queued for Founder approval')

    // 5. Founder approves first hiring proposal with adjusted monthly budget cap
    const firstProposal = plan.proposalsCreated[0]
    const approvedHire = await decideHiringProposal(company.id, firstProposal.id, {
      decision: 'approve',
      adjustedBudgetUsd: 45,
      founderNote: 'Approved for Q2 launch',
    })
    assert.equal(approvedHire.proposal.status, 'approved')
    assert.equal(approvedHire.proposal.monthlyBudgetUsd, 45)
    assert.ok(approvedHire.employee?.id)
    createdEmployeeIds.push(approvedHire.employee.id)

    // 6. Founder rejects second hiring proposal
    const secondProposal = plan.proposalsCreated[1]
    const rejectedHire = await decideHiringProposal(company.id, secondProposal.id, {
      decision: 'reject',
      founderNote: 'Wait until next month',
    })
    assert.equal(rejectedHire.proposal.status, 'rejected')
    assert.equal(rejectedHire.employee, null)

    // 7. Founder approves a budget increase spend request and verifies company budget updates
    const budgetReq = createSpendRequest(company.id, {
      productId: product.id,
      title: 'Expand monthly AI operating ceiling',
      category: 'budget_increase',
      amountUsd: 100,
      rationale: 'Scale outbound marketing experiments',
    })
    const decidedSpend = decideSpendRequest(company.id, budgetReq.id, {
      decision: 'approve',
      founderNote: 'Approved +$100/mo',
    })
    assert.equal(decidedSpend.status, 'approved')

    const snap = await getCompanySnapshot({ companyId: company.id })
    assert.equal(snap.company.monthlyBudgetUsd, 400)
    assert.equal(snap.products.length, 1)
    assert.ok(snap.metrics.activeAgents >= 1)

    // Clean up attached product
    const removedProd = deleteProductFromCompany(company.id, product.id)
    assert.equal(removedProd, true)
  } finally {
    // Clean up test DB employees and test company
    for (const empId of createdEmployeeIds) {
      await db.aiEmployee.delete({ where: { id: empId } }).catch(() => {})
    }
    deleteCompany(company.id)
    setActiveCompanyContext(originalActiveId, null)
  }
})
