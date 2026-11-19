'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { CoucouBot } from '@/components/coucou/coucou-bot'
import { useEva } from '@/components/agent/eva-provider'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { EYE_EXPRESSION_LABELS } from '@/lib/agent/mochi-eyes'
import { resolveCompanionAnchor, type CompanionAnchorSlot } from '@/lib/agent/companion-anchor'
import { cn } from '@/lib/utils'

export { resolveCompanionAnchor, type CompanionAnchorSlot }

/**
 * Borderless, Glitch-Free, Context-Aware Floating Companion for Eva.
 * - Fixed 92x92 bounding box so hover, click, or captions NEVER shift the character.
 * - Automatically glides to task-aware screen anchors (browser split, reasoning, vision, mission)
 *   using compositor-only transform transitions unless manually dragged.
 * - Single subtle Settings icon overlay (opacity-only transition, out of flow).
 * - Renders live animated speech mouth, expressive eyes, and persistent animated hands.
 */
export function EvaCompanionDock() {
  const { voice, wake, vision, evaExpression, emotion, senses, handTracking, onToggleSleepMode, onArmEar } = useEva()
  const activeConvId = useApp((s) => s.activeConvId)
  const activeTab = useApp((s) => s.activeTab)
  const runningRunId = useApp((s) => s.runningRunId)

  const layoutMode = useEvaControl((s) => s.layoutMode)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const setSettingsOpen = useEvaControl((s) => s.setSettingsOpen)
  const companionResetSeq = useEvaControl((s) => s.companionResetSeq)
  const pendingCount = useEvaControl((s) => s.pendingPermissions.length)
  const transientNote = useEvaControl((s) => s.transientMoodNote)
  const coucouOutfit = useEvaControl((s) => s.coucouOutfit)
  const coucouDancing = useEvaControl((s) => s.coucouDancing)
  const mediaPlaying = useEvaControl((s) => Boolean(s.browserFrame?.mediaEmbedUrl))
  const latestChain = useEvaControl((s) => s.reasoningChains[0] ?? null)

  const [greetSeq, setGreetSeq] = useState(0)
  const [manualOffset, setManualOffset] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const dragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    if (companionResetSeq > 0) {
      setManualOffset(null)
    }
  }, [companionResetSeq])

  const anchor = useMemo(
    () =>
      resolveCompanionAnchor({
        splitOpen,
        splitMode,
        activeTab,
        isWorking: Boolean(runningRunId) || Boolean(voice.activeTool),
        visionActive: vision.anyActive,
      }),
    [splitOpen, splitMode, activeTab, runningRunId, voice.activeTool, vision.anyActive]
  )

  // Avoid duplicate character when Voice Focus stage is already front and center
  if (layoutMode === 'focus') return null

  const clampOffset = (x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y }
    const maxLeft = -(window.innerWidth - 130)
    const maxTop = -(window.innerHeight - 150)
    return {
      x: Math.max(maxLeft, Math.min(16, x)),
      y: Math.max(maxTop, Math.min(20, y)),
    }
  }

  const effectiveOffset = manualOffset ?? clampOffset(anchor.offsetX, anchor.offsetY)
  const isDancing = coucouDancing || mediaPlaying

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-dock-action="1"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: effectiveOffset.x,
      origY: effectiveOffset.y,
      moved: false,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.hypot(dx, dy) > 14) {
      drag.moved = true
      setIsDragging(true)
    }
    if (!drag.moved) return
    setManualOffset(clampOffset(drag.origX + dx, drag.origY + dy))
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
    setIsDragging(false)
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

  const activeCaption =
    voice.liveOutputTranscript ||
    voice.liveInputTranscript ||
    (handTracking.active
      ? `${handTracking.label}${handTracking.targetLabel ? ` · ${handTracking.targetLabel}` : ''}`
      : null) ||
    transientNote ||
    (latestChain?.status === 'active'
      ? latestChain.nodes[latestChain.nodes.length - 1]?.title
      : null)

  // Soft silhouette drop-shadow directly on the character — zero circle line or box
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
      data-companion-anchor={manualOffset ? 'manual' : anchor.slot}
      className={cn(
        'group/companion fixed right-5 bottom-20 z-40 h-[92px] w-[92px] select-none bg-transparent md:bottom-6',
        !isDragging && 'transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]'
      )}
      style={{ transform: `translate3d(${effectiveOffset.x}px, ${effectiveOffset.y}px, 0)` }}
    >
      {/* Pure transparent, positionally locked Coucou character — zero hover/click shift */}
      <div
        role="button"
        tabIndex={0}
        data-companion-character="1"
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
              : `Eva · Tap for hands-free Voice Focus or say "${wake.wakePhrase}"`
        }
        style={{ filter: silhouetteDropShadow }}
        className={cn(
          'relative flex h-[92px] w-[92px] cursor-pointer items-center justify-center border-0 bg-transparent outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-sky-500/60',
          wake.sleepMode && 'opacity-80'
        )}
      >
        <CoucouBot
          expression={evaExpression}
          archetype="eva"
          outfit={coucouOutfit}
          greetSeq={greetSeq}
          dancing={isDancing}
          isSpeaking={voice.isSpeaking}
          speakingLevel={voice.isSpeaking ? Math.max(0.45, voice.micLevel) : 0}
          visionActive={vision.anyActive}
          earListening={senses.ears.status === 'active'}
          handsActive={senses.hands.status === 'active'}
          handTracking={handTracking}
          emotion={emotion.id}
          size={90}
          interactive={false}
          trackGaze
          label={`Eva (${EYE_EXPRESSION_LABELS[evaExpression]} · ${emotion.shortLabel})`}
        />
      </div>

      {/* Single Settings icon ONLY — absolute overlay, opacity-only transition, zero layout shift */}
      <button
        type="button"
        data-dock-action="1"
        data-companion-settings="1"
        onClick={(e) => {
          e.stopPropagation()
          setSettingsOpen(true)
        }}
        aria-label="Open Eva and workspace settings"
        title="Settings"
        className="absolute -top-1 -right-1 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border/80 bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover/companion:opacity-100 group-focus-within/companion:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      {/* Pending permission badge (out of flow, top-left) */}
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
          className="absolute -top-1 -left-1 z-20 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[10px] font-semibold text-zinc-950 shadow"
        >
          {pendingCount}
        </button>
      )}

      {/* Transient live caption positioned to the left, completely out of layout flow */}
      {activeCaption && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-1/2 right-[102px] z-20 max-w-[220px] -translate-y-1/2 truncate rounded-md border border-border/70 bg-background/90 px-2.5 py-1 text-[11px] text-foreground shadow-sm backdrop-blur-sm"
        >
          {activeCaption}
        </div>
      )}
    </aside>
  )
}
