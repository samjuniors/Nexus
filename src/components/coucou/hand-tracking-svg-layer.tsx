'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { HandTrackingAction, HandTrackingState } from '@/lib/agent/hand-tracking'

interface HandTrackingSvgLayerProps {
  handTracking?: HandTrackingState | null
  size: number
  mini?: boolean
}

function TrackingHand({
  side,
  baseX,
  baseY,
  accent,
  reducedMotion,
  motionOffset,
}: {
  side: 'left' | 'right'
  baseX: number
  baseY: number
  accent: string
  reducedMotion: boolean
  motionOffset: {
    x: number[]
    y: number[]
    rotate: number[]
  }
}) {
  const isLeft = side === 'left'
  return (
    <g transform={`translate(${baseX}, ${baseY})`} data-tracking-hand={side}>
      <motion.g
        initial={false}
        animate={
          reducedMotion
            ? { x: 0, y: 0, rotate: motionOffset.rotate[0] ?? 0 }
            : {
                x: motionOffset.x,
                y: motionOffset.y,
                rotate: motionOffset.rotate,
              }
        }
        transition={
          reducedMotion
            ? { duration: 0.16 }
            : {
                duration: 1.35,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      >
        {/* Articulated Coucou mochi mitt with soft contrast outline */}
        <ellipse
          cx="0"
          cy="0"
          rx="13"
          ry="10.5"
          fill="#f4f8ff"
          stroke="rgba(15, 23, 42, 0.24)"
          strokeWidth="1.6"
        />
        {/* Fingertip tracking target & kinematic reticle ring */}
        <circle cx={isLeft ? 5.2 : -5.2} cy="-1.5" r="2.7" fill={accent} opacity="0.95" />
        <circle
          cx={isLeft ? 5.2 : -5.2}
          cy="-1.5"
          r="5.6"
          fill="none"
          stroke={accent}
          strokeWidth="1.2"
          strokeOpacity="0.55"
        />
      </motion.g>
    </g>
  )
}

function ActionWorkspaceProp({
  action,
  accent,
  reducedMotion,
}: {
  action: HandTrackingAction
  accent: string
  reducedMotion: boolean
}) {
  if (action === 'file_read') {
    return (
      <g data-hand-prop="file_read">
        {/* Miniature floating file sheet cleanly below Eva's chin */}
        <rect
          x="74"
          y="156"
          width="52"
          height="34"
          rx="6"
          fill="rgba(15, 23, 42, 0.88)"
          stroke={accent}
          strokeOpacity="0.72"
          strokeWidth="1.4"
        />
        <line x1="82" y1="164" x2="112" y2="164" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" opacity="0.82" />
        <line x1="82" y1="171" x2="118" y2="171" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" opacity="0.58" />
        <line x1="82" y1="178" x2="106" y2="178" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" opacity="0.58" />
        <line x1="82" y1="184" x2="114" y2="184" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" opacity="0.42" />
        {/* Sweeping optical scan beam */}
        <motion.line
          x1="77"
          x2="123"
          y1="161"
          y2="161"
          stroke={accent}
          strokeWidth="2.2"
          strokeLinecap="round"
          animate={reducedMotion ? undefined : { y: [0, 22, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </g>
    )
  }

  if (action === 'file_write') {
    return (
      <g data-hand-prop="file_write">
        {/* Miniature code-diff sheet cleanly below Eva's chin */}
        <rect
          x="72"
          y="156"
          width="56"
          height="34"
          rx="6"
          fill="rgba(15, 23, 42, 0.90)"
          stroke={accent}
          strokeOpacity="0.78"
          strokeWidth="1.4"
        />
        <line x1="80" y1="164" x2="102" y2="164" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
        <motion.line
          x1="80"
          y1="172"
          x2="120"
          y2="172"
          stroke={accent}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray="40"
          animate={reducedMotion ? undefined : { strokeDashoffset: [40, 0, 0, 40] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.line
          x1="80"
          y1="180"
          x2="112"
          y2="180"
          stroke="#34d399"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray="32"
          animate={reducedMotion ? undefined : { strokeDashoffset: [32, 32, 0, 32] }}
          transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Active write stylus spark */}
        <motion.circle
          cx="116"
          cy="176"
          r="2.6"
          fill={accent}
          animate={reducedMotion ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.85, 1.35, 0.85] }}
          transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut' }}
        />
      </g>
    )
  }

  if (action === 'terminal_run') {
    return (
      <g data-hand-prop="terminal_run">
        <rect
          x="72"
          y="157"
          width="56"
          height="32"
          rx="6"
          fill="rgba(15, 23, 42, 0.90)"
          stroke={accent}
          strokeOpacity="0.75"
          strokeWidth="1.4"
        />
        <path
          d="M80 168 L85 173 L80 178"
          fill="none"
          stroke={accent}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="90" y1="173" x2="108" y2="173" stroke="#e2e8f0" strokeWidth="2.2" strokeLinecap="round" />
        <motion.rect
          x="112"
          y="168"
          width="5"
          height="10"
          rx="1.2"
          fill={accent}
          animate={reducedMotion ? undefined : { opacity: [1, 0.15, 1] }}
          transition={{ duration: 0.65, repeat: Infinity, ease: 'easeInOut' }}
        />
      </g>
    )
  }

  if (action === 'browser_act') {
    return (
      <g data-hand-prop="browser_act">
        <path
          d="M64 174 Q100 154 136 172"
          fill="none"
          stroke={accent}
          strokeOpacity="0.5"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <motion.circle
          cx="102"
          cy="171"
          r="7"
          fill="none"
          stroke={accent}
          strokeWidth="1.8"
          animate={reducedMotion ? undefined : { r: [5, 14, 5], opacity: [0.9, 0.14, 0.9] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeOut' }}
        />
        <circle cx="102" cy="171" r="3.4" fill={accent} />
      </g>
    )
  }

  if (action === 'org_delegate') {
    return (
      <g data-hand-prop="org_delegate">
        <path
          d="M68 176 Q100 158 132 176"
          fill="none"
          stroke={accent}
          strokeWidth="1.6"
          strokeOpacity="0.6"
        />
        {[
          { cx: 76, cy: 173, delay: 0 },
          { cx: 100, cy: 165, delay: 0.2 },
          { cx: 124, cy: 173, delay: 0.4 },
        ].map((node, i) => (
          <motion.circle
            key={i}
            cx={node.cx}
            cy={node.cy}
            r="4.2"
            fill={accent}
            animate={reducedMotion ? undefined : { scale: [0.85, 1.25, 0.85], opacity: [0.68, 1, 0.68] }}
            transition={{ duration: 1.2, delay: node.delay, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </g>
    )
  }

  return (
    <g data-hand-prop="tool_generic">
      <motion.circle
        cx="100"
        cy="172"
        r="12"
        fill="none"
        stroke={accent}
        strokeWidth="1.8"
        strokeDasharray="10 6"
        animate={reducedMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '100px 172px' }}
      />
      <circle cx="100" cy="172" r="3.5" fill={accent} />
    </g>
  )
}

const HAND_CHOREOGRAPHY: Record<
  Exclude<HandTrackingAction, 'idle'>,
  {
    leftBase: [number, number]
    rightBase: [number, number]
    left: { x: number[]; y: number[]; rotate: number[] }
    right: { x: number[]; y: number[]; rotate: number[] }
  }
> = {
  file_read: {
    leftBase: [56, 169],
    rightBase: [144, 169],
    left: { x: [0, -2, 0], y: [0, -5, 0], rotate: [10, 4, 10] },
    right: { x: [0, -6, 0], y: [-5, 7, -5], rotate: [-14, -4, -14] },
  },
  file_write: {
    leftBase: [56, 171],
    rightBase: [144, 169],
    left: { x: [0, 7, 0, 5, 0], y: [0, -8, 2, -6, 0], rotate: [14, -8, 14, -6, 14] },
    right: { x: [0, -8, 0, -9, 0], y: [-6, 4, -8, 2, -6], rotate: [-14, 10, -16, 8, -14] },
  },
  terminal_run: {
    leftBase: [58, 170],
    rightBase: [142, 170],
    left: { x: [0, 4, 0, 4, 0], y: [-4, 6, -4, 6, -4], rotate: [8, 22, 8, 22, 8] },
    right: { x: [0, -4, 0, -4, 0], y: [6, -4, 6, -4, 6], rotate: [-22, -8, -22, -8, -22] },
  },
  browser_act: {
    leftBase: [54, 168],
    rightBase: [142, 168],
    left: { x: [0, 2, 0], y: [0, -3, 0], rotate: [10, 14, 10] },
    right: { x: [0, -18, -10, 0], y: [0, 4, -3, 0], rotate: [-16, -28, -10, -16] },
  },
  org_delegate: {
    leftBase: [52, 164],
    rightBase: [148, 164],
    left: { x: [0, 9, 0], y: [0, -10, 0], rotate: [20, -10, 20] },
    right: { x: [0, -9, 0], y: [0, -10, 0], rotate: [-20, 10, -20] },
  },
  tool_generic: {
    leftBase: [58, 170],
    rightBase: [142, 170],
    left: { x: [0, 7, 0], y: [0, -8, 0], rotate: [12, -8, 12] },
    right: { x: [0, -7, 0], y: [-8, 0, -8], rotate: [-12, 8, -12] },
  },
}

/**
 * Companion SVG Hand-Tracking Layer — renders crisp vector hand-tracking
 * choreographies over the Coucou character whenever specific tool-use or
 * file-manipulation events occur (file read, file write/patch, command run,
 * browser click/navigate, or subagent delegation).
 */
export function HandTrackingSvgLayer({
  handTracking,
  size,
  mini = false,
}: HandTrackingSvgLayerProps) {
  const reducedMotion = Boolean(useReducedMotion())

  if (mini || size < 64) return null

  const active = Boolean(handTracking?.active && handTracking.action !== 'idle')
  const action = handTracking?.action ?? 'idle'
  const accent = handTracking?.accentHex ?? '#38bdf8'

  return (
    <AnimatePresence>
      {active && action !== 'idle' && (
        <motion.svg
          key={action}
          viewBox="0 0 200 200"
          width={size}
          height={size}
          aria-hidden="true"
          data-hand-tracking-svg="1"
          data-hand-action={action}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="pointer-events-none absolute inset-0 z-10 overflow-visible"
        >
          {/* Kinematic arc connecting left & right tracking hands */}
          <motion.path
            d="M52 170 Q100 194 148 170"
            fill="none"
            stroke={accent}
            strokeWidth="1.3"
            strokeOpacity="0.38"
            strokeDasharray="4 4"
            animate={reducedMotion ? undefined : { strokeDashoffset: [0, -16] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          />

          {/* Action-specific miniature task prop cleanly below Eva's chin */}
          <ActionWorkspaceProp
            action={action}
            accent={accent}
            reducedMotion={reducedMotion}
          />

          {/* Articulated left & right tracking hands physically performing the task */}
          <TrackingHand
            side="left"
            baseX={HAND_CHOREOGRAPHY[action].leftBase[0]}
            baseY={HAND_CHOREOGRAPHY[action].leftBase[1]}
            accent={accent}
            reducedMotion={reducedMotion}
            motionOffset={HAND_CHOREOGRAPHY[action].left}
          />
          <TrackingHand
            side="right"
            baseX={HAND_CHOREOGRAPHY[action].rightBase[0]}
            baseY={HAND_CHOREOGRAPHY[action].rightBase[1]}
            accent={accent}
            reducedMotion={reducedMotion}
            motionOffset={HAND_CHOREOGRAPHY[action].right}
          />
        </motion.svg>
      )}
    </AnimatePresence>
  )
}
