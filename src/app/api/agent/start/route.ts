import { NextResponse } from 'next/server'
import { decideRoute, routeMessage, streamChatAnswer } from '@/lib/agent/orchestrator'
import { ensureSeeded } from '@/lib/agent/seed'

export const runtime = 'nodejs'

/**
 * FRONT DOOR — routes every message.
 *
 * Two response shapes:
 *  - stream: true  → Server-Sent Events. First a `meta` event (routing
 *    decision), then — for chat answers — a live `token` per generated
 *    chunk (the answer appears as if typed, speed proportional to its
 *    length), finally a `done` event with the persisted message id +
 *    suggestions. Task missions arrive as a single `meta` event and the
 *    client drives the run via /api/agent/step as before.
 *  - stream: false → legacy single JSON blob (routeMessage).
 */
export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      conversationId?: string | null
      message?: string
      stream?: boolean
    }
    const message = (body.message ?? '').trim()
    if (!message) {
      return NextResponse.json({ ok: false, error: 'Message is required' }, { status: 400 })
    }
    if (message.length > 4000) {
      return NextResponse.json({ ok: false, error: 'Message too long (max 4000 chars)' }, { status: 400 })
    }
    const conversationId = body.conversationId ?? null

    // ---- legacy non-streaming path ----
    if (!body.stream) {
      const result = await routeMessage(conversationId, message)
      return NextResponse.json({ ok: true, ...result })
    }

    // ---- SSE streaming path (the typing feel) ----
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const send = (obj: unknown) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
          } catch {
            closed = true // client disconnected — stop emitting
          }
        }
        try {
          const decision = await decideRoute(conversationId, message)

          if (decision.mode === 'task') {
            send({
              type: 'meta',
              mode: 'task',
              conversationId: decision.conversationId,
              runId: decision.runId,
              brainConnected: decision.brainConnected,
            })
          } else {
            send({
              type: 'meta',
              mode: 'chat',
              conversationId: decision.conversationId,
              brainConnected: decision.brainConnected,
              recalled: decision.recalled ?? [],
            })
            const res = await streamChatAnswer(decision.conversationId, message, {
              brainConnected: decision.brainConnected,
              recalled: decision.recalled,
              onToken: (token) => send({ type: 'token', text: token }),
            })
            send({
              type: 'done',
              messageId: res.assistantMessageId,
              suggestions: res.suggestions ?? [],
              recalled: res.recalled ?? [],
            })
          }
        } catch (e) {
          send({ type: 'error', error: e instanceof Error ? e.message : String(e) })
        } finally {
          closed = true
          try {
            controller.close()
          } catch {
            // already closed
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
