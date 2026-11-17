import type { BrainAppPrefs } from '../types'

/**
 * APP CONTROL — the levers the connected brain holds over the WHOLE host app.
 *
 * A normal plugin adds a tool. The NEXUS brain is different: it is a second
 * brain that sits over the app's own one and can steer the app itself. Its
 * control surface is deliberately safe — it adjusts HOW the app thinks and
 * speaks, never what data is destroyed:
 *
 *   tone              → the style of every streamed chat answer
 *   missionVerbosity  → how detailed mission reports are written
 *   autoDream         → whether memory consolidation may run by itself
 *
 * These prefs are issued by the brain (stored in its state) and honored by
 * the host ONLY while the brain is connected — disconnect the brain and the
 * app falls back to its default behavior, nothing is lost.
 */

/** Prompt directive for mission final answers, from the brain's prefs. */
export function missionVerbosityDirective(v: BrainAppPrefs['missionVerbosity']): string {
  if (v === 'brief')
    return 'VERBOSITY (brain directive): keep the final answer compact — lead with the result, then at most a short list of key findings (under ~200 words).'
  if (v === 'detailed')
    return 'VERBOSITY (brain directive): write a rich final answer — clear sections, tables where useful, complete explanations (~500+ words).'
  return 'VERBOSITY (brain directive): a well-structured medium-length report — result first, then the key findings.'
}

/** Human-readable summary of the brain's current app control surface (UI). */
export function describeAppControl(prefs: BrainAppPrefs): { lever: string; value: string; effect: string }[] {
  return [
    {
      lever: 'Chat tone',
      value: prefs.tone,
      effect: 'how every streamed chat answer is written',
    },
    {
      lever: 'Mission verbosity',
      value: prefs.missionVerbosity,
      effect: 'how detailed mission reports are',
    },
    {
      lever: 'Auto-dream',
      value: prefs.autoDream ? 'on' : 'off',
      effect: 'memory consolidation may run by itself when enough new memories pile up',
    },
  ]
}
