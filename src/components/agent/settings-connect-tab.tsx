'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComposioState {
  configured: boolean
  enabled: boolean
  hasApiKey: boolean
  apiKeyMasked: string | null
  mcpUrl: string
  userId: string
  toolkits: string[]
  updatedAt: string | null
}

interface ConnectedHttpService {
  id: string
  kind: 'http'
  slug: string
  toolSlug: string | null
  name: string
  description: string
  category: string
  enabled: boolean
  endpoint: string
  authHeaderName: string
  hasAuthSecret: boolean
  authSecretMasked: string | null
  usageCount: number
}

interface ConnectedMcpService {
  id: string
  kind: 'mcp'
  slug: string
  name: string
  description: string
  mode: string
  status: string
  enabled: boolean
  endpoint: string
  authHeaderName: string
  hasAuthSecret: boolean
  authSecretMasked: string | null
  tools: { slug: string; name: string; description: string }[]
  usageCount: number
}

const COMPOSIO_TOOLKIT_PRESETS = [
  'gmail',
  'slack',
  'github',
  'notion',
  'linear',
  'stripe',
  'googlecalendar',
  'hubspot',
]

/**
 * Settings > Connect tab: configure Composio (API key or MCP URL) and manually
 * connect any external HTTP API/webhook or remote MCP server for Eva & company agents.
 */
