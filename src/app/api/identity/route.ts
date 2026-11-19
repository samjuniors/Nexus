import { NextResponse } from 'next/server'
import {
  listAgentInbox,
  provisionAgentEmail,
  readAgentInboxMessage,
  sanitizeIdentityForClient,
  saveCustomAgentIdentity,
} from '@/lib/agent/agent-identity'

export async function GET() {
  try {
    const { identity, messages } = await listAgentInbox()
    return NextResponse.json({
      ok: true,
      identity: sanitizeIdentityForClient(identity),
      messages,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string
      preferredLocal?: string
      displayName?: string
      address?: string
      messageId?: string
    }

    const action = String(body.action ?? 'provision').trim()

    if (action === 'read') {
      const messageId = String(body.messageId ?? '').trim()
      if (!messageId) return NextResponse.json({ ok: false, error: 'Missing messageId' }, { status: 400 })
      const message = await readAgentInboxMessage(messageId)
      return NextResponse.json({ ok: true, message })
    }

    if (action === 'custom') {
      const address = String(body.address ?? '').trim()
      if (!address || !address.includes('@')) {
        return NextResponse.json({ ok: false, error: 'Provide a valid email address' }, { status: 400 })
      }
      const identity = await saveCustomAgentIdentity({ address, displayName: body.displayName })
      return NextResponse.json({ ok: true, identity: sanitizeIdentityForClient(identity), messages: [] })
    }

    const { identity, created } = await provisionAgentEmail({
      preferredLocal: body.preferredLocal,
      displayName: body.displayName,
      forceNew: action === 'reset',
    })
    const { messages } = await listAgentInbox().catch(() => ({ identity, messages: [] }))
    return NextResponse.json({
      ok: true,
      created,
      identity: sanitizeIdentityForClient(identity),
      messages,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
