'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { WifiOff } from 'lucide-react'
import { useEva } from '@/components/agent/eva-provider'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import {
  ensureGlobalAndroidHooks,
  hasNativeWakeListener,
  onAndroidServiceStateChange,
  pauseNativeWakeListener,
  registerBackHandler,
  setAndroidVoiceStopListener,
  startNativeWakeListener,
  stopNativeWakeListener,
  syncForegroundVoice,
  syncSystemBarsTheme,
  type NativeServiceState,
} from '@/lib/platform/android-bridge'
import { useOnlineStatus } from '@/lib/platform/use-pwa-install'

/**
 * Coordinates the live web app with the native Android APK JS bridge:
 * - Maintains the persistent Android Foreground Microphone Service + native "Hey Eva" listener
 * - Pauses the native mic cleanly while WebView Live Voice is active (zero mic contention)
 * - Re-arms the native wake listener automatically when Live Voice returns to standby
 * - Keeps Android status & navigation bar icons matched to Dark/Light theme
 * - Routes Android hardware/predictive Back gestures through in-app navigation stack
 * - Handles the "Stop Voice" action from the Android notification shade
 */
export function AndroidRuntimeSync({
  paletteOpen,
  setPaletteOpen,
}: {
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
}) {
  const { voice, wake } = useEva()
  const { activeTab, setTab } = useApp()
  const { resolvedTheme } = useTheme()
  const online = useOnlineStatus()
  const [nativeState, setNativeState] = useState<NativeServiceState | null>(null)

  const splitOpen = useEvaControl((s) => s.splitOpen)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const settingsOpen = useEvaControl((s) => s.settingsOpen)
  const setSettingsOpen = useEvaControl((s) => s.setSettingsOpen)
  const gbrainGraphOpen = useEvaControl((s) => s.gbrainGraphOpen)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const mobileDrawerOpen = useEvaControl((s) => s.mobileDrawerOpen)
  const setMobileDrawerOpen = useEvaControl((s) => s.setMobileDrawerOpen)
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)

  // Install global JS hooks & subscribe to persistent native foreground service state
  useEffect(() => {
    ensureGlobalAndroidHooks()
    return onAndroidServiceStateChange((state) => {
      setNativeState(state)
    })
  }, [])

  // Sync Dark/Light theme to Android edge-to-edge system bars
  useEffect(() => {
    const isDark = resolvedTheme !== 'light'
    syncSystemBarsTheme(isDark)
  }, [resolvedTheme])

  // Coordinate persistent Foreground Service + Native Wake Listener across Voice & Standby states
  const voiceActive = voice.isActive || voice.status === 'connecting'
  const voiceState = voice.agentState
  const wakeSleepMode = wake.sleepMode
  const wakePhrase = wake.wakePhrase
  const wakeArmed = !wake.sleepMode && wake.status === 'armed'

  useEffect(() => {
    const nativeWake = hasNativeWakeListener()

    if (voiceActive) {
      const label =
        voiceState === 'speaking'
          ? 'Eva is speaking…'
          : voiceState === 'thinking' || voiceState === 'executing'
            ? 'Eva is working on your request…'
            : 'Eva is listening live…'
      if (nativeWake) {
        // Keeps persistent Foreground Service alive while releasing native mic for WebView Live Voice
        pauseNativeWakeListener(label)
      } else {
        syncForegroundVoice(true, label)
      }
      return
    }

    if (!wakeSleepMode) {
      if (nativeWake) {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        startNativeWakeListener(wakePhrase, origin)
      } else if (wakeArmed) {
        syncForegroundVoice(true, 'Eva Wake Ear is standing by')
      } else {
        syncForegroundVoice(false)
      }
      return
    }

    if (nativeWake) {
      stopNativeWakeListener()
    } else {
      syncForegroundVoice(false)
    }
  }, [voiceActive, voiceState, wakeSleepMode, wakePhrase, wakeArmed])

  // Wire "Stop Voice" notification button from Android shade
  useEffect(() => {
    setAndroidVoiceStopListener(() => {
      if (voice.isActive) {
        voice.stopVoice()
      }
      if (!wake.sleepMode) {
        wake.enterSleepMode()
      }
    })
    return () => setAndroidVoiceStopListener(null)
  }, [voice, wake])

  // Centralized Android Hardware/Predictive Back unwinding stack
  useEffect(() => {
    return registerBackHandler(() => {
      if (paletteOpen) {
        setPaletteOpen(false)
        return true
      }
      if (settingsOpen) {
        setSettingsOpen(false)
        return true
      }
      if (gbrainGraphOpen) {
        setGbrainGraphOpen(false)
        return true
      }
      if (mobileDrawerOpen) {
        setMobileDrawerOpen(false)
        return true
      }
      if (splitOpen) {
        closeSplit()
        return true
      }
      if (layoutMode === 'standard' && activeTab !== 'agent') {
        setTab('agent')
        return true
      }
      return false
    }, 10)
  }, [
    paletteOpen,
    setPaletteOpen,
    settingsOpen,
    setSettingsOpen,
    gbrainGraphOpen,
    setGbrainGraphOpen,
    mobileDrawerOpen,
    setMobileDrawerOpen,
    splitOpen,
    closeSplit,
    layoutMode,
    activeTab,
    setTab,
    setLayoutMode,
  ])

  const nativeReconnecting = nativeState?.connectionState === 'reconnecting'
  if (online && !nativeReconnecting) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner="1"
      className="fixed top-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/40 bg-card/95 px-3.5 py-1.5 text-xs font-medium text-amber-500 shadow-lg backdrop-blur-md"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        {!online
          ? 'Offline — waiting for connection'
          : 'Reconnecting persistent Eva service…'}
      </span>
    </div>
  )
}
