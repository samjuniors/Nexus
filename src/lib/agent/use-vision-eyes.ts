'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGazeTrackerState,
  persistGazeMode,
  readSavedGazeMode,
  stepGazeTracker,
  type ExternalFaceRect,
  type FounderGazePoint,
  type FounderGestureEvent,
  type GazeTrackerState,
  type GazeTrackingMode,
} from '@/lib/agent/camera-gaze'

export type VisionSource = 'camera' | 'screen'
export type CameraFacingMode = 'user' | 'environment'
export type CameraPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface CapturedVisionFrame {
  source: VisionSource
  mimeType: 'image/jpeg'
  base64: string
  dataUrl: string
  capturedAt: number
}

interface NativeDetectedFace {
  boundingBox: DOMRectReadOnly
}

interface NativeFaceDetector {
  detect: (source: CanvasImageSource) => Promise<NativeDetectedFace[]>
}

type NativeFaceDetectorCtor = new (options?: {
  fastMode?: boolean
  maxDetectedFaces?: number
}) => NativeFaceDetector

const GAZE_GRID_W = 48
const GAZE_GRID_H = 36
const GAZE_SAMPLE_INTERVAL_MS = 85
const NATIVE_FACE_DETECT_INTERVAL_MS = 180

function formatCameraError(err: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Camera requires HTTPS on mobile browsers. Open this app over HTTPS and allow Camera.'
  }
  const domErr = err as { name?: string; message?: string } | null
  const name = domErr?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was blocked. Allow Camera in your browser or phone site settings, then tap Retry.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Camera is busy in another app. Close the other camera app and tap Retry.'
  }
  if (name === 'OverconstrainedError') {
    return 'Selected camera mode is unsupported on this device. Tap Retry for automatic camera selection.'
  }
  return domErr?.message || 'Camera permission denied'
}

async function acquireCameraStream(facingMode: CameraFacingMode): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    },
    {
      video: { facingMode },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ]

  let lastError: unknown = null
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
      const name = (err as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw err
      }
    }
  }
  throw lastError ?? new Error('Unable to access camera')
}

/**
 * On-demand Multimodal Vision Eyes & Face-First Hybrid Gaze Tracker hook for Eva.
 * - Mobile-resilient browser webcam (`getUserMedia`) with front/rear flip + permission status
 * - Screen/tab capture (`getDisplayMedia`)
 * - 12fps real-time Face-First Hybrid gaze tracking (native browser FaceDetector + YCbCr
 *   face-cluster fallback + outside-face hand glance attention shift) driving Coucou's
 *   real-time eye & 3D head orientation
 * - Resized JPEG frame capture for Gemini Live real-time vision and chat vision
 */
