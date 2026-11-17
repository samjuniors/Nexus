/* Legacy non-stream JSON path — single LLM call. */

export {}
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
async function main() {
  const res = await fetch(BASE + '/api/agent/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: null, message: 'What is the capital of Italy? Answer in one short sentence.' }),
  })
  const data = (await res.json()) as { ok: boolean; mode?: string; reply?: string; error?: string }
  const ok = data.ok && data.mode === 'chat' && (data.reply?.length ?? 0) > 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  legacy JSON chat reply — mode=${data.mode} reply="${(data.reply ?? data.error ?? '').slice(0, 60)}"`)
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error('CRASHED:', e.message); process.exit(1) })
