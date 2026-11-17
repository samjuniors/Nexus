'use client'

import { useSyncExternalStore } from 'react'
import {
  Bot,
  Brain,
  ChevronDown,
  FolderOpen,
  Hexagon,
  Puzzle,
  Server,
  Sparkles,
  Store,
  Wrench,
} from 'lucide-react'
import { useApp } from '@/lib/agent/store'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

interface NavItem {
  tab: Tab
  label: string
  icon: typeof Bot
}

const MISSION_NAV: NavItem[] = [{ tab: 'agent', label: 'Agent', icon: Bot }]

const BRAIN_NAV: NavItem[] = [{ tab: 'brain', label: 'Brain', icon: Brain }]

const WORKSPACE_NAV: NavItem[] = [{ tab: 'artifacts', label: 'Artifacts', icon: FolderOpen }]

const CUSTOMIZE_NAV: NavItem[] = [
  { tab: 'marketplace', label: 'Marketplace', icon: Store },
  { tab: 'plugins', label: 'Plugins', icon: Puzzle },
  { tab: 'skills', label: 'Skills', icon: Sparkles },
  { tab: 'tools', label: 'Tools', icon: Wrench },
  { tab: 'mcps', label: 'MCP Servers', icon: Server },
]

const SYSTEM_NAV: NavItem[] = [{ tab: 'memory', label: 'Memory', icon: Brain }]

/** localStorage-backed open/closed state for the Customize group. */
const customizeStore = {
  listeners: new Set<() => void>(),
  get(): boolean {
    try {
      return window.localStorage.getItem('nexus-customize-open') !== '0'
    } catch {
      return true
    }
  },
  toggle() {
    try {
      window.localStorage.setItem('nexus-customize-open', this.get() ? '0' : '1')
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l()
  },
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  },
}

function NavButton({
  item,
  active,
  badge,
  indented,
  right,
  onClick,
}: {
  item: NavItem
  active: boolean
  badge?: number
  indented?: boolean
  right?: React.ReactNode
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
        indented ? 'pl-3 ml-3 w-[calc(100%-0.75rem)]' : '',
        active
          ? 'border-primary/25 bg-primary/12 text-primary'
          : 'border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
      <span className="flex-1 truncate text-left">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            'terminal-label min-w-6 rounded px-1.5 py-0.5 text-center text-[9px]',
            active ? 'bg-primary/20 text-primary' : 'bg-white/6 text-muted-foreground'
          )}
        >
          {badge}
        </span>
      )}
      {right}
    </button>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 pt-4 pb-1.5">
      <span className="terminal-label text-[9px] tracking-[0.18em] text-muted-foreground/70">{children}</span>
    </div>
  )
}

export function Sidebar() {
  const { activeTab, setTab, plugins, skills, tools, mcps, memories, artifacts, brain } = useApp()
  const customizeOpen = useSyncExternalStore(
    (listener) => customizeStore.subscribe(listener),
    () => customizeStore.get(),
    () => true
  )

  const toggleCustomize = () => customizeStore.toggle()

  const brainConnected = brain?.connected ?? true

  const badges: Partial<Record<Tab, number>> = {
    artifacts: artifacts.length,
    plugins: plugins.filter((p) => p.installed).length,
    skills: skills.filter((s) => s.enabled).length,
    tools: tools.filter((t) => t.enabled).length,
    mcps: mcps.filter((m) => m.status === 'connected' && m.enabled).length,
    memory: memories.length,
  }

  const totalTools =
    tools.filter((t) => t.enabled).length +
    mcps
      .filter((m) => m.status === 'connected' && m.enabled)
      .reduce((acc, m) => {
        try {
          return acc + (JSON.parse(m.toolsJson) as unknown[]).length
        } catch {
          return acc
        }
      }, 0)

  const customizeActive = ['marketplace', 'plugins', 'skills', 'tools', 'mcps'].includes(activeTab)

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-4">
        <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-white/12 bg-white/[0.05] shimmer-ring">
          <Hexagon className="h-5 w-5 shimmer-text" />
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-tight tracking-wide">
            <span className="shimmer-text">NEXUS</span>
            <span className="text-foreground/70"> AGENT</span>
          </div>
          <div className="terminal-label text-[9px] text-muted-foreground">autonomous agent os</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="nice-scroll flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Main navigation">
        <SectionLabel>{'// mission'}</SectionLabel>
        {MISSION_NAV.map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            active={activeTab === item.tab}
            onClick={() => setTab(item.tab)}
          />
        ))}

        {/* Brain — with live connection indicator */}
        <SectionLabel>{'// intelligence'}</SectionLabel>
        {BRAIN_NAV.map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            active={activeTab === item.tab}
            onClick={() => setTab(item.tab)}
            right={
              <span
                title={brainConnected ? 'NEXUS overlay connected' : 'Overlay paused — spine brain running (normal LLM app mode)'}
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  brainConnected ? 'bg-emerald-400/90 pulse-dot' : 'bg-amber-400/80'
                )}
              />
            }
          />
        ))}

        <SectionLabel>{'// workspace'}</SectionLabel>
        {WORKSPACE_NAV.map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            active={activeTab === item.tab}
            badge={badges[item.tab]}
            onClick={() => setTab(item.tab)}
          />
        ))}

        {/* Customize group */}
        <SectionLabel>{'// customize'}</SectionLabel>
        <button
          onClick={toggleCustomize}
          aria-expanded={customizeOpen}
          aria-label={customizeOpen ? 'Collapse customize section' : 'Expand customize section'}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] transition-colors',
            customizeActive ? 'text-primary/90' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', !customizeOpen && '-rotate-90')}
          />
          <span className="terminal-label tracking-wider">extend the agent</span>
          <span className="ml-auto flex-1 border-t border-dashed border-white/8" />
        </button>
        {(customizeOpen || customizeActive) &&
          CUSTOMIZE_NAV.map((item) => (
            <NavButton
              key={item.tab}
              item={item}
              active={activeTab === item.tab}
              badge={badges[item.tab]}
              indented
              onClick={() => setTab(item.tab)}
            />
          ))}

        <SectionLabel>{'// system'}</SectionLabel>
        {SYSTEM_NAV.map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            active={activeTab === item.tab}
            badge={badges[item.tab]}
            onClick={() => setTab(item.tab)}
          />
        ))}
      </nav>

      {/* System status */}
      <div className="m-3 rounded-lg border border-white/[0.07] bg-black/25 p-3.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              brainConnected ? 'bg-emerald-400/80 pulse-dot' : 'bg-amber-400/80'
            )}
          />
          <span className="terminal-label text-[9px] text-zinc-400">
            {brainConnected ? 'online' : 'spine mode'}
          </span>
        </div>
        <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Brain</span>
            <span
              className={cn('font-mono', brainConnected ? 'text-foreground/80' : 'text-amber-200/90')}
            >
              {brainConnected ? 'connected · GLM' : 'spine · GLM'}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Arsenal</span>
            <span className="font-mono text-foreground/80">{totalTools} tools armed</span>
          </div>
          <div className="flex justify-between">
            <span>Plugins</span>
            <span className="font-mono text-foreground/80">{badges.plugins ?? 0} installed</span>
          </div>
          <div className="flex justify-between">
            <span>Memory</span>
            <span className="font-mono text-foreground/80">{badges.memory ?? 0} records</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
