'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bot,
  Brain,
  CalendarClock,
  Focus,
  FolderOpen,
  GitBranch,
  Globe,
  Laptop,
  Layers,
  Mail,
  Moon,
  Network,
  PanelLeft,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Users,
} from 'lucide-react'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useEva } from '@/components/agent/eva-provider'
import { cn } from '@/lib/utils'

interface PaletteItem {
  id: string
  group: 'Workspace' | 'Panels' | 'Eva & Voice'
  label: string
  hint: string
  icon: typeof Search
  run: () => void
}

/**
 * Dynamic Command & Voice Launcher (⌘K / Ctrl+K).
 * Lets the user instantly jump to any workspace view, open/switch split panels,
 * launch GBrain or Voice Focus, toggle the rail/theme, or dispatch a live instruction to Eva.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { setTab, sendTask, activeConvId, brain } = useApp()
  const brainConnected = brain?.connected ?? true
  const { resolvedTheme, setTheme } = useTheme()
  const { voice, wake, onToggleSleepMode } = useEva()
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const toggleSidebarCollapsed = useEvaControl((s) => s.toggleSidebarCollapsed)
  const openSplit = useEvaControl((s) => s.openSplit)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const setSettingsOpen = useEvaControl((s) => s.setSettingsOpen)
  const runBuildVerify = useEvaControl((s) => s.runBuildVerify)

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)

  const close = () => {
    setQuery('')
    onOpenChange(false)
  }

  const items = useMemo<PaletteItem[]>(
    () => [
      {
        id: 'open-settings',
        group: 'Workspace',
        label: 'Open Settings',
        hint: 'Theme, Voice, Ear, Companion & Brain',
        icon: Settings,
        run: () => {
          setSettingsOpen(true)
          close()
        },
      },
      {
        id: 'focus',
        group: 'Eva & Voice',
        label: layoutMode === 'focus' ? 'Exit Voice Focus Mode' : 'Enter Voice Focus Mode',
        hint: 'Companion-first voice canvas',
        icon: Focus,
        run: () => {
          setLayoutMode(layoutMode === 'focus' ? 'standard' : 'focus')
          close()
        },
      },
      {
        id: 'talk',
        group: 'Eva & Voice',
        label: voice.isActive ? 'Stop Live Voice Session' : 'Talk to Eva Live',
        hint: voice.isActive ? 'Disconnect mic' : 'Start bidirectional voice',
        icon: Sparkles,
        run: () => {
          if (voice.isActive) voice.stopVoice()
          else void voice.startVoice(activeConvId)
          close()
        },
      },
      {
        id: 'sleep',
        group: 'Eva & Voice',
        label: wake.sleepMode ? 'Wake Eva from Sleep Mode' : 'Put Eva in Sleep Mode',
        hint: 'Pause always-on ear',
        icon: wake.sleepMode ? Sun : Moon,
        run: () => {
          onToggleSleepMode()
          close()
        },
      },
      {
        id: 'gbrain',
        group: 'Panels',
        label: 'Open GBrain Knowledge Graph',
        hint: 'Categorized visual graph',
        icon: Network,
        run: () => {
          setGbrainGraphOpen(true)
          close()
        },
      },
      {
        id: 'gbrain-audit',
        group: 'Panels',
        label: 'Open GBrain Truth Audit',
        hint: 'Detect contradictions & staleness',
        icon: ShieldAlert,
        run: () => {
          setGbrainGraphOpen(true, 'audit')
          close()
        },
      },
      {
        id: 'gbrain-packs',
        group: 'Panels',
        label: 'Open GBrain Context Packs',
        hint: 'Scope Eva recall to domains',
        icon: Layers,
        run: () => {
          setGbrainGraphOpen(true, 'packs')
          close()
        },
      },
      {
        id: 'split-self-heal',
        group: 'Panels',
        label: 'Open Self-Heal Studio',
        hint: 'Own-code patches, diffs & rollback',
        icon: ShieldCheck,
        run: () => {
          openSplit('self_heal', 'Self-Heal Studio')
          close()
        },
      },
      {
        id: 'self-heal-verify',
        group: 'Panels',
        label: 'Run TypeScript Build Verification',
        hint: 'Verify app compiles cleanly',
        icon: Terminal,
        run: () => {
          openSplit('self_heal', 'Self-Heal Studio')
          void runBuildVerify()
          close()
        },
      },
      {
        id: 'split-reasoning',
        group: 'Panels',
        label: 'Open Reasoning Chain Panel',
        hint: 'Goals, decisions & pivots',
        icon: GitBranch,
        run: () => {
          openSplit('reasoning', 'Reasoning Chain')
          close()
        },
      },
      {
        id: 'split-browser',
        group: 'Panels',
        label: 'Open Live Split Browser',
        hint: 'Playwright autopilot stage',
        icon: Globe,
        run: () => {
          openSplit('browser', 'Live Browser')
          close()
        },
      },
      {
        id: 'split-inbox',
        group: 'Panels',
        label: 'Open Eva Inbox & Identity',
        hint: 'Email & verification codes',
        icon: Mail,
        run: () => {
          openSplit('identity', 'Eva Identity & Inbox')
          close()
        },
      },
      {
        id: 'split-permissions',
        group: 'Panels',
        label: 'Open Permissions Vault',
        hint: 'Capability policies',
        icon: Shield,
        run: () => {
          openSplit('permissions', 'Permissions Vault')
          close()
        },
      },
      {
        id: 'split-devices',
        group: 'Panels',
        label: 'Open Connected Devices',
        hint: 'Local OS bridge & runners',
        icon: Laptop,
        run: () => {
          openSplit('devices', 'Connected Devices')
          close()
        },
      },
      {
        id: 'nav-agent',
        group: 'Workspace',
        label: 'Go to Agent Chat',
        hint: 'Primary command chat',
        icon: Bot,
        run: () => {
          setLayoutMode('standard')
          setTab('agent')
          close()
        },
      },
      {
        id: 'nav-brain',
        group: 'Workspace',
        label: 'Go to Brain Control',
        hint: 'Memory, dreams & coach',
        icon: Brain,
        run: () => {
          setLayoutMode('standard')
          setTab('brain')
          close()
        },
      },
      {
        id: 'nav-org',
        group: 'Workspace',
        label: 'Go to AI Team & Org',
        hint: 'Subagents & roles',
        icon: Users,
        run: () => {
          setLayoutMode('standard')
          setTab('org')
          close()
        },
      },
      {
        id: 'nav-automations',
        group: 'Workspace',
        label: 'Go to Automations',
        hint: 'Scheduled triggers',
        icon: CalendarClock,
        run: () => {
          setLayoutMode('standard')
          setTab('automations')
          close()
        },
      },
      {
        id: 'nav-artifacts',
        group: 'Workspace',
        label: 'Go to Artifacts',
        hint: 'Generated files & outputs',
        icon: FolderOpen,
        run: () => {
          setLayoutMode('standard')
          setTab('artifacts')
          close()
        },
      },
      {
        id: 'toggle-rail',
        group: 'Workspace',
        label: 'Toggle Collapsible Sidebar Rail',
        hint: 'Compact / expanded nav',
        icon: PanelLeft,
        run: () => {
          toggleSidebarCollapsed()
          close()
        },
      },
      {
        id: 'toggle-theme',
        group: 'Workspace',
        label: resolvedTheme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme',
        hint: 'Appearance',
        icon: resolvedTheme === 'light' ? Moon : Sun,
        run: () => {
          setTheme(resolvedTheme === 'light' ? 'dark' : 'light')
          close()
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutMode, voice.isActive, wake.sleepMode, activeConvId, resolvedTheme, brainConnected]
  )

  const visibleItems = useMemo(() => {
    if (brainConnected) return items
    const brainIds = new Set(['gbrain', 'gbrain-audit', 'gbrain-packs', 'nav-brain'])
    return items.filter((item) => !brainIds.has(item.id))
  }, [items, brainConnected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return visibleItems
    return visibleItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q)
    )
  }, [visibleItems, query])

  useEffect(() => {
    setActiveIdx(0)
  }, [query, open])

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [open, onOpenChange])

  const sendDirectToEva = () => {
    const text = query.trim()
    if (!text) return
    setLayoutMode('standard')
    setTab('agent')
    void sendTask(text)
    close()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={close}
          data-command-palette="1"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[14vh] backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    close()
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIdx((i) => Math.min(Math.max(0, filtered.length - 1), i + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIdx((i) => Math.max(0, i - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (filtered[activeIdx]) filtered[activeIdx].run()
                    else sendDirectToEva()
                  }
                }}
                placeholder="Jump to view, open panel, or type a task for Eva…"
                autoFocus
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            <div className="nice-scroll max-h-80 overflow-y-auto p-2">
              {filtered.map((item, idx) => {
                const Icon = item.icon
                const active = idx === activeIdx
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={item.run}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60'
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-sky-500" />
                      <span className="truncate text-xs font-medium text-foreground">{item.label}</span>
                    </span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">{item.hint}</span>
                  </button>
                )
              })}

              {query.trim().length > 0 && (
                <button
                  type="button"
                  onClick={sendDirectToEva}
                  className="mt-1 flex w-full items-center justify-between gap-3 rounded-lg border border-sky-500/30 bg-sky-500/8 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-sky-500/15"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Send className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                    <span className="truncate">Ask Eva: &ldquo;{query.trim()}&rdquo;</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">Enter</span>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
