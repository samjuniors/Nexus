/**
 * RETRIEVALS — ported from gbrain's page_retrievals ledger
 * (src/schema.sql) with the use-attribution idea from gbrain's
 * takes/facts feedback lanes.
 *
 * Every recall is recorded; a memory that keeps being retrieved earns
 * trust (retrieval strength), and one that is never asked for fades from
 * suggestion. The ledger is a bounded ring buffer in the page's metadata:
 * zero-LLM, deterministic, auditable — you can see exactly when a memory
 * was used and for what.
 */

import type { GBrainPage } from './types'

export interface RetrievalEntry {
  q: string // the query that pulled this memory
  t: number // epoch ms
}

const LEDGER_MAX = 20

/** Append a retrieval to a page's metadata ring buffer (returns the new meta). */
export function recordRetrieval(
  page: GBrainPage,
  query: string,
  now = Date.now()
): { meta: Record<string, unknown>; accessCount: number } {
  const ledger = Array.isArray(page.meta.retrievals) ? (page.meta.retrievals as RetrievalEntry[]) : []
  const next: RetrievalEntry[] = [...ledger, { q: query.slice(0, 120), t: now }].slice(-LEDGER_MAX)
  return {
    meta: { ...page.meta, retrievals: next },
    accessCount: page.accessCount + 1,
  }
}

/**
 * Use-attributed trust: how much this page's retrievals support it
 * (0..1). Recent retrievals count more than old ones (recency-weighted),
 * mirroring gbrain's "what the brain actually uses is what it knows".
 */
export function retrievalTrust(page: GBrainPage, now = Date.now()): number {
  const ledger = Array.isArray(page.meta.retrievals) ? (page.meta.retrievals as RetrievalEntry[]) : []
  if (ledger.length === 0) return Math.min(0.4, page.strength)
  let weight = 0
  for (const r of ledger) {
    const ageDays = (now - r.t) / 86_400_000
    weight += Math.exp(-ageDays / 14) // two-week half-life-ish
  }
  return Math.min(1, weight / 8) // saturates around ~8 recent retrievals
}

/** The last N retrieval queries that pulled this page (for the inspector UI). */
export function retrievalLog(page: GBrainPage, limit = 8): RetrievalEntry[] {
  const ledger = Array.isArray(page.meta.retrievals) ? (page.meta.retrievals as RetrievalEntry[]) : []
  return [...ledger].reverse().slice(0, limit)
}
