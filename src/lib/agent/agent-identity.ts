import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ensureWorkspace, WORKSPACE_DIR } from '@/lib/agent/workspace'

const MAIL_TM_BASE = 'https://api.mail.tm'
const IDENTITY_FILE = 'eva-agent-identity.json'

export interface AgentEmailIdentity {
  address: string
  password: string
  provider: 'mail.tm' | 'custom'
  displayName: string
  accountId?: string
  token?: string
  createdAt: string
}

export interface AgentInboxMessageSummary {
  id: string
  from: string
  subject: string
  intro: string
  seen: boolean
  createdAt: string
}

export interface AgentInboxMessageDetail {
  id: string
  from: string
  subject: string
  text: string
  createdAt: string
  codes: string[]
  links: string[]
}

export interface ExtractedVerificationArtifacts {
  codes: string[]
  links: string[]
}

/**
 * Pure helper that extracts OTP/verification codes (4-8 digits) and verification URLs from email bodies.
 */
export function extractVerificationArtifacts(text: string): ExtractedVerificationArtifacts {
  const clean = text || ''
  const codeSet = new Set<string>()
  const linkSet = new Set<string>()

  // Look for labeled verification codes first ("code: 482910", "OTP is 123456", etc.)
  const labeledRe = /(?:code|otp|pin|passcode|verification|confirm(?:ation)?)\D{0,24}\b(\d{4,8})\b/gi
  let m: RegExpExecArray | null
  while ((m = labeledRe.exec(clean)) !== null) {
    if (m[1]) codeSet.add(m[1])
  }

  // Fallback standalone 6-digit codes (common OTP format) excluding obvious years
  if (codeSet.size === 0) {
    const sixDigitRe = /\b(\d{6})\b/g
    while ((m = sixDigitRe.exec(clean)) !== null) {
      if (m[1]) codeSet.add(m[1])
    }
  }

  // Extract http(s) URLs, prioritizing verify/confirm/auth/activate links
  const urlRe = /https?:\/\/[^\s"'<>()]+/gi
  const allUrls: string[] = []
  while ((m = urlRe.exec(clean)) !== null) {
    const cleaned = m[0].replace(/[.,;!?]+$/, '')
    allUrls.push(cleaned)
  }
  const priorityUrls = allUrls.filter((u) => /verify|confirm|activate|token|auth|magic|login|signin/i.test(u))
  for (const u of [...priorityUrls, ...allUrls]) {
    linkSet.add(u)
    if (linkSet.size >= 8) break
  }

  return {
    codes: Array.from(codeSet).slice(0, 6),
    links: Array.from(linkSet).slice(0, 8),
  }
}

async function identityPath(): Promise<string> {
  await ensureWorkspace()
  return path.join(WORKSPACE_DIR, IDENTITY_FILE)
}

export async function getAgentIdentity(): Promise<AgentEmailIdentity | null> {
  try {
    const raw = await fs.readFile(await identityPath(), 'utf-8')
    const parsed = JSON.parse(raw) as AgentEmailIdentity
    if (parsed && parsed.address) return parsed
    return null
  } catch {
    return null
  }
}

async function saveAgentIdentity(identity: AgentEmailIdentity): Promise<void> {
  await fs.writeFile(await identityPath(), JSON.stringify(identity, null, 2), 'utf-8')
}

export async function saveCustomAgentIdentity(opts: {
  address: string
  displayName?: string
}): Promise<AgentEmailIdentity> {
  const identity: AgentEmailIdentity = {
    address: opts.address.trim(),
    password: '',
    provider: 'custom',
    displayName: opts.displayName?.trim() || 'Eva (NEXUS Agent)',
    createdAt: new Date().toISOString(),
  }
  await saveAgentIdentity(identity)
  return identity
}

async function fetchMailTmToken(address: string, password: string): Promise<string> {
  const res = await fetch(`${MAIL_TM_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Mail.tm auth failed (${res.status}): ${errText.slice(0, 140)}`)
  }
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('Mail.tm token missing in response')
  return data.token
}

