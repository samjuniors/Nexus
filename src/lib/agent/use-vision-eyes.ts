'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type VisionSource = 'camera' | 'screen'

export interface CapturedVisionFrame {
  source: VisionSource
  mimeType: 'image/jpeg'
  base64: string
  dataUrl: string
  capturedAt: number
}

/**
 * On-demand Multimodal Vision Eyes hook for Eva.
 * Manages real browser webcam (`getUserMedia`) and screen/tab capture (`getDisplayMedia`),
 * producing crisp resized JPEG frames on demand for server-side Gemini vision analysis.
 */
export function useVisionEyes() {
  const [cameraActive, setCameraActive] = useState(false)
  const [screenActive, setScreenActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [visionError, setVisionError] = useState<string | null>(null)
  const [lastPreview, setLastPreview] = useState<CapturedVisionFrame | null>(null)

  const cameraStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const screenVideoRef = useRef<HTMLVideoElement | null>(null)

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
    setCameraStream(null)
    setCameraActive(false)
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

  const toggleCamera = useCallback(async () => {
    setVisionError(null)
    if (cameraStreamRef.current) {
      stopCamera()
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVisionError('Camera API is unavailable in this browser context.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
        audio: false,
      })
      cameraStreamRef.current = stream
      ensureHiddenVideo(cameraVideoRef, stream)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopCamera()
      })
      setCameraStream(stream)
      setCameraActive(true)
    } catch (e) {
      setVisionError(e instanceof Error ? e.message : 'Camera permission denied')
    }
  }, [stopCamera])

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

      // Wait briefly if metadata hasn't decoded first frame yet
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
      const maxDim = pick === 'screen' ? 1024 : 768
      const scale = Math.min(1, maxDim / Math.max(vw, vh))
      const cw = Math.max(160, Math.round(vw * scale))
      const ch = Math.max(120, Math.round(vh * scale))

      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, cw, ch)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78)
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
    visionError,
    lastPreview,
    toggleCamera,
    toggleScreen,
    stopCamera,
    stopScreen,
    captureFrame,
  }
}
