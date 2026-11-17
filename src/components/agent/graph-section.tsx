'use client'

import { useEffect, useMemo, useState } from 'react'
import { HelpCircle, Loader2, Network, RefreshCw, Sparkles, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/agent/client'
import type { BrainGraphDTO, GraphNodeDTO, GraphReportDTO } from '@/lib/agent/client'
import { useApp } from '@/lib/agent/store'
import { cn } from '@/lib/utils'

/**
 * Interactive knowledge graph for the Brain tab — graphify-inspired:
 * every node and edge of the app's world rendered as a traversable graph.
 * Deterministic radial layout: brain at the center, capabilities in the
 * first ring, activity (conversations/runs) in the second, knowledge
 * (memories/artifacts) on the outside. Hover a node to inspect it.
 *
 * Below the graph: the graphify-style structural report — god nodes,
 * memory communities, surprising cross-cluster connections and suggested
 * questions derived from graph structure.
 */

const TYPE_COLORS: Record<string, string> = {
  brain: '#e7e9ee',
  tool: '#7dd3fc',
  skill: '#a5b4fc',
  plugin: '#6ee7b7',
  mcp: '#fcd34d',
  memory: '#f0abfc',
  conversation: '#94a3b8',
  run: '#cbd5e1',
  artifact: '#fdba74',
}

const RING_ORDER: Record<string, number> = {
  brain: 0,
  tool: 1,
  skill: 1,
  plugin: 1,
  mcp: 1,
  conversation: 2,
  run: 2,
  memory: 3,
  artifact: 3,
}

const CAPS: Record<string, number> = { conversation: 8, run: 12, memory: 22, artifact: 14 }

const W = 880
const H = 540
const CX = W / 2
const CY = H / 2
const RING_R = [0, 105, 205, 268]

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
  const [hover, setHover] = useState<GraphNodeDTO | null>(null)
  const { setTab, sendTask, runningRunId } = useApp()

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

  const { laid, edges } = useMemo(() => {
    if (!graph) return { laid: [] as LaidNode[], edges: [] as { x1: number; y1: number; x2: number; y2: number; kind: string }[] }
    const byRing: Record<number, GraphNodeDTO[]> = { 0: [], 1: [], 2: [], 3: [] }
    const counts: Record<string, number> = {}
    for (const n of graph.nodes) {
      const ring = RING_ORDER[n.type] ?? 3
      const cap = CAPS[n.type]
      if (cap !== undefined) {
        counts[n.type] = (counts[n.type] ?? 0) + 1
        if (counts[n.type] > cap) continue
      }
      byRing[ring].push(n)
    }
    const out: LaidNode[] = []
    for (let ring = 0; ring <= 3; ring++) {
      const nodes = byRing[ring]
      const r = RING_R[ring]
      nodes.forEach((n, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2 + ring * 0.35
        const jitter = ring === 0 ? 0 : ((i % 2 === 0 ? 1 : -1) * (ring * 4))
        out.push({
          node: n,
          x: CX + Math.cos(angle) * (r + jitter),
          y: CY + Math.sin(angle) * (r + jitter),
          r: ring === 0 ? 22 : ring === 1 ? 5.5 : ring === 2 ? 4.5 : 3.5,
        })
      })
    }
    const posById = new Map(out.map((l) => [l.node.id, l]))
    const es = graph.edges
      .map((e) => {
        const a = posById.get(e.source)
        const b = posById.get(e.target)
        if (!a || !b) return null
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, kind: e.kind }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    return { laid: out, edges: es }
  }, [graph])

  const edgeStyle = (kind: string): { stroke: string; width: number; dash?: string } =>
    kind === 'INFERRED'
      ? { stroke: 'rgba(192,132,252,0.22)', width: 1, dash: '3 3' }
      : kind === 'AMBIGUOUS'
        ? { stroke: 'rgba(251,191,36,0.18)', width: 0.8, dash: '1 4' }
        : { stroke: 'rgba(255,255,255,0.10)', width: 0.8 }

  return (
    <section className="mt-7">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Network className="h-3.5 w-3.5 text-zinc-500" />
        <h2 className="text-[12.5px] font-semibold">Knowledge graph</h2>
        <span className="text-[11px] text-muted-foreground">
          — the app's world as a traversable graph, every edge explained
        </span>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 border-white/10 bg-transparent px-2.5 text-[11px]"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Rebuild
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-black/20">
        {graph ? (
          <>
            {/* stats chips */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
              <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                {graph.stats.nodes} nodes
              </span>
              <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                {graph.stats.edges} edges
              </span>
              <span className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                {graph.stats.extracted} extracted
              </span>
              <span className="rounded border border-violet-400/20 bg-violet-400/8 px-2 py-0.5 font-mono text-[10px] text-violet-300/90">
                {graph.stats.inferred} inferred
              </span>
              <span className="rounded border border-amber-400/20 bg-amber-400/8 px-2 py-0.5 font-mono text-[10px] text-amber-300/90">
                {graph.stats.ambiguous} ambiguous
              </span>
              {Object.entries(graph.stats.byType).map(([t, c]) => (
                <span key={t} className="flex items-center gap-1 font-mono text-[9.5px] text-muted-foreground/70">
                  <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] ?? '#888' }} />
                  {t} {c}
                </span>
              ))}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="App knowledge graph">
              {/* edges */}
              {edges.map((e, i) => {
                const s = edgeStyle(e.kind)
                return (
                  <line
                    key={i}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke={s.stroke}
                    strokeWidth={s.width}
                    strokeDasharray={s.dash}
                  />
                )
              })}
              {/* nodes */}
              {laid.map((l) => (
                <g
                  key={l.node.id}
                  onMouseEnter={() => setHover(l.node)}
                  onMouseLeave={() => setHover((h) => (h?.id === l.node.id ? null : h))}
                  className="cursor-default"
                >
                  <title>{`${l.node.label} (${l.node.type})`}</title>
                  {l.node.type === 'brain' && (
                    <circle cx={l.x} cy={l.y} r={l.r + 6} fill="none" stroke="rgba(231,233,238,0.25)" strokeDasharray="4 3" />
                  )}
                  <circle
                    cx={l.x}
                    cy={l.y}
                    r={l.r}
                    fill={TYPE_COLORS[l.node.type] ?? '#94a3b8'}
                    fillOpacity={l.node.type === 'brain' ? 0.95 : 0.85}
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth={l.node.type === 'brain' ? 1.5 : 0.6}
                  />
                  {(l.node.type === 'brain' || (laid.length < 30 && l.node.type !== 'memory')) && (
                    <text
                      x={l.x}
                      y={l.y - l.r - 5}
                      textAnchor="middle"
                      fontSize={l.node.type === 'brain' ? 11 : 8.5}
                      fill="rgba(228,228,231,0.85)"
                      style={{ fontFamily: 'var(--font-geist-mono), monospace' }}
                    >
                      {l.node.label.slice(0, l.node.type === 'brain' ? 14 : 12)}
                    </text>
                  )}
                </g>
              ))}
            </svg>

            {/* hover inspector */}
            <div className="flex min-h-9 items-center gap-2 border-t border-white/[0.06] px-4 py-2">
              {hover ? (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[hover.type] ?? '#888' }} />
                  <span className="font-mono text-[11px] text-zinc-200">{hover.label}</span>
                  <span className={cn('terminal-label rounded border border-white/[0.08] px-1.5 py-0.5 text-[8.5px] text-muted-foreground')}>
                    {hover.type}
                  </span>
                  <span className="font-mono text-[9.5px] text-muted-foreground/60">{hover.id}</span>
                </>
              ) : (
                <span className="text-[10.5px] text-muted-foreground/60">
                  Hover a node to inspect it — tools, skills, memories, runs and artifacts, all connected.
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-48 items-center justify-center">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            ) : (
              <span className="text-[12px] text-muted-foreground">Graph unavailable.</span>
            )}
          </div>
        )}
      </div>

      {/* ---- graphify-style structural report ---- */}
      {report && (report.questions.length > 0 || report.surprising.length > 0 || report.communities.length > 0) && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {/* suggested questions */}
          {report.questions.length > 0 && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="h-3.5 w-3.5 text-sky-300/80" />
                <h3 className="text-[12px] font-semibold">Ask the graph</h3>
              </div>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                questions derived from the structure of your knowledge
              </p>
              <div className="mt-2.5 space-y-1.5">
                {report.questions.map((q) => (
                  <button
                    key={q.question}
                    disabled={runningRunId !== null}
                    title={q.why}
                    onClick={() => askGraphQuestion(q.question)}
                    className="flex w-full items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-left text-[11.5px] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-100 disabled:opacity-50"
                  >
                    <Waypoints className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                    <span className="leading-snug">{q.question}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* communities + surprising connections + god nodes */}
          <div className="space-y-2.5">
            {report.communities.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-300/80" />
                  <h3 className="text-[12px] font-semibold">Memory clusters</h3>
                </div>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                  communities detected by label propagation over inferred links
                </p>
                <div className="mt-2.5 space-y-1.5">
                  {report.communities.slice(0, 3).map((c) => (
                    <div key={c.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-zinc-200">{c.label}</span>
                        <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70">{c.members.length} memories</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/70">
                        {c.members.slice(0, 4).map((m) => m.label).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.surprising.length > 0 && (
              <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.03] p-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-300/80" />
                  <h3 className="text-[12px] font-semibold">Surprising connections</h3>
                </div>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                  links bridging otherwise separate knowledge clusters
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {report.surprising.slice(0, 3).map((s, i) => (
                    <li key={i} className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2 text-[11px] leading-snug text-amber-100/80">
                      {s.reason}
                      <span className="ml-1.5 font-mono text-[9px] text-amber-300/60">[{s.edge.kind}]</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.godNodes.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="flex items-center gap-1.5">
                  <Network className="h-3.5 w-3.5 text-zinc-400" />
                  <h3 className="text-[12px] font-semibold">God nodes</h3>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {report.godNodes.map((n) => (
                    <span
                      key={n.id}
                      className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-300"
                    >
                      {n.label} <span className="text-muted-foreground/60">· {n.degree}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
