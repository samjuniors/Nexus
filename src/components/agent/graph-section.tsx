'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GitFork,
  HelpCircle,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Orbit,
  Plus,
  RefreshCw,
  Scan,
  Search,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/agent/client'
import type { BrainGraphDTO, GraphNodeDTO, GraphReportDTO } from '@/lib/agent/client'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

const TYPE_COLORS: Record<string, string> = {
  brain: '#38bdf8',
  employee: '#0ea5e9',
  bot: '#10b981',
  automation: '#f43f5e',
  project: '#f59e0b',
  tool: '#0284c7',
  skill: '#6366f1',
  plugin: '#14b8a6',
  mcp: '#eab308',
  memory: '#a855f7',
  conversation: '#64748b',
  run: '#94a3b8',
  artifact: '#fb923c',
}

const RING_ORDER: Record<string, number> = {
  brain: 0,
  employee: 1,
  bot: 1,
  project: 1,
  tool: 1,
  skill: 1,
  plugin: 1,
  mcp: 1,
  automation: 2,
  conversation: 2,
  run: 2,
  memory: 3,
  artifact: 3,
}

const CAPS: Record<string, number> = {
  employee: 12,
  bot: 12,
  automation: 12,
  project: 16,
  conversation: 8,
  run: 12,
  memory: 22,
  artifact: 14,
}

const W = 920
const H = 540
const CX = W / 2
const CY = H / 2
const RING_R = [0, 112, 200, 260]

interface LaidNode {
  node: GraphNodeDTO
  x: number
  y: number
  r: number
}

