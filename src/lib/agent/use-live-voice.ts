'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/agent/store'
import type { EventOutDTO, MessageDTO } from '@/lib/agent/client'

import {
  type ActiveVoiceTool,
  type VoiceAgentState,
  type VoiceName,
  type VoiceStatus,
  deriveVoiceAgentState,
} from '@/lib/agent/voice-state'

export type { ActiveVoiceTool, VoiceAgentState, VoiceName, VoiceStatus }

interface LiveServerEvent {
  type: string
  conversationId?: string
  voiceName?: string
  model?: string
  brainConnected?: boolean
  text?: string
  delta?: string
  audio?: string
  active?: boolean
  tool?: string
  args?: Record<string, unknown>
  runId?: string
  userMessage?: MessageDTO | string | null
  assistantMessage?: MessageDTO | null
  status?: string
  events?: EventOutDTO[]
  target?: string
  error?: string
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input
  const ratio = inputSampleRate / 16000
  const newLength = Math.max(1, Math.round(input.length / ratio))
  const result = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = input[idx] ?? 0
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0
    result[i] = s0 + (s1 - s0) * frac
  }
  return result
}

function float32ToBase64Pcm16(samples: Float32Array): string {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const view = new DataView(bytes.buffer)
  const samplesCount = Math.floor(len / 2)
  const float32 = new Float32Array(samplesCount)
  for (let i = 0; i < samplesCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768
  }
  return float32
}

/**
 * Scans a 24kHz PCM buffer in 20ms windows to find the first and last
 * audible vocal frame (RMS > 0.012), trimming dead leading/trailing silence.
 */
function detectPcmSpeechBounds(
  samples: Float32Array,
  sampleRate = 24000
): { firstSec: number | null; lastSec: number | null } {
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02)) // 20ms frames
  const thresholdSq = 0.012 * 0.012
  let firstFrame = -1
  let lastFrame = -1

  for (let offset = 0, frameIdx = 0; offset < samples.length; offset += frameSize, frameIdx++) {
    const end = Math.min(samples.length, offset + frameSize)
    let sumSq = 0
    for (let i = offset; i < end; i++) {
      const s = samples[i]
      sumSq += s * s
    }
    const meanSq = sumSq / Math.max(1, end - offset)
    if (meanSq >= thresholdSq) {
      if (firstFrame === -1) firstFrame = frameIdx
      lastFrame = frameIdx
    }
  }

  if (firstFrame === -1) {
    return { firstSec: null, lastSec: null }
  }
  const totalSec = samples.length / sampleRate
  return {
    firstSec: (firstFrame * frameSize) / sampleRate,
    lastSec: Math.min(totalSec, ((lastFrame + 1) * frameSize) / sampleRate),
  }
}

function stopAndDetachAudioNodes(nodes: Iterable<AudioBufferSourceNode>): void {
  for (const node of nodes) {
    try {
      node.onended = null
      node.stop()
      node.disconnect()
    } catch {
      /* already ended */
    }
  }
}

