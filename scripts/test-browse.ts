export {}
import { executeTool } from '../src/lib/agent/tools'

async function main() {
  const r = await executeTool(
    'browse_site',
    { url: 'https://nodejs.org/en', topic: 'docs learn', maxPages: 3 },
    'test-run',
    null
  )
  console.log('ok:', r.ok)
  console.log('summary:', r.summary)
  console.log('raw first 300:', r.raw.slice(0, 300))
  const pages = (r.raw.match(/\[Page \d+\]/g) ?? []).length
  console.log('pages browsed:', pages)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
