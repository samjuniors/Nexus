'use client'

import { CoucouBot } from '@/components/coucou/coucou-bot'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { EyeArchetype, EyeExpression } from '@/lib/agent/mochi-eyes'
import type { EvaEmotionId } from '@/lib/agent/eva-emotions'
import type { HandTrackingState } from '@/lib/agent/hand-tracking'
import type { OutfitSelection } from '@/lib/coucou/wardrobe'

interface MochiEyesProps {
  expression?: EyeExpression
  archetype?: EyeArchetype
  emotion?: EvaEmotionId
  handTracking?: HandTrackingState | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  amplitude?: number
  trackGaze?: boolean
  gazeTarget?: { x: number; y: number } | null
  outfit?: OutfitSelection
  className?: string
  label?: string
}

const SIZE_PX: Record<NonNullable<MochiEyesProps['size']>, number> = {
  xs: 38,
  sm: 52,
  md: 86,
  lg: 112,
}

/**
 * Unified NEXUS agent avatar rendering the authentic louis-cfm/coucou Mochi BotEngine
 * across Header, Hero, Companion Dock, Permission Popups, and every AI Employee/Bot card.
 */
export function MochiEyes({
  expression = 'idle',
  archetype = 'eva',
  emotion,
  handTracking,
  size = 'sm',
  trackGaze,
  outfit,
  className,
  label,
}: MochiEyesProps) {
  const evaOutfit = useEvaControl((s) => s.coucouOutfit)
  const evaDancing = useEvaControl((s) => s.coucouDancing)
  const px = SIZE_PX[size]
  const isMini = size === 'xs'
  const resolvedOutfit = outfit ?? (archetype === 'eva' ? evaOutfit : undefined)

  return (
    <CoucouBot
      expression={expression}
      archetype={archetype}
      emotion={emotion}
      handTracking={handTracking}
      outfit={resolvedOutfit}
      dancing={archetype === 'eva' ? evaDancing : false}
      mini={isMini}
      size={px}
      interactive={!isMini}
      trackGaze={trackGaze ?? (size === 'md' || size === 'lg')}
      className={className}
      label={label}
    />
  )
}
