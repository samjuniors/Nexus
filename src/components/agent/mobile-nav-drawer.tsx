'use client'

import { AnimatePresence, motion } from 'motion/react'
import {
  Bot,
  Brain,
  CalendarClock,
  Focus,
  FolderOpen,
  GitBranch,
  Globe,
  Hexagon,
  Laptop,
  Mail,
  Network,
  Puzzle,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { useApp } from '@/lib/agent/store'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

const WORKSPACE_DESTINATIONS: { tab: Tab; label: string; icon: typeof Bot }[] = [
  { tab: 'agent', label: 'Chat Workspace', icon: Bot },
  { tab: 'org', label: 'Team & Org', icon: Users },
  { tab: 'automations', label: 'Automations', icon: CalendarClock },
  { tab: 'brain', label: 'Portable Brain', icon: Brain },
  { tab: 'artifacts', label: 'Artifacts', icon: FolderOpen },
  { tab: 'memory', label: 'Memory', icon: Sparkles },
  { tab: 'marketplace', label: 'Marketplace', icon: Store },
  { tab: 'plugins', label: 'Plugins', icon: Puzzle },
  { tab: 'skills', label: 'Skills', icon: Sparkles },
  { tab: 'tools', label: 'Tools', icon: Wrench },
  { tab: 'mcps', label: 'MCP Servers', icon: Server },
]

const TAKEOVER_PANELS: { mode: SplitMode; label: string; title: string; icon: typeof Globe }[] = [
  { mode: 'mobile', label: 'Android Takeover', title: 'Android & Mobile Control', icon: Smartphone },
  { mode: 'browser', label: 'Live Browser', title: 'Live Browser', icon: Globe },
  { mode: 'devices', label: 'Connected Devices', title: 'Connected Computers & Phones', icon: Laptop },
  { mode: 'self_heal', label: 'Self-Heal Studio', title: 'Self-Heal Studio', icon: ShieldCheck },
  { mode: 'reasoning', label: 'Reasoning Chain', title: 'Reasoning Chain', icon: GitBranch },
  { mode: 'permissions', label: 'Permissions Vault', title: 'Permissions Vault', icon: Shield },
  { mode: 'identity', label: 'Eva Inbox', title: 'Eva Email & Identity', icon: Mail },
]

/**
 * Minimalistic touch-ergonomic slide-over navigation drawer for Mobile & Tablet (< 1024px).
 * Keeps the primary Voice Agent and Chat screens serene and clutter-free while retaining
 * 1-tap access to every OS view, Android Takeover, Live Browser, GBrain, and Settings.
 */
export function MobileNavDrawer() {
  const { activeTab, setTab, brain } = useApp()
  const open = useEvaControl((s) => s.mobileDrawerOpen)
  const setOpen = useEvaControl((s) => s.setMobileDrawerOpen)
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const setSettingsOpen = useEvaControl((s) => s.setSettingsOpen)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)

  const brainConnected = brain?.connected ?? true

  const goVoiceAgent = () => {
    closeSplit()
    setLayoutMode('focus')
    setOpen(false)
  }

  const goTab = (tab: Tab) => {
    closeSplit()
    setLayoutMode('standard')
    setTab(tab)
    setOpen(false)
  }

  const goPanel = (mode: SplitMode, title: string) => {
    openSplit(mode, title)
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          data-mobile-nav-drawer="1"
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Nexus workspace menu"
        >
          {/* Scrim */}
          <motion.button
            type="button"
            aria-label="Close navigation menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
          />

          {/* Slide-over drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex h-full w-[296px] max-w-[84vw] flex-col border-r border-border bg-sidebar text-foreground shadow-2xl"
          >
            {/* Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background">
                  <Hexagon className="h-4 w-4 text-foreground" />
                </div>
                <span className="text-sm font-semibold tracking-tight">Nexus</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable navigation groups */}
            <div className="nice-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
              {/* Primary Voice Mode shortcut */}
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={goVoiceAgent}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-colors',
                    layoutMode === 'focus'
                      ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
                      : 'border-border/70 bg-background/60 text-foreground hover:bg-muted'
                  )}
                >
                  <Focus className="h-4 w-4 shrink-0" />
                  <span>Eva Voice Agent</span>
                </button>
              </div>

              {/* Device & Browser Takeover */}
              <div>
                <div className="mb-1.5 px-2.5 text-[11px] font-medium text-muted-foreground">
                  Takeover &amp; Live Tools
                </div>
                <div className="space-y-0.5">
                  {TAKEOVER_PANELS.map(({ mode, label, title, icon: Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => goPanel(mode, title)}
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-[13.5px] text-foreground/90 transition-colors hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                  {brainConnected && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        setGbrainGraphOpen(true)
                      }}
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-[13.5px] text-foreground/90 transition-colors hover:bg-muted"
                    >
                      <Network className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span>GBrain Graph</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Workspace Views */}
              <div>
                <div className="mb-1.5 px-2.5 text-[11px] font-medium text-muted-foreground">
                  Workspace
                </div>
                <div className="space-y-0.5">
                  {WORKSPACE_DESTINATIONS.filter(
                    (item) => brainConnected || (item.tab !== 'brain' && item.tab !== 'memory')
                  ).map(({ tab, label, icon: Icon }) => {
                    const active = layoutMode === 'standard' && activeTab === tab
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => goTab(tab)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors',
                          active
                            ? 'bg-primary/10 font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                        <span className="truncate">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Settings Footer */}
            <div className="border-t border-border/70 p-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setSettingsOpen(true)
                }}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-border/80 bg-background/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Settings</span>
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}
