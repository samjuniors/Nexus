/**
 * CORE MEMORY — ported from gbrain src/core/core-memory.ts (MIT, Garry Tan).
 *
 * The always-loaded tier: a few pages marked `alwaysLoad` render into EVERY
 * prompt through one brain-wide character budget (default 4000, as gbrain).
 * Everything here is deterministic and zero-LLM — the rendered unit is the
 * page's compiled truth (never its whole text), sorted by core priority
 * then importance, and the budget is enforced by the write path
 * (markCore refuses when the tier is full).
 */

import type { GBrainPage } from './types'

export const CORE_DEFAULT_MAX_CHARS = 4000
export const CORE_MIN_MAX_CHARS = 500
export const CORE_MAX_MAX_CHARS = 6000
export const CORE_MAX_PAGES = 50
export const CORE_DEFAULT_PRIORITY = 100

/** Render the core tier: "TITLE: truth" per always-loaded page, under budget. */
export function renderCoreTier(pages: GBrainPage[], maxChars = CORE_DEFAULT_MAX_CHARS): string {
  const core = pages
    .filter((p) => p.alwaysLoad && !p.meta.supersededBy) // superseded truths leave the tier
    .sort(
      (a, b) =>
        (a.corePriority ?? CORE_DEFAULT_PRIORITY) - (b.corePriority ?? CORE_DEFAULT_PRIORITY) ||
        b.importance - a.importance
    )
    .slice(0, CORE_MAX_PAGES)

  if (core.length === 0) return ''

  const lines: string[] = []
  let used = 0
  for (const p of core) {
    const line = `- ${p.truth || p.content.slice(0, 160)}`
    if (used + line.length > maxChars && lines.length > 0) break // never empty the tier
    if (line.length > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ''
  return `CORE MEMORY (always loaded — the owner's standing truths):\n${lines.join('\n')}`
}

/**
 * Mark a page as core (always loaded). Enforces the budget: when adding
 * this page's truth would overflow `maxChars`, refuse — the owner must
 * unmark something first (gbrain's core-guard).
 */
export function canMarkCore(page: GBrainPage, pages: GBrainPage[], maxChars = CORE_DEFAULT_MAX_CHARS): { ok: boolean; reason?: string } {
  const current = pages.filter((p) => p.alwaysLoad && p.id !== page.id)
  const used = current.reduce((a, p) => a + (p.truth || p.content.slice(0, 160)).length + 3, 0)
  const cost = (page.truth || page.content.slice(0, 160)).length + 3
  if (current.length + 1 > CORE_MAX_PAGES) {
    return { ok: false, reason: `core tier holds at most ${CORE_MAX_PAGES} pages` }
  }
  if (used + cost > maxChars) {
    return { ok: false, reason: `core tier budget (${maxChars} chars) is full — unmark another page first` }
  }
  return { ok: true }
}

/**
 * Which pages DESERVE core status (gbrain: the owner designates; here the
 * brain also suggests): standing preferences and decisions with high
 * importance that keep being retrieved.
 */
export function suggestCore(pages: GBrainPage[], limit = 5): GBrainPage[] {
  return pages
    .filter((p) => !p.alwaysLoad)
    .filter((p) => ['preference', 'decision', 'fact'].includes(p.type))
    .filter((p) => p.importance >= 6 || p.accessCount >= 3)
    .sort((a, b) => b.importance + Math.min(10, b.accessCount) - (a.importance + Math.min(10, a.accessCount)))
    .slice(0, limit)
}