export function useVisionEyes() {
  const [cameraActive, setCameraActive] = useState(false)
  const [screenActive, setScreenActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('user')
  const [gazeMode, setGazeModeState] = useState<GazeTrackingMode>(() => readSavedGazeMode())
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionState>('unknown')
  const [visionError, setVisionError] = useState<string | null>(null)
  const [lastPreview, setLastPreview] = useState<CapturedVisionFrame | null>(null)
  const [founderGaze, setFounderGaze] = useState<FounderGazePoint | null>(null)
  const [lastGesture, setLastGesture] = useState<FounderGestureEvent | null>(null)

  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)
  const facingModeRef = useRef<CameraFacingMode>('user')
  facingModeRef.current = facingMode
  const gazeModeRef = useRef<GazeTrackingMode>(gazeMode)
  gazeModeRef.current = gazeMode

  const gazeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const gazeStateRef = useRef<GazeTrackerState>(createGazeTrackerState())
  const nativeFaceRef = useRef<{ rect: ExternalFaceRect; ts: number } | null>(null)

  const setGazeMode = useCallback((mode: GazeTrackingMode) => {
    persistGazeMode(mode)
    setGazeModeState(mode)
  }, [])

  // Query browser camera permission state passively when supported
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraPermission('unsupported')
      return
    }
    let cancelled = false
    let statusRef: PermissionStatus | null = null
    const onChange = () => {
      if (!cancelled && statusRef) {
        setCameraPermission(statusRef.state as CameraPermissionState)
      }
    }
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((status) => {
          if (cancelled) return
          statusRef = status
          setCameraPermission(status.state as CameraPermissionState)
          status.addEventListener?.('change', onChange)
        })
        .catch(() => {
          // Safari/iOS WebKit does not support permissions.query('camera')
        })
    }
    return () => {
      cancelled = true
      statusRef?.removeEventListener?.('change', onChange)
    }
  }, [])

  const ensureHiddenVideo = (
    ref: React.MutableRefObject<HTMLVideoElement | null>,
    stream: MediaStream
  ): HTMLVideoElement => {
    let video = ref.current
    if (!video) {
      video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      video.setAttribute('playsinline', 'true')
      video.setAttribute('webkit-playsinline', 'true')
      video.setAttribute('muted', 'true')
      ref.current = video
    }
    video.srcObject = stream
    void video.play().catch(() => {})
    return video
  }

  const stopCamera = useCallback(() => {
    const s = cameraStreamRef.current
    if (s) {
      s.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }
    gazeStateRef.current = createGazeTrackerState()
    nativeFaceRef.current = null
    setCameraStream(null)
    setCameraActive(false)
    setFounderGaze(null)
  }, [])

  const stopScreen = useCallback(() => {
    const s = screenStreamRef.current
    if (s) {
      s.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null
    }
    setScreenStream(null)
    setScreenActive(false)
  }, [])

  const startCameraWithFacing = useCallback(
    async (mode: CameraFacingMode) => {
      setVisionError(null)
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraPermission('unsupported')
        setVisionError(formatCameraError(null))
        return
      }
      try {
        const stream = await acquireCameraStream(mode)
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((t) => t.stop())
        }
        cameraStreamRef.current = stream
        gazeStateRef.current = createGazeTrackerState()
        nativeFaceRef.current = null
        ensureHiddenVideo(cameraVideoRef, stream)
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          stopCamera()
        })
        setFacingMode(mode)
        setCameraPermission('granted')
        setCameraStream(stream)
        setCameraActive(true)
      } catch (e) {
        const name = (e as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraPermission('denied')
        }
        setVisionError(formatCameraError(e))
      }
    },
    [stopCamera]
  )

  const toggleCamera = useCallback(async () => {
    if (cameraStreamRef.current) {
      stopCamera()
      return
    }
    await startCameraWithFacing(facingModeRef.current)
  }, [startCameraWithFacing, stopCamera])

  const flipCamera = useCallback(async () => {
    const next: CameraFacingMode = facingModeRef.current === 'user' ? 'environment' : 'user'
    setFacingMode(next)
    if (cameraStreamRef.current) {
      await startCameraWithFacing(next)
    }
  }, [startCameraWithFacing])

  const clearVisionError = useCallback(() => {
    setVisionError(null)
  }, [])

  const toggleScreen = useCallback(async () => {
    setVisionError(null)
    if (screenStreamRef.current) {
      stopScreen()
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      setVisionError('Screen capture is unavailable in this browser context.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      screenStreamRef.current = stream
      ensureHiddenVideo(screenVideoRef, stream)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopScreen()
      })
      setScreenStream(stream)
      setScreenActive(true)
    } catch (e) {
      setVisionError(e instanceof Error ? e.message : 'Screen share canceled')
    }
  }, [stopScreen])

  // Real-time ~12fps Face-First Hybrid Gaze & Gesture Loop while Camera Eye is active
  useEffect(() => {
    if (!cameraActive) {
      setFounderGaze(null)
      nativeFaceRef.current = null
      return
    }

    if (!gazeCanvasRef.current && typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = GAZE_GRID_W
      c.height = GAZE_GRID_H
      gazeCanvasRef.current = c
    }

    // Tier 1: Hardware-accelerated native browser FaceDetector when available (Chrome/Edge/Android/macOS)
    let nativeDetector: NativeFaceDetector | null = null
    if (typeof window !== 'undefined') {
      const Ctor = (window as unknown as { FaceDetector?: NativeFaceDetectorCtor }).FaceDetector
      if (typeof Ctor === 'function') {
        try {
          nativeDetector = new Ctor({ fastMode: true, maxDetectedFaces: 1 })
        } catch {
          nativeDetector = null
        }
      }
    }

    let nativeInFlight = false
    let lastNativeTriggerTs = 0

    const timer = window.setInterval(() => {
      const video = cameraVideoRef.current
      const canvas = gazeCanvasRef.current
      if (!video || !canvas || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
        return
      }

      const nowMs = Date.now()

      // Opportunistically poll native FaceDetector without blocking the 12fps loop
      if (nativeDetector && !nativeInFlight && nowMs - lastNativeTriggerTs >= NATIVE_FACE_DETECT_INTERVAL_MS) {
        nativeInFlight = true
        lastNativeTriggerTs = nowMs
        const vw = video.videoWidth
        const vh = video.videoHeight
        nativeDetector
          .detect(video)
          .then((faces) => {
            if (faces.length > 0 && vw > 0 && vh > 0) {
              // Pick largest/closest face
              let largest = faces[0]
              let largestArea = largest.boundingBox.width * largest.boundingBox.height
              for (let i = 1; i < faces.length; i++) {
                const a = faces[i].boundingBox.width * faces[i].boundingBox.height
                if (a > largestArea) {
                  largest = faces[i]
                  largestArea = a
                }
              }
              const b = largest.boundingBox
              nativeFaceRef.current = {
                rect: {
                  x: b.x / vw,
                  y: b.y / vh,
                  width: b.width / vw,
                  height: b.height / vh,
                },
                ts: Date.now(),
              }
            } else {
              nativeFaceRef.current = null
            }
          })
          .catch(() => {
            // Browser threw (e.g. feature flagged off at runtime) — disable native tier gracefully
            nativeDetector = null
            nativeFaceRef.current = null
          })
          .finally(() => {
            nativeInFlight = false
          })
      }

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      try {
        ctx.drawImage(video, 0, 0, GAZE_GRID_W, GAZE_GRID_H)
        const imageData = ctx.getImageData(0, 0, GAZE_GRID_W, GAZE_GRID_H)
        const freshNativeFace =
          nativeFaceRef.current && nowMs - nativeFaceRef.current.ts < 500
            ? nativeFaceRef.current.rect
            : null

        const { gaze, gesture } = stepGazeTracker(
          gazeStateRef.current,
          imageData.data,
          GAZE_GRID_W,
          GAZE_GRID_H,
          nowMs,
          {
            mirrorX: facingModeRef.current === 'user',
            mode: gazeModeRef.current,
            externalFace: freshNativeFace,
          }
        )
        setFounderGaze(gaze)
        if (gesture) {
          setLastGesture(gesture)
        }
      } catch {
        /* ignore transient frame decode errors */
      }
    }, GAZE_SAMPLE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [cameraActive])

  const captureFrame = useCallback(
    async (preferred?: VisionSource): Promise<CapturedVisionFrame | null> => {
      const pick: VisionSource | null =
        preferred === 'camera' && cameraStreamRef.current
          ? 'camera'
          : preferred === 'screen' && screenStreamRef.current
            ? 'screen'
            : screenStreamRef.current
              ? 'screen'
              : cameraStreamRef.current
                ? 'camera'
                : null

      if (!pick) return null
      const video = pick === 'screen' ? screenVideoRef.current : cameraVideoRef.current
      if (!video) return null

      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 450)
          video.addEventListener(
            'loadeddata',
            () => {
              window.clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        })
      }

      const vw = video.videoWidth || 640
      const vh = video.videoHeight || 360
      const maxDim = pick === 'screen' ? 1024 : 640
      const scale = Math.min(1, maxDim / Math.max(vw, vh))
      const cw = Math.max(160, Math.round(vw * scale))
      const ch = Math.max(120, Math.round(vh * scale))

      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, cw, ch)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
      const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
      const frame: CapturedVisionFrame = {
        source: pick,
        mimeType: 'image/jpeg',
        base64,
        dataUrl,
        capturedAt: Date.now(),
      }
      setLastPreview(frame)
      return frame
    },
    []
  )

  useEffect(() => {
    return () => {
      stopCamera()
      stopScreen()
    }
  }, [stopCamera, stopScreen])

  return {
    cameraActive,
    screenActive,
    anyActive: cameraActive || screenActive,
    cameraStream,
    screenStream,
    facingMode,
    gazeMode,
    setGazeMode,
    cameraPermission,
    visionError,
    lastPreview,
    founderGaze,
    lastGesture,
    toggleCamera,
    flipCamera,
    clearVisionError,
    toggleScreen,
    stopCamera,
    stopScreen,
    captureFrame,
  }
}
