'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Loader2, Mic, MicOff, Moon, PhoneOff } from 'lucide-react'
import { EvaProvider, useEva } from '@/components/agent/eva-provider'
import { Sidebar } from '@/components/agent/sidebar'
import { ChatView } from '@/components/agent/chat-view'
import { CustomizeTabs } from '@/components/agent/customize-tabs'
import { ViewErrorBoundary } from '@/components/agent/view-error-boundary'
import { WorkspaceSplitStage } from '@/components/agent/workspace-split-stage'
import { VoiceFocusStage } from '@/components/agent/voice-focus-stage'
import { EvaCompanionDock } from '@/components/agent/eva-companion-dock'
import { EvaLiveCursor } from '@/components/agent/eva-live-cursor'
import { PermissionPopup } from '@/components/agent/permission-popup'
import { EvaDynamicPopup } from '@/components/agent/eva-dynamic-popup'
import { GBrainGraph } from '@/components/agent/gbrain-graph'
import { CommandPalette } from '@/components/agent/command-palette'
import { RuntimeHealBanner } from '@/components/agent/runtime-heal-banner'
import { SettingsModal } from '@/components/agent/settings-modal'
import { OsTopBar } from '@/components/agent/os-top-bar'
import { MobileNavDrawer } from '@/components/agent/mobile-nav-drawer'
import { MaterialBottomNav } from '@/components/agent/material-bottom-nav'
import { AndroidRuntimeSync } from '@/components/agent/android-runtime-sync'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import {
  readSavedMobileVoiceFirst,
  shouldStartInVoiceAgentMode,
  useViewportTier,
} from '@/lib/agent/responsive-layout'
import type { Tab } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

function ViewLoader() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

const BrainView = dynamic(() => import('@/components/agent/brain-view').then((m) => m.BrainView), {
  loading: () => <ViewLoader />,
})
const CompanyHqView = dynamic(
  () => import('@/components/agent/company-hq-view').then((m) => m.CompanyHqView),
  {
    loading: () => <ViewLoader />,
  }
)
const OrgView = dynamic(() => import('@/components/agent/org-view').then((m) => m.OrgView), {
  loading: () => <ViewLoader />,
})
const AutomationsView = dynamic(() => import('@/components/agent/automations-view').then((m) => m.AutomationsView), {
  loading: () => <ViewLoader />,
})
const ArtifactsView = dynamic(() => import('@/components/agent/artifacts-view').then((m) => m.ArtifactsView), {
  loading: () => <ViewLoader />,
})
const PluginsView = dynamic(() => import('@/components/agent/plugins-view').then((m) => m.PluginsView), {
  loading: () => <ViewLoader />,
})
const SkillsView = dynamic(() => import('@/components/agent/skills-view').then((m) => m.SkillsView), {
  loading: () => <ViewLoader />,
})
const ToolsView = dynamic(() => import('@/components/agent/tools-view').then((m) => m.ToolsView), {
  loading: () => <ViewLoader />,
})
const McpsView = dynamic(() => import('@/components/agent/mcps-view').then((m) => m.McpsView), {
  loading: () => <ViewLoader />,
})
const MemoryView = dynamic(() => import('@/components/agent/memory-view').then((m) => m.MemoryView), {
  loading: () => <ViewLoader />,
})
const MarketplaceView = dynamic(() => import('@/components/agent/marketplace-view').then((m) => m.MarketplaceView), {
  loading: () => <ViewLoader />,
})

const VIEW_LABELS: Record<Tab, string> = {
  agent: 'Agent',
  company: 'Company HQ',
  org: 'AI Team & Org',
  automations: 'Automations',
  brain: 'Brain',
  artifacts: 'Artifacts',
  marketplace: 'Marketplace',
  plugins: 'Plugins',
  skills: 'Skills',
  tools: 'Tools',
  mcps: 'MCP Servers',
  memory: 'Memory',
}

function EvaLiveDockedBar() {
  const { activeTab, setTab } = useApp()
  const { voice, onToggleSleepMode } = useEva()

  if (!voice.isActive || activeTab === 'agent') return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 pulse-dot" />
        <span className="font-mono text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          Eva Live ({voice.agentState})
        </span>
        {(voice.liveInputTranscript || voice.liveOutputTranscript) && (
          <span className="truncate text-[11.5px] text-muted-foreground">
            {voice.liveOutputTranscript || voice.liveInputTranscript}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTab('agent')}
          className="rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] font-medium hover:bg-muted"
        >
          Open Chat
        </button>
        <button
          type="button"
          onClick={voice.toggleMute}
          aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] hover:bg-muted"
        >
          {voice.muted ? <MicOff className="h-3 w-3 text-amber-400" /> : <Mic className="h-3 w-3" />}
          {voice.muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          onClick={onToggleSleepMode}
          aria-label="Put Eva in Sleep Mode"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-1 text-[11px] hover:bg-muted"
        >
          <Moon className="h-3 w-3" />
          Sleep
        </button>
        <button
          type="button"
          onClick={voice.stopVoice}
          aria-label="End Eva live voice"
          className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[11px] text-destructive-foreground"
        >
          <PhoneOff className="h-3 w-3" />
          End
        </button>
      </div>
    </div>
  )
}

