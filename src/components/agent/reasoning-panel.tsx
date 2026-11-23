'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  GitBranch,
  Globe,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Target,
  Trash2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { ReasoningChain, ReasoningNode, ReasoningNodeKind } from '@/lib/agent/reasoning-chain'
import { cn } from '@/lib/utils'

type NodeFilter = 'all' | ReasoningNodeKind

const KIND_META: Record<
  ReasoningNodeKind,
  { label: string; icon: typeof Target; accent: string; lineColor: string }
> = {
  goal: {
    label: 'Goal',
    icon: Target,
    accent: 'text-sky-600 dark:text-sky-400',
    lineColor: 'border-sky-500/35 bg-sky-500/10',
  },
  decision: {
    label: 'Decision',
    icon: GitBranch,
    accent: 'text-foreground',
    lineColor: 'border-border bg-muted/60',
  },
  observation: {
    label: 'Observation',
    icon: Eye,
    accent: 'text-muted-foreground',
    lineColor: 'border-border bg-background',
  },
  self_correction: {
    label: 'Self-Correction',
    icon: RotateCcw,
    accent: 'text-amber-600 dark:text-amber-400',
    lineColor: 'border-amber-500/40 bg-amber-500/10',
  },
  verification: {
    label: 'Verification',
    icon: ShieldCheck,
    accent: 'text-emerald-600 dark:text-emerald-400',
    lineColor: 'border-emerald-500/40 bg-emerald-500/10',
  },
}

const SOURCE_META: Record<ReasoningChain['source'], { label: string; icon: typeof Globe }> = {
  browser_autopilot: { label: 'Browser Autopilot', icon: Globe },
  mobile_autopilot: { label: 'Mobile Autopilot', icon: Smartphone },
  mission: { label: 'Mission', icon: Workflow },
  voice_live: { label: 'Voice Action', icon: Mic },
  self_heal: { label: 'Self-Heal', icon: ShieldCheck },
}

const FILTERS: { id: NodeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'goal', label: 'Goals' },
  { id: 'decision', label: 'Decisions' },
  { id: 'self_correction', label: 'Self-Corrections' },
  { id: 'verification', label: 'Verifications' },
]

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ''
  }
}

function StatusLabel({ status }: { status: ReasoningChain['status'] }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-sky-600 dark:text-sky-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Active
      </span>
    )
  }
  if (status === 'corrected') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-amber-600 dark:text-amber-400">
        <RotateCcw className="h-3 w-3" />
        Self-Corrected
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-red-600 dark:text-red-400">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" />
      Verified
    </span>
  )
}

function ReasoningNodeRow({ node, isLast }: { node: ReasoningNode; isLast: boolean }) {
  const meta = KIND_META[node.kind]
  const Icon = meta.icon
  const isFailedVerification = node.kind === 'verification' && node.verified === false

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* vertical rail */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute top-7 bottom-0 left-[13px] w-px bg-border"
        />
      )}

      {/* node icon */}
      <div
        className={cn(
          'relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
          isFailedVerification
            ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
            : cn(meta.lineColor, meta.accent)
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* node content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'font-mono text-[10px] font-medium uppercase tracking-wider',
              isFailedVerification ? 'text-red-600 dark:text-red-400' : meta.accent
            )}
          >
            {meta.label}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono text-[10px] text-muted-foreground">{node.actor}</span>
          {node.tool && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="font-mono text-[10px] text-muted-foreground">{node.tool}</span>
            </>
          )}
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/75">
            {formatClock(node.createdAt)}
          </span>
        </div>

        <div className="mt-1 text-[12.5px] font-medium leading-snug text-foreground">
          {node.title}
        </div>
        {node.detail && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground break-words">
            {node.detail}
          </p>
        )}

        {node.correction && (
          <div className="mt-2 space-y-1 border-l-2 border-amber-500/50 pl-2.5 text-[11px]">
            <div>
              <span className="font-medium text-amber-700 dark:text-amber-300">Failure signal: </span>
              <span className="text-muted-foreground">{node.correction.whatFailed}</span>
            </div>
            <div>
              <span className="font-medium text-foreground">Pivot strategy: </span>
              <span className="text-muted-foreground">{node.correction.pivotStrategy}</span>
            </div>
          </div>
        )}

        {node.url && (
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">
            {node.url}
          </div>
        )}
      </div>
    </li>
  )
}

