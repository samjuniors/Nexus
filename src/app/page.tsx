'use client'

import { useEffect } from 'react'
import { Bot, Brain, FolderOpen, Puzzle, Store } from 'lucide-react'
import { Sidebar } from '@/components/agent/sidebar'
import { ChatView } from '@/components/agent/chat-view'
import { BrainView } from '@/components/agent/brain-view'
import { ArtifactsView } from '@/components/agent/artifacts-view'
import { PluginsView } from '@/components/agent/plugins-view'
import { SkillsView } from '@/components/agent/skills-view'
import { ToolsView } from '@/components/agent/tools-view'
import { McpsView } from '@/components/agent/mcps-view'
import { MemoryView } from '@/components/agent/memory-view'
import { MarketplaceView } from '@/components/agent/marketplace-view'
import { CustomizeTabs } from '@/components/agent/customize-tabs'
import { useApp } from '@/lib/agent/store'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

const MOBILE_NAV: { tab: Tab; label: string; icon: typeof Bot; match: (t: Tab) => boolean }[] = [
  { tab: 'agent', label: 'Agent', icon: Bot, match: (t) => t === 'agent' },
  { tab: 'brain', label: 'Brain', icon: Brain, match: (t) => t === 'brain' },
  { tab: 'artifacts', label: 'Files', icon: FolderOpen, match: (t) => t === 'artifacts' },
  { tab: 'marketplace', label: 'Market', icon: Store, match: (t) => t === 'marketplace' },
  {
    tab: 'plugins',
    label: 'Customize',
    icon: Puzzle,
    match: (t) => t === 'plugins' || t === 'skills' || t === 'tools' || t === 'mcps',
  },
  { tab: 'memory', label: 'Memory', icon: Brain, match: (t) => t === 'memory' },
]

export default function Home() {
  const { activeTab, setTab, bootstrap } = useApp()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const openCustomize = () => {
    const sub: Tab[] = ['plugins', 'skills', 'tools', 'mcps']
    if (!sub.includes(activeTab)) setTab('plugins')
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
        <CustomizeTabs />
        {activeTab === 'agent' && <ChatView />}
        {activeTab === 'brain' && <BrainView />}
        {activeTab === 'artifacts' && <ArtifactsView />}
        {activeTab === 'marketplace' && <MarketplaceView />}
        {activeTab === 'plugins' && <PluginsView />}
        {activeTab === 'skills' && <SkillsView />}
        {activeTab === 'tools' && <ToolsView />}
        {activeTab === 'mcps' && <McpsView />}
        {activeTab === 'memory' && <MemoryView />}
      </main>

      {/* mobile bottom nav */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/[0.08] bg-sidebar md:hidden"
      >
        {MOBILE_NAV.map(({ tab, label, icon: Icon, match }) => {
          const active = match(activeTab)
          return (
            <button
              key={tab}
              onClick={() => (tab === 'plugins' ? openCustomize() : setTab(tab))}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[9px] transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
