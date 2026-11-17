/**
 * CONTEXT CACHE — KV-cache-inspired token economy for the brain.
 *
 * Two ideas from production LLM systems, adapted to a portable brain:
 *
 * 1. RESPONSE CACHE (app level). LLM providers reuse the KV cache when a
 *    request repeats an exact prefix (Anthropic prompt caching reads cost
 *    0.1× base; OpenAI caches automatically ≥1024 tokens). Our brain makes
 *    the same move at the application level: deterministic callers (routing,
 *    chips, lesson matching) get identical prompt → identical answer, so we
 *    memoize the response with a TTL and serve repeats for zero tokens.
 *
 * 2. CACHE-FRIENDLY LAYOUT (prompt level). A prompt is only KV-cacheable
 *    when its PREFIX is byte-stable. `stablePromptLayout()` assembles every
 *    brain prompt in the discipline the providers require:
 *
 *        [ static persona ] → [ stable capability lists ] →
 *        [ stable memory block ] → [ append-only history ] → [ volatile tail ]
 *
 *    Nothing dynamic (timestamps, per-message recall) may appear above the
 *    tail — a date line in the system prompt would bust the whole cache.
 *
 * The cache is fully in-memory and per-process (like a provider's KV cache):
 * no persistence, no cross-restart survival — hits are opportunistic.
 */

export interface CacheEntry {
  value: string
  createdAt: number
  expiresAt: number
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  /** estimated prompt tokens never sent to the model thanks to hits */
  estTokensSaved: number
  hitRate: number
  size: number
  maxEntries: number
}

/** Rough token estimate (≈4 chars/token for English + JSON prompts). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Stable 32-bit FNV-1a hash of a string — deterministic across runs. */
export function hashKey(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + input.length.toString(36)
}

const MAX_ENTRIES = 128

export class ContextCache {
  private store = new Map<string, CacheEntry>()
  private stats = { hits: 0, misses: 0, evictions: 0, estTokensSaved: 0 }

  /**
   * Memoize an LLM call. On a fresh hit the cached value returns immediately
   * and the prompt's tokens are counted as saved (they were never sent).
   */
  async cached(
    key: string,
    promptTokens: number,
    ttlMs: number,
    produce: () => Promise<string>
  ): Promise<{ value: string; hit: boolean }> {
    const now = Date.now()
    const found = this.store.get(key)
    if (found && found.expiresAt > now) {
      this.stats.hits++
      this.stats.estTokensSaved += promptTokens
      // LRU touch
      this.store.delete(key)
      this.store.set(key, found)
      return { value: found.value, hit: true }
    }
    if (found) this.store.delete(key)

    this.stats.misses++
    const value = await produce()
    this.store.set(key, { value, createdAt: now, expiresAt: now + ttlMs })

    // bounded LRU eviction — the cache must never grow unbounded
    while (this.store.size > MAX_ENTRIES) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
      this.stats.evictions++
    }
    return { value, hit: false }
  }

  /** Drop entries whose subject changed (e.g. brain prefs changed → tone answers stale). */
  invalidatePrefix(prefix: string): number {
    let dropped = 0
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k)
        dropped++
      }
    }
    return dropped
  }

  stats_(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    return {
      ...this.stats,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
      size: this.store.size,
      maxEntries: MAX_ENTRIES,
    }
  }

  reset(): void {
    this.store.clear()
    this.stats = { hits: 0, misses: 0, evictions: 0, estTokensSaved: 0 }
  }
}

/**
 * Assemble a cache-friendly prompt body: every layer is byte-stable within a
 * session except the tail. The host lays its blocks in THIS order so the
 * provider's KV cache can reuse the longest possible prefix across turns.
 */
export function stablePromptLayout(blocks: {
  staticPersona: string
  stableLists?: string
  stableMemory?: string
  history: string
  volatileTail: string
}): string {
  return [
    blocks.staticPersona,
    blocks.stableLists ?? '',
    blocks.stableMemory ?? '',
    blocks.history,
    blocks.volatileTail,
  ]
    .filter((b) => b && b.trim().length > 0)
    .join('\n')
}
