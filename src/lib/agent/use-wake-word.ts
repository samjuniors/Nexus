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
export type WakeEngine = 'speech' | 'vad' | 'none'

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

const STORAGE_KEY_SLEEP = 'nexus-eva-sleep-mode'
const STORAGE_KEY_PHRASE = 'nexus-wake-word-phrase'

// Acoustic VAD tuning constants
const VAD_RMS_THRESHOLD = 0.017
const VAD_SILENCE_MS = 560
const VAD_MIN_SPEECH_MS = 260
const VAD_MAX_BURST_MS = 2700
const VAD_PREROLL_CHUNKS = 3

/**
 * Dual-Engine Always-On Ear for Eva:
 * 1. Primary: Browser Web Speech API (`SpeechRecognition`) with multi-alternative & rolling-chunk matching.
 * 2. Automatic Fallback: Real-time Web Audio VAD + `/api/wake` Gemini audio wake detector
 *    (automatically engages if Web Speech API is missing, blocked in an iframe, or throws network/service errors).
 *
 * Stays ALWAYS ON across all views and conditions until explicitly placed into Sleep Mode
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
  const startWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const forceVadRef = useRef(false)
  const backoffAttemptRef = useRef(0)
  const hasUserGestureRef = useRef(false)
  const lastTriggerAtRef = useRef(0)
  const prevChunkRef = useRef('')

  // Acoustic VAD refs
  const vadStreamRef = useRef<MediaStream | null>(null)
  const vadCtxRef = useRef<AudioContext | null>(null)
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const vadProcRef = useRef<ScriptProcessorNode | null>(null)
  const vadGainRef = useRef<GainNode | null>(null)
  const vadInFlightRef = useRef(false)
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
    forceVadRef.current = false
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
      if (now - lastTriggerAtRef.current < 1800) return
      lastTriggerAtRef.current = now
      prevChunkRef.current = ''
      stopAllListening()
      setLastTriggeredPhrase(matchedPhrase || wakePhraseRef.current)
      playEvaWakeChime()
      // Give browser/OS 180ms to release the wake mic before Live Voice claims getUserMedia
      handoffTimerRef.current = setTimeout(() => {
        handoffTimerRef.current = null
        if (!sleepModeRef.current) {
          onWakeRef.current(trailingCommand)
        }
      }, 180)
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

  // Always-on dual-engine loop (SpeechRecognition -> automatic Acoustic VAD + /api/wake fallback)
  useEffect(() => {
    const speechCtor = getSpeechRecognitionCtor()
    const canMic = hasMediaMicSupport()
    const canListen = Boolean(speechCtor) || canMic
    setSupported(canListen)

    if (sleepMode) {
      stopAllListening()
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
          try {
            await ctx.resume()
          } catch {
            /* will resume on first gesture */
          }
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

        const preroll: Float32Array[] = []
        let recordingChunks: Float32Array[] = []
        let isSpeaking = false
        let speechStartMs = 0
        let lastVoiceMs = 0
        let lastLevelTick = 0

        const flushBurst = async (chunks: Float32Array[], sampleRate: number) => {
          if (vadInFlightRef.current || cancelled || sleepModeRef.current) return
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
            if (data.transcript) {
              setLastHeard(data.transcript.slice(-80))
            }
            if (data.sleepRequested) {
              enterSleepMode()
              return
            }
            if (data.matched) {
              triggerWake(data.matchedPhrase || wakePhraseRef.current, data.trailingCommand || '')
            }
          } catch {
            /* transient network error — keep ear armed */
          } finally {
            vadInFlightRef.current = false
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
            setEarLevel(Math.min(1, rms * 8))
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

        setEngine('vad')
        setError(null)
        setStatus('armed')
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
      const delay = baseDelay ?? Math.min(3000, 260 * Math.pow(1.6, attempt))
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

        rec.onstart = () => {
          if (cancelled || sleepModeRef.current) return
          if (startWatchdogRef.current) {
            clearTimeout(startWatchdogRef.current)
            startWatchdogRef.current = null
          }
          speechStartedRef.current = true
          backoffAttemptRef.current = 0
          setEngine('speech')
          setError(null)
          setStatus('armed')
        }

        rec.onspeechstart = () => {
          if (!cancelled) setEarLevel(0.6)
        }

        rec.onspeechend = () => {
          if (!cancelled) setEarLevel(0)
        }

        rec.onresult = (ev) => {
          if (cancelled || sleepModeRef.current) return
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
            if (backoffAttemptRef.current >= 3 && canMic) {
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
          scheduleSpeechRestart()
        }

        rec.start()

        // If onstart never fires within 2.5s (common in restricted iframes / Chromium builds), switch to VAD
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
        }, 2500)
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
      if (forceVadRef.current || !speechCtor) {
        void startVadLoop()
      } else {
        startSpeechLoop()
      }
    }

    const handleVisibilityOrFocus = () => {
      if (cancelled || sleepModeRef.current) return
      if (document.visibilityState === 'visible' && !recognitionRef.current && !vadActiveRef.current) {
        permissionBlocked = false
        backoffAttemptRef.current = 0
        startEngine()
      }
    }

    const handleOnline = () => {
      if (cancelled || sleepModeRef.current) return
      if (!recognitionRef.current && !vadActiveRef.current) {
        permissionBlocked = false
        backoffAttemptRef.current = 0
        startEngine()
      }
    }

    // Unlock mic synchronously on the very first user click or keydown anywhere in the app
    const handleFirstGesture = (ev: Event) => {
      hasUserGestureRef.current = true
      const target = ev.target as HTMLElement | null
      if (target?.closest?.('[data-eva-ear-control]')) return
      if (!cancelled && !sleepModeRef.current && !recognitionRef.current && !vadActiveRef.current) {
        permissionBlocked = false
        backoffAttemptRef.current = 0
        startEngine()
      }
    }

    // Attempt immediate auto-arm (works if mic permission was already granted for this origin)
    startEngine()

    // Watchdog keeps ear alive even if Chrome silently drops onend across OS sleep/wake
    const watchdog = setInterval(() => {
      if (
        !cancelled &&
        !sleepModeRef.current &&
        !permissionBlocked &&
        !recognitionRef.current &&
        !vadActiveRef.current &&
        !restartTimerRef.current &&
        document.visibilityState === 'visible' &&
        hasUserGestureRef.current
      ) {
        startEngine()
      }
    }, 12_000)

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pointerdown', handleFirstGesture, { passive: true, capture: true })
    window.addEventListener('keydown', handleFirstGesture, { passive: true, capture: true })

    return () => {
      cancelled = true
      clearInterval(watchdog)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pointerdown', handleFirstGesture, { capture: true })
      window.removeEventListener('keydown', handleFirstGesture, { capture: true })
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
