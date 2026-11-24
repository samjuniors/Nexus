'use client'

import { useSyncExternalStore } from 'react'
import {
  Bot,
  Brain,
  Building2,
  CalendarClock,
  ChevronDown,
  Command,
  Focus,
  FolderOpen,
  GitBranch,
  Globe,
  Hexagon,
  Laptop,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
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
} from 'lucide-react'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import { useApp } from '@/lib/agent/store'
import { useCompanyStore } from '@/lib/agent/company-store'
import { CompanySwitcher } from '@/components/agent/company-switcher'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

interface NavItem {
  tab: Tab
  label: string
  icon: typeof Bot
}

const PRIMARY_NAV: NavItem[] = [
  { tab: 'agent', label: 'Agent', icon: Bot },
  { tab: 'company', label: 'Company HQ', icon: Building2 },
  { tab: 'org', label: 'Team & Org', icon: Users },
  { tab: 'automations', label: 'Automations', icon: CalendarClock },
  { tab: 'brain', label: 'Brain', icon: Brain },
  { tab: 'artifacts', label: 'Artifacts', icon: FolderOpen },
  { tab: 'memory', label: 'Memory', icon: Sparkles },
]

const CUSTOMIZE_NAV: NavItem[] = [
  { tab: 'marketplace', label: 'Marketplace', icon: Store },
  { tab: 'plugins', label: 'Plugins', icon: Puzzle },
  { tab: 'skills', label: 'Skills', icon: Sparkles },
  { tab: 'tools', label: 'Tools', icon: Wrench },
  { tab: 'mcps', label: 'MCP Servers', icon: Server },
]

const SPLIT_ACTIONS: { mode: SplitMode; label: string; title: string; icon: typeof Globe }[] = [
  { mode: 'reasoning', label: 'Reasoning', title: 'Reasoning Chain', icon: GitBranch },
  { mode: 'self_heal', label: 'Self-Heal', title: 'Self-Heal Studio', icon: ShieldCheck },
  { mode: 'browser', label: 'Browser', title: 'Live Browser', icon: Globe },
  { mode: 'mobile', label: 'Mobile', title: 'Android & Mobile Control', icon: Smartphone },
  { mode: 'identity', label: 'Inbox', title: 'Eva Email & Identity', icon: Mail },
  { mode: 'permissions', label: 'Permissions', title: 'Permissions Vault', icon: Shield },
  { mode: 'devices', label: 'Devices', title: 'Connected Computers', icon: Laptop },
]

