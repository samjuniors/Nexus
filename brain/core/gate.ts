import {
  DEFAULT_APP_PREFS,
  parseAppPrefs,
  type BrainAppPrefs,
  type BrainHost,
  type BrainStatus,
} from '../types'

/**
 * BRAIN GATE — the connect/disconnect switch for the NEXUS overlay brain.
 *
 * This is the "brain chip" socket. Disconnecting does NOT lobotomize the
 * host app: the app's own spine brain (LLM routing, tools, planning,
 * memory) keeps everything running. Disconnecting only removes the OVERLAY
 * intelligence — reflex routing, recall with citations, the knowledge
 * graph, dream cycles and the brain's app directives. Reconnecting
 * restores all of it instantly, because nothing was deleted.
 *
 * While connected, the gate also carries the brain's APP DIRECTIVES
 * (tone / verbosity / auto-dream) — the levers through which the brain
 * controls the whole host app.
 */

export async function gateStatus(host: BrainHost): Promise<BrainStatus> {
  const state =
    (await host.state.get()) ?? { connected: true, personality: 'NEXUS' }
  return {
    connected: state.connected,
    personality: state.personality || 'NEXUS',
    since: null,
    appPrefs: { ...DEFAULT_APP_PREFS, ...state.appPrefs },
  }
}

export async function connect(host: BrainHost): Promise<BrainStatus> {
  await host.state.set({ connected: true })
  return gateStatus(host)
}

export async function disconnect(host: BrainHost): Promise<BrainStatus> {
  await host.state.set({ connected: false })
  return gateStatus(host)
}

/** Update the brain's app directives (its whole-app control surface). */
export async function setAppPrefs(
  host: BrainHost,
  prefs: Partial<BrainAppPrefs>
): Promise<BrainStatus> {
  const current = await gateStatus(host)
  const next: BrainAppPrefs = { ...current.appPrefs, ...prefs }
  await host.state.set({ appPrefs: next })
  return { ...current, appPrefs: next }
}

/** Read + validate prefs from raw storage (helper for hosts). */
export function readAppPrefs(raw: string | null | undefined): BrainAppPrefs {
  return parseAppPrefs(raw)
}
