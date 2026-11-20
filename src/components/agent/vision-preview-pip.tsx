'use client'

import { useEffect, useRef } from 'react'
import { Camera, Monitor, RefreshCw, SwitchCamera, X } from 'lucide-react'
import type { useVisionEyes } from '@/lib/agent/use-vision-eyes'
import type { GazeFocusTarget, NormalizedFaceBox } from '@/lib/agent/camera-gaze'
import { cn } from '@/lib/utils'

type VisionHook = ReturnType<typeof useVisionEyes>

function FaceTrackingReticle({
  box,
  target,
}: {
  box: NormalizedFaceBox
  target: GazeFocusTarget
}) {
  const colorClass = target === 'hand' ? 'border-amber-400/90' : 'border-sky-400/90'
  return (
    <div
      aria-hidden="true"
      data-face-reticle="1"
      className="pointer-events-none absolute transition-all duration-100 ease-out"
      style={{
        left: `${Math.round(box.x * 100)}%`,
        top: `${Math.round(box.y * 100)}%`,
        width: `${Math.round(box.width * 100)}%`,
        height: `${Math.round(box.height * 100)}%`,
      }}
    >
      <span className={cn('absolute top-0 left-0 h-2 w-2 border-t-2 border-l-2 rounded-tl-[2px]', colorClass)} />
      <span className={cn('absolute top-0 right-0 h-2 w-2 border-t-2 border-r-2 rounded-tr-[2px]', colorClass)} />
      <span className={cn('absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 rounded-bl-[2px]', colorClass)} />
      <span className={cn('absolute right-0 bottom-0 h-2 w-2 border-r-2 border-b-2 rounded-br-[2px]', colorClass)} />
    </div>
  )
}

function StreamThumb({
  stream,
  label,
  sublabel,
  icon: Icon,
  mirror,
  compact,
  faceBox,
  gazeTarget,
  onFlip,
  onStop,
}: {
  stream: MediaStream
  label: string
  sublabel?: string
  icon: typeof Camera
  mirror?: boolean
  compact?: boolean
  faceBox?: NormalizedFaceBox | null
  gazeTarget?: GazeFocusTarget
  onFlip?: () => void
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

  if (compact) {
    return (
      <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-black/80 shadow-lg backdrop-blur-md">
        <div className="relative h-20 w-24 sm:h-24 sm:w-32">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className={cn(
              'h-full w-full object-cover',
              mirror && '-scale-x-100'
            )}
          />
          {faceBox && <FaceTrackingReticle box={faceBox} target={gazeTarget ?? 'face'} />}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 py-1 text-[10px] font-medium text-white">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              gazeTarget === 'hand'
                ? 'bg-amber-400'
                : gazeTarget === 'face'
                  ? 'bg-emerald-400'
                  : 'bg-sky-400/75'
            )}
          />
          <span className="truncate">{label}</span>
        </div>
        <div className="absolute top-1 right-1 flex items-center gap-1">
          {onFlip && (
            <button
              type="button"
              onClick={onFlip}
              aria-label="Switch front or rear camera"
              title="Flip camera"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85"
            >
              <SwitchCamera className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            aria-label={`Turn off ${label}`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex items-center gap-2 rounded-lg border border-sky-500/35 bg-background/90 p-1.5 pr-2">
      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={cn(
            'h-full w-full object-cover',
            mirror && '-scale-x-100'
          )}
        />
        {faceBox && <FaceTrackingReticle box={faceBox} target={gazeTarget ?? 'face'} />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
          <Icon className="h-3 w-3 text-sky-500" />
          <span>{label}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">{sublabel ?? 'Eva sees you live'}</div>
      </div>
      {onFlip && (
        <button
          type="button"
          onClick={onFlip}
          aria-label="Flip camera"
          title="Switch front / rear camera"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SwitchCamera className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        aria-label={`Turn off ${label}`}
        className="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function VisionPreviewStrip({
  vision,
  variant = 'bar',
}: {
  vision: VisionHook
  variant?: 'bar' | 'floating'
}) {
  if (!vision.anyActive && !vision.visionError) return null

  const gazeTarget = vision.founderGaze?.target ?? 'idle'
  const cameraStatusLabel =
    gazeTarget === 'face'
      ? 'Eye contact'
      : gazeTarget === 'hand'
        ? 'Glancing at hand'
        : 'Finding face…'

  if (variant === 'floating') {
    return (
      <>
        {vision.anyActive && (
          <div
            data-vision-preview="1"
            className="pointer-events-auto absolute top-2.5 right-3 z-20 flex flex-col items-end gap-2 lg:top-14 lg:right-5"
          >
            {vision.cameraStream && (
              <StreamThumb
                stream={vision.cameraStream}
                label={cameraStatusLabel}
                icon={Camera}
                mirror={vision.facingMode === 'user'}
                compact
                faceBox={vision.founderGaze?.faceBox}
                gazeTarget={gazeTarget}
                onFlip={() => void vision.flipCamera()}
                onStop={vision.stopCamera}
              />
            )}
            {vision.screenStream && (
              <StreamThumb
                stream={vision.screenStream}
                label="Screen"
                icon={Monitor}
                compact
                onStop={vision.stopScreen}
              />
            )}
          </div>
        )}

        {vision.visionError && (
          <div
            role="alert"
            data-vision-error="1"
            className="pointer-events-auto absolute top-2.5 left-1/2 z-30 flex w-[min(calc(100%-1.5rem),24rem)] -translate-x-1/2 items-start gap-2.5 rounded-2xl border border-amber-500/35 bg-card/95 px-3.5 py-2.5 text-xs text-foreground shadow-lg backdrop-blur-md lg:top-14"
          >
            <Camera className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="leading-snug text-foreground">{vision.visionError}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void vision.toggleCamera()}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-foreground px-2.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
                >
                  <RefreshCw className="h-3 w-3" />
                  Allow Camera
                </button>
                <button
                  type="button"
                  onClick={vision.clearVisionError}
                  className="inline-flex h-7 items-center rounded-lg px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div
      data-vision-preview="1"
      className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2"
    >
      {vision.cameraStream && (
        <StreamThumb
          stream={vision.cameraStream}
          label="Camera Eye"
          sublabel={cameraStatusLabel}
          icon={Camera}
          mirror={vision.facingMode === 'user'}
          faceBox={vision.founderGaze?.faceBox}
          gazeTarget={gazeTarget}
          onFlip={() => void vision.flipCamera()}
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
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-600 dark:text-amber-300">
          <span>{vision.visionError}</span>
          <button
            type="button"
            onClick={() => void vision.toggleCamera()}
            className="inline-flex h-6 items-center gap-1 rounded border border-amber-500/40 px-2 text-[10.5px] font-medium hover:bg-amber-500/10"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
