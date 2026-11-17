/**
 * ENTITY RESOLUTION — ported from gbrain src/core/entities/{name-variants,
 * near-name, resolve, resolve-on-save}.ts (MIT, Garry Tan).
 *
 * Names reach the brain in many shapes: a nickname ("Allie Example"), an
 * initial ("A. Example"), the surname alone, a one-letter typo ("ACMX" for
 * "ACME"), reversed order ("Example, Alice") or a title in front ("Dr.
 * Alice Example"). This module decides whether a name and an existing
 * entity are the same name, and how strong that match is — strongest kind
 * wins, and weak kinds (typo, surname) only resolve when exactly ONE
 * entity holds the match, so a near-name never silently becomes a
 * different entity.
 *
 * Save-time cascade (gbrain resolve-on-save):
 *   exact (normalized) → alias → variant (unique strongest) → new entity.
 *
 * Leaf module: text primitives only.
 */

import type { GBrainEntity, EntityResolution } from './types'

export type NameMatchKind =
  | 'normalized'
  | 'honorific'
  | 'reordered'
  | 'diminutive'
  | 'initial'
  | 'typo'
  | 'surname'

/** Variant kinds, strongest first (gbrain NAME_MATCH_RANK). */
export const NAME_MATCH_RANK: Readonly<Record<NameMatchKind, number>> = {
  normalized: 0,
  honorific: 1,
  reordered: 2,
  diminutive: 3,
  initial: 4,
  typo: 5,
  surname: 6,
}

/** Kinds that name an entity by part of the name only — require a unique match. */
export const WEAK_NAME_MATCHES: ReadonlySet<NameMatchKind> = new Set(['typo', 'surname'])

/** Leading honorifics and roles (gbrain NAME_TITLE_TOKENS, trimmed to the common set). */
const TITLE_TOKENS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'doctor', 'prof', 'professor', 'sir', 'dame',
  'lord', 'lady', 'rev', 'reverend', 'hon', 'honorable', 'mayor', 'senator', 'sen',
  'rep', 'president', 'pres', 'ceo', 'cto', 'cfo', 'coo', 'founder', 'chairman',
])

const SUFFIX_TOKENS: ReadonlySet<string> = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq'])

/** Corporate suffixes that do not distinguish two organizations (gbrain). */
const CORPORATE_SUFFIXES: ReadonlySet<string> = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co',
  'company', 'labs', 'lab', 'gmbh', 'plc', 'ag', 'sa', 'bv', 'the',
])

/**
 * Common English given-name groups: names in one group are the same given
 * name (gbrain NICKNAME_GROUPS). A name may sit in several groups ("alex").
 */
const NICKNAME_GROUPS: readonly string[] = [
  'abigail abby abbie gail', 'alexander alex alec al sasha xander', 'alexandra alex alexa lexi sandra sasha allie',
  'alice allie ally', 'alison allison ali allie', 'allan alan al', 'albert al bert bertie', 'alfred alf alfie fred',
  'amanda mandy manda', 'andrew andy drew', 'angela angie', 'anthony tony ant', 'arthur art artie',
  'barbara barb barbie babs', 'benjamin ben benji benny', 'bernard bernie', 'beverly bev', 'bradley brad',
  'calvin cal', 'cameron cam', 'catherine cathy cat kate katie', 'katherine kathy kate katie kat', 'kathryn kathy kate katie',
  'charles charlie chuck chas', 'charlotte charlie lottie', 'christina chris tina', 'christine chris tina chrissy',
  'christopher chris kit topher', 'cynthia cindy', 'daniel dan danny', 'danielle dani', 'david dave davey',
  'deborah debbie deb debra', 'dennis denny', 'donald don donnie', 'dorothy dot dottie', 'douglas doug',
  'edward ed eddie ted ned', 'edwin ed eddie', 'eleanor ellie nell nora', 'elizabeth liz lizzie beth betty eliza libby',
  'emily em emmy', 'eugene gene', 'frances fran franny', 'francis frank fran', 'franklin frank', 'frederick fred freddie rick',
  'gabriel gabe', 'gabrielle gabby', 'gerald gerry jerry', 'gregory greg', 'harold hal harry', 'harrison harry',
  'henry hank harry hal', 'herbert herb', 'isabel izzy bella', 'isabella izzy bella', 'jacob jake', 'james jim jimmy jamie',
  'jane janie', 'janet jan', 'jeffrey jeff', 'jennifer jen jenny', 'jessica jess jessie', 'johnathan jon john',
  'jonathan jon jonny', 'john johnny jack', 'joseph joe joey', 'josephine jo josie', 'joshua josh', 'judith judy',
  'kenneth ken kenny', 'kimberly kim', 'lawrence larry', 'leonard leo len lenny', 'louis lou', 'louise lou',
  'madeline maddie maddy', 'margaret maggie meg peggy marge', 'matthew matt', 'melissa mel missy', 'michael mike mikey mick',
  'michelle shelly', 'nathan nate', 'nathaniel nate nat', 'nicholas nick nicky', 'nicole nikki', 'oliver ollie',
  'pamela pam', 'patricia pat patty trish', 'patrick pat paddy', 'peter pete', 'philip phil', 'phillip phil',
  'rebecca becky becca', 'richard rick ricky dick rich', 'robert rob bob bobby robbie bert', 'roberta bobbie',
  'ronald ron ronnie', 'rosemary rose rosie', 'samantha sam sammy', 'samuel sam sammy', 'sandra sandy',
  'sarah sara sally', 'stephanie steph', 'stephen steve stevie', 'steven steve stevie', 'stuart stu', 'susan sue susie',
  'suzanne sue suzy', 'theodore ted teddy theo', 'thomas tom tommy', 'timothy tim timmy', 'valerie val',
  'victoria vicky tori', 'vincent vince vinny', 'walter walt wally', 'william will bill billy liam willy',
  'zachary zach zack',
]

