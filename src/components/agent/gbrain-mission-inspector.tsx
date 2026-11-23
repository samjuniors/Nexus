'use client'

import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  Link2,
  Loader2,
  Lock,
  Target,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  MISSION_STATUS_META,
  type MissionGraphNode,
  type MissionOverlayGraph,
  type MissionTaskStatus,
} from '@/lib/agent/gbrain-mission-graph'
import { GBRAIN_CATEGORY_MAP, type GBrainCategoryId } from '@/lib/agent/gbrain-categories'
import { cn } from '@/lib/utils'

function StatusGlyph({ status, className }: { status: MissionTaskStatus; className?: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className={cn('h-3.5 w-3.5 text-emerald-500', className)} />
    case 'running':
      return <Loader2 className={cn('h-3.5 w-3.5 animate-spin text-sky-500', className)} />
    case 'failed':
      return <XCircle className={cn('h-3.5 w-3.5 text-red-500', className)} />
    case 'blocked':
      return <Lock className={cn('h-3.5 w-3.5 text-amber-500', className)} />
    case 'pending':
      return <Circle className={cn('h-3.5 w-3.5 text-muted-foreground', className)} />
  }
}

export function GBrainMissionInspector({
  node,
  mission,
  entityLookup,
  onFocusMissionNode,
  onFocusEntityNode,
  onOpenReasoningChain,
}: {
  node: MissionGraphNode
  mission: MissionOverlayGraph
  entityLookup: Map<string, { id: string; name: string; category: GBrainCategoryId }>
  onFocusMissionNode: (id: string) => void
  onFocusEntityNode: (id: string) => void
  onOpenReasoningChain: () => void
}) {
  const statusMeta = MISSION_STATUS_META[node.status]
  const missionNodeById = new Map(mission.nodes.map((n) => [n.id, n]))
  const upstreamNodes = node.dependsOn
    .map((id) => missionNodeById.get(id))
    .filter((n): n is MissionGraphNode => Boolean(n))
  const downstreamNodes = node.dependents
    .map((id) => missionNodeById.get(id))
    .filter((n): n is MissionGraphNode => Boolean(n))
  const linkedEntities = node.linkedEntityIds
    .map((id) => entityLookup.get(id))
    .filter((e): e is { id: string; name: string; category: GBrainCategoryId } => Boolean(e))

  return (
    <div data-gbrain-mission-inspector="1" className="space-y-4 p-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {node.nodeKind === 'mission_root' ? (
            <Target className="h-3.5 w-3.5 text-sky-500" />
          ) : (
            <StatusGlyph status={node.status} />
          )}
          <span className={cn('font-medium', statusMeta.textClass)}>{node.statusLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[10.5px] tabular-nums">
            {node.nodeKind === 'mission_root'
              ? `${mission.completed}/${mission.total} tasks · ${mission.percent}%`
              : `Sub-goal ${node.stepIndex}/${node.totalSteps}`}
          </span>
        </div>
        <h3 className="mt-1.5 text-sm font-semibold leading-snug text-foreground">
          {node.description}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3 shrink-0" />
          <span className="text-foreground/90">{node.assignee}</span>
          {node.assigneeRole && (
            <>
              <span aria-hidden="true">·</span>
              <span>{node.assigneeRole}</span>
            </>
          )}
        </div>
      </div>

      {/* Mission Root Progress Bar */}
      {node.nodeKind === 'mission_root' && (
        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted-foreground">Mission progress</span>
            <span className="font-mono text-[11px] tabular-nums text-foreground">
              {mission.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${mission.percent}%`,
                backgroundColor: statusMeta.accent,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">{mission.completed} done</span>
            <span>·</span>
            <span className="text-sky-600 dark:text-sky-400">{mission.running} running</span>
            {mission.failed > 0 && (
              <>
                <span>·</span>
                <span className="text-red-600 dark:text-red-400">{mission.failed} failed</span>
              </>
            )}
            {mission.blocked > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-600 dark:text-amber-400">{mission.blocked} blocked</span>
              </>
            )}
            {mission.pending > 0 && (
              <>
                <span>·</span>
                <span>{mission.pending} queued</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Blocked dependency callout */}
      {node.status === 'blocked' && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Blocked by a failed upstream dependency. Inspect upstream tasks below to recover.</span>
        </div>
      )}

      {/* Upstream Dependencies */}
      {upstreamNodes.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            Depends on ({upstreamNodes.length})
          </div>
          <div className="space-y-1">
            {upstreamNodes.map((up) => (
              <button
                key={up.id}
                type="button"
                onClick={() => onFocusMissionNode(up.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-sky-500/40 hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusGlyph status={up.status} className="h-3 w-3 shrink-0" />
                  <span className="truncate font-medium text-foreground">
                    {up.nodeKind === 'mission_root' ? 'Mission Goal' : `Step ${up.stepIndex}: ${up.title}`}
                  </span>
                </span>
                <span className={cn('shrink-0 font-mono text-[10px]', MISSION_STATUS_META[up.status].textClass)}>
                  {up.statusLabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Downstream Dependents */}
      {downstreamNodes.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {node.nodeKind === 'mission_root' ? `Entry sub-goals (${downstreamNodes.length})` : `Unlocks (${downstreamNodes.length})`}
          </div>
          <div className="space-y-1">
            {downstreamNodes.map((down) => (
              <button
                key={down.id}
                type="button"
                onClick={() => onFocusMissionNode(down.id)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-sky-500/40 hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">
                    Step {down.stepIndex}: {down.title}
                  </span>
                </span>
                <span className={cn('shrink-0 font-mono text-[10px]', MISSION_STATUS_META[down.status].textClass)}>
                  {down.statusLabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Planned Tools / Capabilities */}
      {node.uses.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Wrench className="h-3 w-3" /> Planned capabilities
          </div>
          <div className="font-mono text-[11px] leading-relaxed text-foreground/85">
            {node.uses.join(' · ')}
          </div>
        </div>
      )}

      {/* Executed Tool Calls */}
      {node.toolExecutions.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            Tool executions ({node.toolExecutions.length})
          </div>
          <ul className="space-y-1.5">
            {node.toolExecutions.map((exec, idx) => (
              <li
                key={`${exec.tool}-${idx}`}
                className="rounded-md border border-border/70 bg-background/70 px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[10.5px]">
                  <span className="font-medium text-foreground">{exec.tool}</span>
                  <span className={exec.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {exec.ok ? 'ok' : 'error'}
                  </span>
                </div>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">{exec.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Linked GBrain Knowledge Entities */}
      {linkedEntities.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Link2 className="h-3 w-3" />
              <span>Linked GBrain entities ({linkedEntities.length})</span>
            </span>
            {node.status === 'running' && (
              <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400">
                Processing live
              </span>
            )}
          </div>
          <div className="space-y-1">
            {linkedEntities.map((ent) => {
              const cat = GBRAIN_CATEGORY_MAP[ent.category] ?? GBRAIN_CATEGORY_MAP.concepts
              const isLive = node.status === 'running'
              return (
                <button
                  key={ent.id}
                  type="button"
                  onClick={() => onFocusEntityNode(ent.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-sky-500/40 hover:bg-muted',
                    isLive
                      ? 'border-sky-500/35 bg-sky-500/8'
                      : 'border-border/70 bg-background/60'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: isLive ? '#38bdf8' : cat.accent }}
                    />
                    <span className="truncate font-medium text-foreground">{ent.name}</span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-[10px]',
                      isLive ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'
                    )}
                  >
                    {isLive ? 'Processing' : cat.shortLabel}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Analysis / Step Output */}
      {node.resultPreview && (
        <div className="border-t border-border/60 pt-3">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">
            {node.nodeKind === 'mission_root' ? 'Plan analysis' : 'Task output'}
          </div>
          <p className="text-[11.5px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {node.resultPreview}
          </p>
        </div>
      )}

      {/* Quick link to live Reasoning Chain */}
      <div className="border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={onOpenReasoningChain}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
        >
          <GitBranch className="h-3.5 w-3.5" />
          <span>Open full Reasoning Chain</span>
        </button>
      </div>
    </div>
  )
}
