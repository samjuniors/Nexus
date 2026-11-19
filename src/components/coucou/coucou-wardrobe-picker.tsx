'use client'

import { Music, Shirt, Sparkles } from 'lucide-react'
import { OUTFIT_LABELS, OUTFIT_SELECTIONS, type OutfitSelection } from '@/lib/coucou/wardrobe'
import type { BotEmoteName } from '@/lib/coucou/types'
import { cn } from '@/lib/utils'

interface CoucouWardrobePickerProps {
  outfit: OutfitSelection
  onSelectOutfit: (outfit: OutfitSelection) => void
  onEmote: (emote: BotEmoteName) => void
  dancing: boolean
  onToggleDance: () => void
}

const QUICK_EMOTES: { name: BotEmoteName; label: string }[] = [
  { name: 'happy', label: 'Happy' },
  { name: 'love', label: 'Love' },
  { name: 'wink', label: 'Wink' },
  { name: 'proud', label: 'Proud' },
  { name: 'surprised', label: 'Whoa' },
]

/**
 * Compact Coucou Wardrobe & Emote selector for Eva (all 13 authentic Coucou outfits + emotes + dance).
 */
export function CoucouWardrobePicker({
  outfit,
  onSelectOutfit,
  onEmote,
  dancing,
  onToggleDance,
}: CoucouWardrobePickerProps) {
  return (
    <div
      data-coucou-wardrobe="1"
      className="mt-2 space-y-2 rounded-xl border border-border bg-background/90 p-2.5 text-left"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Shirt className="h-3 w-3" /> Coucou Wardrobe
        </span>
        <button
          type="button"
          onClick={onToggleDance}
          aria-pressed={dancing}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9.5px] transition-colors',
            dancing
              ? 'border-sky-400/50 bg-sky-400/15 text-sky-400'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          )}
        >
          <Music className="h-2.5 w-2.5" />
          {dancing ? 'Dancing' : 'Dance'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {OUTFIT_SELECTIONS.map((sel) => {
          const active = outfit === sel
          return (
            <button
              key={sel}
              type="button"
              onClick={() => onSelectOutfit(sel)}
              aria-pressed={active}
              className={cn(
                'truncate rounded-md border px-2 py-1 text-left text-[10.5px] transition-colors',
                active
                  ? 'border-sky-400/50 bg-sky-400/15 font-medium text-sky-400'
                  : 'border-border/70 bg-card/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {OUTFIT_LABELS[sel]}
            </button>
          )
        })}
      </div>

      <div className="border-t border-border/70 pt-2">
        <div className="mb-1 flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" /> Emotes
        </div>
        <div className="flex flex-wrap gap-1">
          {QUICK_EMOTES.map((em) => (
            <button
              key={em.name}
              type="button"
              onClick={() => onEmote(em.name)}
              className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {em.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
