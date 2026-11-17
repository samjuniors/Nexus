'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  Boxes,
  Check,
  Download,
  ExternalLink,
  FileJson,
  Github,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Store,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useApp } from '@/lib/agent/store'
import { api } from '@/lib/agent/client'
import type {
  CatalogDTO,
  FetchUrlResolutionDTO,
  GithubResolutionDTO,
  NpmPackageDTO,
  SmitheryServerDTO,
} from '@/lib/agent/client'
import { pluginIcon } from '@/components/agent/icons'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type MarketTab = 'featured' | 'github' | 'smithery' | 'npm' | 'paste'

const TABS: { id: MarketTab; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'github', label: 'GitHub' },
  { id: 'smithery', label: 'MCP Registry' },
  { id: 'npm', label: 'npm' },
  { id: 'paste', label: 'JSON / URL' },
]

const GITHUB_EXAMPLES = [
  { label: 'Anthropic agent skills', url: 'https://github.com/anthropics/skills' },
  { label: 'skills.sh repo (vercel-labs)', url: 'https://github.com/vercel-labs/skills' },
  { label: 'MCP servers collection', url: 'https://github.com/modelcontextprotocol/servers' },
  { label: 'Any repo → knowledge skill', url: 'https://github.com/vercel/next.js' },
]

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function MarketplaceView() {
  const { toast } = useToast()
  const { refreshPlugins, refreshSkills, refreshTools, refreshMcps } = useApp()
  const [tab, setTab] = useState<MarketTab>('featured')
  const [installing, setInstalling] = useState<string | null>(null)

  // featured
  const [catalog, setCatalog] = useState<CatalogDTO | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)

  // github
  const [ghUrl, setGhUrl] = useState('')
  const [ghBusy, setGhBusy] = useState(false)
  const [ghResult, setGhResult] = useState<GithubResolutionDTO | null>(null)
  const [ghError, setGhError] = useState('')

  // smithery
  const [smQuery, setSmQuery] = useState('')
  const [smServers, setSmServers] = useState<SmitheryServerDTO[] | null>(null)
  const [smBusy, setSmBusy] = useState(false)
  const [smError, setSmError] = useState('')

  // npm
  const [npmQuery, setNpmQuery] = useState('mcp-server')
  const [npmPkgs, setNpmPkgs] = useState<NpmPackageDTO[] | null>(null)
  const [npmBusy, setNpmBusy] = useState(false)
  const [npmError, setNpmError] = useState('')

  // paste
  const [urlText, setUrlText] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [urlResult, setUrlResult] = useState<FetchUrlResolutionDTO | null>(null)
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteError, setPasteError] = useState('')

  const loadCatalog = useCallback(async () => {
    setCatalogBusy(true)
    try {
      setCatalog(await api.marketplaceCatalog())
    } catch (e) {
      toast({
        title: 'Failed to load catalog',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setCatalogBusy(false)
    }
  }, [toast])

  const loadSmithery = useCallback(
    async (query: string) => {
      setSmBusy(true)
      setSmError('')
      try {
        const { servers } = await api.marketplaceSmithery(query)
        setSmServers(servers)
      } catch (e) {
        setSmError(e instanceof Error ? e.message : String(e))
      } finally {
        setSmBusy(false)
      }
    },
    []
  )

  const loadNpm = useCallback(async (query: string) => {
    setNpmBusy(true)
    setNpmError('')
    try {
      const { packages } = await api.marketplaceNpm(query)
      setNpmPkgs(packages)
    } catch (e) {
      setNpmError(e instanceof Error ? e.message : String(e))
    } finally {
      setNpmBusy(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'featured' && !catalog && !catalogBusy) void loadCatalog()
    if (tab === 'smithery' && smServers === null && !smBusy) void loadSmithery('')
    if (tab === 'npm' && npmPkgs === null && !npmBusy) void loadNpm('mcp-server')
  }, [tab, catalog, catalogBusy, smServers, smBusy, npmPkgs, npmBusy, loadCatalog, loadSmithery, loadNpm])

  // shared install runner
  const runInstall = async (key: string, payload: Parameters<typeof api.marketplaceInstall>[0], doneMsg: string) => {
    setInstalling(key)
    try {
      await api.marketplaceInstall(payload)
      await Promise.all([refreshPlugins(), refreshSkills(), refreshTools(), refreshMcps()])
      toast({ title: doneMsg })
      return true
    } catch (e) {
      toast({
        title: 'Install failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
      return false
    } finally {
      setInstalling(null)
    }
  }

  const resolveGithub = async () => {
    if (!ghUrl.trim()) return
    setGhBusy(true)
    setGhError('')
    setGhResult(null)
    try {
      setGhResult(await api.marketplaceGithub(ghUrl.trim()))
    } catch (e) {
      setGhError(e instanceof Error ? e.message : String(e))
    } finally {
      setGhBusy(false)
    }
  }

  const resolveUrl = async () => {
    if (!urlText.trim()) return
    setPasteBusy(true)
    setPasteError('')
    setUrlResult(null)
    try {
      setUrlResult(await api.marketplaceFetchUrl(urlText.trim()))
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : String(e))
    } finally {
      setPasteBusy(false)
    }
  }

  const installJson = async () => {
    setPasteBusy(true)
    setPasteError('')
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>
      const hasConfig = typeof parsed.config === 'object' && parsed.config !== null
      const isSkill = typeof parsed.prompt === 'string' && parsed.prompt.trim() !== ''
      const isMcp = Array.isArray(parsed.tools)
      const type = hasConfig ? 'plugin' : isSkill ? 'skill' : isMcp ? 'mcp' : null
      if (!type) {
        throw new Error(
          'Unrecognized manifest — expected a "config" object (plugin), a "prompt" field (skill) or a "tools" array (MCP server).'
        )
      }
      const ok = await runInstall('paste-json', { type, payload: parsed }, `Installed ${type}`)
      if (ok) setJsonText('')
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : String(e))
    } finally {
      setPasteBusy(false)
    }
  }

  return (
    <div className="grid-bg h-full overflow-y-auto nice-scroll">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 space-y-6">
        {/* header */}
        <header className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Store className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Marketplace</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              live sources
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Install plugins, skills and MCP servers from real sources — the Smithery MCP registry, the npm
            registry, GitHub repositories, or any https URL serving a manifest.
          </p>
        </header>

        {/* tab strip */}
        <div role="tablist" aria-label="Marketplace sources" className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'shrink-0 rounded-lg border px-3.5 py-2 text-[12px] font-medium transition-colors',
                tab === t.id
                  ? 'border-primary/30 bg-primary/15 text-primary'
                  : 'border-white/8 bg-black/20 text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ------------------------------ FEATURED ------------------------------ */}
        {tab === 'featured' && (
          <div className="space-y-8">
            <section aria-label="Featured plugins" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="terminal-label text-[10px] text-muted-foreground">{'// plugins'}</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
                  disabled={catalogBusy}
                  onClick={() => void loadCatalog()}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', catalogBusy && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {catalog?.plugins.map((p) => {
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
                          className="gap-1.5 border-primary/30 bg-primary/10 text-xs text-primary hover:bg-primary/20 hover:text-primary"
                          disabled={installing === p.id}
                          onClick={async () => {
                            setInstalling(p.id)
                            try {
                              await api.patchPlugin(p.id, { installed: true, enabled: true })
                              await Promise.all([refreshPlugins(), refreshTools()])
                              toast({ title: `${p.name} installed` })
                            } catch (e) {
                              toast({
                                title: 'Install failed',
                                description: e instanceof Error ? e.message : String(e),
                                variant: 'destructive',
                              })
                            } finally {
                              setInstalling(null)
                            }
                          }}
                        >
                          {installing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Install
                        </Button>
                      </div>
                    </div>
                  )
                })}
                {catalog && catalog.plugins.length === 0 && (
                  <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                    Every catalog plugin is installed. Find more in the GitHub, MCP Registry and npm tabs.
                  </p>
                )}
              </div>
            </section>

            <section aria-label="Restorable default skills" className="space-y-3">
              <h2 className="terminal-label text-[10px] text-muted-foreground">{'// default skills (not installed)'}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {catalog?.skills.map((s) => {
                  const Icon = pluginIcon(s.icon)
                  return (
                    <div key={s.slug} className="rounded-xl border border-white/8 bg-black/20 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04]">
                          <Icon className="h-4.5 w-4.5 text-zinc-300" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium">{s.name}</h3>
                          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{s.description}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-white/[0.1] bg-white/[0.04] text-xs text-zinc-300 hover:bg-white/[0.1] hover:text-zinc-100"
                          disabled={installing === s.slug}
                          onClick={() =>
                            void runInstall(
                              s.slug,
                              { type: 'skill', payload: s },
                              `Skill restored: ${s.name}`
                            )
                          }
                        >
                          {installing === s.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Restore
                        </Button>
                      </div>
                    </div>
                  )
                })}
                {catalog && catalog.skills.length === 0 && (
                  <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                    All default skills are installed.
                  </p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ------------------------------ GITHUB ------------------------------ */}
        {tab === 'github' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                Paste a GitHub repository (or a raw file URL). Nexus scans it for{' '}
                <code className="text-zinc-300">plugin.json</code>, <code className="text-zinc-300">skill.json</code>,{' '}
                <code className="text-zinc-300">mcp.json</code>, <code className="text-zinc-300">nexus-*.json</code>{' '}
                and <code className="text-zinc-300">SKILL.md</code> — the agent-skills format used by skills.sh and
                Anthropic&apos;s official skills repo — then previews what it found before installing.
              </p>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void resolveGithub()
                }}
              >
                <div className="relative flex-1">
                  <Github className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={ghUrl}
                    onChange={(e) => setGhUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="border-white/10 bg-black/40 pl-9 text-[13px] focus-visible:ring-primary/40"
                    aria-label="GitHub repository URL"
                  />
                </div>
                <Button type="submit" size="sm" className="gap-1.5 text-xs" disabled={ghBusy || !ghUrl.trim()}>
                  {ghBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Resolve
                </Button>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] text-muted-foreground">Try:</span>
                {GITHUB_EXAMPLES.map((ex) => (
                  <button
                    key={ex.url}
                    onClick={() => setGhUrl(ex.url)}
                    className="rounded border border-white/10 bg-white/4 px-2 py-1 text-[10.5px] text-muted-foreground transition-colors hover:text-zinc-300"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {ghError && (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-[12px] text-red-300" role="alert">
                {ghError}
              </p>
            )}

            {ghResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-card px-4 py-3">
                  <Github className="h-4 w-4 shrink-0 text-zinc-300" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {ghResult.repo.owner}/{ghResult.repo.name}
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">@{ghResult.repo.branch}</span>
                    </div>
                    <p className="truncate text-[11.5px] text-muted-foreground">{ghResult.repo.description}</p>
                  </div>
                  <a
                    href={ghResult.repo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground transition-colors hover:text-primary"
                    aria-label="Open repository on GitHub"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>

                {ghResult.found.map((f) => (
                  <ManifestCard
                    key={f.path}
                    type={f.type}
                    path={f.path}
                    payload={f.payload}
                    installing={installing === `gh-${f.path}`}
                    onInstall={() =>
                      void runInstall(
                        `gh-${f.path}`,
                        { type: f.type, payload: f.payload, origin: { source: 'github', repo: `${ghResult.repo.owner}/${ghResult.repo.name}`, path: f.path } },
                        `Installed ${f.type} from GitHub`
                      )
                    }
                  />
                ))}

                {ghResult.fallback && (
                  <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4">
                    <p className="text-[11.5px] text-zinc-300">{ghResult.fallback.reason}</p>
                    <ManifestCard
                      type={ghResult.fallback.type}
                      payload={ghResult.fallback.payload}
                      installing={installing === 'gh-fallback'}
                      compact
                      onInstall={() =>
                        void runInstall(
                          'gh-fallback',
                          { type: ghResult!.fallback!.type, payload: ghResult!.fallback!.payload, origin: { source: 'github', repo: `${ghResult.repo.owner}/${ghResult.repo.name}` } },
                          'Imported from GitHub'
                        )
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------ SMITHERY ------------------------------ */}
        {tab === 'smithery' && (
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void loadSmithery(smQuery)
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={smQuery}
                  onChange={(e) => setSmQuery(e.target.value)}
                  placeholder="Search the Smithery MCP registry…"
                  className="border-white/10 bg-black/40 pl-9 text-[13px] focus-visible:ring-primary/40"
                  aria-label="Search Smithery registry"
                />
              </div>
              <Button type="submit" size="sm" className="gap-1.5 text-xs" disabled={smBusy}>
                {smBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Live from{' '}
              <a href="https://smithery.ai" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                smithery.ai
              </a>{' '}
              — the MCP server registry. Importing registers the server with its real published tool list; tool
              calls are executed by the AI core following those definitions.
            </p>
            {smError && (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-[12px] text-red-300" role="alert">
                {smError}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {smServers?.map((s) => (
                <div key={s.qualifiedName} className="flex flex-col rounded-xl border border-white/8 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.1] bg-white/[0.04]">
                      {s.iconUrl ? (
                        <img
                          src={s.iconUrl}
                          alt=""
                          className="h-5 w-5 object-contain"
                          onError={(e) => {
                           ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <Server className="h-4.5 w-4.5 text-zinc-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-medium">{s.displayName}</h3>
                        {s.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-label="Verified" />}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {s.description || 'No description'}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                        <span className="font-mono">{s.qualifiedName}</span>
                        <span>· {formatCount(s.useCount)} uses</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/6 pt-3">
                    {s.homepage ? (
                      <a
                        href={s.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
                      >
                        <ExternalLink className="h-3 w-3" /> homepage
                      </a>
                    ) : (
                      <span />
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 border-white/[0.1] bg-white/[0.04] px-2.5 text-[11px] text-zinc-300 hover:bg-white/[0.1] hover:text-zinc-100"
                      disabled={installing === s.qualifiedName}
                      onClick={() =>
                        void runInstall(
                          s.qualifiedName,
                          { type: 'smithery', origin: { qualifiedName: s.qualifiedName } },
                          `${s.displayName} connected`
                        )
                      }
                    >
                      {installing === s.qualifiedName ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Import
                    </Button>
                  </div>
                </div>
              ))}
              {smServers?.length === 0 && !smBusy && (
                <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                  No servers matched “{smQuery}”.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------ NPM ------------------------------ */}
        {tab === 'npm' && (
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void loadNpm(npmQuery)
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={npmQuery}
                  onChange={(e) => setNpmQuery(e.target.value)}
                  placeholder="Search npm packages…"
                  className="border-white/10 bg-black/40 pl-9 text-[13px] focus-visible:ring-primary/40"
                  aria-label="Search npm registry"
                />
              </div>
              <Button type="submit" size="sm" className="gap-1.5 text-xs" disabled={npmBusy}>
                {npmBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Search
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">
              Live from the npm registry. MCP server packages are imported as MCP servers; other packages become
              knowledge skills the agent can draw on.
            </p>
            {npmError && (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-[12px] text-red-300" role="alert">
                {npmError}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {npmPkgs?.map((p) => (
                <div key={p.name} className="flex flex-col rounded-xl border border-white/8 bg-black/20 p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                        p.isMcp ? 'border-white/[0.1] bg-white/[0.04]' : 'border-white/[0.1] bg-white/[0.04]'
                      )}
                    >
                      {p.isMcp ? (
                        <Server className="h-4.5 w-4.5 text-zinc-400" />
                      ) : (
                        <Package className="h-4.5 w-4.5 text-zinc-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="truncate font-mono text-[12.5px] font-medium">{p.name}</h3>
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-4 px-1.5 text-[9px]',
                            p.isMcp
                              ? 'border-white/[0.1] bg-white/[0.04] text-zinc-300'
                              : 'border-white/[0.1] bg-white/[0.04] text-zinc-300'
                          )}
                        >
                          {p.isMcp ? '→ MCP server' : '→ skill'}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {p.description || 'No description'}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                        <span>v{p.version}</span>
                        <span>· {formatCount(p.downloads)} downloads/wk</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end border-t border-white/6 pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary hover:bg-primary/20 hover:text-primary"
                      disabled={installing === p.name}
                      onClick={() =>
                        void runInstall(
                          p.name,
                          {
                            type: 'npm',
                            payload: { name: p.name, description: p.description, version: p.version, keywords: p.keywords },
                            origin: { package: p.name },
                          },
                          `${p.name} imported from npm`
                        )
                      }
                    >
                      {installing === p.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      Install
                    </Button>
                  </div>
                </div>
              ))}
              {npmPkgs?.length === 0 && !npmBusy && (
                <p className="col-span-2 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-muted-foreground">
                  No packages matched “{npmQuery}”.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------ JSON / URL ------------------------------ */}
        {tab === 'paste' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <h2 className="terminal-label mb-3 text-[10px] text-muted-foreground">{'// install from url'}</h2>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void resolveUrl()
                }}
              >
                <div className="relative flex-1">
                  <Link2 className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    placeholder="https://example.com/plugin.json"
                    className="border-white/10 bg-black/40 pl-9 text-[13px] focus-visible:ring-primary/40"
                    aria-label="Manifest URL"
                  />
                </div>
                <Button type="submit" size="sm" className="gap-1.5 text-xs" disabled={pasteBusy || !urlText.trim()}>
                  {pasteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Fetch
                </Button>
              </form>
              {urlResult && (
                <div className="mt-3">
                  <ManifestCard
                    type={urlResult.type}
                    payload={urlResult.payload}
                    installing={installing === 'url'}
                    onInstall={() =>
                      void runInstall(
                        'url',
                        { type: urlResult.type, payload: urlResult.payload, origin: { source: 'url', path: urlText } },
                        `Installed ${urlResult.type} from URL`
                      )
                    }
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <h2 className="terminal-label mb-3 text-[10px] text-muted-foreground">{'// paste manifest json'}</h2>
              <Textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={`{\n  "name": "Sentiment Analyzer",\n  "description": "…",\n  "config": { "type": "llm", "instructions": "…" }\n}`}
                rows={9}
                className="resize-y border-white/10 bg-black/40 font-mono text-[11.5px] focus-visible:ring-primary/40"
                aria-label="Manifest JSON"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" className="gap-1.5 text-xs" disabled={pasteBusy || !jsonText.trim()} onClick={() => void installJson()}>
                  {pasteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Install Manifest
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Detects plugins (<code className="text-zinc-300">config</code>), skills ({' '}
                  <code className="text-zinc-300">prompt</code>) and MCP servers ({' '}
                  <code className="text-zinc-300">tools</code>) automatically.
                </span>
              </div>
            </div>

            {pasteError && (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-[12px] text-red-300" role="alert">
                {pasteError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manifest preview card
// ---------------------------------------------------------------------------

function ManifestCard({
  type,
  payload,
  path,
  installing,
  compact,
  onInstall,
}: {
  type: 'plugin' | 'skill' | 'mcp'
  payload: Record<string, unknown>
  path?: string
  installing: boolean
  compact?: boolean
  onInstall: () => void
}) {
  const meta = {
    plugin: { label: 'plugin', icon: Wrench, cls: 'text-zinc-300 border-white/[0.1] bg-white/[0.04]' },
    skill: { label: 'skill', icon: Sparkles, cls: 'text-zinc-300 border-white/[0.1] bg-white/[0.04]' },
    mcp: { label: 'mcp server', icon: Server, cls: 'text-zinc-300 border-white/[0.1] bg-white/[0.04]' },
  }[type]
  const Icon = meta.icon
  const name = typeof payload.name === 'string' ? payload.name : 'Unnamed'
  const description = typeof payload.description === 'string' ? payload.description : ''
  const tools = Array.isArray(payload.tools) ? (payload.tools as Record<string, unknown>[]).slice(0, 4) : []
  const instructions =
    isRecord(payload.config) && typeof payload.config.instructions === 'string' ? payload.config.instructions : ''
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''

  return (
    <div className={cn('rounded-xl border border-white/10 bg-card p-4', compact && 'mt-2 border-white/8 bg-black/25')}>
      <div className="flex items-start gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', meta.cls)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-medium">{name}</h3>
            <Badge variant="outline" className={cn('h-4 px-1.5 text-[9px]', meta.cls)}>
              {meta.label}
            </Badge>
            {path && <code className="font-mono text-[9.5px] text-muted-foreground/70">{path}</code>}
          </div>
          {description && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
          {(instructions || prompt) && (
            <p className="mt-1.5 line-clamp-2 rounded-md border border-white/6 bg-black/30 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {(instructions || prompt).slice(0, 220)}
            </p>
          )}
          {tools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tools.map((t, i) => (
                <code key={i} className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {String(t.name ?? '?')}()
                </code>
              ))}
              {(payload.tools as unknown[]).length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{(payload.tools as unknown[]).length - 4} more</span>
              )}
            </div>
          )}
        </div>
        <Button size="sm" className="shrink-0 gap-1.5 text-xs" disabled={installing} onClick={onInstall}>
          {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Install
        </Button>
      </div>
    </div>
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
