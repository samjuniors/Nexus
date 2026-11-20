'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WAKE_VAD_SAMPLE_RATE,
  computeRmsLevel,
  downsampleMonoFloat32,
  encodePcm16ToWavBase64,
  playEvaWakeChime,
} from '@/lib/agent/audio-wake'
import {
  DEFAULT_WAKE_PHRASE,
  matchSleepCommand,
  matchWakeWordCandidates,
  shouldSuspendWakeWord,
} from '@/lib/agent/wake-word'
import type { VoiceStatus, WakeWordStatus } from '@/lib/agent/voice-state'
import {
  getNativeServiceState,
  hasNativeWakeListener,
  onAndroidServiceStateChange,
  onAndroidWakeDetected,
  startNativeWakeListener,
  stopNativeWakeListener,
} from '@/lib/platform/android-bridge'

interface SpeechRecognitionAlternativeLike {
  transcript?: string
}

interface SpeechRecognitionResultLike {
  isFinal?: boolean
  length?: number
  [index: number]: SpeechRecognitionAlternativeLike | undefined
}

interface SpeechRecognitionEventLike {
  resultIndex?: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionErrorEventLike {
  error?: string
  message?: string
}

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  maxAlternatives?: number
  lang: string
  onstart: (() => void) | null
  onspeechstart?: (() => void) | null
  onspeechend?: (() => void) | null
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance
export type WakeEngine = 'speech' | 'vad' | 'native-android' | 'none'

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function hasMediaMicSupport(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

/**
 * Inside cross-origin preview iframes, mobile browsers, and Android WebViews,
 * browser SpeechRecognition frequently fires `onstart` but silently drops speech or loops empty restarts.
 * Acoustic VAD + `/api/wake` uses the same `getUserMedia` mic path as Live Voice and works reliably everywhere.
 */
function shouldPreferVadEngine(): boolean {
  if (typeof window === 'undefined' || !hasMediaMicSupport()) return false
  try {
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true
  if (Boolean((window as unknown as { NexusAndroid?: unknown }).NexusAndroid)) return true
  return false
}

const STORAGE_KEY_SLEEP = 'nexus-eva-sleep-mode'
const STORAGE_KEY_PHRASE = 'nexus-wake-word-phrase'

// Acoustic VAD tuning constants — sensitive enough for crisp "Eva" / "Hey Eva" at desk distance
const VAD_RMS_THRESHOLD = 0.01
const VAD_SILENCE_MS = 420
const VAD_MIN_SPEECH_MS = 140
const VAD_MAX_BURST_MS = 2600
const VAD_PREROLL_CHUNKS = 5

// Heartbeat interval to recycle silently stalled Chromium SpeechRecognition sessions
const SPEECH_STALL_RECYCLE_MS = 42_000

/**
 * Dual-Engine Always-On Ear for Eva:
 * 1. Primary: Browser Web Speech API (`SpeechRecognition`) with multi-alternative, rolling-chunk matching,
 *    stall detection, and rapid-restart loop fallback.
 * 2. Automatic Fallback: Real-time Web Audio VAD + `/api/wake` Gemini (`gemini-3.5-transcribe`) wake detector
 *    with suspended-AudioContext gesture resume and latest-burst queueing.
 *
 * Stays ALWAYS ON across all views (including Text Workspace) until explicitly placed into Sleep Mode
 * (or temporarily suspended while Live Voice is connected so there is zero mic contention).
 */
export function useWakeWord(options: {
  voiceStatus: VoiceStatus
  onWake: (trailingCommand: string) => void
  onSleep?: () => void
}) {
  const [supported, setSupported] = useState(true)
  const [sleepMode, setSleepMode] = useState(false)
  const [wakePhrase, setWakePhraseState] = useState(DEFAULT_WAKE_PHRASE)
  const [status, setStatus] = useState<WakeWordStatus>('awaiting-mic')
  const [engine, setEngine] = useState<WakeEngine>('none')
  const [earLevel, setEarLevel] = useState(0)
  const [lastHeard, setLastHeard] = useState('')
  const [lastTriggeredPhrase, setLastTriggeredPhrase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [armNonce, setArmNonce] = useState(0)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const speechStartedRef = useRef(false)
  const speechLastActivityAtRef = useRef(0)
  const rapidEmptyEndsRef = useRef<number[]>([])
  const startWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const forceVadRef = useRef(false)
  const backoffAttemptRef = useRef(0)
  const hasUserGestureRef = useRef(false)
  const lastTriggerAtRef = useRef(0)
  const prevChunkRef = useRef('')
  const prevVadChunkRef = useRef<{ text: string; ts: number } | null>(null)

  // Acoustic VAD refs
  const vadStreamRef = useRef<MediaStream | null>(null)
  const vadCtxRef = useRef<AudioContext | null>(null)
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const vadProcRef = useRef<ScriptProcessorNode | null>(null)
  const vadGainRef = useRef<GainNode | null>(null)
  const vadInFlightRef = useRef(false)
  const vadPendingBurstRef = useRef<{ chunks: Float32Array[]; sampleRate: number } | null>(null)
  const vadActiveRef = useRef(false)

  const onWakeRef = useRef(options.onWake)
  onWakeRef.current = options.onWake
  const onSleepRef = useRef(options.onSleep)
  onSleepRef.current = options.onSleep
  const wakePhraseRef = useRef(wakePhrase)
  wakePhraseRef.current = wakePhrase
  const sleepModeRef = useRef(sleepMode)
  sleepModeRef.current = sleepMode
  const voiceStatusRef = useRef(options.voiceStatus)
  voiceStatusRef.current = options.voiceStatus

  // Hydrate persisted Sleep Mode + Wake Phrase
  useEffect(() => {
    const canListen = Boolean(getSpeechRecognitionCtor()) || hasMediaMicSupport()
    setSupported(canListen)
    let initialSleeping = false
    try {
      const savedPhrase = window.localStorage.getItem(STORAGE_KEY_PHRASE)
      if (savedPhrase && savedPhrase.trim()) {
        setWakePhraseState(savedPhrase.trim())
      }
      initialSleeping = window.localStorage.getItem(STORAGE_KEY_SLEEP) === '1'
      setSleepMode(initialSleeping)
    } catch {
      /* ignore storage access errors */
    }
    if (initialSleeping) {
      setStatus('sleeping')
    } else if (!canListen) {
      setStatus('unsupported')
    }
  }, [])

  const setWakePhrase = useCallback((phrase: string) => {
    const clean = phrase.trim() || DEFAULT_WAKE_PHRASE
    setWakePhraseState(clean)
    try {
      window.localStorage.setItem(STORAGE_KEY_PHRASE, clean)
    } catch {
      /* ignore */
    }
  }, [])

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    if (startWatchdogRef.current) {
      clearTimeout(startWatchdogRef.current)
      startWatchdogRef.current = null
    }
    if (handoffTimerRef.current) {
      clearTimeout(handoffTimerRef.current)
      handoffTimerRef.current = null
    }
  }, [])

  const stopVad = useCallback(() => {
    vadActiveRef.current = false
    vadPendingBurstRef.current = null
    try {
      vadProcRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    vadProcRef.current = null
    try {
      vadSourceRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    vadSourceRef.current = null
    try {
      vadGainRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    vadGainRef.current = null
    if (vadStreamRef.current) {
      for (const track of vadStreamRef.current.getTracks()) {
        try {
          track.stop()
        } catch {
          /* ignore */
        }
      }
      vadStreamRef.current = null
    }
    if (vadCtxRef.current) {
      vadCtxRef.current.onstatechange = null
      void vadCtxRef.current.close().catch(() => {})
      vadCtxRef.current = null
    }
    setEarLevel(0)
  }, [])

  const stopSpeech = useCallback(() => {
    speechStartedRef.current = false
    const rec = recognitionRef.current
    if (rec) {
      recognitionRef.current = null
      rec.onstart = null
      rec.onspeechstart = null
      rec.onspeechend = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.abort?.()
      } catch {
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const stopAllListening = useCallback(() => {
    clearTimers()
    stopSpeech()
    stopVad()
    setEngine('none')
    setEarLevel(0)
  }, [clearTimers, stopSpeech, stopVad])

  const enterSleepMode = useCallback(() => {
    sleepModeRef.current = true
    setSleepMode(true)
    setError(null)
    backoffAttemptRef.current = 0
    stopAllListening()
    setStatus('sleeping')
    try {
      window.localStorage.setItem(STORAGE_KEY_SLEEP, '1')
    } catch {
      /* ignore */
    }
    onSleepRef.current?.()
  }, [stopAllListening])

  const wakeUp = useCallback(() => {
    hasUserGestureRef.current = true
    sleepModeRef.current = false
    setSleepMode(false)
    setError(null)
    backoffAttemptRef.current = 0
    rapidEmptyEndsRef.current = []
    try {
      window.localStorage.setItem(STORAGE_KEY_SLEEP, '0')
    } catch {
      /* ignore */
    }
    setArmNonce((n) => n + 1)
  }, [])

  /**
   * Explicitly re-arms the microphone inside a user click gesture (unlocks Chrome autoplay/mic gate).
   */
  const armNow = useCallback(() => {
    hasUserGestureRef.current = true
    if (sleepModeRef.current) {
      sleepModeRef.current = false
      setSleepMode(false)
      try {
        window.localStorage.setItem(STORAGE_KEY_SLEEP, '0')
      } catch {
        /* ignore */
      }
    }
    setError(null)
    // If VAD AudioContext is already open but suspended, resume it directly inside the user gesture!
    if (vadCtxRef.current && vadCtxRef.current.state === 'suspended') {
      void vadCtxRef.current.resume().catch(() => {})
    }
    forceVadRef.current = shouldPreferVadEngine()
    rapidEmptyEndsRef.current = []
    backoffAttemptRef.current = 0
    setArmNonce((n) => n + 1)
  }, [])

  const toggleSleepMode = useCallback(() => {
    if (sleepModeRef.current) {
      wakeUp()
    } else {
      enterSleepMode()
    }
  }, [enterSleepMode, wakeUp])

  const triggerWake = useCallback(
    (matchedPhrase: string, trailingCommand: string) => {
      if (sleepModeRef.current) return
      const now = Date.now()
      if (now - lastTriggerAtRef.current < 1600) return
      lastTriggerAtRef.current = now
      prevChunkRef.current = ''
      prevVadChunkRef.current = null
      stopAllListening()
      setLastTriggeredPhrase(matchedPhrase || wakePhraseRef.current)
      playEvaWakeChime()
      // Give browser/OS 160ms to release the wake mic before Live Voice claims getUserMedia
      handoffTimerRef.current = setTimeout(() => {
        handoffTimerRef.current = null
        if (!sleepModeRef.current) {
          onWakeRef.current(trailingCommand)
        }
      }, 160)
    },
    [stopAllListening]
  )

  const processTranscripts = useCallback(
    (candidates: string[]): boolean => {
      if (sleepModeRef.current) return false
      const cleanList = candidates.map((c) => c.trim()).filter(Boolean)
      if (cleanList.length === 0) return false

      const primary = cleanList[0]
      setLastHeard(primary.slice(-80))

      for (const c of cleanList) {
        if (matchSleepCommand(c)) {
          enterSleepMode()
          return true
        }
      }

      const match = matchWakeWordCandidates(cleanList, wakePhraseRef.current)
      if (match.matched) {
        triggerWake(match.matchedPhrase, match.trailingCommand)
        return true
      }
      return false
    },
    [enterSleepMode, triggerWake]
  )

  const processTranscript = useCallback(
    (transcript: string): boolean => processTranscripts([transcript]),
    [processTranscripts]
  )

  // Always-on wake engine:
  // 1. Inside Android APK: delegates persistent mic listening to EvaVoiceForegroundService via JS bridge
  // 2. Web / Desktop: dual-engine SpeechRecognition -> automatic Acoustic VAD + /api/wake fallback
  useEffect(() => {
    const nativeAndroidWake = hasNativeWakeListener()
    const speechCtor = getSpeechRecognitionCtor()
    const canMic = hasMediaMicSupport()
    const canListen = nativeAndroidWake || Boolean(speechCtor) || canMic
    setSupported(canListen)

    if (sleepMode) {
      stopAllListening()
      if (nativeAndroidWake) {
        stopNativeWakeListener()
      }
      setStatus('sleeping')
      return
    }

    if (!canListen) {
      stopAllListening()
      setStatus('unsupported')
      return
    }

    const suspended = shouldSuspendWakeWord({
      sleepMode,
      voiceStatus: options.voiceStatus,
    })

    // Native Android Foreground Service path: zero WebView mic contention & instant bridge handoff
    if (nativeAndroidWake) {
      stopAllListening()
      setEngine('native-android')
      setError(null)

      const applyNativeState = (
        state: ReturnType<typeof getNativeServiceState>
      ) => {
        if (!state) return
        setEarLevel(Math.max(0, Math.min(1, state.audioLevel || 0)))
        if (suspended || state.listenerState === 'listening') {
          setStatus('off')
        } else if (state.listenerState === 'awaiting-permission') {
          setStatus('awaiting-mic')
        } else if (state.listenerState === 'armed') {
          setStatus('armed')
        }
      }

      const unsubState = onAndroidServiceStateChange((state) => {
        applyNativeState(state)
      })

      const unsubWake = onAndroidWakeDetected((event) => {
        if (sleepModeRef.current) return
        const heard = event.transcript || event.matchedPhrase
        if (heard) setLastHeard(heard.slice(-80))
        triggerWake(event.matchedPhrase, event.trailingCommand)
      })

      if (suspended) {
        setStatus('off')
      } else {
        setStatus('armed')
        startNativeWakeListener(
          wakePhraseRef.current,
          typeof window !== 'undefined' ? window.location.origin : ''
        )
        applyNativeState(getNativeServiceState())
      }

      return () => {
        unsubWake()
        unsubState()
      }
    }

    if (suspended) {
      stopAllListening()
      setStatus('off')
      return
    }

    let cancelled = false
    let permissionBlocked = false

    const startVadLoop = async () => {
      if (cancelled || sleepModeRef.current || vadActiveRef.current) return
      if (!hasMediaMicSupport()) {
        setStatus('unsupported')
        return
      }
      stopSpeech()
      stopVad()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        if (cancelled || sleepModeRef.current) {
          for (const t of stream.getTracks()) t.stop()
          return
        }

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        if (ctx.state === 'suspended') {
          await Promise.race([
            ctx.resume().catch(() => {}),
            new Promise<void>((resolve) => setTimeout(resolve, 250)),
          ])
        }
        if (cancelled || sleepModeRef.current) {
          for (const t of stream.getTracks()) t.stop()
          void ctx.close().catch(() => {})
          return
        }

        const source = ctx.createMediaStreamSource(stream)
        const proc = ctx.createScriptProcessor(2048, 1, 1)
        const silentGain = ctx.createGain()
        silentGain.gain.value = 0

        vadStreamRef.current = stream
        vadCtxRef.current = ctx
        vadSourceRef.current = source
        vadProcRef.current = proc
        vadGainRef.current = silentGain
        vadActiveRef.current = true

        // Keep UI status strictly truthful to AudioContext running state
        const syncVadState = () => {
          if (cancelled || sleepModeRef.current || !vadActiveRef.current) return
          if (ctx.state === 'running') {
            setEngine('vad')
            setError(null)
            setStatus('armed')
          } else if (ctx.state === 'suspended') {
            setEngine('vad')
            setStatus('awaiting-mic')
          }
        }
        ctx.onstatechange = syncVadState

        const preroll: Float32Array[] = []
        let recordingChunks: Float32Array[] = []
        let isSpeaking = false
        let speechStartMs = 0
        let lastVoiceMs = 0
        let lastLevelTick = 0

        const flushBurst = async (chunks: Float32Array[], sampleRate: number) => {
          if (cancelled || sleepModeRef.current) return
          if (vadInFlightRef.current) {
            // Queue the newest burst instead of dropping it so rapid "Hey Eva" retries always land
            vadPendingBurstRef.current = { chunks, sampleRate }
            return
          }
          let totalLen = 0
          for (const c of chunks) totalLen += c.length
          if (totalLen === 0) return
          const merged = new Float32Array(totalLen)
          let offset = 0
          for (const c of chunks) {
            merged.set(c, offset)
            offset += c.length
          }
          const resampled = downsampleMonoFloat32(merged, sampleRate, WAKE_VAD_SAMPLE_RATE)
          const audioBase64 = encodePcm16ToWavBase64(resampled, WAKE_VAD_SAMPLE_RATE)

          vadInFlightRef.current = true
          try {
            const resp = await fetch('/api/wake', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audioBase64,
                mimeType: 'audio/wav',
                wakePhrase: wakePhraseRef.current,
              }),
            })
            if (!resp.ok || cancelled || sleepModeRef.current) return
            const data = (await resp.json()) as {
              ok?: boolean
              transcript?: string
              matched?: boolean
              matchedPhrase?: string
              trailingCommand?: string
              sleepRequested?: boolean
            }
            const text = (data.transcript ?? '').trim()
            if (text) {
              setLastHeard(text.slice(-80))
            }
            if (data.sleepRequested) {
              enterSleepMode()
              return
            }
            if (data.matched) {
              triggerWake(data.matchedPhrase || wakePhraseRef.current, data.trailingCommand || '')
              return
            }
            // Also evaluate rolling VAD window (previous short burst + current burst within 4s)
            if (text) {
              const nowMs = Date.now()
              const candidates = [text]
              if (prevVadChunkRef.current && nowMs - prevVadChunkRef.current.ts < 4000) {
                candidates.push(`${prevVadChunkRef.current.text} ${text}`)
              }
              prevVadChunkRef.current = { text: text.slice(-60), ts: nowMs }
              processTranscripts(candidates)
            }
          } catch {
            /* transient network error — keep ear armed */
          } finally {
            vadInFlightRef.current = false
            const pending = vadPendingBurstRef.current
            vadPendingBurstRef.current = null
            if (pending && !cancelled && !sleepModeRef.current && vadActiveRef.current) {
              void flushBurst(pending.chunks, pending.sampleRate)
            }
          }
        }

        proc.onaudioprocess = (ev) => {
          if (cancelled || sleepModeRef.current || !vadActiveRef.current) return
          const input = ev.inputBuffer.getChannelData(0)
          const copy = new Float32Array(input.length)
          copy.set(input)

          const rms = computeRmsLevel(copy)
          const now = performance.now()
          if (now - lastLevelTick > 85) {
            lastLevelTick = now
            setEarLevel(Math.min(1, rms * 10))
          }

          if (rms >= VAD_RMS_THRESHOLD) {
            if (!isSpeaking) {
              isSpeaking = true
              speechStartMs = now
              recordingChunks = [...preroll]
            }
            lastVoiceMs = now
            recordingChunks.push(copy)

            if (now - speechStartMs >= VAD_MAX_BURST_MS) {
              const burst = recordingChunks
              recordingChunks = []
              isSpeaking = false
              void flushBurst(burst, ctx.sampleRate)
            }
          } else if (isSpeaking) {
            recordingChunks.push(copy)
            if (now - lastVoiceMs >= VAD_SILENCE_MS) {
              const spokenDuration = lastVoiceMs - speechStartMs
              const burst = recordingChunks
              recordingChunks = []
              isSpeaking = false
              if (spokenDuration >= VAD_MIN_SPEECH_MS) {
                void flushBurst(burst, ctx.sampleRate)
              }
            }
          } else {
            preroll.push(copy)
            if (preroll.length > VAD_PREROLL_CHUNKS) preroll.shift()
          }
        }

        source.connect(proc)
        proc.connect(silentGain)
        silentGain.connect(ctx.destination)

        syncVadState()
      } catch (err) {
        stopVad()
        const name = err instanceof DOMException ? err.name : ''
        if (!hasUserGestureRef.current) {
          setError(null)
          setStatus('awaiting-mic')
        } else if (name === 'NotAllowedError' || name === 'SecurityError') {
          permissionBlocked = true
          setError('Microphone permission blocked — allow microphone access in your browser, then click Arm Ear.')
          setStatus('error')
        } else {
          setError(err instanceof Error ? err.message : 'Unable to access microphone for Eva ear.')
          setStatus('error')
        }
      }
    }

    const scheduleSpeechRestart = (baseDelay?: number) => {
      if (cancelled || sleepModeRef.current || permissionBlocked || forceVadRef.current) return
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
      const attempt = backoffAttemptRef.current
      const delay = baseDelay ?? Math.min(2500, 220 * Math.pow(1.5, attempt))
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null
        if (!cancelled) startSpeechLoop()
      }, delay)
    }

    const startSpeechLoop = () => {
      if (cancelled || sleepModeRef.current || recognitionRef.current || vadActiveRef.current) return
      if (forceVadRef.current || !speechCtor) {
        void startVadLoop()
        return
      }

      stopSpeech()
      try {
        const rec = new speechCtor()
        rec.continuous = true
        rec.interimResults = true
        rec.maxAlternatives = 5
        rec.lang = 'en-US'
        recognitionRef.current = rec
        speechStartedRef.current = false
        let sessionStartedAt = 0
        let sessionHadResult = false

        rec.onstart = () => {
          if (cancelled || sleepModeRef.current) return
          if (startWatchdogRef.current) {
            clearTimeout(startWatchdogRef.current)
            startWatchdogRef.current = null
          }
          sessionStartedAt = Date.now()
          speechStartedRef.current = true
          speechLastActivityAtRef.current = sessionStartedAt
          backoffAttemptRef.current = 0
          setEngine('speech')
          setError(null)
          setStatus('armed')
        }

        rec.onspeechstart = () => {
          if (!cancelled) {
            speechLastActivityAtRef.current = Date.now()
            setEarLevel(0.6)
          }
        }

        rec.onspeechend = () => {
          if (!cancelled) setEarLevel(0)
        }

        rec.onresult = (ev) => {
          if (cancelled || sleepModeRef.current) return
          sessionHadResult = true
          speechLastActivityAtRef.current = Date.now()
          rapidEmptyEndsRef.current = []
          backoffAttemptRef.current = 0
          const startIdx = Math.max(0, ev.resultIndex ?? 0)
          for (let i = startIdx; i < ev.results.length; i++) {
            const res = ev.results[i]
            if (!res) continue
            const altCount = typeof res.length === 'number' && res.length > 0 ? res.length : 1
            const candidates: string[] = []
            for (let a = 0; a < altCount; a++) {
              const t = res[a]?.transcript?.trim()
              if (t) candidates.push(t)
            }
            // Also test rolling window (previous chunk + current chunk) so split "Hey" + "Eva" always matches
            if (prevChunkRef.current && candidates[0]) {
              candidates.push(`${prevChunkRef.current} ${candidates[0]}`)
            }
            if (processTranscripts(candidates)) return
            if (res.isFinal && candidates[0]) {
              prevChunkRef.current = candidates[0].slice(-60)
            }
          }
        }

        rec.onerror = (ev) => {
          if (cancelled) return
          const code = ev.error ?? ''
          if (startWatchdogRef.current) {
            clearTimeout(startWatchdogRef.current)
            startWatchdogRef.current = null
          }

          // Browser speech service unavailable/blocked in iframe -> switch seamlessly to Acoustic VAD + /api/wake
          if (
            code === 'network' ||
            code === 'service-not-allowed' ||
            code === 'language-not-supported' ||
            code === 'audio-capture'
          ) {
            forceVadRef.current = true
            stopSpeech()
            void startVadLoop()
            return
          }

          if (code === 'not-allowed') {
            stopSpeech()
            if (!hasUserGestureRef.current) {
              setError(null)
              setStatus('awaiting-mic')
            } else {
              // Chrome sometimes blocks SpeechRecognition inside iframes while allowing getUserMedia
              forceVadRef.current = true
              void startVadLoop()
            }
            return
          }

          if (code !== 'no-speech' && code !== 'aborted') {
            backoffAttemptRef.current = Math.min(backoffAttemptRef.current + 1, 4)
            if (backoffAttemptRef.current >= 2 && canMic) {
              forceVadRef.current = true
              stopSpeech()
              void startVadLoop()
            }
          }
        }

        rec.onend = () => {
          recognitionRef.current = null
          speechStartedRef.current = false
          setEarLevel(0)
          if (cancelled || sleepModeRef.current || permissionBlocked || forceVadRef.current) return

          // Detect rapid empty restart loops (common in Chromium iframes/mobile WebViews) -> fall back to VAD
          const nowMs = Date.now()
          if (!sessionHadResult && sessionStartedAt > 0 && nowMs - sessionStartedAt < 2200) {
            rapidEmptyEndsRef.current = [
              ...rapidEmptyEndsRef.current.filter((t) => nowMs - t < 6000),
              nowMs,
            ]
            if (rapidEmptyEndsRef.current.length >= 3 && canMic) {
              forceVadRef.current = true
              void startVadLoop()
              return
            }
          }

          scheduleSpeechRestart()
        }

        rec.start()

        // If onstart never fires within 2.2s (common in restricted iframes / Chromium builds), switch to VAD
        if (startWatchdogRef.current) clearTimeout(startWatchdogRef.current)
        startWatchdogRef.current = setTimeout(() => {
          startWatchdogRef.current = null
          if (!cancelled && !sleepModeRef.current && !speechStartedRef.current) {
            if (canMic) {
              forceVadRef.current = true
              stopSpeech()
              void startVadLoop()
            } else {
              setStatus('awaiting-mic')
            }
          }
        }, 2200)
      } catch {
        recognitionRef.current = null
        if (!hasUserGestureRef.current) {
          setStatus('awaiting-mic')
        } else if (canMic) {
          forceVadRef.current = true
          void startVadLoop()
        } else {
          setStatus('error')
          setError('Unable to start browser speech recognition.')
        }
      }
    }

    const startEngine = () => {
      if (cancelled || sleepModeRef.current) return
      if (forceVadRef.current || shouldPreferVadEngine() || !speechCtor) {
        forceVadRef.current = true
        void startVadLoop()
      } else {
        startSpeechLoop()
      }
    }

    const resumeOrRestart = () => {
      if (cancelled || sleepModeRef.current) return
      // 1. If VAD AudioContext is suspended (e.g. started before user gesture), resume it right away!
      if (vadActiveRef.current && vadCtxRef.current) {
        if (vadCtxRef.current.state === 'suspended') {
          void vadCtxRef.current.resume().catch(() => {})
        }
        // Check if OS killed the mic track
        const liveTracks = vadStreamRef.current?.getAudioTracks().some((t) => t.readyState === 'live')
        if (!liveTracks) {
          stopVad()
          void startVadLoop()
        }
        return
      }
      if (!recognitionRef.current && !vadActiveRef.current) {
        permissionBlocked = false
        backoffAttemptRef.current = 0
        startEngine()
      }
    }

    const handleVisibilityOrFocus = () => {
      if (cancelled || sleepModeRef.current) return
      if (document.visibilityState === 'visible') {
        resumeOrRestart()
      }
    }

    const handleOnline = () => {
      if (cancelled || sleepModeRef.current) return
      resumeOrRestart()
    }

    // Unlock mic & resume any suspended AudioContext synchronously on any user click/tap/keypress/input focus
    const handleFirstGesture = (ev: Event) => {
      hasUserGestureRef.current = true
      const target = ev.target as HTMLElement | null
      if (target?.closest?.('[data-eva-ear-control]')) return
      resumeOrRestart()
    }

    // Small settle delay so a just-ended Live Voice session finishes releasing the OS mic cleanly
    const initialStartTimer = setTimeout(() => {
      if (!cancelled) startEngine()
    }, 260)

    // Watchdog keeps ear alive across silent Chromium SpeechRecognition stalls, OS sleep/wake, or killed tracks
    const watchdog = setInterval(() => {
      if (cancelled || sleepModeRef.current || permissionBlocked || document.visibilityState !== 'visible') {
        return
      }
      // Recycle silent zombie SpeechRecognition sessions every ~42s while user works in text workspace
      if (
        recognitionRef.current &&
        speechStartedRef.current &&
        speechLastActivityAtRef.current > 0 &&
        Date.now() - speechLastActivityAtRef.current >= SPEECH_STALL_RECYCLE_MS
      ) {
        stopSpeech()
        scheduleSpeechRestart(180)
        return
      }
      // Resume suspended VAD AudioContext or restart dead audio track
      if (vadActiveRef.current && vadCtxRef.current) {
        if (vadCtxRef.current.state === 'suspended' && hasUserGestureRef.current) {
          void vadCtxRef.current.resume().catch(() => {})
        }
        const hasLiveTrack = vadStreamRef.current?.getAudioTracks().some((t) => t.readyState === 'live')
        if (!hasLiveTrack) {
          stopVad()
          void startVadLoop()
        }
        return
      }
      if (!recognitionRef.current && !vadActiveRef.current && !restartTimerRef.current && hasUserGestureRef.current) {
        startEngine()
      }
    }, 5000)

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true, capture: true })
    window.addEventListener('click', handleFirstGesture, { passive: true, capture: true })
    window.addEventListener('touchstart', handleFirstGesture, { passive: true, capture: true })
    window.addEventListener('keydown', handleFirstGesture, { passive: true, capture: true })
    window.addEventListener('focusin', handleFirstGesture, { passive: true, capture: true })

    return () => {
      cancelled = true
      clearTimeout(initialStartTimer)
      clearInterval(watchdog)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pointerdown', handleFirstGesture, { capture: true })
      window.removeEventListener('click', handleFirstGesture, { capture: true })
      window.removeEventListener('touchstart', handleFirstGesture, { capture: true })
      window.removeEventListener('keydown', handleFirstGesture, { capture: true })
      window.removeEventListener('focusin', handleFirstGesture, { capture: true })
      stopAllListening()
    }
  }, [
    armNonce,
    enterSleepMode,
    options.voiceStatus,
    processTranscripts,
    sleepMode,
    stopAllListening,
    stopSpeech,
    stopVad,
    triggerWake,
  ])

  return {
    supported,
    enabled: !sleepMode,
    sleepMode,
    status,
    engine,
    earLevel,
    wakePhrase,
    lastHeard,
    lastTriggeredPhrase,
    error,
    setWakePhrase,
    enterSleepMode,
    wakeUp,
    armNow,
    toggleSleepMode,
    toggleEnabled: toggleSleepMode,
    processTranscript,
  }
}
