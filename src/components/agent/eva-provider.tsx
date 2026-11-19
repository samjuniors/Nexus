'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useApp } from '@/lib/agent/store'
import { useLiveVoice } from '@/lib/agent/use-live-voice'
import { useWakeWord } from '@/lib/agent/use-wake-word'
import { useVisionEyes } from '@/lib/agent/use-vision-eyes'
import { useControlBus } from '@/lib/agent/use-control-bus'
import { useEvaControl, type LayoutMode } from '@/lib/agent/eva-control-store'
import { deriveEvaEyeExpression, type EyeExpression } from '@/lib/agent/mochi-eyes'
import {
  deriveEvaEmotion,
  deriveEvaSenses,
  type EvaEmotionState,
  type EvaSenseId,
  type EvaSensesState,
} from '@/lib/agent/eva-emotions'
import {
  deriveLiveHandTracking,
  type HandTrackingState,
} from '@/lib/agent/hand-tracking'
import { useToast } from '@/hooks/use-toast'

type LiveVoiceState = ReturnType<typeof useLiveVoice>
type WakeWordState = ReturnType<typeof useWakeWord>
type VisionEyesState = ReturnType<typeof useVisionEyes>

interface EvaContextValue {
  voice: LiveVoiceState
  wake: WakeWordState
  vision: VisionEyesState
  evaExpression: EyeExpression
  emotion: EvaEmotionState
  senses: EvaSensesState
  handTracking: HandTrackingState
  toggleSense: (sense: EvaSenseId) => void
  onToggleSleepMode: () => void
  onArmEar: () => void
}

const EvaContext = createContext<EvaContextValue | null>(null)

