'use client'

import { create } from 'zustand'
import type { CompanyHqSnapshotDTO } from '@/lib/agent/company-types'

interface CompanyStoreState {
  snapshot: CompanyHqSnapshotDTO | null
  loading: boolean
  busy: boolean
  error: string | null
  /** Opens the "New Company" modal in Company HQ from anywhere (e.g., top bar / sidebar switcher) */
  newCompanyModalOpen: boolean
  setNewCompanyModalOpen: (open: boolean) => void
  refreshCompany: (opts?: { companyId?: string; productId?: string | null }) => Promise<CompanyHqSnapshotDTO | null>
  runCompanyAction: (
    payload: Record<string, unknown>
  ) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>
  switchCompany: (companyId: string, productId?: string | null) => Promise<void>
}

export const useCompanyStore = create<CompanyStoreState>((set, get) => ({
  snapshot: null,
  loading: false,
  busy: false,
  error: null,
  newCompanyModalOpen: false,

  setNewCompanyModalOpen: (open) => set({ newCompanyModalOpen: open }),

  refreshCompany: async (opts) => {
    set({ loading: !get().snapshot, error: null })
    try {
      const params = new URLSearchParams()
      if (opts?.companyId) params.set('companyId', opts.companyId)
      if (opts?.productId !== undefined) params.set('productId', opts.productId ?? '')
      const qs = params.toString()
      const res = await fetch(`/api/company${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `Failed to load company (${res.status})`)
      }
      const data = (await res.json()) as CompanyHqSnapshotDTO
      set({ snapshot: data, loading: false, error: null })
      return data
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load company HQ'
      set({ loading: false, error: msg })
      return null
    }
  },

  runCompanyAction: async (payload) => {
    set({ busy: true, error: null })
    try {
      const res = await fetch('/api/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const errMsg = typeof data.error === 'string' ? data.error : `Action failed (${res.status})`
        set({ busy: false, error: errMsg })
        return { ok: false, error: errMsg }
      }
      const nextSnap = (data.snapshot ?? (data.company && data.metrics ? data : null)) as
        | CompanyHqSnapshotDTO
        | null
      if (nextSnap) {
        set({ snapshot: nextSnap, busy: false, error: null })
      } else {
        set({ busy: false, error: null })
      }
      return { ok: true, data }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Network error'
      set({ busy: false, error: errMsg })
      return { ok: false, error: errMsg }
    }
  },

  switchCompany: async (companyId, productId) => {
    await get().runCompanyAction({
      action: 'switch_company',
      companyId,
      productId: productId === undefined ? null : productId,
    })
  },
}))
