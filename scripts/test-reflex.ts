/**
 * Reflex + brain-core regression suite.
 * Run: npx tsx scripts/test-reflex.ts
 */
import { reflexCheck, recallMemories, extractEntities, extractTriples, spreadingActivation, personalizedPageRank, rabbitHole, buildMemoryGraph, needsRewrite, expandQuery, teachFact, lessonsFor, coachDirective } from '../brain/index'
import { ContextCache, hashKey, stablePromptLayout, estimateTokens } from '../brain/core/cache'
import type { CoachLesson } from '../brain/core/coach'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}`)
  }
}

// ---------- reflexes ----------
console.log('reflexes:')
check('image gen escalates', reflexCheck('generate an image of a cat')?.reason === 'image generation')
check('tts escalates', reflexCheck('read this out loud')?.reason === 'text-to-speech')
check('real-time escalates', reflexCheck('latest news about AI')?.reason === 'real-time information')
check('clock question stays chat', reflexCheck('what is the date today?') === null)
check('time question stays chat', reflexCheck("what's the time right now?") === null)
check('research escalates', reflexCheck('research the history of Rome')?.reason === 'research mission')
check('computer use escalates (terminal)', reflexCheck('run this command in the terminal')?.reason === 'computer use')
check('computer use escalates (control)', reflexCheck('use my computer to check files')?.reason === 'computer use')
check('rabbit hole escalates', reflexCheck('take me down the rabbit hole about Maria')?.reason === 'graph exploration')
check('plain greeting stays chat', reflexCheck('hey how are you?') === null)

// ---------- entity + triple extraction ----------
console.log('entity extraction:')
const ents = extractEntities('Maria works at Zalando and Maria uses Python daily')
check('extracts Maria', ents.includes('Maria'))
check('extracts Zalando', ents.includes('Zalando'))
const triples = extractTriples('Maria works at Zalando. Maria uses Python daily.')
check('triple Maria→Zalando', triples.some((t) => t.source === 'Maria' && t.target === 'Zalando'))
check('triple Maria→python', triples.some((t) => t.source === 'Maria' && t.target.toLowerCase() === 'python'))

// ---------- recall scoring (Generative Agents formula) ----------
console.log('recall scoring:')
const now = new Date()
const memories = [
  { id: 'a', content: 'User prefers dark themes in every app', type: 'preference', importance: 8, createdAt: new Date(now.getTime() - 2 * 3600e3).toISOString() },
  { id: 'b', content: 'User asked about weather in Berlin yesterday', type: 'note', importance: 3, createdAt: new Date(now.getTime() - 48 * 3600e3).toISOString() },
  { id: 'c', content: 'The Starship Flight test succeeded', type: 'fact', importance: 6, createdAt: new Date(now.getTime() - 1 * 3600e3).toISOString() },
]
const recalled = recallMemories(memories, 'what themes do I prefer?', { limit: 2, now })
check('recalls the preference', recalled[0]?.id === 'a')
check('high importance outranks old noise', !recalled.some((r) => r.id === 'b'))
check('citations assigned', recalled.every((r) => r.cite > 0))

// ---------- graph: spreading activation + PPR + rabbit hole ----------
console.log('graph memory:')
const graph = buildMemoryGraph({
  entities: [
    { id: 'e1', name: 'Maria' },
    { id: 'e2', name: 'python' },
    { id: 'e3', name: 'Zalando' },
  ],
  edges: [
    { sourceId: 'e1', targetId: 'e2', relation: 'uses', kind: 'EXTRACTED', weight: 1 },
    { sourceId: 'e1', targetId: 'e3', relation: 'works at', kind: 'EXTRACTED', weight: 1 },
  ],
  links: [
    { entityId: 'e1', memoryId: 'm1' },
    { entityId: 'e2', memoryId: 'm2' },
    { entityId: 'e3', memoryId: 'm3' },
  ],
})
const sa = spreadingActivation(graph, ['e1'], { hops: 2 })
check('spreading activation reaches neighbors', sa.activation.get('e2')! > 0 && sa.activation.get('e3')! > 0)
const seeds = new Map([['e2', 1]])
const ppr = personalizedPageRank(graph, seeds)
check('PPR diffuses python → Maria → Zalando', (ppr.activation.get('e1') ?? 0) > 0 && (ppr.activation.get('e3') ?? 0) > 0)
check('PPR seed activated', (ppr.activation.get('e2') ?? 0) > 0)
// the fan effect is correct here: python's whole mass flows to Maria, so the
// memory mentioning BOTH ("Maria uses python") must outrank either alone —
// which is exactly what graph recall needs for "who uses python?"
const mBoth = (ppr.activation.get('e1') ?? 0) + (ppr.activation.get('e2') ?? 0)
check('hub neighbor mass ranks memory mentioning both highest', mBoth > (ppr.activation.get('e2') ?? 0))
const hole = rabbitHole(graph, 'Maria')
check('rabbit hole starts at Maria', hole?.entry === 'Maria')
check('rabbit hole hops somewhere', (hole?.hops.length ?? 0) >= 1)

// ---------- prompt refinement ----------
console.log('prompt refinement:')
check('pronoun follow-up needs rewrite', needsRewrite('and his sister?', [{ role: 'assistant', content: 'John is 34.' }]))
check('self-contained question passes', !needsRewrite('What is the capital of France?', []))
check('greeting never rewritten', !needsRewrite('thanks!', [{ role: 'assistant', content: 'here you go' }]))
check('query expansion makes variants', expandQuery('what is the python runtime?').length >= 2)
const taught = teachFact('please remember that I take coffee black')
check('teachFact strips wrapper', taught.ok && taught.content === 'I take coffee black')

// ---------- the coach ----------
console.log('the coach:')
const lessons: CoachLesson[] = [
  { id: 'l1', content: 'prefer web_search for prices', fromGoal: 'check the latest bitcoin price', weight: 0.8, timesUsed: 3, createdAt: '2026-11-01' },
  { id: 'l2', content: 'always fence code blocks', fromGoal: 'write a python palindrome function', weight: 0.4, timesUsed: 0, createdAt: '2026-11-02' },
  { id: 'l3', content: 'never use wikipedia for prices', fromGoal: 'check ethereum price now', weight: 0.1, timesUsed: 5, createdAt: '2026-11-03' },
]
const injected = lessonsFor('check the current bitcoin price', lessons)
check('relevant lesson injected', injected.some((l) => l.id === 'l1'))
check('low-credible lesson skipped', !injected.some((l) => l.id === 'l3'))
check('irrelevant task gets no lessons', lessonsFor('draw me a cat', lessons).length === 0)
check('coach directive formats', coachDirective(injected).includes('prefer web_search'))

// ---------- context cache ----------
console.log('context cache:')
check('hashKey stable', hashKey('abc') === hashKey('abc'))
check('hashKey differs', hashKey('abc') !== hashKey('abd'))
check('estimateTokens sane', estimateTokens('hello world, this is a test') > 0)
const cache = new ContextCache()
const layout = stablePromptLayout({ staticPersona: 'A', stableLists: 'B', history: 'C', volatileTail: 'D' })
check('stable layout ordered', layout === 'A\nB\nC\nD')

async function main() {
  console.log('context cache (async):')
  let produced = 0
  const r1 = await cache.cached('k1', 100, 60_000, async () => { produced++; return 'v1' })
  const r2 = await cache.cached('k1', 100, 60_000, async () => { produced++; return 'v2' })
  check('first call produces', !r1.hit && r1.value === 'v1')
  check('second call hits cache', r2.hit && r2.value === 'v1')
  check('producer ran once', produced === 1)
  check('tokens saved counted', cache.stats_().estTokensSaved === 100)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
void main()
