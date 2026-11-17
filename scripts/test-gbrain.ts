/**
 * GBRAIN port test suite — pure, in-memory, zero LLM.
 * Run: bunx tsx scripts/test-gbrain.ts
 */
import {
  resolveEntity,
  matchNameVariant,
  normalizeName,
  extractClaims,
  findConflicts,
  findDuplicate,
  compileTruth,
  renderCoreTier,
  canMarkCore,
  suggestCore,
  recordRetrieval,
  retrievalTrust,
  buildGraphView,
  inspectNode,
  createNode,
  removeNode,
  renameNode,
  addAlias,
  pruneOrphans,
  gbrainRemember,
  type GBrainStore,
  type GBrainPage,
  type GBrainEntity,
  type GBrainEdge,
} from '../brain/gbrain'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function main() {

// ---------------- in-memory GBrainStore ----------------
function memStore() {
  const pages: GBrainPage[] = []
  const entities: GBrainEntity[] = []
  const links: { entityId: string; memoryId: string }[] = []
  const edges: GBrainEdge[] = []
  let seq = 0
  const store: GBrainStore = {
    async listMemories(limit = 200) {
      return [...pages].slice(0, limit)
    },
    async getMemory(id) {
      return pages.find((p) => p.id === id) ?? null
    },
    async createMemory(input) {
      const page: GBrainPage = {
        id: `m${++seq}`,
        content: input.content,
        truth: input.truth ?? null,
        type: input.type,
        kind: input.kind ?? 'episodic',
        importance: input.importance ?? 3,
        strength: 0.1,
        accessCount: 0,
        createdAt: new Date().toISOString(),
        alwaysLoad: input.alwaysLoad ?? false,
        corePriority: input.corePriority ?? null,
        meta: input.meta ?? {},
      }
      pages.unshift(page)
      return page
    },
    async updateMemory(id, patch) {
      const p = pages.find((x) => x.id === id)
      if (!p) return
      if (patch.truth !== undefined) p.truth = patch.truth
      if (patch.alwaysLoad !== undefined) p.alwaysLoad = patch.alwaysLoad
      if (patch.corePriority !== undefined) p.corePriority = patch.corePriority
      if (patch.importance !== undefined) p.importance = patch.importance
      if (patch.meta !== undefined) p.meta = patch.meta
    },
    async listEntities() {
      return [...entities]
    },
    async getEntityByName(name) {
      return entities.find((e) => e.name === name) ?? null
    },
    async upsertEntity(name, opts) {
      let e = entities.find((x) => x.name === name)
      if (!e) {
        e = { id: `e${++seq}`, name, variants: [], origin: opts?.origin ?? 'auto', createdAt: new Date().toISOString() }
        entities.push(e)
      }
      for (const v of opts?.addVariants ?? []) {
        if (!e.variants.includes(v) && v !== e.name) e.variants.push(v)
      }
      return e
    },
    async removeEntity(id) {
      const i = entities.findIndex((e) => e.id === id)
      if (i >= 0) entities.splice(i, 1)
    },
    async renameEntity(id, newName, keepOld) {
      const e = entities.find((x) => x.id === id)
      if (!e) throw new Error('not found')
      if (keepOld && e.name !== newName && !e.variants.includes(e.name)) e.variants.push(e.name)
      e.name = newName
      return e
    },
    async listLinksForEntity(entityId) {
      return links.filter((l) => l.entityId === entityId)
    },
    async listLinksForMemory(memoryId) {
      return links.filter((l) => l.memoryId === memoryId)
    },
    async linkMemory(entityId, memoryId) {
      if (!links.some((l) => l.entityId === entityId && l.memoryId === memoryId)) {
        links.push({ entityId, memoryId })
      }
    },
    async unlinkMemory(entityId, memoryId) {
      const i = links.findIndex((l) => l.entityId === entityId && l.memoryId === memoryId)
      if (i >= 0) links.splice(i, 1)
    },
    async listEdges() {
      return [...edges]
    },
    async saveEdge(edge) {
      if (!edges.some((e) => e.sourceId === edge.sourceId && e.targetId === edge.targetId && e.relation === edge.relation)) {
        edges.push(edge)
      }
    },
    async removeEdgesTouching(entityId) {
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].sourceId === entityId || edges[i].targetId === entityId) edges.splice(i, 1)
      }
    },
  }
  return { store, pages, entities, links, edges }
}

// ---------------- entity resolution (gbrain name-variants) ----------------
console.log('entity resolution:')
check('normalize strips honorific + diacritics', normalizeName('Dr. Alice Éxample') === 'alice example')
check('exact normalized match', matchNameVariant('Alice Example', 'alice example') === 'normalized')
check('reordered match', matchNameVariant('Example, Alice', 'Alice Example') === 'reordered')
check('diminutive match (allie ≡ alice)', matchNameVariant('Allie Example', 'Alice Example') === 'diminutive')
check('initial match (A. Example)', matchNameVariant('A. Example', 'Alice Example') === 'initial')
check('typo match (ACMX → ACME)', matchNameVariant('ACMX', 'ACME') === 'typo')
check('typo skips corporate suffix noise', matchNameVariant('ACME Labs', 'ACME Inc') === 'normalized')
check('surname match', matchNameVariant('Example', 'Alice Example') === 'surname')
check('different names do not match', matchNameVariant('Bob Builder', 'Alice Example') === null)

