'use client'

import { useState } from 'react'
import {
  Check,
  Download,
  Loader2,
  PackageX,
  Puzzle,
  Store,
  Trash2,
  Zap,
} from 'lucide-react'
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
import { pluginIcon } from '@/components/agent/icons'
import { api } from '@/lib/agent/client'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const JSON_TEMPLATE = `{
  "name": "Sentiment Analyzer",
  "description": "Analyzes the sentiment of any text and returns a score with reasoning.",
  "icon": "sparkles",
  "category": "language",
  "config": {
    "type": "llm",
    "instructions": "You are a sentiment analysis engine. Given text, return sentiment (positive/negative/neutral), a score from -1 to 1, and a one-line reason.",
    "inputHint": "{\\"input\\": \\"text to analyze\\"}"
  }
}`

const HTTP_EXAMPLE = `{
  "name": "My HTTP Service",
  "description": "Calls my own API endpoint as a tool.",
  "config": {
    "type": "http",
    "endpoint": "https://example.com/api/process",
    "inputHint": "{\\"input\\": \\"query\\"}"
  }
}`

export function PluginsView() {
  const { plugins, refreshPlugins, refreshTools, setTab } = useApp()
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonBusy, setJsonBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ id: string; name: string; source: string } | null>(null)

  const installed = plugins.filter((p) => p.installed)
  const marketplace = plugins.filter((p) => !p.installed)

  const patch = async (id: string, data: { installed?: boolean; enabled?: boolean }, okMsg: string) => {
    setBusyId(id)
    try {
      await api.patchPlugin(id, data)
      await refreshPlugins()
      await refreshTools()
      toast({ title: okMsg })
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string, name: string) => {
    setBusyId(id)
    try {
      await api.deletePlugin(id)
      await refreshPlugins()
      await refreshTools()
      toast({ title: `Uninstalled ${name}`, description: 'The plugin and its tool were removed.' })
    } catch (e) {
      toast({ title: 'Uninstall failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const doUninstall = async () => {
    if (!confirm) return
    const { id, name, source } = confirm
    setConfirm(null)
    if (source === 'custom' || source === 'github') {
      await remove(id, name)
    } else {
      // catalog plugin: return it to the marketplace
      await patch(id, { installed: false, enabled: false }, `${name} uninstalled`)
    }
  }

  const installJson = async () => {
    setJsonBusy(true)
    try {
      const payload = JSON.parse(jsonText) as unknown
      const { plugin } = await api.installCustomPlugin(payload)
      await refreshPlugins()
      await refreshTools()
      toast({ title: `Installed ${plugin.name}`, description: 'The agent can now use this plugin as a tool.' })
      setJsonText('')
    } catch (e) {
      toast({
        title: 'Invalid plugin JSON',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setJsonBusy(false)
    }
  }

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 space-y-8">
        {/* header */}
        <header className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Puzzle className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Plugins</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              {installed.length} installed
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Extend the agent with capabilities. Installed plugins arm new tools the agent can pick during missions.
          </p>
        </header>

        {/* installed */}
        <section aria-label="Installed plugins" className="space-y-3">
          <h2 className="terminal-label text-[10px] text-muted-foreground">{'// installed'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {installed.map((p) => {
              const Icon = pluginIcon(p.icon)
              return (
                <div
                  key={p.id}
                  className={cn(
                    'rounded-xl border p-4 transition-colors',
                    p.enabled ? 'border-white/10 bg-card' : 'border-white/6 bg-black/20 opacity-60'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                      <Icon className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-medium">{p.name}</h3>
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/5 text-muted-foreground">
                          {p.category}
                        </Badge>
                        {p.source === 'custom' && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/[0.1] bg-white/[0.04] text-zinc-300">
                            custom
                          </Badge>
                        )}
                        {p.source === 'github' && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-zinc-400/30 bg-zinc-400/10 text-zinc-300">
                            github
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{p.description}</p>
                      <div className="mt-2.5 flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                          <Zap className="h-3 w-3 text-zinc-400" /> {p.usageCount} uses
                        </span>
                        {p.toolSlug && (
                          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            {p.toolSlug}()
                          </code>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Switch
                        checked={p.enabled}
                        disabled={busyId === p.id}
                        onCheckedChange={(v) => void patch(p.id, { enabled: v }, v ? `${p.name} enabled` : `${p.name} disabled`)}
                        aria-label={`Toggle ${p.name}`}
                      />
                      <button
                        className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-red-300 disabled:opacity-40"
                        disabled={busyId === p.id}
                        onClick={() => setConfirm({ id: p.id, name: p.name, source: p.source })}
                        aria-label={`Uninstall ${p.name}`}
                      >
                        <PackageX className="h-3.5 w-3.5" /> uninstall
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {installed.length === 0 && (
              <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                No plugins installed — install from the marketplace below.
              </p>
            )}
          </div>
        </section>

        {/* marketplace (local catalog) */}
        <section aria-label="Plugin catalog" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="terminal-label text-[10px] text-muted-foreground">{'// catalog'}</h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
              onClick={() => setTab('marketplace')}
            >
              <Store className="h-3.5 w-3.5" />
              More sources
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
            {marketplace.map((p) => {
              const Icon = pluginIcon(p.icon)
              return (
                <div key={p.id} className="rounded-xl border border-white/8 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                      <Icon className="h-4.5 w-4.5 text-zinc-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-medium">{p.name}</h3>
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-white/15 bg-white/5 text-muted-foreground">
                          {p.category}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{p.description}</p>
                      {p.toolSlug && (
                        <code className="mt-2 inline-block rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                          +{p.toolSlug}()
                        </code>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary text-xs"
                      disabled={busyId === p.id}
                      onClick={() => void patch(p.id, { installed: true, enabled: true }, `${p.name} installed`)}
                    >
                      {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Install
                    </Button>
                  </div>
                </div>
              )
            })}
            {marketplace.length === 0 && (
              <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                Everything from the catalog is installed — find more in the Marketplace (GitHub, Smithery, npm).
              </p>
            )}
          </div>
        </section>

        {/* custom JSON */}
        <section aria-label="Install custom plugin" className="space-y-3">
          <h2 className="terminal-label text-[10px] text-muted-foreground">{'// install from json'}</h2>
          <div className="rounded-xl border border-white/8 bg-black/20 p-4">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Paste a plugin definition. <code className="text-zinc-300">type: &quot;llm&quot;</code> plugins run on the AI
              core with your instructions; <code className="text-zinc-300">type: &quot;http&quot;</code> plugins POST{' '}
              <code className="text-zinc-300">{'{ input }'}</code> to your endpoint. Skills and MCP servers can be
              installed from the Marketplace.
            </p>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={JSON_TEMPLATE}
              rows={9}
              className="resize-y border-white/10 bg-black/40 font-mono text-[11.5px] focus-visible:ring-primary/40"
              aria-label="Custom plugin JSON"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                disabled={jsonBusy || !jsonText.trim()}
                onClick={() => void installJson()}
              >
                {jsonBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Install Plugin
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-xs"
                onClick={() => setJsonText(JSON_TEMPLATE)}
              >
                LLM template
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 bg-transparent text-xs"
                onClick={() => setJsonText(HTTP_EXAMPLE)}
              >
                HTTP template
              </Button>
            </div>
          </div>
        </section>
      </div>

      {/* uninstall confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-white/10 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.source === 'custom' || confirm?.source === 'github'
                ? 'This plugin and its tool will be permanently removed. You can reinstall it from its JSON definition or GitHub URL.'
                : 'The plugin will be removed from the agent and returned to the catalog — you can reinstall it anytime.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="gap-1.5 bg-red-500/90 text-white hover:bg-red-500"
              onClick={() => void doUninstall()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
