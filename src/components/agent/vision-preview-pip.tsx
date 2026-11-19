'use client'

import { useEffect, useRef } from 'react'
import { Camera, Monitor, X } from 'lucide-react'
import type { useVisionEyes } from '@/lib/agent/use-vision-eyes'

type VisionHook = ReturnType<typeof useVisionEyes>

function StreamThumb({
  stream,
  label,
  icon: Icon,
  onStop,
}: {
  stream: MediaStream
  label: string
  icon: typeof Camera
  onStop: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [stream])

  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-sky-500/35 bg-background/90 p-1.5 pr-2">
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-10 w-16 shrink-0 rounded object-cover bg-black"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
          <Icon className="h-3 w-3 text-sky-500" />
          <span>{label}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">Eva can see this frame</div>
      </div>
      <button
        type="button"
        onClick={onStop}
        aria-label={`Turn off ${label}`}
        className="ml-1 flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function VisionPreviewStrip({ vision }: { vision: VisionHook }) {
  if (!vision.anyActive && !vision.visionError) return null

  return (
    <div
      data-vision-preview="1"
      className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2"
    >
      {vision.cameraStream && (
        <StreamThumb
          stream={vision.cameraStream}
          label="Camera Eye"
          icon={Camera}
          onStop={vision.stopCamera}
        />
      )}
      {vision.screenStream && (
        <StreamThumb
          stream={vision.screenStream}
          label="Screen Eye"
          icon={Monitor}
          onStop={vision.stopScreen}
        />
      )}
      {vision.visionError && (
        <span className="text-[11px] text-amber-600 dark:text-amber-300">{vision.visionError}</span>
      )}
    </div>
  )
}