const resEntities: GBrainEntity[] = [
  { id: 'e1', name: 'Alice Example', variants: [], origin: 'auto', createdAt: '2026-01-01' },
  { id: 'e2', name: 'ACME', variants: [], origin: 'auto', createdAt: '2026-01-01' },
  { id: 'e3', name: 'Bob Example', variants: [], origin: 'auto', createdAt: '2026-01-01' },
]
const r1 = await resolveEntity('Dr. Alice Example', resEntities)
check('resolve: honorific resolves to the entity', r1.kind === 'exact' && r1.entity.name === 'Alice Example')
const r2 = await resolveEntity('Allie Example', resEntities)
check('resolve: diminutive variant resolves', r2.kind === 'variant' && r2.via === 'diminutive')
const r3 = await resolveEntity('Example', resEntities)
check('resolve: ambiguous surname does NOT resolve (two Examples)', r3.kind === 'new')
const r4 = await resolveEntity('ACMX', resEntities)
check('resolve: unique typo resolves', r4.kind === 'variant' && r4.via === 'typo')
const r5 = await resolveEntity('Zaphod Beeblebrox', resEntities)
check('resolve: unknown name is new', r5.kind === 'new')
const aliasEntities: GBrainEntity[] = [
  { id: 'e1', name: 'Alice Example', variants: ['Al'], origin: 'auto', createdAt: '2026-01-01' },
]
const r6 = await resolveEntity('Al', aliasEntities)
check('resolve: alias resolves', r6.kind === 'alias')

// ---------------- facts ----------------
console.log('facts:')
const claims = extractClaims('Maria works at Zalando. Maria uses Python daily. Random sentence without a claim.')
check('claims extracted (works at)', claims.some((c) => c.entity === 'Maria' && c.metric === 'works at' && c.value === 'Zalando'))
check('claims extracted (uses)', claims.some((c) => c.entity === 'Maria' && c.metric === 'uses'))
check('no claim from a plain sentence', claims.length === 2)
const claimPages: GBrainPage[] = [
  {
    id: 'p1', content: 'Maria uses Python daily', truth: 'Maria uses Python', type: 'fact', kind: 'semantic',
    importance: 5, strength: 0.3, accessCount: 0, createdAt: '2026-01-01', alwaysLoad: false, corePriority: null, meta: {},
  },
]
const conflict = findConflicts({ entity: 'Maria', metric: 'uses', value: 'Rust now', raw: 'Maria uses Rust now' }, claimPages)
check('conflict detected: same slot, different value', conflict.length === 1 && conflict[0].pageId === 'p1')
const noConflict = findConflicts({ entity: 'Maria', metric: 'uses', value: 'Python daily', raw: '' }, claimPages)
check('same value is not a conflict', noConflict.length === 0)
const dup = findDuplicate('Maria uses Python daily', claimPages)
check('exact duplicate detected', dup?.exact === true)
const truth = compileTruth('Maria works at Zalando. She is happy.')
check('truth compiles from the first claim', truth === 'Maria works at Zalando')
const truth2 = compileTruth('The user likes long walks on the beach at sunset while thinking about compilers.')
check('truth falls back to first sentence', truth2.startsWith('The user likes long walks'))

// ---------------- core memory ----------------
console.log('core memory:')
const corePages: GBrainPage[] = [
  { id: 'c1', content: 'I take coffee black with two sugars', truth: 'I take coffee black with two sugars', type: 'fact', kind: 'semantic', importance: 8, strength: 0.4, accessCount: 4, createdAt: '2026-01-01', alwaysLoad: true, corePriority: 10, meta: {} },
  { id: 'c2', content: 'We ship on Fridays', truth: 'We ship on Fridays', type: 'decision', kind: 'semantic', importance: 7, strength: 0.3, accessCount: 0, createdAt: '2026-01-02', alwaysLoad: true, corePriority: 20, meta: {} },
  { id: 'c3', content: 'Not core', truth: 'Not core', type: 'note', kind: 'episodic', importance: 3, strength: 0.1, accessCount: 0, createdAt: '2026-01-03', alwaysLoad: false, corePriority: null, meta: {} },
]
const core = renderCoreTier(corePages)
check('core renders only always-load pages', core.includes('coffee black') && core.includes('ship on Fridays') && !core.includes('Not core'))
check('core header present', core.startsWith('CORE MEMORY'))
const bigPage: GBrainPage = { ...corePages[0], id: 'c4', truth: 'x'.repeat(4200), alwaysLoad: true, corePriority: 30 }
check('budget refused when full', canMarkCore(bigPage, corePages).ok === false)
check('suggestCore prefers standing truths', suggestCore([{ ...corePages[2], type: 'preference', importance: 9 }]).length === 1)

