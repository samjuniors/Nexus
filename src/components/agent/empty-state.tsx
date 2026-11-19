'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateGuideStep {
  title: string
  detail: string
}

interface EmptyStateProps {
  icon: LucideIcon
  eyebrow?: string
  title: string
  description: string
  steps?: EmptyStateGuideStep[]
  actions?: ReactNode
  className?: string
}

/**
 * Shared empty-state module for workspace views.
 * Presents a concise status summary, optional step-by-step guide, and
 * primary "Get Started" actions without decorative clutter.
 */
export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  description,
  steps,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-7 sm:px-7',
        className
      )}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
          <Icon className="h-5 w-5 text-zinc-300" aria-hidden />
        </div>

        {eyebrow && (
          <span className="terminal-label mt-3 text-[9px] text-muted-foreground/70">
            {eyebrow}
          </span>
        )}

        <h2 className="mt-1.5 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1.5 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </p>

        {actions && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}

        {steps && steps.length > 0 && (
          <ol
            aria-label="Getting started guide"
            className={cn(
              'mt-6 grid w-full gap-2.5 text-left',
              steps.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
            )}
          >
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-lg border border-white/[0.06] bg-black/25 px-3.5 py-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-primary/90">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[12px] font-medium text-zinc-200">{step.title}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {step.detail}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
