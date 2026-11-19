'use client'

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Command,
  Focus,
  GitBranch,
  Globe,
  Moon,
  Network,
  Shirt,
  Sun,
} from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { useEva } from '@/components/agent/eva-provider'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { EYE_EXPRESSION_LABELS } from '@/lib/agent/mochi-eyes'
import { OUTFIT_SELECTIONS, type OutfitSelection } from '@/lib/coucou/wardrobe'
import { cn } from '@/lib/utils'

const OUTFIT_CYCLE: readonly OutfitSelection[] = OUTFIT_SELECTIONS

/**
 * Borderless, Transparent Floating Dynamic Companion for Eva.
 * Zero circle line, zero frame, zero box — only Eva's living 3D Coucou character
 * floating organically over any light or dark workspace background.
 * Tap directly to talk or wake, drag smoothly anywhere, hover for quick actions.
 */
export function EvaCompanionDock({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const { voice, wake, evaExpression, onToggleSleepMode, onArmEar } = useEva()
  const activeConvId = useApp((s) => s.activeConvId)

  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const pendingCount = useEvaControl((s) => s.pendingPermissions.length)
  const transientNote = useEvaControl((s) => s.transientMoodNote)
  const coucouOutfit = useEvaControl((s) => s.coucouOutfit)
  const setCoucouOutfit = useEvaControl((s) => s.setCoucouOutfit)
  const coucouDancing = useEvaControl((s) => s.coucouDancing)
  const mediaPlaying = useEvaControl((s) => Boolean(s.browserFrame?.mediaEmbedUrl))
  const latestChain = useEvaControl((s) => s.reasoningChains[0] ?? null)

  const [hovered, setHovered] = useState(false)
  const [greetSeq, setGreetSeq] = useState(0)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const dragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)

  // Avoid duplicate character when Voice Focus stage is already front and center
  if (layoutMode === 'focus') return null

  const isDancing = coucouDancing || mediaPlaying

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-dock-action="1"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.hypot(dx, dy) > 6) {
      drag.moved = true
    }
    if (!drag.moved) return

    const maxLeft = -(window.innerWidth - 130)
    const maxTop = -(window.innerHeight - 150)
    setDragOffset({
      x: Math.max(maxLeft, Math.min(20, drag.origX + dx)),
      y: Math.max(maxTop, Math.min(80, drag.origY + dy)),
    })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const wasDrag = dragRef.current.moved
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = null
    if (!wasDrag) {
      handleTapToTalk()
    }
  }

  const handleTapToTalk = () => {
    if (wake.sleepMode) {
      onToggleSleepMode()
      setGreetSeq((n) => n + 1)
      return
    }
    if (voice.isActive) {
      voice.stopVoice()
      return
    }
    if (wake.status === 'awaiting-mic' || wake.status === 'error') {
      onArmEar()
    }
    setGreetSeq((n) => n + 1)
    void voice.startVoice(activeConvId)
  }

  const toggleSplit = (mode: 'reasoning' | 'browser') => {
    if (splitOpen && splitMode === mode) closeSplit()
    else openSplit(mode)
  }

  const cycleOutfit = () => {
    const idx = OUTFIT_CYCLE.indexOf(coucouOutfit)
    setCoucouOutfit(OUTFIT_CYCLE[(idx + 1) % OUTFIT_CYCLE.length])
  }

  const activeCaption =
    voice.liveOutputTranscript ||
    voice.liveInputTranscript ||
    transientNote ||
    (latestChain?.status === 'active'
      ? latestChain.nodes[latestChain.nodes.length - 1]?.title
      : null)

  // Soft, edge-free drop-shadow directly on the character silhouette — zero circle outline
  const silhouetteDropShadow = wake.sleepMode
    ? 'drop-shadow(0 6px 14px rgba(15, 23, 42, 0.25))'
    : voice.isActive
      ? voice.isSpeaking
        ? 'drop-shadow(0 0 18px rgba(16, 185, 129, 0.42)) drop-shadow(0 8px 18px rgba(0, 0, 0, 0.24))'
        : 'drop-shadow(0 0 18px rgba(56, 189, 248, 0.45)) drop-shadow(0 8px 18px rgba(0, 0, 0, 0.24))'
      : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.22))'

  return (
    <aside
      aria-label="Eva floating voice companion"
      data-eva-companion-dock="minimal"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHovered(false)
        }
      }}
      className={cn(
        'fixed right-5 z-40 flex flex-col items-center bg-transparent select-none',
        splitOpen ? 'bottom-16' : 'bottom-24 md:bottom-20'
      )}
      style={{ transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)` }}
    >
      {/* Hover-revealed compact quick actions */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.14 }}
            data-dock-hover-menu="1"
            className="mb-1 flex items-center gap-0.5 rounded-full border border-border/70 bg-background/88 px-1.5 py-1 shadow-md backdrop-blur-md"
          >
            {onOpenCommandPalette && (
              <button
                type="button"
                data-dock-action="1"
                onClick={onOpenCommandPalette}
                aria-label="Open Command Bar (Ctrl+K)"
                title="Command Bar (⌘K)"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Command className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              data-dock-action="1"
              onClick={() => setLayoutMode('focus')}
              aria-label="Enter Voice Focus mode"
              title="Voice Focus mode"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Focus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-dock-action="1"
              data-eva-target="dock-reasoning"
              onClick={() => toggleSplit('reasoning')}
              aria-label="Toggle Reasoning Chain panel"
              title="Reasoning Chain"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                splitOpen && splitMode === 'reasoning'
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-dock-action="1"
              data-eva-target="dock-browser"
              onClick={() => toggleSplit('browser')}
              aria-label="Toggle Live Split Browser"
              title="Live Browser"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-colors',
                splitOpen && splitMode === 'browser'
                  ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Globe className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-dock-action="1"
              onClick={() => setGbrainGraphOpen(true)}
              aria-label="Open GBrain Knowledge Graph"
              title="GBrain Graph"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Network className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-dock-action="1"
              onClick={onToggleSleepMode}
              aria-label={wake.sleepMode ? 'Wake Eva' : 'Put Eva in Sleep Mode'}
              title={wake.sleepMode ? 'Wake Eva' : 'Sleep Mode'}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {wake.sleepMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              data-dock-action="1"
              onClick={cycleOutfit}
              aria-label="Cycle Eva outfit"
              title={`Outfit: ${coucouOutfit}`}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Shirt className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pure transparent, borderless floating Coucou character — zero circle line */}
      <motion.div
        role="button"
        tabIndex={0}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleTapToTalk()
          }
        }}
        aria-label={
          wake.sleepMode
            ? 'Eva is sleeping — tap to wake'
            : voice.isActive
              ? 'Eva live voice active — tap to stop'
              : `Eva (${EYE_EXPRESSION_LABELS[evaExpression]}) — tap to talk or drag to move`
        }
        title={
          wake.sleepMode
            ? 'Eva · Sleep Mode (tap to wake)'
            : voice.isActive
              ? 'Eva · Live Voice (tap to stop)'
              : `Eva · Tap to talk or say "${wake.wakePhrase}" (drag to move)`
        }
        style={{ filter: silhouetteDropShadow }}
        className={cn(
          'relative flex h-[92px] w-[92px] cursor-pointer items-center justify-center bg-transparent border-0 ring-0 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:rounded-2xl',
          wake.sleepMode && 'opacity-80'
        )}
      >
        <CoucouBot
          expression={evaExpression}
          archetype="eva"
          outfit={coucouOutfit}
          greetSeq={greetSeq}
          dancing={isDancing}
          size={90}
          interactive={false}
          trackGaze
          label={`Eva (${EYE_EXPRESSION_LABELS[evaExpression]})`}
        />

        {pendingCount > 0 && (
          <button
            type="button"
            data-dock-action="1"
            onClick={(e) => {
              e.stopPropagation()
              openSplit('permissions', 'Permissions Vault')
            }}
            aria-label={`${pendingCount} pending permission requests`}
            title="Review pending permission request"
            className="absolute top-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[10px] font-semibold text-zinc-950 shadow"
          >
            {pendingCount}
          </button>
        )}
      </motion.div>

      {/* Transient voice / reasoning caption beneath character — invisible when idle */}
      <AnimatePresence>
        {activeCaption && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.16 }}
            className="mt-1 max-w-[210px] truncate rounded-md bg-background/85 px-2.5 py-0.5 text-center text-[10.5px] text-foreground/90 shadow-sm backdrop-blur-sm"
          >
            {activeCaption}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}
