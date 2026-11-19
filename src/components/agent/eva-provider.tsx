'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useApp } from '@/lib/agent/store'
import { useLiveVoice } from '@/lib/agent/use-live-voice'
import { useWakeWord } from '@/lib/agent/use-wake-word'
import { useControlBus } from '@/lib/agent/use-control-bus'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { deriveEvaEyeExpression, type EyeExpression } from '@/lib/agent/mochi-eyes'
import { useToast } from '@/hooks/use-toast'

type LiveVoiceState = ReturnType<typeof useLiveVoice>
type WakeWordState = ReturnType<typeof useWakeWord>

interface EvaContextValue {
  voice: LiveVoiceState
  wake: WakeWordState
  evaExpression: EyeExpression
  onToggleSleepMode: () => void
  onArmEar: () => void
}

const EvaContext = createContext<EvaContextValue | null>(null)

export function EvaProvider({ children }: { children: React.ReactNode }) {
  useControlBus()
  const { toast } = useToast()
  const activeConvId = useApp((s) => s.activeConvId)
  const runningRunId = useApp((s) => s.runningRunId)
  const isRouting = useApp((s) => s.isRouting)
  const pendingPermissionCount = useEvaControl((s) => s.pendingPermissions.length)
  const transientMood = useEvaControl((s) => s.transientMood)
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId

  const enterSleepRef = useRef<(() => void) | null>(null)
  const pendingWakeCommandRef = useRef<string | null>(null)
  const pendingWakeAckRef = useRef(false)

  const voice = useLiveVoice({
    onError: (msg) => {
      pendingWakeAckRef.current = false
      toast({
        title: 'Eva voice error',
        description: msg,
        variant: 'destructive',
      })
    },
    onSleepRequested: () => {
      enterSleepRef.current?.()
      toast({
        title: 'Eva is now in Sleep Mode',
        description: 'Always-on ear paused. Click Wake Eva whenever you want her listening again.',
      })
    },
  })

  const voiceRef = useRef(voice)
  voiceRef.current = voice

  const wake = useWakeWord({
    voiceStatus: voice.status,
    onWake: (trailingCommand) => {
      const clean = trailingCommand.trim()
      if (clean) {
        pendingWakeCommandRef.current = clean
        pendingWakeAckRef.current = false
      } else {
        pendingWakeCommandRef.current = null
        pendingWakeAckRef.current = true
      }
      const currentVoice = voiceRef.current
      if (!currentVoice.isActive && currentVoice.status !== 'connecting') {
        toast({
          title: 'Eva woke up',
          description: clean ? `Forwarding: "${clean}"` : 'Listening live — go ahead!',
        })
        void currentVoice.startVoice(activeConvIdRef.current)
      }
    },
  })

  enterSleepRef.current = wake.enterSleepMode

  useEffect(() => {
    if (voice.status !== 'connected') return
    if (pendingWakeCommandRef.current) {
      const cmd = pendingWakeCommandRef.current
      pendingWakeCommandRef.current = null
      pendingWakeAckRef.current = false
      voice.sendLiveText(cmd)
      return
    }
    if (pendingWakeAckRef.current) {
      pendingWakeAckRef.current = false
      voice.sendWakeAck()
    }
  }, [voice.status, voice.sendLiveText, voice.sendWakeAck])

  const onArmEar = useCallback(() => {
    wake.armNow()
    toast({
      title: 'Arming Eva always-on ear',
      description: `Allow microphone access if prompted, then say "${wake.wakePhrase}" anytime.`,
    })
  }, [toast, wake])

  const onToggleSleepMode = useCallback(() => {
    // If ear is awaiting mic permission or in error state, clicking should ARM the ear rather than putting Eva to sleep
    if (!wake.sleepMode && (wake.status === 'awaiting-mic' || wake.status === 'error')) {
      wake.armNow()
      toast({
        title: 'Arming Eva always-on ear',
        description: `Allow microphone access if prompted, then say "${wake.wakePhrase}" anytime.`,
      })
      return
    }

    if (wake.sleepMode) {
      wake.wakeUp()
      if (!wake.supported) {
        toast({
          title: 'Eva awake (manual voice mode)',
          description: 'Microphone API unavailable for passive wake detection — click Voice to talk to Eva.',
        })
      } else {
        toast({
          title: 'Eva ear is always on',
          description: `Listening across all views for "${wake.wakePhrase}" until Sleep Mode is enabled.`,
        })
      }
      return
    }

    if (voice.isActive) {
      voice.stopVoice()
    }
    wake.enterSleepMode()
    toast({
      title: 'Eva entered Sleep Mode',
      description: 'Always-on ear paused until you click Wake Eva.',
    })
  }, [toast, voice, wake])

  const evaExpression = useMemo(
    () =>
      deriveEvaEyeExpression({
        sleepMode: wake.sleepMode,
        voiceActive: voice.isActive,
        voiceAgentState: voice.agentState,
        isSpeaking: voice.isSpeaking,
        isThinking: isRouting || voice.agentState === 'thinking',
        isWorking: Boolean(runningRunId) || Boolean(voice.activeTool),
        hasError: voice.status === 'error',
        pendingPermissionCount,
        transientMood,
      }),
    [
      wake.sleepMode,
      voice.isActive,
      voice.agentState,
      voice.isSpeaking,
      voice.activeTool,
      voice.status,
      isRouting,
      runningRunId,
      pendingPermissionCount,
      transientMood,
    ]
  )

  return (
    <EvaContext.Provider value={{ voice, wake, evaExpression, onToggleSleepMode, onArmEar }}>
      {children}
    </EvaContext.Provider>
  )
}

export function useEva(): EvaContextValue {
  const ctx = useContext(EvaContext)
  if (!ctx) {
    throw new Error('useEva must be used inside <EvaProvider>')
  }
  return ctx
}
