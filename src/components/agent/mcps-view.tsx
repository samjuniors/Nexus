'use client'

import { useState } from 'react'
import { Check, Loader2, Plug, PlugZap, Server, Trash2, Zap } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/agent/store'
import { api } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const MCP_TEMPLATE = `{
  "name": "Customer DB",
  "description": "Simulated MCP server for looking up customer records.",
  "tools": [
    { "name": "find_customer", "description": "Find a customer by name or email" },
    { "name": "list_orders", "description": "List recent orders for a customer" }
  ]
}`

export function McpsView() {
  const { mcps, refreshMcps, refreshTools } = useApp()
  const { toast } = useToast()
  const [jsonText, setJsonText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [jsonBusy, setJsonBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null)

  const patch = async (id: string, data: { enabled?: boolean; status?: string }, okMsg: string) => {
    setBusy(id)
    try {
      await api.patchMcp(id, data)
      await refreshMcps()
      await refreshTools()
      toast({ title: okMsg })
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirm) return
    const { id, name } = confirm
    setConfirm(null)
    setBusy(id)
    try {
      await api.deleteMcp(id)
      await refreshMcps()
      await refreshTools()
      toast({ title: `Removed ${name}` })
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const addJson = async () => {
    setJsonBusy(true)
    try {
      const payload = JSON.parse(jsonText) as unknown
      const { server } = await api.addCustomMcp(payload)
      await refreshMcps()
      await refreshTools()
      toast({ title: `Connected ${server.name}`, description: 'Its tools are now available to the agent.' })
      setJsonText('')
    } catch (e) {
      toast({ title: 'Invalid MCP JSON', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setJsonBusy(false)
    }
  }

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">MCP Servers</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {mcps.filter((m) => m.status === 'connected' && m.enabled).length} connected
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Model Context Protocol servers expose tool sets to the agent. Built-in servers run for real; servers
            imported from registries (Smithery, npm, GitHub) or added as JSON are executed by the AI core following
            their published tool definitions.
          </p>
        </header>

        <section aria-label="MCP servers" className="grid gap-3 sm:grid-cols-2">
          {mcps.map((m) => {
            let tools: { slug: string; name: string; description: string }[] = []
            try {
              tools = JSON.parse(m.toolsJson) as typeof tools
            } catch { /* ignore */ }
            const connected = m.status === 'connected' && m.enabled
            return (
              <div
                key={m.id}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  connected ? 'border-amber-400/20 bg-card' : 'border-white/6 bg-black/20 opacity-70'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10">
                      <Server className="h-4.5 w-4.5 text-zinc-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">{m.name}</h3>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-mono',
                            connected
                              ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300/90'
                              : 'border-white/15 bg-white/5 text-muted-foreground'
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400/80' : 'bg-zinc-500')} />
                          {m.status === 'connected' ? 'connected' : 'disconnected'}
                        </span>
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/5 text-muted-foreground">
                          {m.mode === 'builtin'
                            ? 'built-in · real'
                            : m.mode === 'registry'
                              ? 'registry import · ai-simulated'
                              : 'custom · simulated'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Switch
                      checked={m.enabled}
                      disabled={busy === m.id}
                      onCheckedChange={(v) => void patch(m.id, { enabled: v }, `${m.name} ${v ? 'enabled' : 'disabled'}`)}
                      aria-label={`Toggle ${m.name}`}
                    />
                    {m.mode !== 'builtin' && (
                      <button
                        className="text-muted-foreground transition-colors hover:text-red-300 disabled:opacity-40"
                        disabled={busy === m.id}
                        onClick={() => setConfirm({ id: m.id, name: m.name })}
                        aria-label={`Delete ${m.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">{m.description}</p>

                <div className="mt-3 space-y-1.5">
                  {tools.map((t) => (
                    <div key={t.slug} className="rounded-md border border-white/6 bg-black/25 px-2.5 py-1.5">
                      <code className="font-mono text-[11px] text-zinc-300">{t.slug}()</code>
                      <p className="text-[11px] text-muted-foreground line-clamp-1">{t.description}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                    <Zap className="h-3 w-3 text-zinc-400" /> {m.usageCount} calls
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    disabled={busy === m.id}
                    onClick={() =>
                      void patch(
                        m.id,
                        { status: m.status === 'connected' ? 'disconnected' : 'connected' },
                        m.status === 'connected' ? `${m.name} disconnected` : `${m.name} connected`
                      )
                    }
                  >
                    {m.status === 'connected' ? <Plug className="h-3.5 w-3.5" /> : <PlugZap className="h-3.5 w-3.5" />}
                    {m.status === 'connected' ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </div>
            )
          })}
        </section>

        <section aria-label="Add custom MCP server" className="space-y-3">
          <h2 className="terminal-label text-[10px] text-muted-foreground">{'// connect custom server (json)'}</h2>
          <div className="rounded-xl border border-white/8 bg-black/20 p-4">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Register an MCP-style server. Its tools become available to the agent as{' '}
              <code className="text-zinc-300">server.tool()</code> and are executed by the AI core following your
              descriptions.
            </p>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={MCP_TEMPLATE}
              rows={10}
              className="resize-y border-white/10 bg-black/40 font-mono text-[11.5px] focus-visible:ring-primary/40"
              aria-label="Custom MCP JSON"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" className="gap-1.5 text-xs" disabled={jsonBusy || !jsonText.trim()} onClick={() => void addJson()}>
                {jsonBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Connect Server
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-xs"
                onClick={() => setJsonText(MCP_TEMPLATE)}
              >
                Fill template
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* delete confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-white/10 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The server and all of its tools will be disconnected and removed from the agent. You can re-import
              it from the Marketplace anytime.
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
