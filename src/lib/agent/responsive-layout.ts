import { useEffect, useState } from 'react'

export type ViewportTier = 'mobile' | 'tablet' | 'desktop'

export const MOBILE_MAX_WIDTH = 767
export const TABLET_MAX_WIDTH = 1023
export const MOBILE_VOICE_FIRST_STORAGE_KEY = 'nexus-mobile-voice-first'

/**
 * Pure viewport tier classifier:
 * - mobile:  < 768px  (phones)
 * - tablet:  768px .. 1023px (tablets & compact touch displays)
 * - desktop: >= 1024px (laptops & wide monitors)
 */
export function classifyViewport(width: number): ViewportTier {
  if (!Number.isFinite(width) || width <= 0) return 'desktop'
  if (width <= MOBILE_MAX_WIDTH) return 'mobile'
  if (width <= TABLET_MAX_WIDTH) return 'tablet'
  return 'desktop'
}

export function isCompactTouchTier(tier: ViewportTier): boolean {
  return tier === 'mobile' || tier === 'tablet'
}

/**
 * Determines whether the initial screen on a given viewport should open
 * directly into the minimalistic Voice Agent experience.
 */
export function shouldStartInVoiceAgentMode(opts: {
  width: number
  mobileVoiceFirstEnabled: boolean
  queryView?: string | null
}): boolean {
  if (opts.queryView === 'workspace' || opts.queryView === 'chat') return false
  if (opts.queryView === 'voice' || opts.queryView === 'focus') return true
  if (!opts.mobileVoiceFirstEnabled) return false
  return isCompactTouchTier(classifyViewport(opts.width))
}

export function readSavedMobileVoiceFirst(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(MOBILE_VOICE_FIRST_STORAGE_KEY)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

export function persistMobileVoiceFirst(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MOBILE_VOICE_FIRST_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore storage errors */
  }
}

/**
 * SSR-safe reactive viewport tier hook.
 * Returns `ready: false` during initial SSR pass and hydrates immediately on mount.
 */
export function useViewportTier(): {
  tier: ViewportTier
  isCompact: boolean
  isMobile: boolean
  isTablet: boolean
  ready: boolean
} {
  const [state, setState] = useState<{ tier: ViewportTier; ready: boolean }>({
    tier: 'desktop',
    ready: false,
  })

  useEffect(() => {
    const update = () => {
      setState({ tier: classifyViewport(window.innerWidth), ready: true })
    }
    update()
    window.addEventListener('resize', update, { passive: true })
    return () => window.removeEventListener('resize', update)
  }, [])

  return {
    tier: state.tier,
    isCompact: isCompactTouchTier(state.tier),
    isMobile: state.tier === 'mobile',
    isTablet: state.tier === 'tablet',
    ready: state.ready,
  }
}
