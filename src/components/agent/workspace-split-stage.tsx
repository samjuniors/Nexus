'use client'

import dynamic from 'next/dynamic'
import { motion } from 'motion/react'
import {
  Brain,
  CalendarCheck2,
  CalendarClock,
  FolderOpen,
  GitBranch,
  Globe,
  Laptop,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  Shield,
  ShieldCheck,
  Smartphone,
  Terminal,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import { ReasoningPanel } from '@/components/agent/reasoning-panel'
import { SelfHealPanel } from '@/components/agent/self-heal-panel'
import { LiveBrowserPanel } from '@/components/agent/live-browser-panel'
import { MobileControlPanel } from '@/components/agent/mobile-control-panel'
import { AgentIdentityPanel } from '@/components/agent/agent-identity-panel'
import { PermissionsPanel } from '@/components/agent/permissions-panel'
import { DevicesPanel } from '@/components/agent/devices-panel'
import { GoogleWorkspacePanel } from '@/components/agent/google-workspace-panel'
import { TerminalPanel } from '@/components/agent/terminal-panel'
import { cn } from '@/lib/utils'

function SplitLoader() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

const OrgView = dynamic(() => import('@/components/agent/org-view').then((m) => m.OrgView), {
  loading: () => <SplitLoader />,
})
const ArtifactsView = dynamic(() => import('@/components/agent/artifacts-view').then((m) => m.ArtifactsView), {
  loading: () => <SplitLoader />,
})
const ToolsView = dynamic(() => import('@/components/agent/tools-view').then((m) => m.ToolsView), {
  loading: () => <SplitLoader />,
})
const AutomationsView = dynamic(() => import('@/components/agent/automations-view').then((m) => m.AutomationsView), {
  loading: () => <SplitLoader />,
})
const BrainView = dynamic(() => import('@/components/agent/brain-view').then((m) => m.BrainView), {
  loading: () => <SplitLoader />,
})

const SPLIT_TABS: { mode: SplitMode; label: string; icon: typeof Globe }[] = [
  { mode: 'reasoning', label: 'Reasoning', icon: GitBranch },
  { mode: 'self_heal', label: 'Self-Heal', icon: ShieldCheck },
  { mode: 'browser', label: 'Browser', icon: Globe },
  { mode: 'terminal', label: 'Terminal', icon: Terminal },
  { mode: 'google_workspace', label: 'Google', icon: CalendarCheck2 },
  { mode: 'mobile', label: 'Mobile', icon: Smartphone },
  { mode: 'identity', label: 'Inbox', icon: Mail },
  { mode: 'permissions', label: 'Permissions', icon: Shield },
  { mode: 'devices', label: 'Devices', icon: Laptop },
  { mode: 'org', label: 'Org', icon: Users },
  { mode: 'artifacts', label: 'Artifacts', icon: FolderOpen },
  { mode: 'tools', label: 'Tools', icon: Wrench },
  { mode: 'automations', label: 'Auto', icon: CalendarClock },
  { mode: 'brain', label: 'Brain', icon: Brain },
]

/**
 * Right-hand dynamic resizable split-screen stage driven by Eva or toggled directly by the user.
 */
export function WorkspaceSplitStage({
  expanded = false,
  onToggleExpand,
}: {
  expanded?: boolean
  onToggleExpand?: () => void
}) {
  const splitMode = useEvaControl((s) => s.splitMode)
  const splitTitle = useEvaControl((s) => s.splitTitle)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)

  return (
    <motion.section
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      aria-label={splitTitle || `Split stage: ${splitMode}`}
      data-workspace-split-stage={splitMode}
      className="flex h-full min-h-0 flex-col border-l border-border bg-background"
    >
      {/* Dynamic split mode switcher bar with animated active indicator */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-sidebar px-2.5 py-2">
        <div className="nice-scroll flex min-w-0 items-center gap-1 overflow-x-auto">
          {SPLIT_TABS.map(({ mode, label, icon: Icon }) => {
            const active = splitMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => openSplit(mode)}
                aria-pressed={active}
                className={cn(
                  'relative inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="split-active-pill"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 rounded-md border border-primary/25 bg-primary/10"
                  />
                )}
                <Icon className="relative z-10 h-3.5 w-3.5" />
                <span className="relative z-10">{label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={expanded ? 'Restore split width' : 'Expand split panel'}
              title={expanded ? 'Restore 50/50 split' : 'Expand split panel'}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={closeSplit}
            aria-label="Close split panel"
            title="Close split panel"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Animated split content container */}
      <motion.div
        key={splitMode}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.14 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {splitMode === 'reasoning' && <ReasoningPanel />}
        {splitMode === 'self_heal' && <SelfHealPanel />}
        {splitMode === 'browser' && <LiveBrowserPanel />}
        {splitMode === 'terminal' && <TerminalPanel />}
        {splitMode === 'google_workspace' && <GoogleWorkspacePanel />}
        {splitMode === 'mobile' && <MobileControlPanel />}
        {splitMode === 'identity' && <AgentIdentityPanel />}
        {splitMode === 'permissions' && <PermissionsPanel />}
        {splitMode === 'devices' && <DevicesPanel />}
        {splitMode === 'org' && <OrgView />}
        {splitMode === 'artifacts' && <ArtifactsView />}
        {splitMode === 'tools' && <ToolsView />}
        {splitMode === 'automations' && <AutomationsView />}
        {splitMode === 'brain' && <BrainView />}
      </motion.div>
    </motion.section>
  )
}
