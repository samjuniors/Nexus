'use client'

import { Puzzle, Server, Sparkles, Wrench } from 'lucide-react'
import { useApp } from '@/lib/agent/store'
import type { CustomizeTab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

const ITEMS: { tab: CustomizeTab; label: string; icon: typeof Puzzle }[] = [
  { tab: 'plugins', label: 'Plugins', icon: Puzzle },
  { tab: 'skills', label: 'Skills', icon: Sparkles },
  { tab: 'tools', label: 'Tools', icon: Wrench },
  { tab: 'mcps', label: 'MCP', icon: Server },
]

/** Segmented switcher for the four Customize areas — shown on mobile only. */
export function CustomizeTabs() {
  const { activeTab, setTab } = useApp()
  const current = ITEMS.find((i) => i.tab === activeTab)
  if (!current) return null

  return (
    <div
      role="tablist"
      aria-label="Customize sections"
      className="sticky top-0 z-20 flex gap-1 border-b border-white/[0.08] bg-sidebar px-3 py-2 md:hidden"
    >
      {ITEMS.map(({ tab, label, icon: Icon }) => (
        <button
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => setTab(tab)}
          className={cn(
            'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors',
            activeTab === tab
              ? 'border-primary/30 bg-primary/15 text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}
