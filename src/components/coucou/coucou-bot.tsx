'use client'

import { useEffect, useRef } from 'react'
import { BotEngine, hexToRGB } from '@/lib/coucou/engine'
import {
  botGlowColor,
  botGlowOpacity,
  getCoucouPreset,
  mapEvaExpressionToCoucouState,
  type BotEmoteName,
  type BotStateName,
} from '@/lib/coucou/types'
import { resolveOutfit, type OutfitSelection } from '@/lib/coucou/wardrobe'
import type { EyeArchetype, EyeExpression } from '@/lib/agent/mochi-eyes'
import type { EvaEmotionId } from '@/lib/agent/eva-emotions'
import type { HandTrackingState } from '@/lib/agent/hand-tracking'
import { HandTrackingSvgLayer } from '@/components/coucou/hand-tracking-svg-layer'
import { cn } from '@/lib/utils'

export interface CoucouBotProps {
  /** Direct Coucou state OR auto-mapped from Eva EyeExpression */
  state?: BotStateName
  expression?: EyeExpression
  archetype?: EyeArchetype
  /** Optional custom hex body color override */
  bodyColor?: string
  /** Authentic Coucou outfit selection ("auto" | "none" | "crown" | "sunglasses" | ...) */
  outfit?: OutfitSelection
  /** Trigger an emote when this object changes (pass { name, seq } to re-trigger) */
  emoteTrigger?: { name: BotEmoteName; seq: number } | null
  /** Trigger Coucou's signature peek-wave greet() when seq increments */
  greetSeq?: number
  /** Dance gently when music/media is playing */
  dancing?: boolean
  /** Animate small talking mouth in sync with live voice output */
  isSpeaking?: boolean
  /** 0..1 audio amplitude driving mouth lip-sync and hand gesture energy */
  speakingLevel?: number
  /** Show attentive lifted hands when Camera or Screen eyes are active */
  visionActive?: boolean
  /** Show perked ears & acoustic wave arcs when Eva's Ears are actively listening */
  earListening?: boolean
  /** Show active working hand cadence when Eva's Hands are executing tasks/tools */
  handsActive?: boolean
  /** Live tool-use / file-manipulation hand-tracking state rendered by the companion SVG overlay */
  handTracking?: HandTrackingState | null
  /** Current Eva emotion / feeling driving mouth curve and soft cheek blush */
  emotion?: EvaEmotionId
  /** Compact mini-bot rendering for header and subagent cards */
  mini?: boolean
  /** Canvas CSS pixel size */
  size?: number
  /** Enable interactive click reaction (greet or triple-tap dizzy slap) */
  interactive?: boolean
  /** Track global pointer gaze subtly */
  trackGaze?: boolean
  /** Live camera Founder gaze target (-1..1, -1..1) overriding pointer gaze when present */
  gazeOverride?: {
    x: number
    y: number
    headTilt?: number
    eyeScale?: number
    present?: boolean
    target?: 'face' | 'hand' | 'idle'
  } | null
  className?: string
  label?: string
}

/**
 * Authentic Coucou Mochi Canvas component powered directly by louis-cfm/coucou's
 * 3D-projected `BotEngine` + `outfits.ts` + `wardrobe.ts` (MIT License).
 */