export function ReasoningPanel() {
  const chains = useEvaControl((s) => s.reasoningChains)
  const activeChainId = useEvaControl((s) => s.activeReasoningChainId)
  const selectChain = useEvaControl((s) => s.selectReasoningChain)
  const refreshChains = useEvaControl((s) => s.refreshReasoningChains)
  const clearChains = useEvaControl((s) => s.clearReasoningChains)
  const busy = useEvaControl((s) => s.reasoningBusy)

  const [filter, setFilter] = useState<NodeFilter>('all')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void refreshChains()
  }, [refreshChains])

  const activeChain = useMemo(
    () => chains.find((c) => c.id === activeChainId) ?? chains[0] ?? null,
    [chains, activeChainId]
  )

  const visibleNodes = useMemo(() => {
    if (!activeChain) return []
    if (filter === 'all') return activeChain.nodes
    return activeChain.nodes.filter((n) => n.kind === filter)
  }, [activeChain, filter])

  const copyTrace = async () => {
    if (!activeChain) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeChain, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div
      data-reasoning-panel="1"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      {/* Top header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            <h2 className="truncate text-xs font-semibold tracking-tight">Reasoning Chain</h2>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {chains.length} trace{chains.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeChain && (
            <button
              type="button"
              onClick={() => void copyTrace()}
              aria-label="Copy reasoning trace JSON"
              title="Copy trace JSON"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? 'Copied' : 'JSON'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void refreshChains()}
            disabled={busy}
            aria-label="Refresh reasoning chains"
            title="Refresh"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
          {chains.length > 0 && (
            <button
              type="button"
              onClick={() => void clearChains()}
              disabled={busy}
              aria-label="Clear reasoning history"
              title="Clear history"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {chains.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40">
            <GitBranch className="h-4.5 w-4.5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-xs font-medium text-foreground">No reasoning traces logged yet</p>
          <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-muted-foreground">
            Run a multi-step web task, ask Eva to play media, or start a mission to inspect her live goal decomposition, decision nodes, and self-correction pivots.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Chain selector strip */}
          {chains.length > 1 && (
            <div className="nice-scroll flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
              {chains.slice(0, 10).map((chain) => {
                const selected = chain.id === activeChain?.id
                const SrcIcon = SOURCE_META[chain.source].icon
                return (
                  <button
                    key={chain.id}
                    type="button"
                    onClick={() => selectChain(chain.id)}
                    aria-pressed={selected}
                    className={cn(
                      'inline-flex max-w-[210px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                      selected
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border/70 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <SrcIcon className="h-3 w-3 shrink-0" />
                    <span className="truncate">{chain.goal}</span>
                  </button>
                )
              })}
            </div>
          )}

          {activeChain && (
            <>
              {/* Active goal summary header */}
              <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {SOURCE_META[activeChain.source].label} · {activeChain.actor}
                  </span>
                  <StatusLabel status={activeChain.status} />
                </div>
                <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
                  {activeChain.goal}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  <span>{activeChain.nodes.length} nodes</span>
                  <span>·</span>
                  <span>{activeChain.decisionCount} decisions</span>
                  <span>·</span>
                  <span className={activeChain.correctionCount > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}>
                    {activeChain.correctionCount} self-corrections
                  </span>
                  <span>·</span>
                  <span>{formatClock(activeChain.startedAt)}</span>
                </div>

                {/* Node kind filter bar */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  {FILTERS.map((f) => {
                    const active = filter === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-md px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                          active
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Timeline nodes */}
              <div className="nice-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {visibleNodes.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No {filter.replace('_', ' ')} nodes recorded in this chain.
                  </p>
                ) : (
                  <ol aria-label="Reasoning timeline">
                    {visibleNodes.map((node, idx) => (
                      <ReasoningNodeRow
                        key={node.id}
                        node={node}
                        isLast={idx === visibleNodes.length - 1}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