export function KnowledgeGraphSection() {
  const [graph, setGraph] = useState<BrainGraphDTO | null>(null)
  const [report, setReport] = useState<GraphReportDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [layoutMode, setLayoutMode] = useState<'orbital' | 'hierarchy'>('orbital')
  const [hover, setHover] = useState<GraphNodeDTO | null>(null)
  const [pinned, setPinned] = useState<GraphNodeDTO | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })

  const panRef = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null)

  const { setTab, sendTask, runningRunId } = useApp()
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)

  const load = async () => {
    setLoading(true)
    try {
      const { graph: g, report: r } = await api.brainGraph()
      setGraph(g)
      setReport(r)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const askGraphQuestion = (question: string) => {
    if (runningRunId) return
    setTab('agent')
    void sendTask(question)
  }

  const activeNode = pinned ?? hover

  const { laid, edges, nodeMap } = useMemo(() => {
    if (!graph) {
      return {
        laid: [] as LaidNode[],
        edges: [] as { x1: number; y1: number; x2: number; y2: number; kind: string; source: string; target: string; relation: string }[],
        nodeMap: new Map<string, GraphNodeDTO>(),
      }
    }

    const q = search.trim().toLowerCase()
    const seedIds = new Set<string>()
    for (const n of graph.nodes) {
      if (typeFilter && n.type !== typeFilter) continue
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) continue
      seedIds.add(n.id)
    }

    const visibleIds = new Set<string>(seedIds)
    if (typeFilter || q) {
      for (const e of graph.edges) {
        if (seedIds.has(e.source)) visibleIds.add(e.target)
        if (seedIds.has(e.target)) visibleIds.add(e.source)
      }
    }

    const byRing: Record<number, GraphNodeDTO[]> = { 0: [], 1: [], 2: [], 3: [] }
    const counts: Record<string, number> = {}
    for (const n of graph.nodes) {
      if ((typeFilter || q) && !visibleIds.has(n.id)) continue
      const ring = RING_ORDER[n.type] ?? 3
      const cap = CAPS[n.type]
      if (!typeFilter && !q && cap !== undefined) {
        counts[n.type] = (counts[n.type] ?? 0) + 1
        if (counts[n.type] > cap) continue
      }
      byRing[ring].push(n)
    }

    // Sort within each ring by type so semantic neighbors stay grouped cleanly
    for (let ring = 0; ring <= 3; ring++) {
      byRing[ring].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))
    }

    const out: LaidNode[] = []
    if (layoutMode === 'hierarchy') {
      const activeRings = [0, 1, 2, 3].filter((r) => byRing[r].length > 0)
      const rowGap = activeRings.length > 1 ? (H - 120) / (activeRings.length - 1) : 0
      activeRings.forEach((ring, rowIdx) => {
        const nodes = byRing[ring]
        const span = Math.min(W - 110, Math.max(200, (nodes.length - 1) * 72))
        const startX = CX - span / 2
        const y = activeRings.length === 1 ? CY : 66 + rowIdx * rowGap
        nodes.forEach((n, i) => {
          const x = nodes.length === 1 ? CX : startX + (i / (nodes.length - 1)) * span
          out.push({
            node: n,
            x,
            y,
            r: ring === 0 ? 18 : n.type === 'employee' || n.type === 'bot' ? 8 : ring === 1 ? 6.5 : 5,
          })
        })
      })
    } else {
      for (let ring = 0; ring <= 3; ring++) {
        const nodes = byRing[ring]
        if (nodes.length === 0) continue
        const r = RING_R[ring]
        nodes.forEach((n, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2 + ring * 0.28
          out.push({
            node: n,
            x: CX + Math.cos(angle) * r,
            y: CY + Math.sin(angle) * r,
            r:
              ring === 0
                ? 20
                : n.type === 'employee' || n.type === 'bot'
                  ? 7.5
                  : ring === 1
                    ? 6
                    : ring === 2
                      ? 5
                      : 4.5,
          })
        })
      }
    }

    const posById = new Map(out.map((l) => [l.node.id, l]))
    const es = graph.edges
      .map((e) => {
        const a = posById.get(e.source)
        const b = posById.get(e.target)
        if (!a || !b) return null
        return {
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          kind: e.kind,
          source: e.source,
          target: e.target,
          relation: e.relation,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const map = new Map(graph.nodes.map((n) => [n.id, n]))
    return { laid: out, edges: es, nodeMap: map }
  }, [graph, typeFilter, search, layoutMode])

  const activeConnections = useMemo(() => {
    if (!graph || !activeNode) return []
    return graph.edges
      .filter((e) => e.source === activeNode.id || e.target === activeNode.id)
      .slice(0, 8)
      .map((e) => {
        const otherId = e.source === activeNode.id ? e.target : e.source
        const other = nodeMap.get(otherId)
        return {
          relation: e.relation,
          kind: e.kind,
          targetLabel: other?.label ?? otherId,
          targetType: other?.type ?? 'node',
        }
      })
  }, [graph, activeNode, nodeMap])

  const zoom = (factor: number) => {
    setView((prev) => {
      const nextScale = Math.max(0.55, Math.min(2.4, prev.scale * factor))
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        tx: CX - (CX - prev.tx) * ratio,
        ty: CY - (CY - prev.ty) * ratio,
      }
    })
  }

  return (
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Network className="h-3.5 w-3.5 text-sky-500" />
        <h2 className="text-[12.5px] font-semibold">Knowledge graph</h2>
        <span className="flex-1" />
        <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => {
              setLayoutMode('orbital')
              setView({ tx: 0, ty: 0, scale: 1 })
            }}
            aria-pressed={layoutMode === 'orbital'}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors',
              layoutMode === 'orbital' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Orbit className="h-3 w-3" /> Orbital
          </button>
          <button
            type="button"
            onClick={() => {
              setLayoutMode('hierarchy')
              setView({ tx: 0, ty: 0, scale: 1 })
            }}
            aria-pressed={layoutMode === 'hierarchy'}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors',
              layoutMode === 'hierarchy' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <GitFork className="h-3 w-3" /> Hierarchy
          </button>
        </div>

        <div className="relative w-40">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter nodes…"
            aria-label="Filter graph nodes"
            className="h-7 pl-7 text-[11px]"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => setGbrainGraphOpen(true)}
        >
          <Maximize2 className="h-3 w-3" />
          GBrain
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {graph ? (
          <>
            {/* Stats + interactive type filters */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-[10.5px]">
              <span className="font-mono tabular-nums text-muted-foreground">
                {graph.stats.nodes} nodes · {graph.stats.edges} edges · {graph.stats.extracted} extracted ·{' '}
                {graph.stats.inferred} inferred
              </span>
              <span className="flex-1" />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => zoom(1 / 1.18)}
                  aria-label="Zoom out inline graph"
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => zoom(1.18)}
                  aria-label="Zoom in inline graph"
                  className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setView({ tx: 0, ty: 0, scale: 1 })}
                  aria-label="Reset inline graph zoom"
                  className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Scan className="h-2.5 w-2.5" /> Fit
                </button>
              </div>
            </div>

            {/* Type filter row */}
            <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-muted/20 px-4 py-1.5">
              {typeFilter && (
                <button
                  type="button"
                  onClick={() => setTypeFilter(null)}
                  className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary"
                >
                  All types ×
                </button>
              )}
              {Object.entries(graph.stats.byType).map(([t, c]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter((cur) => (cur === t ? null : t))}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors',
                    typeFilter === t
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] ?? '#64748b' }} />
                  {t} {c}
                </button>
              ))}
            </div>

            <svg
              viewBox={`0 0 ${W} ${H}`}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('[data-inline-node="1"]')) return
                e.currentTarget.setPointerCapture(e.pointerId)
                panRef.current = { startX: e.clientX, startY: e.clientY, origTx: view.tx, origTy: view.ty }
              }}
              onPointerMove={(e) => {
                const pan = panRef.current
                if (!pan) return
                const nextTx = pan.origTx + (e.clientX - pan.startX)
                const nextTy = pan.origTy + (e.clientY - pan.startY)
                setView((prev) => ({
                  ...prev,
                  tx: nextTx,
                  ty: nextTy,
                }))
              }}
              onPointerUp={(e) => {
                if (!panRef.current) return
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                } catch {
                  /* ignore */
                }
                panRef.current = null
              }}
              onPointerCancel={() => {
                panRef.current = null
              }}
              className="block h-auto w-full cursor-grab select-none active:cursor-grabbing"
              role="img"
              aria-label="App knowledge graph"
            >
              <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
                {/* Orbital reference rings */}
                {layoutMode === 'orbital' &&
                  RING_R.slice(1).map((r) => (
                    <circle
                      key={r}
                      cx={CX}
                      cy={CY}
                      r={r}
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeDasharray="4 5"
                    />
                  ))}

                {/* Edges */}
                {edges.map((e, i) => {
                  const highlighted =
                    activeNode !== null && (e.source === activeNode.id || e.target === activeNode.id)
                  const dimmed = activeNode !== null && !highlighted
                  return (
                    <line
                      key={i}
                      x1={e.x1}
                      y1={e.y1}
                      x2={e.x2}
                      y2={e.y2}
                      stroke={highlighted ? '#38bdf8' : e.kind === 'INFERRED' ? '#a78bfa' : '#64748b'}
                      strokeOpacity={highlighted ? 0.85 : dimmed ? 0.08 : 0.24}
                      strokeWidth={highlighted ? 1.6 : 0.9}
                      strokeDasharray={
                        e.kind === 'INFERRED' ? '4 3' : e.kind === 'AMBIGUOUS' ? '1 4' : undefined
                      }
                    />
                  )
                })}

                {/* Nodes */}
                {laid.map((l) => {
                  const isPinned = pinned?.id === l.node.id
                  const isActive = activeNode?.id === l.node.id
                  const showLabel =
                    l.node.type === 'brain' ||
                    isPinned ||
                    isActive ||
                    l.node.type === 'employee' ||
                    l.node.type === 'bot' ||
                    (laid.length < 36 && l.node.type !== 'memory') ||
                    view.scale >= 1.25
                  return (
                    <g
                      key={l.node.id}
                      data-inline-node="1"
                      onMouseEnter={() => setHover(l.node)}
                      onMouseLeave={() => setHover((h) => (h?.id === l.node.id ? null : h))}
                      onClick={() => setPinned((cur) => (cur?.id === l.node.id ? null : l.node))}
                      className="cursor-pointer"
                    >
                      <title>{`${l.node.label} (${l.node.type}) — click to pin`}</title>
                      {(l.node.type === 'brain' || isPinned) && (
                        <circle
                          cx={l.x}
                          cy={l.y}
                          r={l.r + 5}
                          fill="none"
                          stroke="#38bdf8"
                          strokeOpacity={0.65}
                          strokeDasharray="3 3"
                        />
                      )}
                      <circle
                        cx={l.x}
                        cy={l.y}
                        r={l.r}
                        fill={TYPE_COLORS[l.node.type] ?? '#64748b'}
                        fillOpacity={l.node.type === 'brain' || isPinned ? 0.98 : 0.85}
                        stroke="var(--background)"
                        strokeWidth={1.2}
                      />
                      {showLabel && (
                        <text
                          x={l.x}
                          y={l.y - l.r - 5}
                          textAnchor="middle"
                          fontSize={l.node.type === 'brain' ? 11 : 9}
                          fontWeight={l.node.type === 'brain' || isPinned ? 600 : 500}
                          fill="currentColor"
                          paintOrder="stroke"
                          stroke="var(--background)"
                          strokeWidth={3}
                          strokeLinejoin="round"
                          className="pointer-events-none font-mono"
                        >
                          {l.node.label.slice(0, l.node.type === 'brain' ? 16 : 15)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>

            {/* Hover / pinned inspector */}
            <div className="border-t border-border px-4 py-2.5">
              {activeNode ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: TYPE_COLORS[activeNode.type] ?? '#64748b' }}
                    />
                    <span className="font-mono font-medium text-foreground">{activeNode.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">· {activeNode.type}</span>
                    {pinned && (
                      <button
                        type="button"
                        onClick={() => setPinned(null)}
                        className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-2.5 w-2.5" /> Unpin
                      </button>
                    )}
                  </div>
                  {activeConnections.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                      {activeConnections.map((c, idx) => (
                        <span key={idx}>
                          {c.relation} → <span className="text-foreground">{c.targetLabel}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Drag to pan, zoom, or click any node to pin and inspect its relationships.
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-48 items-center justify-center">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-xs text-muted-foreground">Graph unavailable.</span>
            )}
          </div>
        )}
      </div>

      {/* Structural report */}
      {report && (report.questions.length > 0 || report.surprising.length > 0 || report.communities.length > 0) && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {report.questions.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="h-3.5 w-3.5 text-sky-500" />
                <h3 className="text-xs font-semibold">Ask the graph</h3>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {report.questions.map((q) => (
                  <button
                    key={q.question}
                    disabled={runningRunId !== null}
                    title={q.why}
                    onClick={() => askGraphQuestion(q.question)}
                    className="flex w-full items-start gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-2 text-left text-[11.5px] text-foreground/90 transition-colors hover:border-sky-500/40 hover:bg-muted/40 disabled:opacity-50"
                  >
                    <Waypoints className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="leading-snug">{q.question}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            {report.communities.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  <h3 className="text-xs font-semibold">Memory clusters</h3>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  {report.communities.slice(0, 3).map((c) => (
                    <div key={c.id} className="rounded-lg border border-border/70 bg-background px-2.5 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-foreground">{c.label}</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {c.members.length} memories
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[10.5px] text-muted-foreground">
                        {c.members.slice(0, 4).map((m) => m.label).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.surprising.length > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <h3 className="text-xs font-semibold">Surprising connections</h3>
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {report.surprising.slice(0, 3).map((s, i) => (
                    <li key={i} className="rounded-lg border border-border/70 bg-background px-2.5 py-2 text-[11px] leading-snug text-foreground/90">
                      {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
