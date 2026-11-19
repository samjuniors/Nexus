import type { SplitMode } from '@/lib/agent/eva-control-store'
import type { Tab } from '@/lib/agent/client'

export type CompanionAnchorSlot =
  | 'bottom-right'
  | 'top-right-split'
  | 'bottom-center-left'
  | 'bottom-right-elevated'

/**
 * Pure task-aware anchor resolver: smoothly repositions Eva based on what the user
 * and Eva are actively doing so she stays present beside the work without obstructing it.
 */
export function resolveCompanionAnchor(ctx: {
  splitOpen: boolean
  splitMode: SplitMode
  activeTab: Tab
  isWorking: boolean
  visionActive: boolean
}): { slot: CompanionAnchorSlot; offsetX: number; offsetY: number } {
  if (ctx.splitOpen) {
    if (ctx.splitMode === 'browser') {
      // Glide near bottom-center-left beside the chat while the right half shows the Live Browser
      return { slot: 'bottom-center-left', offsetX: -460, offsetY: -16 }
    }
    if (ctx.splitMode === 'reasoning' || ctx.splitMode === 'self_heal') {
      // Perched cleanly in the upper-right workspace corner while inspecting chains/patches
      return { slot: 'top-right-split', offsetX: -12, offsetY: -540 }
    }
    return { slot: 'bottom-right-elevated', offsetX: -8, offsetY: -64 }
  }

  if (ctx.visionActive) {
    // Sit slightly higher above the composer viewfinder when Camera/Screen eyes are active
    return { slot: 'bottom-right-elevated', offsetX: 0, offsetY: -120 }
  }

  if (ctx.activeTab === 'org') {
    // Keep clear of Org inspector controls on the bottom-right
    return { slot: 'bottom-right-elevated', offsetX: -8, offsetY: -80 }
  }

  if (ctx.isWorking) {
    // Slight attentive hover near the composer while executing a mission
    return { slot: 'bottom-right-elevated', offsetX: 0, offsetY: -96 }
  }

  return { slot: 'bottom-right', offsetX: 0, offsetY: 0 }
}