/**
 * Autonomously provisions a real working email inbox for Eva via Mail.tm (zero user setup).
 * If Eva already has an active Mail.tm identity and `forceNew` is false, reuses it.
 */
export async function provisionAgentEmail(opts?: {
  preferredLocal?: string
  displayName?: string
  forceNew?: boolean
}): Promise<{ identity: AgentEmailIdentity; created: boolean }> {
  const existing = await getAgentIdentity()
  if (existing && existing.provider === 'mail.tm' && !opts?.forceNew) {
    // Refresh token if missing
    if (!existing.token && existing.password) {
      try {
        existing.token = await fetchMailTmToken(existing.address, existing.password)
        await saveAgentIdentity(existing)
      } catch {
        /* fall through to provision fresh account */
      }
    }
    if (existing.token) {
      return { identity: existing, created: false }
    }
  }

  // 1. Discover active Mail.tm domain (handles both JSON-LD hydra:member and plain JSON array)
  const domRes = await fetch(`${MAIL_TM_BASE}/domains?page=1`, {
    headers: { Accept: 'application/ld+json, application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!domRes.ok) {
    throw new Error(`Could not query Mail.tm domains (${domRes.status})`)
  }
  const domJson = (await domRes.json()) as
    | Array<{ domain?: string; isActive?: boolean }>
    | { 'hydra:member'?: Array<{ domain?: string; isActive?: boolean }>; member?: Array<{ domain?: string; isActive?: boolean }> }
  const domainList = Array.isArray(domJson)
    ? domJson
    : (domJson['hydra:member'] ?? domJson.member ?? [])
  const activeDomain =
    domainList.find((d) => d.isActive !== false && d.domain)?.domain ?? domainList[0]?.domain
  if (!activeDomain) {
    throw new Error('No active Mail.tm domain available right now.')
  }

  // 2. Generate unique alphanumeric local-part & strong hex password (Mail.tm compatible)
  const baseLocal = (opts?.preferredLocal || 'evanexus')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'evanexus'
  const suffix = crypto.randomBytes(3).toString('hex')
  const address = `${baseLocal}${suffix}@${activeDomain}`
  const password = `Eva${crypto.randomBytes(10).toString('hex')}`

  // 3. Create account
  const accRes = await fetch(`${MAIL_TM_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!accRes.ok) {
    const errText = await accRes.text().catch(() => '')
    throw new Error(`Mail.tm account creation failed (${accRes.status}): ${errText.slice(0, 160)}`)
  }
  const accData = (await accRes.json()) as { id?: string }

  // 4. Obtain JWT token
  const token = await fetchMailTmToken(address, password)

  const identity: AgentEmailIdentity = {
    address,
    password,
    provider: 'mail.tm',
    displayName: opts?.displayName?.trim() || 'Eva (NEXUS Agent)',
    accountId: accData.id,
    token,
    createdAt: new Date().toISOString(),
  }
  await saveAgentIdentity(identity)
  return { identity, created: true }
}

async function ensureMailTmToken(identity: AgentEmailIdentity): Promise<string> {
  if (identity.provider !== 'mail.tm') {
    throw new Error('Live inbox polling is available for autonomous Mail.tm identities. Provision one first.')
  }
  if (identity.token) return identity.token
  const token = await fetchMailTmToken(identity.address, identity.password)
  identity.token = token
  await saveAgentIdentity(identity)
  return token
}

export async function listAgentInbox(): Promise<{
  identity: AgentEmailIdentity | null
  messages: AgentInboxMessageSummary[]
}> {
  const identity = await getAgentIdentity()
  if (!identity) return { identity: null, messages: [] }
  if (identity.provider !== 'mail.tm') return { identity, messages: [] }

  let token = await ensureMailTmToken(identity)
  let res = await fetch(`${MAIL_TM_BASE}/messages?page=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/ld+json, application/json' },
    signal: AbortSignal.timeout(12_000),
  })

  // Refresh expired JWT once automatically
  if (res.status === 401 && identity.password) {
    token = await fetchMailTmToken(identity.address, identity.password)
    identity.token = token
    await saveAgentIdentity(identity)
    res = await fetch(`${MAIL_TM_BASE}/messages?page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/ld+json, application/json' },
      signal: AbortSignal.timeout(12_000),
    })
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch inbox (${res.status})`)
  }

  type RawMailTmMsg = {
    id?: string
    from?: { address?: string; name?: string }
    subject?: string
    intro?: string
    seen?: boolean
    createdAt?: string
  }
  const data = (await res.json()) as
    | RawMailTmMsg[]
    | { 'hydra:member'?: RawMailTmMsg[]; member?: RawMailTmMsg[] }
  const rawList = Array.isArray(data) ? data : (data['hydra:member'] ?? data.member ?? [])

  const messages: AgentInboxMessageSummary[] = rawList.map((m) => ({
    id: String(m.id ?? ''),
    from: m.from?.name ? `${m.from.name} <${m.from.address ?? ''}>` : m.from?.address ?? 'unknown',
    subject: m.subject || '(no subject)',
    intro: m.intro || '',
    seen: Boolean(m.seen),
    createdAt: m.createdAt || new Date().toISOString(),
  }))

  return { identity, messages }
}

export async function readAgentInboxMessage(messageId: string): Promise<AgentInboxMessageDetail> {
  const identity = await getAgentIdentity()
  if (!identity) throw new Error('No autonomous agent email provisioned yet.')
  const token = await ensureMailTmToken(identity)

  const res = await fetch(`${MAIL_TM_BASE}/messages/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    throw new Error(`Could not read message ${messageId} (${res.status})`)
  }

  const data = (await res.json()) as {
    id?: string
    from?: { address?: string; name?: string }
    subject?: string
    text?: string
    html?: string[]
    createdAt?: string
  }

  const htmlText = Array.isArray(data.html)
    ? data.html.join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : ''
  const bodyText = (data.text || htmlText || '').trim()
  const { codes, links } = extractVerificationArtifacts(`${data.subject ?? ''}\n${bodyText}`)

  return {
    id: String(data.id ?? messageId),
    from: data.from?.name ? `${data.from.name} <${data.from.address ?? ''}>` : data.from?.address ?? 'unknown',
    subject: data.subject || '(no subject)',
    text: bodyText.slice(0, 6000),
    createdAt: data.createdAt || new Date().toISOString(),
    codes,
    links,
  }
}

export async function waitForVerificationCode(opts?: {
  senderFilter?: string
  timeoutMs?: number
}): Promise<{
  found: boolean
  message?: AgentInboxMessageDetail
  note: string
}> {
  const timeoutMs = Math.min(30_000, Math.max(4_000, opts?.timeoutMs ?? 20_000))
  const started = Date.now()
  const filter = (opts?.senderFilter ?? '').trim().toLowerCase()

  while (Date.now() - started < timeoutMs) {
    const { messages } = await listAgentInbox()
    const match = messages.find((m) =>
      filter ? `${m.from} ${m.subject}`.toLowerCase().includes(filter) : true
    )
    if (match) {
      const detail = await readAgentInboxMessage(match.id)
      if (detail.codes.length > 0 || detail.links.length > 0 || !filter) {
        return {
          found: true,
          message: detail,
          note: `Received "${detail.subject}" from ${detail.from}.`,
        }
      }
    }
    await new Promise((r) => setTimeout(r, 2500))
  }

  return {
    found: false,
    note: `No matching verification email arrived within ${Math.round(timeoutMs / 1000)}s.`,
  }
}

export function sanitizeIdentityForClient(identity: AgentEmailIdentity | null) {
  if (!identity) return null
  return {
    address: identity.address,
    provider: identity.provider,
    displayName: identity.displayName,
    createdAt: identity.createdAt,
  }
}