/** localStorage-backed open/closed state for the Extensions group. */
const customizeStore = {
  listeners: new Set<() => void>(),
  get(): boolean {
    try {
      return window.localStorage.getItem('nexus-customize-open') === '1'
    } catch {
      return false
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
  collapsed,
  badge,
  indented,
  onClick,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  badge?: number
  indented?: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      data-eva-target={`nav-${item.tab}`}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={cn(
        'group flex w-full items-center rounded-lg border text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-2',
        !collapsed && indented && 'ml-2.5 w-[calc(100%-0.625rem)] py-1.5 text-[12.5px]',
        active
          ? 'border-primary/25 bg-primary/10 font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  )
}

function SectionHeading({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return <div className="mx-2 my-2 border-t border-border/60" />
  }
  return (
    <div className="px-2.5 pt-3.5 pb-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
    </div>
  )
}

export function Sidebar({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const { activeTab, setTab, plugins, skills, tools, mcps, memories, artifacts, employees, automations, brain } =
    useApp()
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const collapsed = useEvaControl((s) => s.sidebarCollapsed)
  const toggleCollapsed = useEvaControl((s) => s.toggleSidebarCollapsed)
  const setSettingsOpen = useEvaControl((s) => s.setSettingsOpen)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const pendingPermissions = useEvaControl((s) => s.pendingPermissions.length)
  const onlineDevices = useEvaControl((s) => s.onlineDeviceIds.length)
  const reasoningCount = useEvaControl((s) => s.reasoningChains.length)
  const selfHealCount = useEvaControl((s) => s.selfHealSessions.length)

  const customizeOpen = useSyncExternalStore(
    (listener) => customizeStore.subscribe(listener),
    () => customizeStore.get(),
    () => false
  )

  const pendingApprovals = useCompanyStore((s) => s.snapshot?.metrics.totalFounderApprovals ?? 0)
  const brainConnected = brain?.connected ?? true

  const badges: Partial<Record<Tab, number>> = {
    company: pendingApprovals,
    org: employees.filter((e) => e.status === 'active').length,
    automations: automations.filter((a) => a.enabled).length,
    artifacts: artifacts.length,
    plugins: plugins.filter((p) => p.installed).length,
    skills: skills.filter((s) => s.enabled).length,
    tools: tools.filter((t) => t.enabled).length,
    mcps: mcps.filter((m) => m.status === 'connected' && m.enabled).length,
    memory: memories.length,
  }

  const customizeActive = ['marketplace', 'plugins', 'skills', 'tools', 'mcps'].includes(activeTab)

  const handleSelectTab = (tab: Tab) => {
    if (layoutMode === 'focus') setLayoutMode('standard')
    setTab(tab)
  }

  return (
    <aside
      data-sidebar-rail={collapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[60px]' : 'w-[224px]'
      )}
    >
      {/* Brand + Collapse Toggle */}
      <div
        className={cn(
          'flex items-center border-b border-border/60 py-3.5',
          collapsed ? 'flex-col gap-2 px-2' : 'justify-between gap-2 px-3.5'
        )}
      >
        <button
          type="button"
          onClick={() => handleSelectTab('agent')}
          className="flex min-w-0 items-center gap-2.5 text-left"
          title="Nexus Agent OS"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
            <Hexagon className="h-4 w-4 text-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
                Nexus
              </div>
              <div className="truncate font-mono text-[9.5px] text-muted-foreground">
                {brainConnected ? 'overlay active' : 'spine mode'}
              </div>
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={toggleCollapsed}
          data-eva-target="toggle-sidebar"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand navigation rail' : 'Collapse to slim rail'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Active Company & Product Switcher + Instant Voice Focus + Dynamic Command Bar */}
      <div className={cn('space-y-1.5 px-2 pt-2.5 pb-1', !collapsed && 'px-2.5')}>
        <CompanySwitcher variant="sidebar" collapsed={collapsed} />
        {onOpenCommandPalette && (
          <button
            type="button"
            data-eva-target="open-command-palette"
            onClick={onOpenCommandPalette}
            title="Command Bar (⌘K)"
            className={cn(
              'flex w-full items-center rounded-lg border border-border/70 bg-background/40 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-1.5'
            )}
          >
            <Command className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left">Quick command</span>
                <kbd className="font-mono text-[9.5px] text-muted-foreground/80">⌘K</kbd>
              </>
            )}
          </button>
        )}
        <button
          type="button"
          data-eva-target="toggle-voice-focus"
          onClick={() => setLayoutMode(layoutMode === 'focus' ? 'standard' : 'focus')}
          aria-pressed={layoutMode === 'focus'}
          title="Instant Voice Focus mode"
          className={cn(
            'flex w-full items-center rounded-lg border text-[12.5px] font-medium transition-colors',
            collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2',
            layoutMode === 'focus'
              ? 'border-sky-500/40 bg-sky-500/12 text-sky-600 dark:text-sky-400'
              : 'border-border/70 bg-background/50 text-foreground hover:bg-muted'
          )}
        >
          <Focus className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">Voice Focus</span>
              <span className="font-mono text-[9.5px] text-muted-foreground">
                {layoutMode === 'focus' ? 'On' : 'Zen'}
              </span>
            </>
          )}
        </button>
      </div>

        {/* Navigation */}
      <nav className={cn('nice-scroll flex-1 space-y-0.5 overflow-y-auto pb-2', collapsed ? 'px-2' : 'px-2.5')} aria-label="Main navigation">
        <SectionHeading label="Workspace" collapsed={collapsed} />
        {PRIMARY_NAV.filter((item) => brainConnected || (item.tab !== 'brain' && item.tab !== 'memory')).map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            active={layoutMode === 'standard' && activeTab === item.tab}
            collapsed={collapsed}
            badge={badges[item.tab]}
            onClick={() => handleSelectTab(item.tab)}
          />
        ))}

        {/* Extensions collapsible group */}
        <SectionHeading label="Extensions" collapsed={collapsed} />
        {!collapsed && (
          <button
            type="button"
            onClick={() => customizeStore.toggle()}
            aria-expanded={customizeOpen || customizeActive}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors',
              customizeActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', !(customizeOpen || customizeActive) && '-rotate-90')}
            />
            <span className="flex-1 text-left">Capabilities</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {(badges.tools ?? 0) + (badges.plugins ?? 0)}
            </span>
          </button>
        )}
        {(collapsed || customizeOpen || customizeActive) &&
          CUSTOMIZE_NAV.slice(0, collapsed ? 3 : CUSTOMIZE_NAV.length).map((item) => (
            <NavButton
              key={item.tab}
              item={item}
              active={layoutMode === 'standard' && activeTab === item.tab}
              collapsed={collapsed}
              badge={badges[item.tab]}
              indented={!collapsed}
              onClick={() => handleSelectTab(item.tab)}
            />
          ))}

        {/* Split Panels */}
        <SectionHeading label="Panels" collapsed={collapsed} />
        {SPLIT_ACTIONS.map(({ mode, label, title, icon: Icon }) => {
          const active = splitOpen && splitMode === mode
          const count =
            mode === 'permissions'
              ? pendingPermissions
              : mode === 'devices'
                ? onlineDevices
                : mode === 'reasoning'
                  ? reasoningCount
                  : mode === 'self_heal'
                    ? selfHealCount
                    : 0
          return (
            <button
              key={mode}
              type="button"
              data-eva-target={`split-${mode}`}
              onClick={() => (active ? closeSplit() : openSplit(mode, title))}
              aria-pressed={active}
              title={collapsed ? title : undefined}
              aria-label={title}
              className={cn(
                'relative flex w-full items-center rounded-lg border text-[12.5px] transition-colors',
                collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2',
                active
                  ? 'border-sky-500/35 bg-sky-500/10 font-medium text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
              {!collapsed && count > 0 && (
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    mode === 'permissions' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  )}
                >
                  {count}
                </span>
              )}
              {collapsed && mode === 'permissions' && pendingPermissions > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          )
        })}
      </nav>

      {/* Single minimal Settings footer trigger */}
      <div className={cn('border-t border-border/60 p-2', !collapsed && 'p-2.5')}>
        <button
          type="button"
          data-eva-target="open-settings"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open Settings"
          title="Settings"
          className={cn(
            'flex w-full items-center rounded-lg border border-border/70 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            collapsed ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2'
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Settings</span>}
        </button>
      </div>
    </aside>
  )
}
