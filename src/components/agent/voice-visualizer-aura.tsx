'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { VoiceVisualizerStyle } from '@/lib/agent/voice-visualizer'

interface VoiceVisualizerAuraProps {
  style: VoiceVisualizerStyle
  accentColor: string
  /** Normalized 0..1 audio/voice activity energy */
  intensity: number
  isSpeaking: boolean
  isListening: boolean
  isThinking?: boolean
  /** Compact mobile GPU-friendly mode (lighter blurs, fewer orbital bars) */
  compact?: boolean
  size?: number
}

type AuraMode = 'idle' | 'listening' | 'thinking' | 'speaking'

const DESKTOP_BAR_COUNT = 28
const MOBILE_BAR_COUNT = 18

/**
 * Ambient Voice Focus aura rendered directly behind CoucouBot.
 *
 * CRITICAL FOR MOBILE 60FPS STABILITY:
 * - Infinite ambient animations are strictly keyed to discrete `AuraMode`
 *   ('idle' | 'listening' | 'thinking' | 'speaking') and NEVER embed live
 *   `intensity` / `micLevel` inside keyframe arrays (which previously caused
 *   Motion to restart every loop from frame 0 on every audio tick!).
 * - Live audio energy is applied via a single outer GPU-composited transform
 *   wrapper (`scale` + `opacity` with smooth CSS transition).
 * - All animations use compositor-only `transform` and `opacity` (never layout `height`).
 */
