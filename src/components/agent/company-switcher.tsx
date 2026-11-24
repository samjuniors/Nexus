'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Building2,
  Check,
  ChevronDown,
  Layers,
  Plus,
  ShieldAlert,
} from 'lucide-react'
import { useCompanyStore } from '@/lib/agent/company-store'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

interface CompanySwitcherProps {
  variant?: 'sidebar' | 'topbar'
  collapsed?: boolean
}

export function CompanySwitcher({ variant = 'topbar', collapsed = false }: CompanySwitcherProps) {
  const { setTab } = useApp()
  const layoutMode = useEvaControl((s) => s.layoutMode)
  const setLayoutMode = useEvaControl((s) => s.setLayoutMode)

  const snapshot = useCompanyStore((s) => s.snapshot)
  const refreshCompany = useCompanyStore((s) => s.refreshCompany)
  const switchCompany = useCompanyStore((s) => s.switchCompany)
  const setNewCompanyModalOpen = useCompanyStore((s) => s.setNewCompanyModalOpen)

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!snapshot) {
      void refreshCompany()
    }
  }, [snapshot, refreshCompany])

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const activeCompanyName = snapshot?.company.companyName ?? 'Nexus Company'
  const activeProduct =
    snapshot?.activeProductId
      ? snapshot.products.find((p) => p.id === snapshot.activeProductId) ?? null
      : null
  const pendingApprovals = snapshot?.metrics.totalFounderApprovals ?? 0
  const companies = snapshot?.companies ?? []

  const openCompanyHq = () => {
    if (layoutMode === 'focus') setLayoutMode('standard')
    setTab('company')
    setOpen(false)
  }

  const openNewCompany = () => {
    if (layoutMode === 'focus') setLayoutMode('standard')
    setTab('company')
    setNewCompanyModalOpen(true)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className={cn('relative', variant === 'sidebar' && 'w-full')}>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          title={
            collapsed
              ? `${activeCompanyName}${activeProduct ? ` · ${activeProduct.name}` : ''}`
              : 'Switch active company or product'
          }
          className={cn(
            'flex w-full items-center rounded-lg border border-border/75 bg-background/55 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            collapsed ? 'justify-center py-2' : 'gap-2 px-2.5 py-1.5'
          )}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium leading-tight text-foreground">
                  {activeCompanyName}
                </div>
                <div className="truncate font-mono text-[9.5px] text-muted-foreground">
                  {activeProduct ? activeProduct.name : 'All products'}
                  {pendingApprovals > 0 ? ` · ${pendingApprovals} pending` : ''}
                </div>
              </div>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180'
                )}
              />
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Active Company & Product Context"
          className={cn(
            'inline-flex h-6 max-w-[260px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open
              ? 'border-primary/45 bg-primary/10 text-foreground'
              : 'border-border/70 bg-background/60 text-foreground hover:bg-muted'
          )}
        >
          <Building2 className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate">{activeCompanyName}</span>
          {activeProduct && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="truncate text-muted-foreground">{activeProduct.name}</span>
            </>
          )}
          {pendingApprovals > 0 && (
            <span className="ml-0.5 inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
              {pendingApprovals}
            </span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Company and product switcher"
          className={cn(
            'absolute z-50 mt-1.5 w-[280px] rounded-lg border border-border bg-card p-2 text-foreground shadow-lg',
            variant === 'sidebar' ? 'left-0 top-full' : 'left-0 top-full'
          )}
        >
          <div className="flex items-center justify-between border-b border-border/70 px-2 pb-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Companies ({companies.length})
            </span>
            <button
              type="button"
              onClick={openCompanyHq}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Open HQ
            </button>
          </div>

          <div className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto">
            {companies.map((c) => {
              const isSelectedCompany = c.id === snapshot?.activeCompanyId
              return (
                <div key={c.id} className="space-y-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void switchCompany(c.id, null)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                      isSelectedCompany && !snapshot?.activeProductId
                        ? 'bg-primary/10 font-medium text-foreground'
                        : 'text-foreground/90 hover:bg-muted'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {c.industry} · {c.productCount} prod
                        {c.pendingApprovalsCount > 0 ? ` · ${c.pendingApprovalsCount} pending` : ''}
                      </div>
                    </div>
                    {isSelectedCompany && !snapshot?.activeProductId && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </button>

                  {c.products.length > 0 && (
                    <div className="ml-3 border-l border-border/70 pl-2 space-y-0.5">
                      {c.products.map((p) => {
                        const isSelectedProduct =
                          isSelectedCompany && snapshot?.activeProductId === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              void switchCompany(c.id, p.id)
                              setOpen(false)
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition-colors',
                              isSelectedProduct
                                ? 'bg-primary/10 font-medium text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Layers className="h-3 w-3 shrink-0" />
                              <span className="truncate">{p.name}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[9.5px] uppercase text-muted-foreground">
                              {p.stage}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-2 border-t border-border/70 pt-1.5">
            <button
              type="button"
              onClick={openNewCompany}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New Company Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