export function useLiveVoice(options?: {
  onError?: (message: string) => void
  onSleepRequested?: () => void
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [voiceName, setVoiceName] = useState<VoiceName>('Zephyr')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [liveInputTranscript, setLiveInputTranscript] = useState('')
  const [liveOutputTranscript, setLiveOutputTranscript] = useState('')
  const [outputAudioElapsedSec, setOutputAudioElapsedSec] = useState(0)
  const [outputAudioTotalSec, setOutputAudioTotalSec] = useState(0)
  const [outputSpeechStartSec, setOutputSpeechStartSec] = useState(0)
  const [outputSpeechEndSec, setOutputSpeechEndSec] = useState(0)
  const [outputTurnComplete, setOutputTurnComplete] = useState(false)
  const [outputTurnSeq, setOutputTurnSeq] = useState(0)
  const [activeTool, setActiveTool] = useState<ActiveVoiceTool | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const statusRef = useRef<VoiceStatus>('idle')
  statusRef.current = status
  const wsRef = useRef<WebSocket | null>(null)
  const inputCtxRef = useRef<AudioContext | null>(null)
  const outputCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const silentGainRef = useRef<GainNode | null>(null)
  const mutedRef = useRef(false)
  const nextStartTimeRef = useRef(0)
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const turnAudioStartCtxRef = useRef<number | null>(null)
  const turnScheduledSecRef = useRef(0)
  const turnSpeechStartRef = useRef<number | null>(null)
  const turnSpeechEndRef = useRef(0)
  const pendingClearOutputRef = useRef(false)
  const deferredClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outputClockRafRef = useRef<number | null>(null)
  const lastClockEmitMsRef = useRef(0)
  const closingIntentRef = useRef(false)
  const lastLevelTickRef = useRef(0)
  const smoothedMicRef = useRef(0)
  const lastEmittedMicRef = useRef(0)
  const loudFramesRef = useRef(0)
  const isSpeakingRef = useRef(false)
  isSpeakingRef.current = isSpeaking
  const isThinkingRef = useRef(false)
  isThinkingRef.current = isThinking
  const speechIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInputTranscriptRef = useRef(false)
  const onErrorRef = useRef(options?.onError)
  onErrorRef.current = options?.onError
  const onSleepRequestedRef = useRef(options?.onSleepRequested)
  onSleepRequestedRef.current = options?.onSleepRequested

  const clearSpeechTimer = useCallback(() => {
    if (speechIdleTimerRef.current) {
      clearTimeout(speechIdleTimerRef.current)
      speechIdleTimerRef.current = null
    }
  }, [])

  const bumpUserSpeech = useCallback(
    (hasTranscript: boolean) => {
      if (hasTranscript) hasInputTranscriptRef.current = true
      setIsUserSpeaking(true)
      setIsThinking(false)
      isThinkingRef.current = false
      clearSpeechTimer()
      speechIdleTimerRef.current = setTimeout(() => {
        setIsUserSpeaking(false)
        if (hasInputTranscriptRef.current && !isSpeakingRef.current) {
          isThinkingRef.current = true
          setIsThinking(true)
        }
      }, 950)
    },
    [clearSpeechTimer]
  )

  const stopOutputClock = useCallback(() => {
    if (outputClockRafRef.current !== null) {
      cancelAnimationFrame(outputClockRafRef.current)
      outputClockRafRef.current = null
    }
    if (deferredClearTimerRef.current) {
      clearTimeout(deferredClearTimerRef.current)
      deferredClearTimerRef.current = null
    }
  }, [])

  const resetOutputTurnClock = useCallback(() => {
    stopOutputClock()
    turnAudioStartCtxRef.current = null
    turnScheduledSecRef.current = 0
    turnSpeechStartRef.current = null
    turnSpeechEndRef.current = 0
    pendingClearOutputRef.current = false
    setOutputAudioElapsedSec(0)
    setOutputAudioTotalSec(0)
    setOutputSpeechStartSec(0)
    setOutputSpeechEndSec(0)
    setOutputTurnComplete(false)
  }, [stopOutputClock])

  const startOutputClock = useCallback(() => {
    if (outputClockRafRef.current !== null) return
    lastClockEmitMsRef.current = 0

    const tick = (nowMs: number) => {
      const outCtx = outputCtxRef.current
      const startCtx = turnAudioStartCtxRef.current
      if (!outCtx || startCtx === null || activeSourcesRef.current.size === 0) {
        outputClockRafRef.current = null
        return
      }
      if (nowMs - lastClockEmitMsRef.current >= 24) {
        lastClockEmitMsRef.current = nowMs
        const ctxWithLatency = outCtx as AudioContext & { outputLatency?: number }
        const hwLatency = Math.max(
          0,
          Math.min(0.25, (outCtx.baseLatency ?? 0) + (ctxWithLatency.outputLatency ?? 0))
        )
        const elapsed = Math.max(
          0,
          Math.min(turnScheduledSecRef.current, outCtx.currentTime - startCtx - hwLatency)
        )
        setOutputAudioElapsedSec(elapsed)
      }
      outputClockRafRef.current = requestAnimationFrame(tick)
    }

    outputClockRafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopOutputPlayback = useCallback(() => {
    stopAndDetachAudioNodes(Array.from(activeSourcesRef.current))
    activeSourcesRef.current.clear()
    nextStartTimeRef.current = 0
    isSpeakingRef.current = false
    setIsSpeaking(false)
    resetOutputTurnClock()
  }, [resetOutputTurnClock])

  const teardown = useCallback(() => {
    clearSpeechTimer()
    hasInputTranscriptRef.current = false
    stopOutputPlayback()

    if (processorRef.current) {
      try {
        processorRef.current.disconnect()
        processorRef.current.onaudioprocess = null
      } catch { /* ignore */ }
      processorRef.current = null
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect()
      } catch { /* ignore */ }
      silentGainRef.current = null
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect()
      } catch { /* ignore */ }
      sourceNodeRef.current = null
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop()
        } catch { /* ignore */ }
      }
      streamRef.current = null
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {})
      inputCtxRef.current = null
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {})
      outputCtxRef.current = null
    }
    if (wsRef.current) {
      const ws = wsRef.current
      wsRef.current = null
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }))
        }
        ws.close()
      } catch { /* ignore */ }
    }

    smoothedMicRef.current = 0
    lastEmittedMicRef.current = 0
    loudFramesRef.current = 0
    isSpeakingRef.current = false
    isThinkingRef.current = false
    setMicLevel(0)
    setActiveTool(null)
    setLiveInputTranscript('')
    setLiveOutputTranscript('')
    setIsSpeaking(false)
    setIsUserSpeaking(false)
    setIsThinking(false)
  }, [clearSpeechTimer, stopOutputPlayback])

  const enqueueAudio = useCallback(
    (base64Pcm: string) => {
      const outCtx = outputCtxRef.current
      if (!outCtx) return
      if (outCtx.state === 'suspended') {
        void outCtx.resume().catch(() => {})
      }
      const samples = base64Pcm16ToFloat32(base64Pcm)
      if (samples.length === 0) return

      const audioBuffer = outCtx.createBuffer(1, samples.length, 24000)
      audioBuffer.getChannelData(0).set(samples)

      const source = outCtx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(outCtx.destination)

      const now = outCtx.currentTime
      const prevNextStart = nextStartTimeRef.current
      const startAt = Math.max(prevNextStart, now)
      nextStartTimeRef.current = startAt + audioBuffer.duration

      // Anchor a brand-new turn playback clock when the first buffer of a turn arrives
      const startingFreshTurn =
        turnAudioStartCtxRef.current === null || pendingClearOutputRef.current
      if (startingFreshTurn) {
        if (deferredClearTimerRef.current) {
          clearTimeout(deferredClearTimerRef.current)
          deferredClearTimerRef.current = null
        }
        turnAudioStartCtxRef.current = startAt
        turnScheduledSecRef.current = 0
        turnSpeechStartRef.current = null
        turnSpeechEndRef.current = 0
        pendingClearOutputRef.current = false
        setOutputTurnComplete(false)
        setOutputAudioElapsedSec(0)
        setOutputSpeechStartSec(0)
        setOutputSpeechEndSec(0)
        setOutputTurnSeq((n) => n + 1)
      } else if (prevNextStart > 0 && now > prevNextStart + 0.02 && turnAudioStartCtxRef.current !== null) {
        // Compensate for any silent network jitter gap between PCM chunks so
        // `outCtx.currentTime - turnAudioStartCtxRef.current` stays locked to played audio seconds.
        turnAudioStartCtxRef.current += now - prevNextStart
      }

      const chunkOffsetSec = turnScheduledSecRef.current
      const speechBounds = detectPcmSpeechBounds(samples, 24000)
      if (speechBounds.firstSec !== null && turnSpeechStartRef.current === null) {
        const firstVoice = chunkOffsetSec + speechBounds.firstSec
        turnSpeechStartRef.current = firstVoice
        setOutputSpeechStartSec(firstVoice)
      }
      if (speechBounds.lastSec !== null) {
        const lastVoice = chunkOffsetSec + speechBounds.lastSec
        if (lastVoice > turnSpeechEndRef.current) {
          turnSpeechEndRef.current = lastVoice
          setOutputSpeechEndSec(lastVoice)
        }
      }

      turnScheduledSecRef.current += audioBuffer.duration
      setOutputAudioTotalSec(turnScheduledSecRef.current)

      activeSourcesRef.current.add(source)
      isSpeakingRef.current = true
      setIsSpeaking(true)
      setIsThinking(false)
      startOutputClock()

      source.onended = () => {
        activeSourcesRef.current.delete(source)
        if (activeSourcesRef.current.size === 0) {
          const finalTotal = turnScheduledSecRef.current
          if (outputClockRafRef.current !== null) {
            cancelAnimationFrame(outputClockRafRef.current)
            outputClockRafRef.current = null
          }
          setOutputAudioElapsedSec(finalTotal)
          isSpeakingRef.current = false
          setIsSpeaking(false)

          if (pendingClearOutputRef.current) {
            pendingClearOutputRef.current = false
            // Brief 90ms settle so UI paints the final synced phrase before transitioning cleanly to heldSubtitle
            deferredClearTimerRef.current = setTimeout(() => {
              deferredClearTimerRef.current = null
              if (activeSourcesRef.current.size === 0) {
                setLiveOutputTranscript('')
                turnAudioStartCtxRef.current = null
                turnScheduledSecRef.current = 0
                turnSpeechStartRef.current = null
                turnSpeechEndRef.current = 0
                setOutputAudioElapsedSec(0)
                setOutputAudioTotalSec(0)
                setOutputSpeechStartSec(0)
                setOutputSpeechEndSec(0)
                setOutputTurnComplete(false)
              }
            }, 90)
          }
        }
      }

      source.start(startAt)
    },
    [startOutputClock]
  )

  const syncCapabilities = useCallback((target?: string) => {
    const store = useApp.getState()
    if (!target || target === 'all') {
      void store.refreshSkills()
      void store.refreshPlugins()
      void store.refreshTools()
      void store.refreshMcps()
      void store.refreshMemories()
      void store.refreshArtifacts()
      void store.refreshOrg()
      void store.refreshAutomations()
      void store.refreshBrain()
      return
    }
    if (target === 'skills') void store.refreshSkills()
    if (target === 'plugins') {
      void store.refreshPlugins()
      void store.refreshTools()
    }
    if (target === 'tools') void store.refreshTools()
    if (target === 'memories') void store.refreshMemories()
    if (target === 'org') {
      void store.refreshOrg()
      void store.refreshPlugins()
      void store.refreshTools()
    }
    if (target === 'automations') void store.refreshAutomations()
    if (target === 'artifacts') void store.refreshArtifacts()
  }, [])

  const startVoice = useCallback(async (overrideConvId?: string | null, overrideVoice?: VoiceName) => {
    if (statusRef.current === 'connecting' || statusRef.current === 'connected') return
    statusRef.current = 'connecting'
    closingIntentRef.current = false
    hasInputTranscriptRef.current = false
    setLastError(null)
    setStatus('connecting')
    setLiveInputTranscript('')
    setLiveOutputTranscript('')
    setIsUserSpeaking(false)
    setIsThinking(false)

    const activeConvId = overrideConvId !== undefined ? overrideConvId : useApp.getState().activeConvId
    const chosenVoice = overrideVoice ?? voiceName

    const tryResumeAudioCtx = async (ctx: AudioContext) => {
      if (ctx.state !== 'suspended') return
      await Promise.race([
        ctx.resume().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ])
    }

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not available in this browser context.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const inputCtx = new AudioCtx({ sampleRate: 16000 })
      const outputCtx = new AudioCtx({ sampleRate: 24000 })
      inputCtxRef.current = inputCtx
      outputCtxRef.current = outputCtx
      // Never block hands-free wake startup forever if browser suspends AudioContext outside a click gesture
      await tryResumeAudioCtx(inputCtx)
      await tryResumeAudioCtx(outputCtx)

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${proto}//${window.location.host}/api/live?conversationId=${encodeURIComponent(activeConvId ?? '')}&voice=${encodeURIComponent(chosenVoice)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        let msg: LiveServerEvent
        try {
          msg = JSON.parse(String(event.data)) as LiveServerEvent
        } catch {
          return
        }

        if (msg.type === 'session_ready') {
          setStatus('connected')
          if (msg.conversationId) {
            void useApp.getState().ensureConversationForVoice(msg.conversationId)
          }
          return
        }

        if (msg.type === 'input_transcript') {
          setLiveInputTranscript(msg.text ?? '')
          bumpUserSpeech(Boolean(msg.text?.trim()))
          return
        }

        if (msg.type === 'output_transcript') {
          clearSpeechTimer()
          hasInputTranscriptRef.current = false
          setIsUserSpeaking(false)
          isThinkingRef.current = false
          setIsThinking(false)
          setLiveInputTranscript('')
          if (deferredClearTimerRef.current) {
            clearTimeout(deferredClearTimerRef.current)
            deferredClearTimerRef.current = null
          }
          // If transcript arrives for a fresh turn before audio starts, reset stale turn clock cleanly
          if (pendingClearOutputRef.current && activeSourcesRef.current.size === 0) {
            resetOutputTurnClock()
            setOutputTurnSeq((n) => n + 1)
          }
          setLiveOutputTranscript(msg.text ?? '')
          return
        }

        if (msg.type === 'output_generation_complete') {
          setOutputTurnComplete(true)
          return
        }

        if (msg.type === 'output_segment_reset') {
          if (activeSourcesRef.current.size === 0) {
            setLiveOutputTranscript('')
            resetOutputTurnClock()
            setOutputTurnSeq((n) => n + 1)
          } else {
            pendingClearOutputRef.current = true
          }
          return
        }

        if (msg.type === 'audio' && msg.audio) {
          clearSpeechTimer()
          hasInputTranscriptRef.current = false
          setIsUserSpeaking(false)
          isSpeakingRef.current = true
          isThinkingRef.current = false
          setLiveInputTranscript('')
          enqueueAudio(msg.audio)
          return
        }

        if (msg.type === 'interrupted') {
          stopOutputPlayback()
          setLiveOutputTranscript('')
          setIsThinking(false)
          return
        }

        if (msg.type === 'tool_status') {
          clearSpeechTimer()
          setIsUserSpeaking(false)
          if (msg.active && msg.tool) {
            setActiveTool({ tool: msg.tool, args: msg.args })
            setIsThinking(false)
          } else {
            setActiveTool(null)
            setIsThinking(true)
          }
          return
        }

        if (msg.type === 'mission_started' && msg.conversationId && msg.runId) {
          const textPrompt = typeof msg.userMessage === 'string' ? msg.userMessage : 'Voice mission'
          useApp.getState().applyVoiceMissionStart(msg.conversationId, msg.runId, textPrompt)
          return
        }

        if (msg.type === 'mission_events' && msg.runId) {
          useApp.getState().applyVoiceMissionEvents(msg.runId, msg.events ?? [], msg.status)
          return
        }

        if (msg.type === 'turn_complete') {
          clearSpeechTimer()
          hasInputTranscriptRef.current = false
          setIsUserSpeaking(false)
          setIsThinking(false)
          setLiveInputTranscript('')
          setOutputTurnComplete(true)
          if (activeSourcesRef.current.size > 0) {
            // Audio buffers are still playing out through WebAudio!
            // Keep liveOutputTranscript visible and audio-synced until playback drains.
            pendingClearOutputRef.current = true
          } else {
            setLiveOutputTranscript('')
            resetOutputTurnClock()
          }
          if (msg.conversationId) {
            const uMsg = msg.userMessage && typeof msg.userMessage === 'object' ? msg.userMessage : null
            const aMsg = msg.assistantMessage ?? null
            useApp.getState().applyVoiceTurn(msg.conversationId, uMsg, aMsg)
          }
          return
        }

        if (msg.type === 'sync') {
          syncCapabilities(msg.target)
          return
        }

        if (msg.type === 'error') {
          const errText = msg.error ?? 'Voice session error'
          clearSpeechTimer()
          setIsThinking(false)
          setIsUserSpeaking(false)
          setLastError(errText)
          setStatus('error')
          onErrorRef.current?.(errText)
          return
        }

        if (msg.type === 'eva_sleep') {
          setTimeout(() => {
            closingIntentRef.current = true
            teardown()
            setStatus('idle')
            onSleepRequestedRef.current?.()
          }, 1400)
          return
        }

        if (msg.type === 'session_closed') {
          teardown()
          setStatus('idle')
        }
      }

      ws.onerror = () => {
        if (!closingIntentRef.current) {
          const errText = 'Lost connection to NEXUS Live voice server.'
          setLastError(errText)
          setStatus('error')
          onErrorRef.current?.(errText)
          teardown()
        }
      }

      ws.onclose = () => {
        if (!closingIntentRef.current) {
          teardown()
          setStatus((prev) => (prev === 'error' ? 'error' : 'idle'))
        }
      }

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream)
        const processor = inputCtx.createScriptProcessor(4096, 1, 1)
        const silentGain = inputCtx.createGain()
        silentGain.gain.value = 0
        sourceNodeRef.current = source
        processorRef.current = processor
        silentGainRef.current = silentGain

        processor.onaudioprocess = (audioEvent) => {
          const currentWs = wsRef.current
          if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return

          const inputData = audioEvent.inputBuffer.getChannelData(0)
          if (mutedRef.current) {
            const nowMs = performance.now()
            if (nowMs - lastLevelTickRef.current > 110) {
              lastLevelTickRef.current = nowMs
              smoothedMicRef.current = 0
              loudFramesRef.current = 0
              if (lastEmittedMicRef.current !== 0) {
                lastEmittedMicRef.current = 0
                setMicLevel(0)
              }
              setIsUserSpeaking(false)
            }
            return
          }

          let sumSq = 0
          for (let i = 0; i < inputData.length; i++) {
            sumSq += inputData[i] * inputData[i]
          }
          const rms = Math.sqrt(sumSq / inputData.length)
          const normalized = Math.min(1, rms * 5.2)
          const nowMs = performance.now()
          if (nowMs - lastLevelTickRef.current > 100) {
            lastLevelTickRef.current = nowMs
            // EMA smooth + deadband quantization to prevent rapid React re-renders on mobile
            const smoothed = smoothedMicRef.current * 0.6 + normalized * 0.4
            smoothedMicRef.current = smoothed < 0.02 ? 0 : smoothed
            const quantized = Math.round(smoothedMicRef.current * 25) / 25
            if (Math.abs(quantized - lastEmittedMicRef.current) >= 0.04 || (quantized === 0 && lastEmittedMicRef.current !== 0)) {
              lastEmittedMicRef.current = quantized
              setMicLevel(quantized)
            }

            // Avoid speaker-bleed echo while Eva is speaking, and require sustained voice
            // energy so mobile ambient noise never flickers Eva out of thinking/listening.
            if (!isSpeakingRef.current) {
              const onsetThreshold = isThinkingRef.current ? 0.34 : 0.16
              if (normalized > onsetThreshold) {
                loudFramesRef.current += 1
                if (loudFramesRef.current >= 2) {
                  bumpUserSpeech(false)
                }
              } else {
                loudFramesRef.current = 0
              }
            } else {
              loudFramesRef.current = 0
            }
          }

          const pcm16k = downsampleTo16k(inputData, inputCtx.sampleRate)
          const b64 = float32ToBase64Pcm16(pcm16k)
          currentWs.send(JSON.stringify({ type: 'audio', audio: b64 }))
        }

        source.connect(processor)
        processor.connect(silentGain)
        silentGain.connect(inputCtx.destination)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLastError(msg)
      setStatus('error')
      onErrorRef.current?.(msg)
      teardown()
    }
  }, [bumpUserSpeech, clearSpeechTimer, enqueueAudio, resetOutputTurnClock, stopOutputPlayback, syncCapabilities, teardown, voiceName])

  const stopVoice = useCallback(() => {
    closingIntentRef.current = true
    teardown()
    setStatus('idle')
  }, [teardown])

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current
    setMuted(mutedRef.current)
    if (mutedRef.current) {
      clearSpeechTimer()
      setMicLevel(0)
      setIsUserSpeaking(false)
    }
  }, [clearSpeechTimer])

  const interruptAudio = useCallback(() => {
    stopOutputPlayback()
    setIsThinking(false)
  }, [stopOutputPlayback])

  const sendLiveText = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim()
      const ws = wsRef.current
      if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return false
      clearSpeechTimer()
      setIsUserSpeaking(false)
      setIsThinking(true)
      setLiveInputTranscript(trimmed)
      ws.send(JSON.stringify({ type: 'text', text: trimmed }))
      return true
    },
    [clearSpeechTimer]
  )

  const sendWakeAck = useCallback((): boolean => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    clearSpeechTimer()
    setIsUserSpeaking(false)
    setIsThinking(true)
    ws.send(JSON.stringify({ type: 'wake_ack' }))
    return true
  }, [clearSpeechTimer])

  const sendLiveVideoFrame = useCallback(
    (base64: string, mimeType = 'image/jpeg'): boolean => {
      const ws = wsRef.current
      if (!base64 || !ws || ws.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify({ type: 'video', image: base64, mimeType }))
      return true
    },
    []
  )

  useEffect(() => {
    return () => {
      closingIntentRef.current = true
      teardown()
    }
  }, [teardown])

  const agentState = deriveVoiceAgentState({
    status,
    activeTool,
    isSpeaking,
    isThinking,
    muted,
    isUserSpeaking,
  })

  return {
    status,
    agentState,
    isActive: status === 'connecting' || status === 'connected',
    muted,
    voiceName,
    setVoiceName,
    isSpeaking,
    isUserSpeaking,
    isThinking,
    micLevel,
    liveInputTranscript,
    liveOutputTranscript,
    outputAudioElapsedSec,
    outputAudioTotalSec,
    outputSpeechStartSec,
    outputSpeechEndSec,
    outputTurnComplete,
    outputTurnSeq,
    activeTool,
    lastError,
    startVoice,
    stopVoice,
    toggleMute,
    interruptAudio,
    sendLiveText,
    sendWakeAck,
    sendLiveVideoFrame,
  }
}
