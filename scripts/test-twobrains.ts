/* Two-brain + streaming live test.

export {}
 * Verifies:
 *  1. Brain OFF  -> spine routes a chat question with FULL LLM answer (streamed, not lifeless)
 *  2. Brain ON   -> overlay routes chat with recall + suggestions, streamed tokens
 *  3. Task mode  -> mission runs end-to-end, produces next + improve suggestions
 *  4. App prefs  -> brain directives persist (tone)
 *  5. Legacy     -> non-stream JSON path still works
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as Record<string, unknown>
}

interface SseResult {
  meta: { mode: string; conversationId: string; runId?: string; brainConnected: boolean; recalled?: unknown[] } | null
  tokens: string[]
  done: { messageId: string; suggestions: string[]; recalled: unknown[] } | null
  error: string | null
  firstTokenMs: number
  lastTokenMs: number
}

async function startStream(message: string): Promise<SseResult> {
  const res = await fetch(BASE + '/api/agent/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: null, message, stream: true }),
  })
  const out: SseResult = { meta: null, tokens: [], done: null, error: null, firstTokenMs: 0, lastTokenMs: 0 }
  if (!res.ok || !res.body) {
    out.error = `HTTP ${res.status}`
    return out
  }
  const started = Date.now()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        const ev = JSON.parse(line.slice(6)) as Record<string, unknown>
        if (ev.type === 'meta') out.meta = ev as unknown as SseResult['meta']
        else if (ev.type === 'token') {
          out.tokens.push(String(ev.text))
          if (out.firstTokenMs === 0) out.firstTokenMs = Date.now() - started
          out.lastTokenMs = Date.now() - started
        } else if (ev.type === 'done') out.done = ev as unknown as SseResult['done']
        else if (ev.type === 'error') out.error = String(ev.error)
      } catch {
        /* partial */
      }
    }
  }
  return out
}

async function driveRun(runId: string): Promise<{ status: string; events: { type: string; data: Record<string, unknown> }[] }> {
  const events: { type: string; data: Record<string, unknown> }[] = []
  let status = ''
  for (let i = 0; i < 40; i++) {
    const res = (await post('/api/agent/step', { runId })) as unknown as {
      ok: boolean
      busy?: boolean
      status: string
      events: { type: string; data: Record<string, unknown> }[]
    }
    for (const e of res.events ?? []) {
      events.push({ type: e.type, data: (e.data ?? {}) as Record<string, unknown> })
    }
    status = res.status
    if (res.busy) {
      await new Promise((r) => setTimeout(r, 700))
      continue
    }
    if (['done', 'error', 'stopped'].includes(status)) break
    await new Promise((r) => setTimeout(r, 300))
  }
  return { status, events }
}

async function main() {
  // ---- 1. spine: disconnect the overlay, ask a chat question ----
  await post('/api/brain', { action: 'disconnect' })
  const spine = await startStream('What is the capital of France? Answer in one short sentence.')
  check('spine: meta is chat + brainConnected=false', spine.meta?.mode === 'chat' && spine.meta.brainConnected === false)
  check('spine: answer STREAMED as tokens', spine.tokens.length >= 3, `${spine.tokens.length} tokens`)
  const spineText = spine.tokens.join('')
  check('spine: real LLM answer (mentions Paris)', /paris/i.test(spineText), spineText.slice(0, 80))
  check('spine: not a lifeless reply', !/brain disconnected/i.test(spineText))
  check('spine: done event with message id', !!spine.done?.messageId)
  check('spine: no follow-up chips while overlay off', (spine.done?.suggestions ?? []).length === 0)

  // ---- 2. overlay: reconnect, same class of question ----
  await post('/api/brain', { action: 'connect' })
  await new Promise((r) => setTimeout(r, 3000)) // pacing: be gentle with the LLM API
  const overlay = await startStream('What is the capital of Japan? Answer in one short sentence.')
  check('overlay: meta is chat + brainConnected=true', overlay.meta?.mode === 'chat' && overlay.meta.brainConnected === true)
  check('overlay: answer STREAMED as tokens', overlay.tokens.length >= 3, `${overlay.tokens.length} tokens`)
  const overlayText = overlay.tokens.join('')
  check('overlay: real LLM answer (mentions Tokyo)', /tokyo/i.test(overlayText), overlayText.slice(0, 80))

  // longer answer → the typing must visibly spread over time
  await new Promise((r) => setTimeout(r, 3000))
  const long = await startStream('Explain in about 120 words how a knowledge graph works. Plain prose only.')
  check('overlay long: many tokens', long.tokens.length > 15, `${long.tokens.length} tokens`)
  check(
    'overlay long: typing spread over time',
    long.lastTokenMs - long.firstTokenMs > 700,
    `${long.lastTokenMs - long.firstTokenMs}ms spread over ${long.tokens.length} tokens`
  )

  // ---- 3. task mission with suggestions (overlay on) ----
  await new Promise((r) => setTimeout(r, 2500))
  const task = await startStream('Use the run_code tool to compute 7*6, then tell me the result.')
  check('task: meta is task + runId', task.meta?.mode === 'task' && !!task.meta.runId)
  if (task.meta?.runId) {
    const run = await driveRun(task.meta.runId)
    check('task: run completed', run.status === 'done', `status=${run.status}`)
    const final = run.events.find((e) => e.type === 'final')
    check('task: final answer exists', !!final?.data.answer && String(final.data.answer).length > 10)
    check('task: nextSteps suggested', Array.isArray(final?.data.nextSteps) && (final?.data.nextSteps as unknown[]).length > 0)
    check('task: improvements suggested', Array.isArray(final?.data.improvements))
    // verify suggestions persisted with kinds
    const convRes = (await fetch(`${BASE}/api/conversations`).then((r) => r.json())) as {
      conversations: { suggestions: { runId: string | null; kind: string }[] }[]
    }
    const kinds = convRes.conversations
      .flatMap((c) => c.suggestions)
      .filter((s) => s.runId === task.meta!.runId)
      .map((s) => s.kind)
    check('task: persisted suggestions include next', kinds.includes('next'), kinds.join(','))
  }

  // ---- 4. app prefs (brain directives) ----
  const prefsRes = (await post('/api/brain', { action: 'prefs', prefs: { tone: 'concise' } })) as {
    ok: boolean
    status?: { appPrefs?: { tone?: string } }
  }
  check('prefs: tone set to concise', prefsRes.ok && prefsRes.status?.appPrefs?.tone === 'concise')
  const getRes = (await fetch(`${BASE}/api/brain`).then((r) => r.json())) as {
    status: { appPrefs: { tone: string; autoDream: boolean } }
    appControl: { lever: string; value: string }[]
  }
  check('prefs: GET reflects concise + appControl present', getRes.status.appPrefs.tone === 'concise' && getRes.appControl.length === 3)
  await post('/api/brain', { action: 'prefs', prefs: { tone: 'balanced' } }) // restore

  // ---- 5. legacy non-stream JSON ----
  await new Promise((r) => setTimeout(r, 3000))
  const legacy = (await post('/api/agent/start', { conversationId: null, message: 'Say the word banana and nothing else.' })) as {
    ok: boolean
    mode?: string
    reply?: string
    error?: string
  }
  check('legacy: JSON chat reply works', legacy.ok && legacy.mode === 'chat' && (legacy.reply?.length ?? 0) > 0, (legacy.reply ?? legacy.error ?? '').slice(0, 60))

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASHED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
