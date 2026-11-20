'use client'

import { useEffect } from 'react'
import { Drawer } from 'vaul'
import { X } from 'lucide-react'
import { registerBackHandler, triggerHaptic } from '@/lib/platform/android-bridge'
import { cn } from '@/lib/utils'

interface MaterialBottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  dataAttr?: string
  className?: string
  maxHeightClass?: string
  children: React.ReactNode
}

/**
 * Material 3 Swipeable Bottom Sheet for Android & Mobile viewports (< lg).
 * Features a 36×4px centered drag handle, rounded 28px top corners, safe-area padding,
 * tactile haptic close feedback, and automatic Android hardware Back gesture dismissal.
 */
export function MaterialBottomSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  dataAttr,
  className,
  maxHeightClass = 'max-h-[86dvh]',
  children,
}: MaterialBottomSheetProps) {
  useEffect(() => {
    if (!open) return
    return registerBackHandler(() => {
      onOpenChange(false)
      return true
    }, 80)
  }, [open, onOpenChange])

  const handleOpenChange = (next: boolean) => {
    if (!next) triggerHaptic('selection')
    onOpenChange(next)
  }

  return (
    <Drawer.Root open={open} onOpenChange={handleOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] lg:hidden" />
        <Drawer.Content
          data-material-bottom-sheet={dataAttr || '1'}
          aria-label={title}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[28px] border-t border-border/80 bg-card text-foreground shadow-2xl outline-none lg:hidden',
            maxHeightClass,
            className
          )}
        >
          {/* Material 3 Drag Handle */}
          <div className="flex shrink-0 flex-col items-center pt-3 pb-1">
            <div className="h-1 w-9 rounded-full bg-muted-foreground/35" aria-hidden />
          </div>

          {/* Sheet Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 pt-1.5 pb-3">
            <div className="min-w-0 pr-3">
              <Drawer.Title className="truncate text-[16px] font-semibold tracking-tight text-foreground">
                {title}
              </Drawer.Title>
              {subtitle && (
                <Drawer.Description className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {subtitle}
                </Drawer.Description>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              aria-label={`Close ${title}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="nice-scroll flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
