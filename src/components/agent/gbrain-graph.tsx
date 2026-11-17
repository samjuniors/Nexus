'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  Bot,
  CircleDot,
  Loader2,
  Maximize2,
  MousePointerClick,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/agent/client'
import type { GBrainGraphDTO, GBrainNodeDTO, GBrainNodeDetailDTO } from '@/lib/agent/client'
import { cn } from '@/lib/utils'

/**
 * THE GBRAIN GRAPH — the memory entity graph, torn off fullscreen.
 *
 * The brain auto-creates nodes as memories mention entities and auto-prunes
 * orphans when it dreams; here a person can also inspect any node (its
 * memories, its retrieval ledger, its neighbors), create nodes by hand,
 * rename them, add aliases and remove them. Deterministic force-ish layout:
 * seeded positions + relaxation iterations, redrawn only when the graph
 * changes — no animation loop, no jank.
 */

interface Laid {
  node: GBrainNodeDTO
  x: number
  y: number
  r: number
}

const W = 1000
const H = 640

/** Deterministic PRNG (mulberry32) so the layout is stable per graph. */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function layout(nodes: GBrainNodeDTO[], edges: GBrainGraphDTO['edges']): Laid[] {
  if (nodes.length === 0) return []
  const rng = seeded(nodes.reduce((a, n) => a + n.id.charCodeAt(0), 7))
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree))
  const laid: Laid[] = nodes.map((n) => {
    const angle = rng() * Math.PI * 2
    const ring = n.degree === 0 ? 0.34 + rng() * 0.28 : 0.12 + (1 - n.degree / maxDeg) * 0.34 + rng() * 0.12
    return {
      node: n,
      x: W / 2 + Math.cos(angle) * ring * (W / 2 - 70),
      y: H / 2 + Math.sin(angle) * ring * (H / 2 - 60),
      r: 6 + (n.degree / maxDeg) * 16,
    }
  })
  const byId = new Map(laid.map((l) => [l.node.id, l]))
  // relaxation: repel all pairs, attract along edges, stay in bounds
  for (let iter = 0; iter < 160; iter++) {
    const force = new Map<string, { x: number; y: number }>()
    for (const l of laid) force.set(l.node.id, { x: 0, y: 0 })
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]
        const b = laid[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = rng() - 0.5
          dy = rng() - 0.5
          d2 = 1
        }
        const rep = 5200 / d2
        const d = Math.sqrt(d2)
        const ux = dx / d
        const uy = dy / d
        force.get(a.node.id)!.x += ux * rep
        force.get(a.node.id)!.y += uy * rep
        force.get(b.node.id)!.x -= ux * rep
        force.get(b.node.id)!.y -= uy * rep
      }
    }
    for (const e of edges) {
      const a = byId.get(e.sourceId)
      const b = byId.get(e.targetId)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const attract = (d - 130) * 0.012
      const ux = (dx / d) * attract
      const uy = (dy / d) * attract
      force.get(a.node.id)!.x += ux
      force.get(a.node.id)!.y += uy
      force.get(b.node.id)!.x -= ux
      force.get(b.node.id)!.y -= uy
    }
    const damp = 0.85
    for (const l of laid) {
      const f = force.get(l.node.id)!
      l.x = Math.max(l.r + 8, Math.min(W - l.r - 8, l.x + f.x * damp))
      l.y = Math.max(l.r + 8, Math.min(H - l.r - 8, l.y + f.y * damp))
    }
  }
  return laid
}