export function CoucouBot({
  state,
  expression = 'idle',
  archetype = 'eva',
  bodyColor,
  outfit,
  emoteTrigger,
  greetSeq = 0,
  dancing = false,
  isSpeaking = false,
  speakingLevel = 0,
  visionActive = false,
  earListening = false,
  handsActive = false,
  handTracking = null,
  emotion = 'calm',
  mini = false,
  size = 84,
  interactive = true,
  trackGaze = true,
  gazeOverride = null,
  className,
  label,
}: CoucouBotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<BotEngine | null>(null)
  const lastEmoteSeqRef = useRef<number>(0)
  const lastGreetSeqRef = useRef<number>(0)

  const preset = getCoucouPreset(archetype)
  const resolvedState: BotStateName = state ?? mapEvaExpressionToCoucouState(expression)
  const resolvedColor = bodyColor ?? preset.bodyColor
  const resolvedOutfit = resolveOutfit(outfit ?? preset.defaultOutfit)

  // Initialize and drive the authentic Coucou BotEngine animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new BotEngine()
    engine.isMini = mini
    engine.bodyColor = hexToRGB(resolvedColor)
    engine.setState(resolvedState, true)
    engine.setOutfit(resolvedOutfit, false)
    engine.setDancing(dancing)
    engine.isSpeaking = isSpeaking
    engine.speakingLevel = speakingLevel
    engine.visionActive = visionActive
    engine.earListening = earListening
    engine.handsActive = handsActive
    engine.svgHandTrackingActive = Boolean(!mini && size >= 64 && handTracking?.active && handTracking.action !== 'idle')
    engine.emotion = emotion
    engine.onDizzy = () => {
      engine.setState('dizzy')
      setTimeout(() => {
        if (engineRef.current === engine) {
          engine.setState(resolvedState)
        }
      }, 2600)
    }
    engineRef.current = engine

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    let rafId = 0
    let lastTs = performance.now()
    let mounted = true

    const drawFrame = (now: number) => {
      if (!mounted) return
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000))
      lastTs = now

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(size * dpr)
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px
        canvas.height = px
      }

      const ctx = canvas.getContext('2d')
      if (ctx) {
        engine.update(reducedMotion ? 0.001 : dt)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, size, size)
        ctx.save()
        engine.applyDance(ctx, size, size)
        engine.draw(ctx, size, size)
        ctx.restore()
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame)
      }
    }

    rafId = window.requestAnimationFrame(drawFrame)

    return () => {
      mounted = false
      if (rafId) window.cancelAnimationFrame(rafId)
      engineRef.current = null
    }
    // Re-create engine only when size or mini mode changes
  }, [size, mini])

  // Sync dynamic state, color, outfit, dancing, 4 senses (eyes/ears/mouth/hands), and emotions
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.bodyColor = hexToRGB(resolvedColor)
    engine.setState(resolvedState)
    engine.setOutfit(resolvedOutfit, true)
    engine.setDancing(dancing)
    engine.isSpeaking = isSpeaking
    engine.speakingLevel = speakingLevel
    engine.visionActive = visionActive
    engine.earListening = earListening
    engine.handsActive = handsActive
    engine.svgHandTrackingActive = Boolean(!mini && size >= 64 && handTracking?.active && handTracking.action !== 'idle')
    engine.emotion = emotion
  }, [
    resolvedState,
    resolvedColor,
    resolvedOutfit,
    dancing,
    isSpeaking,
    speakingLevel,
    visionActive,
    earListening,
    handsActive,
    handTracking?.active,
    handTracking?.action,
    mini,
    size,
    emotion,
  ])

  // Trigger requested emotes
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !emoteTrigger) return
    if (emoteTrigger.seq === lastEmoteSeqRef.current) return
    lastEmoteSeqRef.current = emoteTrigger.seq
    engine.triggerEmote(emoteTrigger.name)
  }, [emoteTrigger])

  // Trigger Coucou peek-wave greet()
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || greetSeq === 0) return
    if (greetSeq === lastGreetSeqRef.current) return
    lastGreetSeqRef.current = greetSeq
    engine.greet()
  }, [greetSeq])

  const cameraGazeActive = Boolean(gazeOverride?.present)

  // Live Camera Eye-Contact Tracking — updates Coucou's 3D head yaw/pitch, subtle tilt, and eye scale
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || mini) return
    engine.cameraGazeActive = cameraGazeActive
    if (!cameraGazeActive || !gazeOverride) {
      engine.gazeTilt = 0
      engine.gazeEyeScale = 1
      return
    }
    engine.lookX = Math.max(-1, Math.min(1, gazeOverride.x))
    engine.lookY = Math.max(-1, Math.min(1, gazeOverride.y))
    engine.gazeTilt = Math.max(-0.16, Math.min(0.16, gazeOverride.headTilt ?? gazeOverride.x * 0.095))
    engine.gazeEyeScale = Math.max(0.96, Math.min(1.1, gazeOverride.eyeScale ?? 1.03))
  }, [
    cameraGazeActive,
    gazeOverride,
    gazeOverride?.x,
    gazeOverride?.y,
    gazeOverride?.headTilt,
    gazeOverride?.eyeScale,
    mini,
  ])

  // Global pointer gaze tracking via BotEngine's lookX / lookY (fallback when camera gaze is inactive)
  useEffect(() => {
    if (!trackGaze || mini || cameraGazeActive) return
    const onPointerMove = (e: PointerEvent) => {
      const canvas = canvasRef.current
      const engine = engineRef.current
      if (!canvas || !engine) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / Math.max(window.innerWidth * 0.45, 220)))
      const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / Math.max(window.innerHeight * 0.45, 220)))
      engine.lookX = nx * 0.85
      engine.lookY = ny * 0.65
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [trackGaze, mini, cameraGazeActive])

  const handleClick = () => {
    if (!interactive) return
    const engine = engineRef.current
    if (!engine) return
    if (resolvedState === 'sleeping') {
      engine.triggerEmote('yawn')
    } else if (mini) {
      engine.triggerEmote('happy')
    } else {
      engine.slap()
    }
  }

  const handleDoubleClick = () => {
    if (!interactive || mini) return
    engineRef.current?.greet()
  }

  const glow = botGlowColor(resolvedState)
  const glowOp = botGlowOpacity(resolvedState)

  return (
    <div
      role="img"
      aria-label={label ?? `Coucou ${archetype} (${resolvedState})`}
      data-mochi-eyes="1"
      data-coucou-bot="1"
      data-mochi-expression={expression}
      data-coucou-state={resolvedState}
      data-mochi-archetype={archetype}
      data-gaze-target={cameraGazeActive ? (gazeOverride?.target ?? 'face') : 'pointer'}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center select-none',
        interactive && 'cursor-pointer',
        className
      )}
      style={{ width: size, height: size }}
    >
      {!mini && glowOp > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 rounded-full blur-md transition-colors duration-300"
          style={{
            backgroundColor: glow,
            opacity: glowOp * 0.22,
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="relative block"
      />
      <HandTrackingSvgLayer handTracking={handTracking} size={size} mini={mini} />
    </div>
  )
}
