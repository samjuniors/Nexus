'use client'

import { useState } from 'react'
import {
  Bot,
  Brain,
  CalendarClock,
  Download,
  Focus,
  FolderOpen,
  GitBranch,
  Globe,
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
} from 'lucide-react'
import { MaterialBottomSheet } from '@/components/agent/material-bottom-sheet'
import { useApp } from '@/lib/agent/store'
import { useEvaControl, type SplitMode } from '@/lib/agent/eva-control-store'
import type { Tab } from '@/lib/agent/client'
import {
  detectPlatformInfo,
  openAndroidServerPicker,
  triggerHaptic,
} from '@/lib/platform/android-bridge'
import { usePWAInstall } from '@/lib/platform/use-pwa-install'
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
  { mode: 'mobile', label: 'Android Control', title: 'Android & Mobile Control', icon: Smartphone },
  { mode: 'browser', label: 'Live Browser', title: 'Live Browser', icon: Globe },
  { mode: 'devices', label: 'Devices', title: 'Connected Computers & Phones', icon: Laptop },
  { mode: 'self_heal', label: 'Self-Heal', title: 'Self-Heal Studio', icon: ShieldCheck },
  { mode: 'reasoning', label: 'Reasoning', title: 'Reasoning Chain', icon: GitBranch },
  { mode: 'permissions', label: 'Permissions', title: 'Permissions Vault', icon: Shield },
  { mode: 'identity', label: 'Eva Inbox', title: 'Eva Email & Identity', icon: Mail },
]

/**
 * Material 3 Swipeable More / Workspace Bottom Sheet for Android, Mobile & Tablet (< lg).
 * Replaces the rigid side drawer with ergonomic thumb-zone cards, 48dp+ touch targets,
 * haptic feedback, native Android Server Picker shortcut, and PWA Install CTA.
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

  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall()
  const [iosGuideOpen, setIosGuideOpen] = useState(false)

  const platform = detectPlatformInfo()
  const brainConnected = brain?.connected ?? true

  const goVoiceAgent = () => {
    triggerHaptic('light')
    closeSplit()
    setLayoutMode('focus')
    setOpen(false)
  }

  const goTab = (tab: Tab) => {
    triggerHaptic('selection')
    closeSplit()
    setLayoutMode('standard')
    setTab(tab)
    setOpen(false)
  }

  const goPanel = (mode: SplitMode, title: string) => {
    triggerHaptic('selection')
    openSplit(mode, title)
    setOpen(false)
  }

  const handleInstallClick = async () => {
    triggerHaptic('light')
    if (canInstall) {
      await promptInstall()
      setOpen(false)
    } else if (isIOS) {
      setIosGuideOpen((v) => !v)
    }
  }

  return (
    <MaterialBottomSheet
      open={open}
      onOpenChange={setOpen}
      title="Nexus Eva"
      subtitle={`${platform.label} · Workspace & Device Tools`}
      dataAttr="mobile-nav"
    >
      <div data-mobile-nav-drawer="1" className="space-y-5 px-4 pt-3 pb-2">
        {/* Primary Thumb-Zone Quick Actions */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={goVoiceAgent}
            className={cn(
              'flex min-h-[52px] items-center gap-3 rounded-2xl border px-3.5 text-left text-[13.5px] font-medium transition-colors active:scale-[0.98]',
              layoutMode === 'focus'
                ? 'border-sky-500/45 bg-sky-500/14 text-sky-600 dark:text-sky-400'
                : 'border-border/75 bg-background/65 text-foreground hover:bg-muted'
            )}
          >
            <Focus className="h-5 w-5 shrink-0" />
            <span className="truncate">Voice Agent</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic('selection')
              setOpen(false)
              setSettingsOpen(true)
            }}
            className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-border/75 bg-background/65 px-3.5 text-left text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
          >
            <Settings className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="truncate">Settings</span>
          </button>
        </div>

        {/* Native Android APK Server Picker OR Web PWA Install CTA */}
        {platform.isAndroidApk ? (
          <button
            type="button"
            data-android-server-picker-btn="1"
            onClick={() => {
              setOpen(false)
              openAndroidServerPicker()
            }}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl border border-sky-500/35 bg-sky-500/10 px-4 text-left transition-colors hover:bg-sky-500/15 active:scale-[0.99]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Server className="h-5 w-5 shrink-0 text-sky-500" />
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-foreground">Switch Server URL</div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {platform.serverUrl || 'Cloud, Wi-Fi LAN, or USB ADB'}
                </div>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-sky-500/18 px-2.5 py-1 text-[11px] font-medium text-sky-500">
              APK
            </span>
          </button>
        ) : (
          !isInstalled &&
          (canInstall || isIOS) && (
            <div className="space-y-2">
              <button
                type="button"
                data-pwa-install-btn="1"
                onClick={() => void handleInstallClick()}
                className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl border border-sky-500/35 bg-sky-500/10 px-4 text-left transition-colors hover:bg-sky-500/15 active:scale-[0.99]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Download className="h-5 w-5 shrink-0 text-sky-500" />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-foreground">Install Nexus Eva App</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      Add to home screen for full-screen mobile experience
                    </div>
                  </div>
                </div>
              </button>
              {iosGuideOpen && (
                <p className="rounded-xl border border-border/70 bg-muted/40 px-3.5 py-2.5 text-[12px] text-muted-foreground">
                  In Safari, tap the <strong>Share</strong> button and choose{' '}
                  <strong>Add to Home Screen</strong>.
                </p>
              )}
            </div>
          )
        )}

        {/* Takeover & Live Tools — 2-column Material 3 cards */}
        <div>
          <div className="mb-2 px-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Takeover &amp; Live Tools
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TAKEOVER_PANELS.map(({ mode, label, title, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => goPanel(mode, title)}
                className="flex min-h-[48px] items-center gap-2.5 rounded-2xl border border-border/65 bg-background/55 px-3 text-left text-[13px] font-medium text-foreground/95 transition-colors hover:bg-muted active:scale-[0.98]"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </button>
            ))}
            {brainConnected && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('selection')
                  setOpen(false)
                  setGbrainGraphOpen(true)
                }}
                className="flex min-h-[48px] items-center gap-2.5 rounded-2xl border border-border/65 bg-background/55 px-3 text-left text-[13px] font-medium text-foreground/95 transition-colors hover:bg-muted active:scale-[0.98]"
              >
                <Network className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">GBrain Graph</span>
              </button>
            )}
          </div>
        </div>

        {/* Workspace Views — Material 3 list rows */}
        <div>
          <div className="mb-2 px-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
          <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-background/55">
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
                    'flex min-h-[50px] w-full items-center gap-3.5 px-4 text-left text-[14px] transition-colors active:bg-muted/80',
                    active
                      ? 'bg-sky-500/12 font-semibold text-foreground'
                      : 'text-foreground/85 hover:bg-muted/60'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0',
                      active ? 'text-sky-500' : 'text-muted-foreground'
                    )}
                  />
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </MaterialBottomSheet>
  )
}