export function GBrainGraph({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [graph, setGraph] = useState<GBrainGraphDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<GBrainNodeDetailDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [note, setNote] = useState('')
  const [renaming, setRenaming] = useState('')
  const [alias, setAlias] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const g = await api.gbrainGraph()
      setGraph(g)
    } catch (e) {
      setMessage({ kind: 'warn', text: e instanceof Error ? e.message : 'Failed to load graph' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const inspect = useCallback(async (nodeId: string) => {
    setSelected(nodeId)
    setDetail(null)
    setDetailLoading(true)
    setRenaming('')
    setAlias('')
    try {
      const d = (await api.gbrainGraphAction('inspect', { nodeId })) as GBrainNodeDetailDTO
      setDetail(d)
      detailRef.current?.scrollTo({ top: 0 })
    } catch (e) {
      setMessage({ kind: 'warn', text: e instanceof Error ? e.message : 'Inspect failed' })
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const act = useCallback(
    async (fn: () => Promise<string>) => {
      setBusy(true)
      try {
        const text = await fn()
        setMessage({ kind: 'ok', text })
        await refresh()
      } catch (e) {
        setMessage({ kind: 'warn', text: e instanceof Error ? e.message : 'Action failed' })
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const laid = useMemo(() => (graph ? layout(graph.nodes.slice(0, 120), graph.edges) : []), [graph])
  const byId = useMemo(() => new Map(laid.map((l) => [l.node.id, l])), [laid])
  const selectedNode = selected ? byId.get(selected) : null

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/97 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="GBrain memory graph">
      {/* header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/[0.08] px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-sky-300" />
          <h2 className="text-sm font-semibold tracking-tight">GBrain graph</h2>
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
            every memory as entities — the brain creates and prunes nodes; you can too
          </span>
        </div>
        {graph && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span>{graph.stats.nodes} nodes</span>
            <span>{graph.stats.edges} edges</span>
            <span className="text-emerald-300/80">{graph.stats.extracted} extracted</span>
            <span className="text-amber-300/80">{graph.stats.inferred} inferred</span>
            <span className="text-sky-300/80">{graph.stats.manual} manual</span>
            <span className="text-zinc-400">{graph.stats.orphaned} orphaned</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 border-white/10 bg-transparent text-[11px]" disabled={busy || loading} onClick={() => void refresh()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-white/10 bg-transparent text-[11px]"
            disabled={busy || loading}
            onClick={() =>
              void act(async () => {
                const r = (await api.gbrainGraphAction('prune')) as { pruned: number }
                return `Pruned ${r.pruned} orphaned node${r.pruned === 1 ? '' : 's'}`
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            Prune orphans
          </Button>
          <Button variant="outline" size="sm" className="h-8 border-white/10 bg-transparent" onClick={() => onOpenChange(false)} aria-label="Close graph">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* body: graph + inspector */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* graph canvas */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Memory entity graph">
            <defs>
              <radialGradient id="hubGlow">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
              </radialGradient>
            </defs>
            {laid.length === 0 && !loading && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fill="#71717a" fontSize="15">
                no entities yet — teach the brain something and nodes appear here
              </text>
            )}
            {/* edges */}
            {graph?.edges.map((e) => {
              const a = byId.get(e.sourceId)
              const b = byId.get(e.targetId)
              if (!a || !b) return null
              const hot = selected === e.sourceId || selected === e.targetId
              return (
                <g key={e.id}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={hot ? '#7dd3fc' : e.kind === 'EXTRACTED' ? '#3f3f46' : '#52525b'}
                    strokeWidth={hot ? 1.8 : 0.9}
                    strokeDasharray={e.kind === 'INFERRED' ? '4 4' : undefined}
                    opacity={selected && !hot ? 0.25 : 0.8}
                  />
                  {hot && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fill="#7dd3fc" fontSize="9" fontFamily="monospace">
                      {e.relation}
                    </text>
                  )}
                </g>
              )
            })}
            {/* nodes */}
            {laid.map((l) => {
              const isSel = selected === l.node.id
              const isManual = l.node.origin === 'manual'
              const fill = isManual ? '#a5b4fc' : l.node.degree >= 3 ? '#7dd3fc' : '#52525b'
              return (
                <g
                  key={l.node.id}
                  transform={`translate(${l.x}, ${l.y})`}
                  className="cursor-pointer"
                  onClick={() => void inspect(l.node.id)}
                  role="button"
                  aria-label={`Inspect ${l.node.name}`}
                >
                  {l.node.degree >= 5 && <circle r={l.r + 14} fill="url(#hubGlow)" />}
                  <circle
                    r={l.r}
                    fill={fill}
                    fillOpacity={isSel ? 1 : 0.85}
                    stroke={isSel ? '#e7e9ee' : isManual ? '#a5b4fc' : '#3f3f46'}
                    strokeWidth={isSel ? 2.2 : 1}
                  />
                  <text
                    y={l.r + 12}
                    textAnchor="middle"
                    fill={isSel ? '#e7e9ee' : '#a1a1aa'}
                    fontSize={Math.max(9.5, Math.min(12, l.r + 4))}
                    fontFamily="ui-monospace, monospace"
                  >
                    {l.node.name.length > 18 ? l.node.name.slice(0, 17) + '…' : l.node.name}
                  </text>
                  {isManual && (
                    <circle cx={l.r * 0.72} cy={-l.r * 0.72} r={3.4} fill="#a5b4fc" stroke="#18181b" strokeWidth={1} />
                  )}
                </g>
              )
            })}
          </svg>

          {/* legend */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-black/50 px-3 py-2 font-mono text-[9.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><CircleDot className="h-2.5 w-2.5 text-sky-300" /> brain-created (auto) — size = connections</span>
            <span className="flex items-center gap-1.5"><User className="h-2.5 w-2.5 text-indigo-300" /> you-created (manual)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-zinc-600" /> solid = EXTRACTED · dashed = INFERRED</span>
          </div>

          {/* create node */}
          <div className="absolute right-3 top-3 w-64 rounded-lg border border-white/[0.08] bg-black/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] text-muted-foreground">
              <Plus className="h-3 w-3" /> CREATE A NODE
            </div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="entity name, e.g. Acme Corp"
              className="h-8 border-white/10 bg-black/40 text-[11.5px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim() && !busy) {
                  const name = newName.trim()
                  const theNote = note.trim()
                  setNewName('')
                  setNote('')
                  void act(async () => {
                    const r = (await api.gbrainGraphAction('create', { name, note: theNote || undefined })) as { kind: string; hint?: string; entity?: { name: string } }
                    if (r.kind === 'created') return `Node "${r.entity?.name}" created`
                    if (r.kind === 'exists') return `"${name}" already exists as "${r.entity?.name}"`
                    return `Flagged: ${r.hint ?? 'near-match'}`
                  })
                }
              }}
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional first note about it"
              className="mt-2 h-8 border-white/10 bg-black/40 text-[11.5px]"
            />
            <Button
              size="sm"
              className="mt-2 h-7 w-full gap-1 text-[11px]"
              disabled={!newName.trim() || busy}
              onClick={() => {
                const name = newName.trim()
                const theNote = note.trim()
                setNewName('')
                setNote('')
                void act(async () => {
                  const r = (await api.gbrainGraphAction('create', { name, note: theNote || undefined })) as { kind: string; hint?: string; entity?: { name: string } }
                  if (r.kind === 'created') return `Node "${r.entity?.name}" created`
                  if (r.kind === 'exists') return `"${name}" already exists as "${r.entity?.name}"`
                  return `Flagged: ${r.hint ?? 'near-match'}`
                })
              }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add node
            </Button>
          </div>

          {/* toast */}
          {message && (
            <div
              className={cn(
                'absolute left-1/2 top-3 max-w-[90%] -translate-x-1/2 rounded-lg border px-3.5 py-2 text-[11.5px]',
                message.kind === 'ok'
                  ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                  : 'border-amber-400/25 bg-amber-400/10 text-amber-200'
              )}
              role="status"
            >
              {message.text}
            </div>
          )}
        </div>

        {/* inspector */}
        <aside className="flex max-h-[45%] w-full shrink-0 flex-col border-t border-white/[0.08] bg-black/25 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0" aria-label="Node inspector">
          {!selected && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <MousePointerClick className="h-6 w-6 text-zinc-600" />
              <p className="text-[12px] text-muted-foreground">Click a node to inspect it — its memories, its retrieval history, its connections.</p>
            </div>
          )}
          {selected && (
            <div ref={detailRef} className="min-h-0 flex-1 overflow-y-auto p-4">
              {detailLoading && (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> inspecting…
                </div>
              )}
              {detail && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-zinc-100">{detail.entity.name}</h3>
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px]',
                          detail.entity.origin === 'manual'
                            ? 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300'
                            : 'border-sky-400/25 bg-sky-400/10 text-sky-300'
                        )}
                      >
                        {detail.entity.origin === 'manual' ? <User className="h-2.5 w-2.5" /> : <Bot className="h-2.5 w-2.5" />}
                        {detail.entity.origin}
                      </span>
                    </div>
                    {detail.entity.variants.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {detail.entity.variants.slice(0, 8).map((v) => (
                          <span key={v} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                            aka {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 font-mono text-[9px] text-muted-foreground">
                    <div className="rounded border border-white/[0.07] bg-black/30 p-2">
                      <div className="text-[15px] font-semibold text-zinc-100">{detail.neighbors.length}</div>
                      neighbors
                    </div>
                    <div className="rounded border border-white/[0.07] bg-black/30 p-2">
                      <div className="text-[15px] font-semibold text-zinc-100">{detail.memories.length}</div>
                      memories
                    </div>
                    <div className="rounded border border-white/[0.07] bg-black/30 p-2">
                      <div className="text-[15px] font-semibold text-zinc-100">{detail.edges.length}</div>
                      edges
                    </div>
                  </div>

                  {/* rename + alias */}
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <Input
                        value={renaming}
                        onChange={(e) => setRenaming(e.target.value)}
                        placeholder={`rename "${detail.entity.name}"`}
                        className="h-8 border-white/10 bg-black/40 text-[11.5px]"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 border-white/10 bg-transparent px-2.5"
                        disabled={!renaming.trim() || busy}
                        onClick={() =>
                          void act(async () => {
                            await api.gbrainGraphAction('rename', { nodeId: detail.entity.id, name: renaming.trim() })
                            return `Renamed to "${renaming.trim()}" (old name kept as alias)`
                          })
                        }
                        aria-label="Rename node"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex gap-1.5">
                      <Input
                        value={alias}
                        onChange={(e) => setAlias(e.target.value)}
                        placeholder="add an alias…"
                        className="h-8 border-white/10 bg-black/40 text-[11.5px]"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 border-white/10 bg-transparent px-2.5"
                        disabled={!alias.trim() || busy}
                        onClick={() =>
                          void act(async () => {
                            await api.gbrainGraphAction('alias', { nodeId: detail.entity.id, alias: alias.trim() })
                            return `Alias "${alias.trim()}" added`
                          })
                        }
                        aria-label="Add alias"
                      >
                        <Tag className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* memories */}
                  {detail.memories.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] text-muted-foreground">MEMORIES MENTIONING THIS NODE</div>
                      <div className="space-y-2">
                        {detail.memories.map((m) => (
                          <div key={m.id} className="rounded-lg border border-white/[0.07] bg-black/30 p-2.5">
                            <div className="flex items-center gap-1.5 font-mono text-[9px]">
                              <span className="rounded bg-white/5 px-1 py-0.5 text-zinc-400">{m.type}</span>
                              {m.alwaysLoad && (
                                <span className="flex items-center gap-0.5 rounded bg-amber-400/10 px-1 py-0.5 text-amber-300">
                                  <BadgeCheck className="h-2.5 w-2.5" /> core
                                </span>
                              )}
                              {m.trust > 0 && <span className="text-emerald-300/80">trust {Math.round(m.trust * 100)}%</span>}
                              <span className="text-zinc-500">{m.accessCount}× recalled</span>
                            </div>
                            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-300">
                              {m.truth ? <span className="text-zinc-100">{m.truth}</span> : m.content.slice(0, 160)}
                            </p>
                            {m.recentQueries.length > 0 && (
                              <p className="mt-1 font-mono text-[9px] text-zinc-500">pulled by: {m.recentQueries.slice(0, 3).map((q) => `"${q}"`).join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* neighbors */}
                  {detail.neighbors.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] text-muted-foreground">CONNECTED TO</div>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.neighbors.slice(0, 12).map((n) => (
                          <button
                            key={n.id}
                            onClick={() => void inspect(n.id)}
                            className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] text-zinc-300 transition-colors hover:border-sky-400/40 hover:text-sky-300"
                          >
                            {n.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* remove */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-full gap-1.5 border-red-400/25 bg-red-400/5 text-[11px] text-red-300 hover:border-red-400/50"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const name = detail.entity.name
                        const r = (await api.gbrainGraphAction('remove', { nodeId: detail.entity.id })) as unknown as { removed?: { unlinked: number; edges: number } }
                        setSelected(null)
                        return `Removed "${name}" — ${r.removed?.unlinked ?? 0} memories unlinked (kept), ${r.removed?.edges ?? 0} edges dropped`
                      })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove node (memories survive)
                  </Button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** The small trigger button placed in the Brain tab. */
export function GBrainGraphButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="h-7 gap-1.5 border-white/10 bg-black/25 px-2.5 text-[10.5px] font-mono text-zinc-300 hover:border-sky-400/40 hover:text-sky-300"
    >
      <Maximize2 className="h-3 w-3" />
      Open graph
    </Button>
  )
}