export function SettingsConnectTab() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const [composio, setComposio] = useState<ComposioState | null>(null)
  const [composioApiKey, setComposioApiKey] = useState('')
  const [composioMcpUrl, setComposioMcpUrl] = useState('')
  const [composioUserId, setComposioUserId] = useState('default')
  const [composioToolkits, setComposioToolkits] = useState<string[]>([])
  const [customToolkitInput, setCustomToolkitInput] = useState('')

  const [services, setServices] = useState<ConnectedHttpService[]>([])
  const [mcps, setMcps] = useState<ConnectedMcpService[]>([])

  // Manual "Connect Any Service" form
  const [showAddForm, setShowAddForm] = useState(false)
  const [svcKind, setSvcKind] = useState<'http' | 'mcp'>('http')
  const [svcName, setSvcName] = useState('')
  const [svcEndpoint, setSvcEndpoint] = useState('')
  const [svcAuthHeader, setSvcAuthHeader] = useState('Authorization')
  const [svcAuthSecret, setSvcAuthSecret] = useState('')
  const [svcDescription, setSvcDescription] = useState('')
  const [svcTools, setSvcTools] = useState('')

  const applySnapshot = useCallback(
    (data: {
      composio?: ComposioState
      services?: ConnectedHttpService[]
      mcps?: ConnectedMcpService[]
    }) => {
      if (data.composio) {
        setComposio(data.composio)
        setComposioMcpUrl(data.composio.mcpUrl ?? '')
        setComposioUserId(data.composio.userId ?? 'default')
        setComposioToolkits(data.composio.toolkits ?? [])
      }
      if (Array.isArray(data.services)) setServices(data.services)
      if (Array.isArray(data.mcps)) setMcps(data.mcps)
    },
    []
  )

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/connect', { cache: 'no-store' })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        composio?: ComposioState
        services?: ConnectedHttpService[]
        mcps?: ConnectedMcpService[]
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      applySnapshot(data)
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Failed to load connections' })
    } finally {
      setLoading(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    void fetchConnections()
  }, [fetchConnections])

  const postConnect = async (payload: Record<string, unknown>, successText?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        message?: string
        composio?: ComposioState
        services?: ConnectedHttpService[]
        mcps?: ConnectedMcpService[]
      }
      if (!res.ok || !data.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
      applySnapshot(data)
      if (data.message || successText) {
        setNotice({ ok: true, text: data.message ?? successText ?? 'Saved.' })
      }
      return true
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Action failed' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggleToolkit = (slug: string) => {
    setComposioToolkits((prev) =>
      prev.includes(slug) ? prev.filter((item) => item !== slug) : [...prev, slug]
    )
  }

  const handleSaveComposio = async (e: React.FormEvent) => {
    e.preventDefault()
    const extra = customToolkitInput
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const mergedToolkits = Array.from(new Set([...composioToolkits, ...extra]))
    const ok = await postConnect(
      {
        action: 'save_composio',
        apiKey: composioApiKey.trim() || undefined,
        mcpUrl: composioMcpUrl.trim(),
        userId: composioUserId.trim() || 'default',
        toolkits: mergedToolkits,
        enabled: true,
      },
      'Composio configuration saved — Eva and company agents can now use Composio tools.'
    )
    if (ok) {
      setComposioApiKey('')
      setCustomToolkitInput('')
    }
  }

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await postConnect(
      {
        action: 'add_service',
        kind: svcKind,
        name: svcName.trim(),
        endpoint: svcEndpoint.trim(),
        authHeaderName: svcAuthSecret.trim() ? svcAuthHeader.trim() : undefined,
        authHeaderValue: svcAuthSecret.trim() || undefined,
        description: svcDescription.trim() || undefined,
        tools: svcKind === 'mcp' && svcTools.trim() ? svcTools.trim() : undefined,
      },
      `Connected ${svcName.trim()} (${svcKind.toUpperCase()}).`
    )
    if (ok) {
      setSvcName('')
      setSvcEndpoint('')
      setSvcAuthSecret('')
      setSvcDescription('')
      setSvcTools('')
      setShowAddForm(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading connected services…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            notice.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          )}
        >
          {notice.text}
        </div>
      )}

      {/* Composio Integration Card */}
      <section className="rounded-xl border border-border/80 bg-background/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Composio (250+ Apps)
              </h3>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                  composio?.configured && composio.enabled
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : composio?.configured
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {composio?.configured && composio.enabled
                  ? 'Connected'
                  : composio?.configured
                    ? 'Paused'
                    : 'Not Configured'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Connect your Composio Project API key or Composio MCP URL so Eva &amp; Company agents can
              discover and run Gmail, Slack, GitHub, Notion, Stripe, and other connected tools.
            </p>
          </div>
          {composio?.configured && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void postConnect({ action: 'disconnect_composio' }, 'Composio disconnected.')}
              className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              Disconnect
            </button>
          )}
        </div>

        <form onSubmit={(e) => void handleSaveComposio(e)} className="mt-3.5 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="composio-api-key" className="block text-[11px] font-medium text-foreground">
                Composio API Key
              </label>
              <input
                id="composio-api-key"
                type="password"
                autoComplete="off"
                value={composioApiKey}
                onChange={(e) => setComposioApiKey(e.target.value)}
                placeholder={
                  composio?.apiKeyMasked
                    ? `Stored (${composio.apiKeyMasked}) — paste to replace`
                    : 'ak_... (stored server-side only)'
                }
                className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
              />
            </div>

            <div>
              <label htmlFor="composio-user-id" className="block text-[11px] font-medium text-foreground">
                Entity / User ID
              </label>
              <input
                id="composio-user-id"
                type="text"
                value={composioUserId}
                onChange={(e) => setComposioUserId(e.target.value)}
                placeholder="default"
                className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
              />
            </div>
          </div>

          <div>
            <label htmlFor="composio-mcp-url" className="block text-[11px] font-medium text-foreground">
              Composio MCP URL <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="composio-mcp-url"
              type="url"
              value={composioMcpUrl}
              onChange={(e) => setComposioMcpUrl(e.target.value)}
              placeholder="https://mcp.composio.dev/..."
              className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
            />
          </div>

          <div>
            <span className="block text-[11px] font-medium text-foreground">
              Preferred Toolkits <span className="text-muted-foreground">(optional tags)</span>
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {COMPOSIO_TOOLKIT_PRESETS.map((slug) => {
                const active = composioToolkits.includes(slug)
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => toggleToolkit(slug)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-md border px-2 py-0.5 font-mono text-[10.5px] transition-colors',
                      active
                        ? 'border-sky-500/50 bg-sky-500/15 text-sky-600 dark:text-sky-300'
                        : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {slug}
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              value={customToolkitInput}
              onChange={(e) => setCustomToolkitInput(e.target.value)}
              placeholder="Add more toolkits comma-separated (e.g. airtable, figma)"
              aria-label="Additional Composio toolkits"
              className="mt-2 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Save Composio
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void postConnect({
                  action: 'test_composio',
                  apiKey: composioApiKey.trim() || undefined,
                  mcpUrl: composioMcpUrl.trim() || undefined,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Test Connection
            </button>
          </div>
        </form>
      </section>

      {/* Manual Custom Service / MCP Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connected Services &amp; Remote MCPs
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Manually attach any REST webhook, external API, or remote MCP server for Eva to use.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            {showAddForm ? 'Cancel' : 'Add Service'}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={(e) => void handleAddService(e)}
            className="space-y-3 rounded-xl border border-border bg-background/80 p-3.5"
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSvcKind('http')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  svcKind === 'http'
                    ? 'border-sky-500/50 bg-sky-500/12 text-sky-600 dark:text-sky-300'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <Plug className="h-3.5 w-3.5" />
                HTTP / REST Webhook
              </button>
              <button
                type="button"
                onClick={() => setSvcKind('mcp')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  svcKind === 'mcp'
                    ? 'border-sky-500/50 bg-sky-500/12 text-sky-600 dark:text-sky-300'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <Server className="h-3.5 w-3.5" />
                Remote MCP Server
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-foreground">Service Name</label>
                <input
                  type="text"
                  required
                  value={svcName}
                  onChange={(e) => setSvcName(e.target.value)}
                  placeholder="e.g. Stripe Billing, n8n, Slack"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-foreground">Endpoint URL</label>
                <input
                  type="url"
                  required
                  value={svcEndpoint}
                  onChange={(e) => setSvcEndpoint(e.target.value)}
                  placeholder="https://api.example.com/webhook"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-foreground">
                  Auth Header Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="text"
                  value={svcAuthHeader}
                  onChange={(e) => setSvcAuthHeader(e.target.value)}
                  placeholder="Authorization or x-api-key"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-foreground">
                  Token / API Key <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={svcAuthSecret}
                  onChange={(e) => setSvcAuthSecret(e.target.value)}
                  placeholder="Bearer ... or secret key"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-foreground">
                Description / Instructions for Eva
              </label>
              <input
                type="text"
                value={svcDescription}
                onChange={(e) => setSvcDescription(e.target.value)}
                placeholder="What this service does and when Eva should call it"
                className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
              />
            </div>

            {svcKind === 'mcp' && (
              <div>
                <label className="block text-[11px] font-medium text-foreground">
                  MCP Tool Names <span className="text-muted-foreground">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={svcTools}
                  onChange={(e) => setSvcTools(e.target.value)}
                  placeholder="search_docs, create_ticket, send_alert"
                  className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Connect Service
            </button>
          </form>
        )}

        {services.length === 0 && mcps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No custom services connected yet. Click <span className="font-medium text-foreground">Add Service</span> above to add any REST webhook or MCP server anytime.
          </div>
        ) : (
          <div className="divide-y divide-border/70 rounded-xl border border-border/80 bg-background/60">
            {[...services, ...mcps].map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{item.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      {item.kind === 'mcp' ? `MCP · ${item.mode}` : 'HTTP'}
                    </span>
                    {item.authSecretMasked && (
                      <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                        key {item.authSecretMasked}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {item.endpoint || item.description}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {item.endpoint && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void postConnect({ action: 'test_service', id: item.id, kind: item.kind })
                      }
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Test
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void postConnect({
                        action: 'toggle_service',
                        id: item.id,
                        kind: item.kind,
                        enabled: !item.enabled,
                      })
                    }
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
                      item.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        : 'border-border bg-muted/40 text-muted-foreground'
                    )}
                  >
                    {item.enabled ? 'Enabled' : 'Paused'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      void postConnect(
                        { action: 'delete_service', id: item.id, kind: item.kind },
                        `Removed ${item.name}.`
                      )
                    }
                    className="rounded-md border border-destructive/30 p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
