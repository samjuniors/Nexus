'use client'

import { motion } from 'motion/react'
import { LayoutGrid, MessageSquare, Mic, Smartphone } from 'lucide-react'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { triggerHaptic } from '@/lib/platform/android-bridge'
import { cn } from '@/lib/utils'

type M3NavDest = 'voice' | 'chat' | 'android' | 'more'

/**
 * Material 3 Bottom Navigation Bar for Mobile & Tablet Workspace mode (< lg).
 * Features a tonal animated active indicator pill (64×32px), 48dp+ touch targets,
 * haptic selection pulses, and edge-to-edge safe-area bottom inset padding.
 */
export function MaterialBottomNav() {
  const { activeTab, setTab } = useApp()
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)
  const splitOpen = useEvaControl((s) => s.splitOpen)
  const splitMode = useEvaControl((s) => s.splitMode)
  const openSplit = useEvaControl((s) => s.openSplit)
  const closeSplit = useEvaControl((s) => s.closeSplit)
  const mobileDrawerOpen = useEvaControl((s) => s.mobileDrawerOpen)
  const setMobileDrawerOpen = useEvaControl((s) => s.setMobileDrawerOpen)

  if (layoutMode !== 'standard' || activeTab === 'agent') return null

  const activeDest: M3NavDest = mobileDrawerOpen
    ? 'more'
    : splitOpen && splitMode === 'mobile'
      ? 'android'
      : 'more'

  const items: {
    id: M3NavDest
    label: string
    icon: typeof Mic
    onSelect: () => void
  }[] = [
    {
      id: 'voice',
      label: 'Voice',
      icon: Mic,
      onSelect: () => {
        triggerHaptic('light')
        closeSplit()
        setLayoutMode('focus')
      },
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      onSelect: () => {
        triggerHaptic('selection')
        closeSplit()
        setTab('agent')
      },
    },
    {
      id: 'android',
      label: 'Android',
      icon: Smartphone,
      onSelect: () => {
        triggerHaptic('selection')
        openSplit('mobile', 'Android & Mobile Control')
      },
    },
    {
      id: 'more',
      label: 'More',
      icon: LayoutGrid,
      onSelect: () => {
        triggerHaptic('selection')
        setMobileDrawerOpen(true)
      },
    },
  ]

  return (
    <nav
      aria-label="Material mobile navigation"
      data-mobile-bottom-nav="1"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/75 bg-card/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="grid h-16 grid-cols-4 items-center px-1">
        {items.map(({ id, label, icon: Icon, onSelect }) => {
          const isActive = activeDest === id
          return (
            <button
              key={id}
              type="button"
              data-m3-nav-item={id}
              aria-current={isActive ? 'page' : undefined}
              onClick={onSelect}
              className="group relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 transition-transform active:scale-95"
            >
              <span className="relative flex h-8 w-16 items-center justify-center rounded-full">
                {isActive && (
                  <motion.span
                    layoutId="m3-bottom-nav-pill"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className={cn(
                      'absolute inset-0 rounded-full',
                      id === 'android'
                        ? 'bg-emerald-500/18'
                        : 'bg-sky-500/16'
                    )}
                  />
                )}
                <Icon
                  className={cn(
                    'relative z-10 h-[20px] w-[20px] transition-colors',
                    isActive
                      ? id === 'android'
                        ? 'text-emerald-500'
                        : 'text-sky-500'
                      : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
              </span>
              <span
                className={cn(
                  'text-[11px] leading-none tracking-tight transition-colors',
                  isActive ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