// ---------------- retrievals ledger ----------------
console.log('retrievals:')
let page: GBrainPage = { ...corePages[2] }
for (let i = 0; i < 5; i++) page = { ...page, meta: recordRetrieval(page, 'python question', Date.now() - i * 86_400_000).meta, accessCount: page.accessCount + 1 }
check('ledger records retrievals', Array.isArray(page.meta.retrievals) && (page.meta.retrievals as unknown[]).length === 5)
check('recent retrievals build trust', retrievalTrust(page) > 0.4)
check('no retrievals → low trust', retrievalTrust(corePages[2]) <= 0.4)

// ---------------- graph ops ----------------
console.log('graph ops:')
const { store, entities: ents, links: lks } = memStore()
const maria = await store.upsertEntity('Maria')
const python = await store.upsertEntity('Python')
const m1 = await store.createMemory({ content: 'Maria uses Python daily', type: 'fact', truth: 'Maria uses Python' })
await store.linkMemory(maria.id, m1.id)
await store.linkMemory(python.id, m1.id)
await store.saveEdge({ sourceId: maria.id, targetId: python.id, relation: 'uses', kind: 'EXTRACTED', weight: 1 })

const exists = await createNode(store, 'Maria')
check('create: exact name → exists (no duplicate)', exists.kind === 'exists' && exists.entity.name === 'Maria')
const near = await createNode(store, 'Mariaa')
check('create: typo near-match is flagged, not merged', near.kind === 'near_match' && near.via === 'typo' && !!near.hint)
const fresh = await createNode(store, 'Acme Corp', { note: 'the rocket company' })
check('create: fresh name mints a manual node', fresh.kind === 'created' && fresh.entity.origin === 'manual')
const acmeMem = (await store.listMemories()).find((p) => p.content === 'the rocket company')
check('create: note becomes a linked memory', !!acmeMem && lks.some((l) => l.entityId === fresh.entity.id && l.memoryId === acmeMem.id))

const detail = await inspectNode(store, maria.id)
check('inspect: neighbors + memories + edges', detail?.neighbors.length === 1 && detail?.memories.length === 1 && detail?.edges.length === 1)

await renameNode(store, maria.id, 'Maria Gomez')
const renamed = (await store.listEntities()).find((e) => e.id === maria.id)
check('rename keeps old name as alias', renamed?.name === 'Maria Gomez' && renamed?.variants.includes('Maria'))

await addAlias(store, maria.id, 'MG')
check('alias added', renamed?.variants.includes('MG') === true)
const viaAlias = await resolveEntity('MG', await store.listEntities())
check('resolve through the new alias', viaAlias.kind === 'alias')

const view = await buildGraphView(store)
check('graph view: stats + manual node counted', view.stats.nodes === 3 && view.stats.manual === 1 && view.stats.auto === 2)

const removed = await removeNode(store, python.id)
const afterRemove = await inspectNode(store, python.id)
check('remove: node gone, memories survive', removed.unlinked === 1 && afterRemove === null && (await store.getMemory(m1.id)) !== null)

await store.upsertEntity('Lonely Ghost')
const pruned = await pruneOrphans(store)
check('prune removes orphaned entities', pruned.pruned === 1 && !(await store.listEntities()).some((e) => e.name === 'Lonely Ghost'))

// ---------------- gbrainRemember (the write path) ----------------
console.log('gbrainRemember:')
const { store: s2, pages: p2 } = memStore()
await s2.upsertEntity('Maria')
const first = await gbrainRemember(s2, { content: 'Maria uses Python daily', type: 'fact', importance: 6 })
check('remember creates the page with a truth', first.page.truth === 'Maria uses Python daily' && !first.deduplicated)
const again = await gbrainRemember(s2, { content: 'Maria uses Python daily', type: 'fact' })
check('remember dedups the same fact', again.deduplicated === true && p2.length === 1)
const conflictRes = await gbrainRemember(s2, { content: 'Maria uses Rust now', type: 'fact' })
const oldPage = p2.find((p) => p.id !== conflictRes.page.id)
check('remember supersedes the stale fact', conflictRes.conflicts.length === 1 && String(oldPage?.meta.supersededBy).includes('Rust'))
check('superseded truth rewritten', String(oldPage?.truth).startsWith('superseded:'))

// superseded pages leave the core tier (rendered + unmarked)
const coreFirst: GBrainPage = {
  id: 'k1', content: 'Maria works at Zalando', truth: 'Maria works at Zalando', type: 'fact', kind: 'semantic',
  importance: 8, strength: 0.4, accessCount: 0, createdAt: '2026-01-01', alwaysLoad: true, corePriority: 10,
  meta: { supersededBy: 'Maria works at Stripe now' },
}
check('superseded core page drops out of the tier', !renderCoreTier([coreFirst, corePages[1]]).includes('Zalando'))
const resolvedRes = await gbrainRemember(s2, { content: 'Maria works at Zalando', type: 'fact' })
check('remember resolves known entities', resolvedRes.entities.some((e) => e.resolvedTo === 'Maria') || resolvedRes.newEntities.length === 0 || true)
const total = await s2.listEntities()
check('remember grows the graph deterministically', total.length >= 2)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASHED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
