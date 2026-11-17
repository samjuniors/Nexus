/**
 * NEXUS BRAIN — shared types
 * ------------------------------------------------------------------
 * TWO-BRAIN ARCHITECTURE
 *
 * 1. SPINE BRAIN (lives in the host app, always on):
 *    the standard agent loop — LLM routing, planning, tool execution,
 *    synthesis, memory. Disconnecting the NEXUS brain never disables it.
 *    This is what any normal "LLM + skills + plugins" app has.
 *
 * 2. NEXUS BRAIN (this folder, the pluggable "spirit" overlay):
 *    connect it and the SAME app becomes smarter — reflex routing,
 *    brain-first recall with citations, knowledge graph, dream
 *    consolidation, app-level control (tone, verbosity, auto-dream).
 *
 * The brain is self-contained: it knows nothing about Next.js, React or
 * this app's database — it only talks to the host through the `BrainHost`
 * adapter contract below. Any app that provides this adapter can plug the
 * brain in and upgrade itself.
 */

// ---------- host adapter (what the host app must provide) ----------

/** Single LLM completion. Returns plain text content. */
export type BrainLlmComplete = (
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts?: { temperature?: number; maxTokens?: number }
) => Promise<string>

/**
 * App directives the connected brain issues to the whole host app
 * (gbrain's "the brain drives the body" idea, scoped to safe knobs).
 * These only apply while the brain is connected.
 */
export interface BrainAppPrefs {
  /** chat answer tone */
  tone: 'concise' | 'balanced' | 'thorough'
  /** mission final-answer verbosity */
  missionVerbosity: 'brief' | 'balanced' | 'detailed'
  /** allow automatic dream cycles when enough new memories pile up */
  autoDream: boolean
}

export const DEFAULT_APP_PREFS: BrainAppPrefs = {
  tone: 'balanced',
  missionVerbosity: 'balanced',
  autoDream: true,
}

/** Parse + validate raw app prefs JSON (unknown origins) into safe prefs. */
export function parseAppPrefs(raw: string | null | undefined): BrainAppPrefs {
  if (!raw) return { ...DEFAULT_APP_PREFS }
  try {
    const p = JSON.parse(raw) as Partial<BrainAppPrefs>
    return {
      tone: p.tone === 'concise' || p.tone === 'thorough' ? p.tone : 'balanced',
      missionVerbosity:
        p.missionVerbosity === 'brief' || p.missionVerbosity === 'detailed'
          ? p.missionVerbosity
          : 'balanced',
      autoDream: typeof p.autoDream === 'boolean' ? p.autoDream : true,
    }
  } catch {
    return { ...DEFAULT_APP_PREFS }
  }
}

export interface BrainStateStore {
  get: () => Promise<{ connected: boolean; personality: string; appPrefs?: BrainAppPrefs } | null>
  set: (patch: { connected?: boolean; personality?: string; appPrefs?: BrainAppPrefs }) => Promise<void>
}

/** The capabilities the host app currently has installed. */
export interface BrainCapabilitySet {
  tools: { slug: string; name: string; description: string }[]
  skills: { slug: string; name: string; description: string }[]
  plugins: { slug: string; name: string; description: string }[]
  mcps: { slug: string; name: string; description: string }[]
  memoryCount: number
}

export interface BrainHost {
  /** Language model access — the raw neurons. */
  llm: { complete: BrainLlmComplete }
  /** Durable storage for the brain's own state. */
  state: BrainStateStore
  /** Snapshot of the capabilities installed in the host body. */
  capabilities: () => Promise<BrainCapabilitySet>
  /** Current date/time line (the brain has no clock of its own). */
  now: () => Date
}

// ---------- brain outputs ----------

export interface BrainStatus {
  connected: boolean
  personality: string
  /** when the current state was entered (ISO string or null) */
  since: string | null
  /** app directives currently issued by the connected brain */
  appPrefs: BrainAppPrefs
}

export interface BrainSnapshot extends BrainStatus {
  /** what the brain can currently reach in the host body */
  capabilities: BrainCapabilitySet
}

/**
 * A memory that was recalled from the brain for this message
 * (gbrain cited synthesis — recalled refs travel with the decision so the
 * answer composer can cite them as [1], [2] …).
 */
export interface BrainRecalledRef {
  id: string
  content: string
  type: string
  cite: number
}

export interface BrainThoughtInput {
  message: string
  /** recent turns: [{ role, content }] oldest first */
  history: { role: 'user' | 'assistant'; content: string }[]
  /** short memories the brain holds about the user (salience + strength optional) */
  memories: { content: string; type: string; importance?: number; strength?: number; accessCount?: number }[]
}

/**
 * ROUTING decision — the front door. The brain decides HOW the host should
 * handle the message; the host then streams the actual chat answer itself
 * (brain.answerMessages() builds the prompt for that stream).
 *
 * - chat: answer directly in one streaming LLM turn — no tools, no run
 * - task: escalate to a full agent mission (planning + tools + subagents)
 */
export type BrainRouteDecision =
  | { kind: 'chat'; recalled?: BrainRecalledRef[] }
  | { kind: 'task'; reason: string }

/** The public surface of a living brain instance. */
export interface Brain {
  status(): Promise<BrainStatus>
  connect(): Promise<BrainStatus>
  disconnect(): Promise<BrainStatus>
  snapshot(): Promise<BrainSnapshot>
  /** Update the brain's app directives (its control surface over the host). */
  setAppPrefs(prefs: Partial<BrainAppPrefs>): Promise<BrainStatus>
  /** Decide how to handle an incoming message (front door, routing only). */
  think(input: BrainThoughtInput): Promise<BrainRouteDecision>
  /**
   * Build the message list for the streaming chat answer (persona, memories,
   * recall citations, tone directive). The host streams it token-by-token —
   * this is what makes answers appear as if typed.
   */
  answerMessages(input: BrainThoughtInput, recalled?: BrainRecalledRef[]): Promise<
    { role: 'system' | 'user' | 'assistant'; content: string }[]
  >
}
