'use client'

import { useState } from 'react'
import { Brain, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApp } from '@/lib/agent/store'
import { api } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'

const TYPE_STYLES: Record<string, string> = {
  fact: 'border-white/[0.1] bg-white/[0.04] text-zinc-300',
  preference: 'border-white/[0.1] bg-white/[0.04] text-zinc-300',
  insight: 'border-white/[0.1] bg-white/[0.04] text-zinc-300',
  note: 'border-white/15 bg-white/5 text-zinc-300',
}

export function MemoryView() {
  const { memories, refreshMemories } = useApp()
  const { toast } = useToast()
  const [content, setContent] = useState('')
  const [type, setType] = useState('note')
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const add = async () => {
    if (!content.trim()) return
    setBusy(true)
    try {
      await api.addMemory(content.trim(), type)
      await refreshMemories()
      setContent('')
      toast({ title: 'Memory stored' })
    } catch (e) {
      toast({ title: 'Failed to save', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api.deleteMemory(id)
      await refreshMemories()
    } catch (e) {
      toast({ title: 'Failed to delete', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    }
  }

  const clearAll = async () => {
    try {
      await api.clearMemories()
      await refreshMemories()
      toast({ title: 'Memory wiped' })
    } catch (e) {
      toast({ title: 'Failed to wipe', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setConfirmClear(false)
    }
  }

  const counts = memories.reduce<Record<string, number>>((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">App Memory</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {memories.length} records
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            The agent saves what it learns about you and your missions — automatically. These memories are injected
            into every future mission. You can also add your own.
          </p>
        </header>

        {/* stats */}
        <div className="flex flex-wrap gap-2">
          {['fact', 'preference', 'insight', 'decision', 'note'].map((t) => (
            <span key={t} className={`rounded-full border px-2.5 py-1 text-[10.5px] font-mono ${TYPE_STYLES[t]}`}>
              {t}: {counts[t] ?? 0}
            </span>
          ))}
        </div>

        {/* add memory */}
        <div className="rounded-xl border border-white/8 bg-black/20 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. I prefer concise answers with bullet points"
              className="flex-1 border-white/10 bg-black/40 text-[13px] focus-visible:ring-primary/40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
              aria-label="New memory content"
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full sm:w-32 border-white/10 bg-black/40 text-xs" aria-label="Memory type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-card">
                {['fact', 'preference', 'insight', 'decision', 'note'].map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="gap-1.5 text-xs" disabled={busy || !content.trim()} onClick={() => void add()}>
              <Plus className="h-3.5 w-3.5" /> Store
            </Button>
          </div>
        </div>

        {/* memory list */}
        <div className="space-y-2">
          {memories.map((m) => (
            <div
              key={m.id}
              className="group flex items-start gap-3 rounded-xl border border-white/8 bg-card px-4 py-3"
            >
              <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${TYPE_STYLES[m.type] ?? TYPE_STYLES.note}`}>
                {m.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed text-zinc-200">{m.content}</p>
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  {m.source === 'agent' ? 'saved by agent' : 'added by you'} · {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                className="mt-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                onClick={() => void remove(m.id)}
                aria-label="Delete memory"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {memories.length === 0 && (
            <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-muted-foreground">
              Memory is empty. Run a mission — the agent will store what it learns here.
            </p>
          )}
        </div>

        {memories.length > 0 && (
          <div className="flex justify-end pb-4">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Wipe all {memories.length} memories?</span>
                <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => void clearAll()}>
                  Yes, wipe
                </Button>
                <Button size="sm" variant="outline" className="h-7 border-white/10 bg-transparent text-xs" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-white/10 bg-transparent text-xs text-muted-foreground hover:text-red-300"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear all memory
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
