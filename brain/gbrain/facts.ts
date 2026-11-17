/**
 * FACTS — ported from gbrain src/core/facts/{classify, claim-conflicts,
 * capture-dedup}.ts (MIT, Garry Tan).
 *
 * A fact is a typed claim: ENTITY + METRIC + VALUE ("Maria uses Python",
 * "User prefers dark themes"). Two active facts that state different values
 * of the same metric for the same entity are a CONFLICT — gbrain files the
 * newer one as superseding the older instead of letting memory quietly
 * contradict itself. Here: the incoming claim wins (it is the newer truth),
 * the older page is marked superseded in its metadata and its compiled
 * truth is rewritten, so recall stops serving the stale value while the
 * history stays readable.
 */

import type { GBrainClaim, GBrainConflict, GBrainPage } from './types'

/** Metrics (relations) whose claims are comparable — same metric + entity = same fact slot. */
const CLAIM_METRICS = new Set([
  'prefers', 'uses', 'works at', 'lives in', 'likes', 'owns', 'studies',
  'plays', 'speaks', 'reports to', 'founded', 'joined', 'left', 'is',
])

/**
 * Mine typed claims from free text. Deterministic sentence-pattern parse —
 * the same discipline as gbrain's line grammar: only what the sentence
 * actually says, never inferred values.
 */
export function extractClaims(text: string): GBrainClaim[] {
  const claims: GBrainClaim[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  for (const s of sentences) {
    const t = s.trim()
    if (!t || t.length > 300) continue
    // "ENTITY METRIC VALUE" with a capitalized/entity-like head
    const m = t.match(/^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)\s+(prefers|uses|works at|lives in|likes|owns|studies|plays|speaks|reports to|founded|joined|left)\s+(.{2,120}?)(?:[.!?]|$)/)
    if (m) {
      claims.push({ entity: m[1].trim(), metric: m[2], value: m[3].trim(), raw: t })
      continue
    }
    // "ENTITY's METRIC is VALUE" (preferences phrased as nouns)
    const m2 = t.match(/^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)'s\s+(favorite|preferred)\s+([\w\s-]{2,40}?)\s+is\s+(.{2,120}?)(?:[.!?]|$)/i)
    if (m2) {
      claims.push({
        entity: m2[1].trim(),
        metric: 'prefers',
        value: `${m2[3].trim()}: ${m2[4].trim()}`,
        raw: t,
      })
    }
  }
  return claims
}

/** The fact slot a claim occupies — conflicts are same-slot, different-value. */
export function claimKey(claim: GBrainClaim): string {
  return `${claim.entity.toLowerCase()}|${claim.metric.toLowerCase()}`
}

/**
 * Find conflicts between an incoming claim and the stored pages
 * (gbrain claim-conflicts, keyless lane): same entity + metric, a
 * different value, on an active (not superseded) page.
 */
export function findConflicts(claim: GBrainClaim, pages: GBrainPage[]): GBrainConflict[] {
  const key = claimKey(claim)
  const conflicts: GBrainConflict[] = []
  for (const p of pages) {
    if (p.meta.supersededBy) continue // already superseded — history, not truth
    const pageClaims = extractClaims(p.content)
    for (const pc of pageClaims) {
      if (claimKey(pc) !== key) continue
      const sameValue =
        pc.value.toLowerCase().trim() === claim.value.toLowerCase().trim() ||
        pc.value.toLowerCase().includes(claim.value.toLowerCase()) ||
        claim.value.toLowerCase().includes(pc.value.toLowerCase())
      if (!sameValue) {
        conflicts.push({
          claim,
          pageId: p.id,
          pageContent: p.content,
          supersededTruth: pc.raw,
        })
      }
    }
  }
  return conflicts
}

/**
 * Capture dedup (gbrain capture-dedup): is this incoming memory a
 * near-duplicate of an existing page? Same normalized content or one
 * containing the other counts — a duplicate refreshes the original
 * (bumps importance) instead of adding noise.
 */
export function findDuplicate(
  content: string,
  pages: GBrainPage[]
): { page: GBrainPage; exact: boolean } | null {
  const norm = content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!norm) return null
  for (const p of pages) {
    const pn = p.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!pn) continue
    if (pn === norm) return { page: p, exact: true }
    // containment on pages over ~40 chars (short strings contain too easily)
    if (norm.length >= 40 && pn.length >= 40 && (pn.includes(norm) || norm.includes(pn))) {
      return { page: p, exact: false }
    }
  }
  return null
}

/**
 * Compile a one-line TRUTH for a page (gbrain's compiled truth, heuristic
 * lane): the first claim if the text makes one, else the first sentence
 * under ~160 chars. This is what the core tier and recall surfaces render.
 */
export function compileTruth(content: string): string {
  const claims = extractClaims(content)
  if (claims.length > 0) {
    const c = claims[0]
    return `${c.entity} ${c.metric} ${c.value}`.slice(0, 200)
  }
  const first = content.split(/(?<=[.!?])\s+/)[0]?.trim() ?? content.trim()
  return first.length > 200 ? first.slice(0, 197) + '…' : first
}