const NICKNAMES: ReadonlyMap<string, ReadonlySet<number>> = (() => {
  const map = new Map<string, Set<number>>()
  NICKNAME_GROUPS.forEach((group, i) => {
    for (const name of group.split(' ')) {
      if (!map.has(name)) map.set(name, new Set())
      map.get(name)!.add(i)
    }
  })
  return map
})()

/** Fold latin diacritics to base letters (é→e) — gbrain latin-fold, compact. */
function foldLatin(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeName(raw: string): string {
  return foldLatin(raw.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TITLE_TOKENS.has(w) && !SUFFIX_TOKENS.has(w))
    .join(' ')
    .trim()
}

/** Damerau-Levenshtein distance (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1) // transposition
      }
    }
  }
  return d[m][n]
}

function words(name: string): string[] {
  return normalizeName(name).split(/\s+/).filter(Boolean)
}

function sameNicknames(a: string, b: string): boolean {
  const ga = NICKNAMES.get(a)
  const gb = NICKNAMES.get(b)
  if (!ga || !gb) return false
  for (const i of ga) if (gb.has(i)) return true
  return false
}

/**
 * The strongest name-variant match between a query name and a candidate
 * entity name, or null when they are different names (gbrain matchNameVariant).
 */
export function matchNameVariant(query: string, candidate: string): NameMatchKind | null {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (!q || !c) return null
  if (q === c) return 'normalized'

  const qw = words(query)
  const cw = words(candidate)
  if (qw.length === 0 || cw.length === 0) return null

  // reordered: "Example, Alice" ≡ "Alice Example"
  if (qw.length === cw.length && qw.length >= 2) {
    const qset = new Set(qw)
    const cset = new Set(cw)
    let allIn = true
    for (const w of qw) if (!cset.has(w)) allIn = false
    for (const w of cw) if (!qset.has(w)) allIn = false
    if (allIn) return 'reordered'
  }

  // honorific already stripped by normalize; title-only difference is 'honorific'
  // (e.g. "mayor example" vs "example" after stripping would already be equal)
  // initial: "A. Example" vs "Alice Example" — tails equal, one head is a
  // single letter prefix of the other (works at either length)
  if (qw.length >= 2 && cw.length >= 2) {
    const [qFirst, ...qRest] = qw
    const [cFirst, ...cRest] = cw
    if (qRest.join(' ') === cRest.join(' ')) {
      if (qFirst.length === 1 && cFirst.length > 1 && cFirst.startsWith(qFirst)) return 'initial'
      if (cFirst.length === 1 && qFirst.length > 1 && qFirst.startsWith(cFirst)) return 'initial'
    }
  }

  // diminutive: same surname + same given-name group (allie ≡ alice example)
  if (qw.length >= 2 && cw.length >= 2 && qw[qw.length - 1] === cw[cw.length - 1]) {
    if (sameNicknames(qw[0], cw[0])) return 'diminutive'
  }

  // surname: query is only the family name, candidate contains it
  if (qw.length === 1 && cw.length >= 2 && cw.includes(qw[0])) return 'surname'

  // corporate suffixes do not distinguish two organizations (gbrain):
  // "ACME Labs" vs "ACME Inc" is the same entity
  const qCore = dropCorporateSuffix(q)
  const cCore = dropCorporateSuffix(c)
  if ((qCore !== q || cCore !== c) && qCore === cCore && qCore.length >= 3) {
    return 'normalized'
  }

  // typo: Damerau distance exactly 1 on 3..64 char normalized names
  if (qCore !== cCore && qCore.length >= 3 && qCore.length <= 64 && cCore.length >= 3 && cCore.length <= 64) {
    if (editDistance(qCore, cCore) === 1) return 'typo'
  }

  return null
}

function dropCorporateSuffix(n: string): string {
  const w = n.split(' ').filter(Boolean)
  while (w.length > 1 && CORPORATE_SUFFIXES.has(w[w.length - 1])) w.pop()
  return w.join(' ')
}

/**
 * Save-time resolution cascade (gbrain resolve-on-save):
 * exact → alias → unique strongest variant → new entity.
 * Weak matches (typo/surname) resolve only when exactly one entity matches.
 */
export async function resolveEntity(
  name: string,
  entities: GBrainEntity[] | (() => Promise<GBrainEntity[]>)
): Promise<EntityResolution> {
  const list = typeof entities === 'function' ? await entities() : entities
  const norm = normalizeName(name)
  if (!norm) return { kind: 'new', name }

  // 1. exact normalized name
  const exact = list.find((e) => normalizeName(e.name) === norm)
  if (exact) return { kind: 'exact', entity: exact, via: 'normalized' }

  // 2. alias — a known variant of an existing entity
  for (const e of list) {
    if (e.variants.some((v) => normalizeName(v) === norm)) {
      return { kind: 'alias', entity: e, via: 'alias' }
    }
  }

  // 3. name-variant match — strongest kind wins; weak kinds need uniqueness
  let best: { entity: GBrainEntity; kind: NameMatchKind } | null = null
  let bestCount = 0
  for (const e of list) {
    const kind = matchNameVariant(name, e.name)
    if (!kind) continue
    if (!best || NAME_MATCH_RANK[kind] < NAME_MATCH_RANK[best.kind]) {
      best = { entity: e, kind }
      bestCount = 1
    } else if (kind === best.kind) {
      bestCount++
    }
  }
  if (best && (!WEAK_NAME_MATCHES.has(best.kind) || bestCount === 1)) {
    return { kind: 'variant', entity: best.entity, via: best.kind }
  }

  // 4. new entity
  return { kind: 'new', name }
}