function ShellContent() {
  const { activeTab, setTab, bootstrap, brain } = useApp()
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const setMobileVoiceFirst = useEvaControl((s) => s.setMobileVoiceFirst)
  const gbrainGraphOpen = useEvaControl((s) => s.gbrainGraphOpen)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [splitExpanded, setSplitExpanded] = useState(false)
  const { tier: viewportTier, isCompact } = useViewportTier()
  const initializedViewportRef = useRef(false)

  const brainConnected = brain?.connected ?? true

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // Start phones & tablets directly on the minimal Real Voice Agent first screen
  useEffect(() => {
    if (initializedViewportRef.current || typeof window === 'undefined') return
    initializedViewportRef.current = true
    const savedVoiceFirst = readSavedMobileVoiceFirst()
    if (!savedVoiceFirst) {
      setMobileVoiceFirst(false)
    }
    const params = new URLSearchParams(window.location.search)
    if (
      shouldStartInVoiceAgentMode({
        width: window.innerWidth,
        mobileVoiceFirstEnabled: savedVoiceFirst,
        queryView: params.get('view'),
      })
    ) {
      setLayoutMode('focus')
    }
  }, [setLayoutMode, setMobileVoiceFirst])

  // Portable Brain auto-detach: automatically leave Brain/Memory views and close GBrain overlay
  useEffect(() => {
    if (!brainConnected) {
      if (activeTab === 'brain' || activeTab === 'memory') {
        setTab('agent')
      }
      if (gbrainGraphOpen) {
        setGbrainGraphOpen(false)
      }
    }
  }, [brainConnected, activeTab, setTab, gbrainGraphOpen, setGbrainGraphOpen])

  const primaryWorkspace =
    layoutMode === 'focus' ? (
      <VoiceFocusStage onOpenCommandPalette={() => setPaletteOpen(true)} />
    ) : (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <EvaLiveDockedBar />
        <CustomizeTabs />
        <ViewErrorBoundary
          key={activeTab}
          viewName={VIEW_LABELS[activeTab]}
          resetKey={activeTab}
          onReturnHome={activeTab !== 'agent' ? () => setTab('agent') : undefined}
        >
          {activeTab === 'agent' && <ChatView />}
          {activeTab === 'company' && <CompanyHqView />}
          {activeTab === 'org' && <OrgView />}
          {activeTab === 'automations' && <AutomationsView />}
          {brainConnected && activeTab === 'brain' && <BrainView />}
          {activeTab === 'artifacts' && <ArtifactsView />}
          {activeTab === 'marketplace' && <MarketplaceView />}
          {activeTab === 'plugins' && <PluginsView />}
          {activeTab === 'skills' && <SkillsView />}
          {activeTab === 'tools' && <ToolsView />}
          {activeTab === 'mcps' && <McpsView />}
          {brainConnected && activeTab === 'memory' && <MemoryView />}
        </ViewErrorBoundary>
      </div>
    )

  return (
    <div
      data-viewport-tier={viewportTier}
      data-layout-mode={layoutMode}
      className="flex h-dvh overflow-hidden bg-background text-foreground"
    >
      <Sidebar onOpenCommandPalette={() => setPaletteOpen(true)} />

      <main
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col lg:pb-0',
          layoutMode === 'standard' && activeTab !== 'agent'
            ? 'pb-[calc(4rem+env(safe-area-inset-bottom))]'
            : 'pb-0'
        )}
      >
        <OsTopBar onOpenCommandPalette={() => setPaletteOpen(true)} />
        {splitOpen && !isCompact ? (
          <PanelGroup
            key={splitExpanded ? 'wide' : 'balanced'}
            direction="horizontal"
            className="min-h-0 flex-1"
          >
            <Panel
              defaultSize={splitExpanded ? 32 : 54}
              minSize={24}
              className="flex min-h-0 min-w-0 flex-col"
            >
              {primaryWorkspace}
            </Panel>
            <PanelResizeHandle
              aria-label="Resize split workspace"
              className="w-1.5 cursor-col-resize bg-border/60 transition-colors hover:bg-sky-400/60 active:bg-sky-400"
            />
            <Panel
              defaultSize={splitExpanded ? 68 : 46}
              minSize={28}
              className="flex min-h-0 min-w-0 flex-col"
            >
              <WorkspaceSplitStage
                expanded={splitExpanded}
                onToggleExpand={() => setSplitExpanded((v) => !v)}
              />
            </Panel>
          </PanelGroup>
        ) : (
          primaryWorkspace
        )}
      </main>

      {/* Mobile & Tablet full-height split stage overlay (Android Takeover, Live Browser, Devices, etc.) */}
      {splitOpen && isCompact && (
        <div
          data-mobile-split-sheet="1"
          className="fixed inset-0 z-40 flex flex-col bg-background lg:hidden"
        >
          <WorkspaceSplitStage />
        </div>
      )}

      {/* Slide-over navigation drawer for Mobile & Tablet (< lg) */}
      <MobileNavDrawer />

      {/* Borderless Floating Companion (Desktop), Settings Modal, Dynamic Popups, Command Palette (⌘K), Permission Prompt, Live AI Cursor, and Portable GBrain Graph */}
      <EvaCompanionDock />
      <SettingsModal />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <EvaDynamicPopup />
      <PermissionPopup />
      <EvaLiveCursor />
      <RuntimeHealBanner />
      {brainConnected && <GBrainGraph open={gbrainGraphOpen} onOpenChange={setGbrainGraphOpen} />}

      {/* Android APK / Web / Desktop Bridge Coordinator (Foreground Voice, Haptics, Back Gesture, Offline Pill) */}
      <AndroidRuntimeSync paletteOpen={paletteOpen} setPaletteOpen={setPaletteOpen} />

      {/* Material 3 Navigation Bar with tonal pill indicator — ONLY in Mobile/Tablet Workspace mode */}
      <MaterialBottomNav />
    </div>
  )
}

export default function Home() {
  return (
    <EvaProvider>
      <ShellContent />
    </EvaProvider>
  )
}