export function EvaProvider({ children }: { children: React.ReactNode }) {
  useControlBus()
  const { toast } = useToast()
  const activeConvId = useApp((s) => s.activeConvId)
  const conversations = useApp((s) => s.conversations)
  const runningRunId = useApp((s) => s.runningRunId)
  const isRouting = useApp((s) => s.isRouting)
  const pendingPermissionCount = useEvaControl((s) => s.pendingPermissions.length)
  const transientMood = useEvaControl((s) => s.transientMood)
  const manualEmotion = useEvaControl((s) => s.manualEmotion)
  const previewHandAction = useEvaControl((s) => s.previewHandAction)
  const selfHealBusy = useEvaControl((s) => s.selfHealBusy)
  const browserBusy = useEvaControl((s) => s.browserBusy)
  const latestReasoningChain = useEvaControl((s) => s.reasoningChains[0] ?? null)
  const autoVoiceFocus = useEvaControl((s) => s.autoVoiceFocus)
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const activeConvIdRef = useRef(activeConvId)
  activeConvIdRef.current = activeConvId

  const enterSleepRef = useRef<(() => void) | null>(null)
  const pendingWakeCommandRef = useRef<string | null>(null)
  const pendingWakeAckRef = useRef(false)
  const prevVoiceActiveRef = useRef(false)
  const layoutBeforeVoiceRef = useRef<LayoutMode>('standard')

  const vision = useVisionEyes()

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

  // Automatic hands-free Voice Focus transition when live voice starts/ends
  useEffect(() => {
    const wasActive = prevVoiceActiveRef.current
    const isNowActive = voice.isActive
    prevVoiceActiveRef.current = isNowActive

    if (!autoVoiceFocus) return
    if (!wasActive && isNowActive) {
      layoutBeforeVoiceRef.current = layoutMode
      if (layoutMode !== 'focus') {
        setLayoutMode('focus')
      }
    } else if (wasActive && !isNowActive) {
      if (layoutBeforeVoiceRef.current === 'standard' && layoutMode === 'focus') {
        setLayoutMode('standard')
      }
    }
  }, [voice.isActive, autoVoiceFocus, layoutMode, setLayoutMode])

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

  const toggleSense = useCallback(
    (sense: EvaSenseId) => {
      if (sense === 'eyes') {
        if (vision.screenActive) {
          vision.stopScreen()
        } else if (vision.cameraActive) {
          vision.stopCamera()
        } else {
          void vision.toggleScreen()
        }
        return
      }
      if (sense === 'ears') {
        onToggleSleepMode()
        return
      }
      if (sense === 'mouth') {
        if (voice.isActive) {
          voice.toggleMute()
        } else {
          void voice.startVoice(activeConvIdRef.current)
        }
        return
      }
      if (sense === 'hands') {
        if (splitOpen && (splitMode === 'reasoning' || splitMode === 'browser')) {
          closeSplit()
        } else {
          openSplit(runningRunId ? 'reasoning' : 'browser', runningRunId ? 'Reasoning Chain' : 'Live Browser')
        }
      }
    },
    [vision, onToggleSleepMode, voice, splitOpen, splitMode, closeSplit, openSplit, runningRunId]
  )

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConvId) ?? null,
    [conversations, activeConvId]
  )

  const latestUserMsg = useMemo(() => {
    const msgs = activeConv?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return msgs[i].content
    }
    return ''
  }, [activeConv?.messages])

  const latestAssistantMsg = useMemo(() => {
    const msgs = activeConv?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'user') return msgs[i].content
    }
    return ''
  }, [activeConv?.messages])

  const latestRunDone = useMemo(() => {
    const runList = activeConv?.runs ?? []
    if (runList.length === 0) return false
    return runList.some((r) => r.status === 'done') && !runningRunId
  }, [activeConv?.runs, runningRunId])

  const emotion = useMemo(
    () =>
      deriveEvaEmotion({
        manualEmotion,
        sleepMode: wake.sleepMode,
        hasError: voice.status === 'error',
        pendingPermissionCount,
        isWorking: Boolean(runningRunId) || Boolean(voice.activeTool),
        isThinking: isRouting || voice.agentState === 'thinking',
        isSpeaking: voice.isSpeaking,
        voiceActive: voice.isActive,
        visionActive: vision.anyActive,
        recentUserText: voice.liveInputTranscript || latestUserMsg,
        recentAssistantText: voice.liveOutputTranscript || latestAssistantMsg,
        justCompleted: latestRunDone,
      }),
    [
      manualEmotion,
      wake.sleepMode,
      voice.status,
      pendingPermissionCount,
      runningRunId,
      voice.activeTool,
      isRouting,
      voice.agentState,
      voice.isSpeaking,
      voice.isActive,
      vision.anyActive,
      voice.liveInputTranscript,
      latestUserMsg,
      voice.liveOutputTranscript,
      latestAssistantMsg,
      latestRunDone,
    ]
  )

  const latestRunEvent = useMemo(() => {
    if (!runningRunId) return null
    const run = (activeConv?.runs ?? []).find((r) => r.id === runningRunId)
    if (!run || run.events.length === 0) return null
    return run.events[run.events.length - 1] ?? null
  }, [activeConv?.runs, runningRunId])

  const activeReasoningTitle =
    latestReasoningChain?.status === 'active'
      ? latestReasoningChain.nodes[latestReasoningChain.nodes.length - 1]?.title ?? null
      : null

  const handTracking = useMemo(
    () =>
      deriveLiveHandTracking({
        previewAction: previewHandAction,
        activeVoiceTool: voice.activeTool,
        isRunning: Boolean(runningRunId),
        latestRunEvent,
        selfHealBusy,
        browserBusy,
        activeReasoningTitle,
      }),
    [
      previewHandAction,
      voice.activeTool,
      runningRunId,
      latestRunEvent,
      selfHealBusy,
      browserBusy,
      activeReasoningTitle,
    ]
  )

  const senses = useMemo(
    () =>
      deriveEvaSenses({
        cameraActive: vision.cameraActive,
        screenActive: vision.screenActive,
        browserSplitActive: splitOpen && splitMode === 'browser',
        sleepMode: wake.sleepMode,
        wakeListening: wake.status === 'listening',
        voiceActive: voice.isActive,
        voiceMuted: voice.muted,
        isSpeaking: voice.isSpeaking,
        isWorking: Boolean(runningRunId) || Boolean(voice.activeTool) || handTracking.active,
        activeToolName:
          handTracking.active && handTracking.targetLabel
            ? `${handTracking.label} (${handTracking.targetLabel})`
            : voice.activeTool,
        splitMode,
      }),
    [
      vision.cameraActive,
      vision.screenActive,
      splitOpen,
      splitMode,
      wake.sleepMode,
      wake.status,
      voice.isActive,
      voice.muted,
      voice.isSpeaking,
      runningRunId,
      voice.activeTool,
      handTracking.active,
      handTracking.label,
      handTracking.targetLabel,
    ]
  )

  const evaExpression = useMemo(
    () =>
      deriveEvaEyeExpression({
        sleepMode: wake.sleepMode,
        voiceActive: voice.isActive,
        voiceAgentState: voice.agentState,
        isSpeaking: voice.isSpeaking,
        isThinking: isRouting || voice.agentState === 'thinking',
        isWorking: Boolean(runningRunId) || Boolean(voice.activeTool) || handTracking.active,
        hasError: voice.status === 'error',
        pendingPermissionCount,
        transientMood:
          transientMood ??
          (manualEmotion === 'happy' || manualEmotion === 'proud' || manualEmotion === 'excited'
            ? 'happy'
            : manualEmotion === 'concerned'
              ? 'error'
              : null),
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
      handTracking.active,
      pendingPermissionCount,
      transientMood,
      manualEmotion,
    ]
  )

  return (
    <EvaContext.Provider
      value={{
        voice,
        wake,
        vision,
        evaExpression,
        emotion,
        senses,
        handTracking,
        toggleSense,
        onToggleSleepMode,
        onArmEar,
      }}
    >
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