export function VoiceVisualizerAura({
  style,
  accentColor,
  intensity,
  isSpeaking,
  isListening,
  isThinking = false,
  compact = false,
  size = 310,
}: VoiceVisualizerAuraProps) {
  const prefersReduced = useReducedMotion()
  const clamped = Math.max(0.05, Math.min(1, intensity))

  const mode: AuraMode = isSpeaking
    ? 'speaking'
    : isThinking
      ? 'thinking'
      : isListening
        ? 'listening'
        : 'idle'

  // Calm violet-tinted shimmer while thinking, accent color otherwise
  const effectiveColor = mode === 'thinking' ? '#8b5cf6' : accentColor

  // Smooth, GPU-composited reactive scale driven by live mic/speech energy
  // without restarting any child ambient keyframe animation!
  const reactiveScale = prefersReduced
    ? 1
    : mode === 'speaking'
      ? 1.03 + clamped * 0.08
      : mode === 'thinking'
        ? 1.02
        : mode === 'listening'
          ? 1 + clamped * 0.07
          : 1

  const reactiveOpacity =
    mode === 'speaking'
      ? 0.85 + clamped * 0.15
      : mode === 'thinking'
        ? 0.88
        : mode === 'listening'
          ? 0.68 + clamped * 0.28
          : 0.52

  const durationBase =
    mode === 'speaking'
      ? 1.7
      : mode === 'thinking'
        ? 2.2
        : mode === 'listening'
          ? 3.0
          : 4.4

  const barCount = compact ? MOBILE_BAR_COUNT : DESKTOP_BAR_COUNT
  const softBlurClass = compact ? 'blur-xl' : 'blur-3xl'
  const midBlurClass = compact ? 'blur-lg' : 'blur-2xl'

  return (
    <div
      aria-hidden="true"
      data-voice-visualizer="1"
      data-voice-visualizer-style={style}
      data-voice-visualizer-mode={mode}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 select-none"
      style={{ width: size, height: size }}
    >
      {/* Outer GPU-composited audio-reactive breath layer (never restarts child loops) */}
      <div
        className="relative h-full w-full transform-gpu"
        style={{
          transform: `scale(${reactiveScale.toFixed(3)}) translateZ(0)`,
          opacity: Number(reactiveOpacity.toFixed(2)),
          transition: 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out',
          willChange: 'transform, opacity',
        }}
      >
        {style === 'halo' && (
          <>
            <motion.div
              className={`absolute inset-5 rounded-full transform-gpu ${softBlurClass}`}
              style={{
                background: `radial-gradient(circle, ${effectiveColor}62 0%, ${effectiveColor}20 48%, transparent 74%)`,
              }}
              animate={
                prefersReduced
                  ? { opacity: 0.36, scale: 1 }
                  : mode === 'thinking'
                    ? { opacity: [0.28, 0.56, 0.28], scale: [0.95, 1.06, 0.95] }
                    : mode === 'speaking'
                      ? { opacity: [0.34, 0.66, 0.34], scale: [0.96, 1.08, 0.96] }
                      : { opacity: [0.22, 0.42, 0.22], scale: [0.97, 1.04, 0.97] }
              }
              transition={{ duration: durationBase, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute inset-12 rounded-full border transform-gpu"
              style={{
                borderColor: `${effectiveColor}48`,
                boxShadow: compact ? undefined : `0 0 30px ${effectiveColor}28`,
              }}
              animate={
                prefersReduced
                  ? { opacity: 0.32, scale: 1 }
                  : mode === 'thinking'
                    ? { opacity: [0.24, 0.58, 0.24], scale: [0.97, 1.04, 0.97] }
                    : { opacity: [0.2, 0.48, 0.2], scale: [0.98, 1.04, 0.98] }
              }
              transition={{ duration: durationBase * 0.9, repeat: Infinity, ease: 'easeInOut' }}
            />
            {mode === 'thinking' && !prefersReduced && (
              <motion.div
                className="absolute inset-10 rounded-full transform-gpu"
                style={{
                  background: `conic-gradient(from 0deg, transparent 0deg, ${effectiveColor}55 70deg, transparent 150deg)`,
                  WebkitMaskImage: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))',
                  maskImage: 'radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </>
        )}

        {style === 'ripples' && (
          <>
            {[0, 1, 2].map((ring) => (
              <motion.div
                key={ring}
                className="absolute inset-10 rounded-full border transform-gpu"
                style={{
                  borderColor: `${effectiveColor}${ring === 0 ? '66' : ring === 1 ? '44' : '2d'}`,
                }}
                animate={
                  prefersReduced
                    ? { opacity: 0.22 + (2 - ring) * 0.08, scale: 0.92 + ring * 0.12 }
                    : {
                        scale: [0.78, mode === 'speaking' ? 1.3 : mode === 'thinking' ? 1.22 : 1.24],
                        opacity: [mode === 'speaking' ? 0.62 : 0.46, 0],
                      }
                }
                transition={{
                  duration: mode === 'speaking' ? 1.85 : mode === 'thinking' ? 2.4 : mode === 'listening' ? 2.9 : 3.9,
                  repeat: Infinity,
                  ease: 'easeOut',
                  delay: ring * (mode === 'speaking' ? 0.6 : mode === 'thinking' ? 0.8 : 0.95),
                }}
              />
            ))}
            <motion.div
              className={`absolute inset-16 rounded-full transform-gpu ${midBlurClass}`}
              style={{ backgroundColor: `${effectiveColor}26` }}
              animate={
                prefersReduced
                  ? { opacity: 0.24 }
                  : { opacity: [0.2, 0.42, 0.2], scale: [0.96, 1.04, 0.96] }
              }
              transition={{ duration: durationBase, repeat: Infinity, ease: 'easeInOut' }}
            />
          </>
        )}

        {style === 'waveform' && (
          <>
            <div
              className={`absolute inset-14 rounded-full transform-gpu ${midBlurClass}`}
              style={{
                backgroundColor: `${effectiveColor}22`,
                opacity: 0.45,
              }}
            />
            <motion.div
              className="absolute inset-0 transform-gpu"
              animate={prefersReduced ? undefined : { rotate: 360 }}
              transition={{
                duration: mode === 'speaking' ? 24 : mode === 'thinking' ? 16 : 46,
                repeat: Infinity,
                ease: 'linear',
              }}
            >
              {Array.from({ length: barCount }).map((_, i) => {
                const angle = (i / barCount) * 360
                const phase = Math.sin((i / barCount) * Math.PI * 4) * 0.5 + 0.5
                const maxScaleY =
                  mode === 'speaking'
                    ? 0.55 + phase * 0.55
                    : mode === 'thinking'
                      ? 0.38 + phase * 0.35
                      : mode === 'listening'
                        ? 0.32 + phase * 0.32
                        : 0.22 + phase * 0.16
                const minScaleY = 0.18 + phase * 0.08
                const radius = size * 0.39
                return (
                  <div
                    key={i}
                    className="absolute top-1/2 left-1/2"
                    style={{
                      transform: `rotate(${angle}deg) translateY(-${radius}px)`,
                      transformOrigin: '0 0',
                    }}
                  >
                    <motion.span
                      className="block h-[26px] w-[2.5px] -translate-x-1/2 rounded-full transform-gpu"
                      style={{
                        backgroundColor: effectiveColor,
                        transformOrigin: '50% 100%',
                        opacity: 0.65,
                      }}
                      animate={
                        prefersReduced
                          ? { scaleY: minScaleY + 0.2 }
                          : { scaleY: [minScaleY, maxScaleY, minScaleY] }
                      }
                      transition={{
                        duration: (mode === 'speaking' ? 0.55 : mode === 'thinking' ? 0.95 : 1.25) + (i % 5) * 0.09,
                        repeat: Infinity,
                        ease: 'easeInOut',
                        delay: (i % 7) * 0.08,
                      }}
                    />
                  </div>
                )
              })}
            </motion.div>
          </>
        )}

        {style === 'aurora' && (
          <>
            <motion.div
              className={`absolute top-6 left-8 h-44 w-44 rounded-full transform-gpu ${softBlurClass}`}
              style={{
                background: `radial-gradient(circle, ${effectiveColor}68 0%, transparent 72%)`,
              }}
              animate={
                prefersReduced
                  ? { opacity: 0.32 }
                  : {
                      x: [-12, 16, -8, -12],
                      y: [-8, 10, 14, -8],
                      scale: [0.95, 1.12, 0.98, 0.95],
                      opacity: [0.24, 0.48, 0.28, 0.24],
                    }
              }
              transition={{ duration: mode === 'speaking' ? 4.2 : mode === 'thinking' ? 5.2 : 7.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className={`absolute right-8 bottom-6 h-44 w-44 rounded-full transform-gpu ${softBlurClass}`}
              style={{
                background: `radial-gradient(circle, #38bdf860 0%, ${effectiveColor}2c 48%, transparent 74%)`,
              }}
              animate={
                prefersReduced
                  ? { opacity: 0.28 }
                  : {
                      x: [14, -16, 10, 14],
                      y: [10, -12, -6, 10],
                      scale: [1.04, 0.93, 1.1, 1.04],
                      opacity: [0.22, 0.42, 0.26, 0.22],
                    }
              }
              transition={{ duration: mode === 'speaking' ? 4.8 : mode === 'thinking' ? 5.8 : 8.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className={`absolute inset-12 rounded-full transform-gpu ${midBlurClass}`}
              style={{
                background: `conic-gradient(from 0deg, ${effectiveColor}32, transparent 40%, #a855f72e 70%, ${effectiveColor}32)`,
              }}
              animate={prefersReduced ? { opacity: 0.24 } : { rotate: 360 }}
              transition={{ duration: mode === 'speaking' ? 10 : mode === 'thinking' ? 8 : 18, repeat: Infinity, ease: 'linear' }}
            />
          </>
        )}

        {style === 'minimal' && (
          <motion.div
            className="absolute inset-12 rounded-full border transform-gpu"
            style={{ borderColor: `${effectiveColor}44` }}
            animate={
              prefersReduced
                ? { opacity: 0.28, scale: 1 }
                : mode === 'thinking'
                  ? { opacity: [0.22, 0.52, 0.22], scale: [0.98, 1.03, 0.98] }
                  : { opacity: [0.18, 0.38, 0.18], scale: [0.985, 1.025, 0.985] }
            }
            transition={{ duration: durationBase * 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>
    </div>
  )
}
