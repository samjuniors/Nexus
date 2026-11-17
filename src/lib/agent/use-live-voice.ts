'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/agent/store'
import type { EventOutDTO, MessageDTO } from '@/lib/agent/client'

export type VoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir'
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface ActiveVoiceTool {
  tool: string
  args?: Record<string, unknown>
}

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

export function useLiveVoice(options?: {
  onError?: (message: string) => void
}) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [voiceName, setVoiceName] = useState<VoiceName>('Zephyr')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [liveInputTranscript, setLiveInputTranscript] = useState('')
  const [liveOutputTranscript, setLiveOutputTranscript] = useState('')
  const [activeTool, setActiveTool] = useState<ActiveVoiceTool | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

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
  const closingIntentRef = useRef(false)
  const lastLevelTickRef = useRef(0)
  const onErrorRef = useRef(options?.onError)
  onErrorRef.current = options?.onError

  const stopOutputPlayback = useCallback(() => {
    for (const node of activeSourcesRef.current) {
      try {
        node.stop()
        node.disconnect()
      } catch {
        /* already ended */
      }
    }
    activeSourcesRef.current.clear()
    nextStartTimeRef.current = 0
    setIsSpeaking(false)
  }, [])

  const teardown = useCallback(() => {
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

    setMicLevel(0)
    setActiveTool(null)
    setLiveInputTranscript('')
    setLiveOutputTranscript('')
    setIsSpeaking(false)
  }, [stopOutputPlayback])

  const enqueueAudio = useCallback((base64Pcm: string) => {
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
    const startAt = Math.max(nextStartTimeRef.current, now)
    nextStartTimeRef.current = startAt + audioBuffer.duration

    activeSourcesRef.current.add(source)
    setIsSpeaking(true)

    source.onended = () => {
      activeSourcesRef.current.delete(source)
      if (activeSourcesRef.current.size === 0) {
        setIsSpeaking(false)
      }
    }

    source.start(startAt)
  }, [])

  const syncCapabilities = useCallback((target?: string) => {
    const store = useApp.getState()
    if (!target || target === 'all') {
      void store.refreshSkills()
      void store.refreshPlugins()
      void store.refreshTools()
      void store.refreshMcps()
      void store.refreshMemories()
      void store.refreshArtifacts()
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
  }, [])

  const startVoice = useCallback(async (overrideConvId?: string | null, overrideVoice?: VoiceName) => {
    if (status === 'connecting' || status === 'connected') return
    closingIntentRef.current = false
    setLastError(null)
    setStatus('connecting')
    setLiveInputTranscript('')
    setLiveOutputTranscript('')

    const activeConvId = overrideConvId !== undefined ? overrideConvId : useApp.getState().activeConvId
    const chosenVoice = overrideVoice ?? voiceName

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
      if (inputCtx.state === 'suspended') await inputCtx.resume()
      if (outputCtx.state === 'suspended') await outputCtx.resume()

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
          return
        }

        if (msg.type === 'output_transcript') {
          setLiveOutputTranscript(msg.text ?? '')
          return
        }

        if (msg.type === 'audio' && msg.audio) {
          enqueueAudio(msg.audio)
          return
        }

        if (msg.type === 'interrupted') {
          stopOutputPlayback()
          return
        }

        if (msg.type === 'tool_status') {
          setActiveTool(msg.active && msg.tool ? { tool: msg.tool, args: msg.args } : null)
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
          setLiveInputTranscript('')
          setLiveOutputTranscript('')
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
          setLastError(errText)
          setStatus('error')
          onErrorRef.current?.(errText)
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
            if (nowMs - lastLevelTickRef.current > 80) {
              lastLevelTickRef.current = nowMs
              setMicLevel(0)
            }
            return
          }

          let sumSq = 0
          for (let i = 0; i < inputData.length; i++) {
            sumSq += inputData[i] * inputData[i]
          }
          const rms = Math.sqrt(sumSq / inputData.length)
          const nowMs = performance.now()
          if (nowMs - lastLevelTickRef.current > 70) {
            lastLevelTickRef.current = nowMs
            setMicLevel(Math.min(1, rms * 5.5))
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
  }, [enqueueAudio, status, stopOutputPlayback, syncCapabilities, teardown, voiceName])

  const stopVoice = useCallback(() => {
    closingIntentRef.current = true
    teardown()
    setStatus('idle')
  }, [teardown])

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current
    setMuted(mutedRef.current)
    if (mutedRef.current) setMicLevel(0)
  }, [])

  const sendLiveText = useCallback((text: string): boolean => {
    const trimmed = text.trim()
    const ws = wsRef.current
    if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return false
    setLiveInputTranscript(trimmed)
    ws.send(JSON.stringify({ type: 'text', text: trimmed }))
    return true
  }, [])

  useEffect(() => {
    return () => {
      closingIntentRef.current = true
      teardown()
    }
  }, [teardown])

  return {
    status,
    isActive: status === 'connecting' || status === 'connected',
    muted,
    voiceName,
    setVoiceName,
    isSpeaking,
    micLevel,
    liveInputTranscript,
    liveOutputTranscript,
    activeTool,
    lastError,
    startVoice,
    stopVoice,
    toggleMute,
    sendLiveText,
  }
}
