'use client'

import { useState } from 'react'
import { Server, Trash2, Wrench, Zap } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useApp } from '@/lib/agent/store'
import { api } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

function sourceBadge(source: string) {
  if (source === 'builtin') {
    return <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/[0.04] text-zinc-300">built-in</Badge>
  }
  if (source.startsWith('plugin:')) {
    return (
      <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/[0.1] bg-white/[0.04] text-zinc-300">
        plugin · {source.slice(7)}
      </Badge>
    )
  }
  return <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/5 text-muted-foreground">{source}</Badge>
}

export function ToolsView() {
  const { tools, mcps, refreshTools, refreshPlugins } = useApp()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null)

  const mcpTools = mcps
    .filter((m) => m.status === 'connected' && m.enabled)
    .flatMap((m) => {
      try {
        const defs = JSON.parse(m.toolsJson) as { slug: string; name: string; description: string }[]
        return defs.map((d) => ({ ...d, server: m.name }))
      } catch {
        return []
      }
    })

  const toggle = async (id: string, name: string, enabled: boolean) => {
    setBusyId(id)
    try {
      await api.patchTool(id, enabled)
      await refreshTools()
      toast({ title: enabled ? `Tool armed: ${name}` : `Tool disarmed: ${name}` })
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!confirm) return
    setBusyId(confirm.id)
    const name = confirm.name
    setConfirm(null)
    try {
      await api.deleteTool(confirm.id)
      await refreshTools()
      await refreshPlugins()
      toast({ title: `Tool removed: ${name}` })
    } catch (e) {
      toast({ title: 'Remove failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Tools</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {tools.filter((t) => t.enabled).length + mcpTools.length} armed
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Atomic capabilities the agent can call during missions. Plugin tools appear here once their plugin is
            installed; MCP tools follow their server.
          </p>
        </header>

        <section aria-label="Tool arsenal" className="space-y-3">
          <h2 className="terminal-label text-[10px] text-muted-foreground">{'// arsenal'}</h2>
          <div className="overflow-hidden rounded-xl border border-white/8">
            <div className="hidden sm:grid grid-cols-[1.4fr_2.2fr_1fr_0.7fr_auto_auto] gap-3 border-b border-white/6 bg-black/30 px-4 py-2.5 text-left">
              {['Tool', 'What it does', 'Source', 'Uses', 'Armed', ''].map((h, i) => (
                <span key={i} className="terminal-label text-[9px] text-muted-foreground">{h}</span>
              ))}
            </div>
            {tools.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'grid grid-cols-[1.4fr_2.2fr] sm:grid-cols-[1.4fr_2.2fr_1fr_0.7fr_auto_auto] gap-3 items-center border-b border-white/4 px-4 py-3 last:border-0',
                  !t.enabled && 'opacity-50'
                )}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{t.name}</div>
                  <code className="font-mono text-[10px] text-zinc-300">{t.slug}()</code>
                </div>
                <p className="hidden sm:block text-[12px] text-muted-foreground line-clamp-2">{t.description}</p>
                <div className="hidden sm:block">{sourceBadge(t.source)}</div>
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Zap className="h-3 w-3 text-zinc-400" />{t.usageCount}
                </span>
                <Switch
                  checked={t.enabled}
                  disabled={busyId === t.id}
                  onCheckedChange={(v) => void toggle(t.id, t.name, v)}
                  aria-label={`Toggle ${t.name}`}
                />
                {t.source !== 'builtin' ? (
                  <button
                    className="text-muted-foreground transition-colors hover:text-red-300 disabled:opacity-40"
                    disabled={busyId === t.id}
                    onClick={() => setConfirm({ id: t.id, name: t.name })}
                    aria-label={`Remove ${t.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="w-[18px]" aria-hidden />
                )}
              </div>
            ))}
            {tools.length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">No tools — install plugins first.</p>
            )}
          </div>
        </section>

        <section aria-label="MCP tools" className="space-y-3">
          <h2 className="terminal-label text-[10px] text-muted-foreground">{'// mcp server tools'}</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {mcpTools.map((t) => (
              <div key={t.slug} className="rounded-xl border border-amber-400/15 bg-amber-400/4 p-3.5">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-zinc-400" />
                  <code className="font-mono text-[11.5px] text-zinc-300 truncate">{t.slug}()</code>
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground line-clamp-2">{t.description || 'No description'}</p>
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">exposed by {t.server}</p>
              </div>
            ))}
            {mcpTools.length === 0 && (
              <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                No connected MCP servers — connect one in the MCP Servers tab.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* remove tool confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-white/10 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tool {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent will no longer be able to call this tool. Reinstalling the plugin that provides it will
              bring it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction className="gap-1.5 bg-red-500/90 text-white hover:bg-red-500" onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
