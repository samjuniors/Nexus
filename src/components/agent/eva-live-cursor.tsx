'use client'

import { useEffect, useState } from 'react'
import { MousePointer2 } from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'

/**
 * GPU-composited animated AI cursor overlay showing Eva (or a subagent) gliding across
 * the NEXUS workspace and clicking buttons, tabs, or controls in real time.
 */
export function EvaLiveCursor() {
  const cursor = useEvaControl((s) => s.cursor)
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 420, y: 260 })
  const [pulseKey, setPulseKey] = useState(0)

  useEffect(() => {
    if (!cursor.visible) return

    let nextX = cursor.x
    let nextY = cursor.y

    if (cursor.selector) {
      try {
        const el = document.querySelector<HTMLElement>(cursor.selector)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            nextX = rect.left + rect.width / 2
            nextY = rect.top + rect.height / 2
          }
        }
      } catch {
        /* ignore invalid selector */
      }
    }

    setCoords({ x: nextX, y: nextY })
    if (cursor.clicking) {
      setPulseKey((k) => k + 1)
    }
  }, [cursor.visible, cursor.x, cursor.y, cursor.selector, cursor.clicking, cursor.updatedAt])

  if (!cursor.visible) return null

  return (
    <div
      aria-hidden="true"
      data-eva-live-cursor="1"
      className="pointer-events-none fixed top-0 left-0 z-[70] will-change-transform transition-transform duration-300 ease-out"
      style={{
        transform: `translate3d(${Math.round(coords.x)}px, ${Math.round(coords.y)}px, 0)`,
      }}
    >
      {/* Click ripple ring */}
      {cursor.clicking && (
        <span
          key={pulseKey}
          className="absolute -top-3 -left-3 h-7 w-7 animate-ping rounded-full border-2 border-sky-400/80 bg-sky-400/20"
        />
      )}

      {/* Pointer arrow */}
      <MousePointer2 className="h-5 w-5 -translate-x-0.5 -translate-y-0.5 fill-sky-400 text-zinc-950 drop-shadow-[0_2px_6px_rgba(56,189,248,0.65)]" />

      {/* Crisp actor & action tag */}
      <div className="mt-1 ml-3 inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-zinc-950/92 px-2 py-0.5 font-mono text-[10.5px] font-medium whitespace-nowrap text-sky-200 shadow-lg">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
        <span>{cursor.label || cursor.actor || 'Eva'}</span>
      </div>
    </div>
  )
}
