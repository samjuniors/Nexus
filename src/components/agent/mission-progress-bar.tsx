'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { CheckCircle2, CircleDashed, GitBranch, Loader2, XCircle } from 'lucide-react'
import type { RunDTO } from '@/lib/agent/client'
import {
  extractMissionProgress,
  type MissionSubtaskItem,
  type SubtaskStatus,
} from '@/lib/agent/mission-progress'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

const STATUS_FILL: Record<SubtaskStatus, string> = {
  done: '#10b981', // emerald-500
  running: '#0ea5e9', // sky-500
  failed: '#ef4444', // red-500
  pending: '#64748b', // slate-500 (rendered with lower opacity)
}

const STATUS_LABEL: Record<SubtaskStatus, string> = {
  done: 'Completed',
  running: 'In Progress',
  failed: 'Failed',
  pending: 'Queued',
}

/**
 * Persistent 'Mission Progress' status bar mounted at the top of the Agent chat view.
 * Uses D3.js (`d3.select`, `d3.scaleBand`, `d3.scaleLinear`, SVG transitions) to visualize
 * the completion status of sub-tasks for the active or latest mission.
 */
export function MissionProgressBar({
  run,
  live,
}: {
  run: RunDTO | null
  live: boolean
}) {
  const snapshot = useMemo(() => extractMissionProgress(run, live), [run, live])
  const openReasoningForChain = useEvaControl((s) => s.openReasoningForChain)
  const matchingChain = useEvaControl((s) =>
    run ? (s.reasoningChains.find((c) => c.runId === run.id) ?? null) : null
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [chartWidth, setChartWidth] = useState(320)
  const [hoveredTask, setHoveredTask] = useState<{
    task: MissionSubtaskItem
    leftPct: number
  } | null>(null)

  // Track responsive container width for crisp D3 SVG redraws
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width)
      if (w > 40) setChartWidth(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Render D3.js sub-task segmented progress visualization
  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return

    const width = Math.max(120, chartWidth)
    const height = 22
    const trackY = 7
    const trackH = 8
    const svg = d3.select(svgEl)
    svg.attr('viewBox', `0 0 ${width} ${height}`)

    // Ensure layer groups exist in deterministic order
    let trackLayer = svg.select<SVGGElement>('g.d3-track-layer')
    if (trackLayer.empty()) trackLayer = svg.append('g').attr('class', 'd3-track-layer')

    let segLayer = svg.select<SVGGElement>('g.d3-segments-layer')
    if (segLayer.empty()) segLayer = svg.append('g').attr('class', 'd3-segments-layer')

    let nodeLayer = svg.select<SVGGElement>('g.d3-nodes-layer')
    if (nodeLayer.empty()) nodeLayer = svg.append('g').attr('class', 'd3-nodes-layer')

    // 1. Background rail
    trackLayer
      .selectAll<SVGRectElement, number>('rect.rail-bg')
      .data([width])
      .join('rect')
      .attr('class', 'rail-bg')
      .attr('x', 0)
      .attr('y', trackY)
      .attr('width', (d) => d)
      .attr('height', trackH)
      .attr('rx', 4)
      .attr('fill', 'currentColor')
      .attr('fill-opacity', 0.1)

    // Idle baseline mode (no subtasks yet)
    if (!snapshot.hasMission || snapshot.subtasks.length === 0) {
      segLayer.selectAll('*').remove()
      nodeLayer.selectAll('*').remove()
      return
    }

    const subtasks = snapshot.subtasks

    // 2. D3 scaleBand for sub-task segments
    const xBand = d3
      .scaleBand<number>()
      .domain(subtasks.map((d) => d.id))
      .range([0, width])
      .paddingInner(subtasks.length > 1 ? 0.04 : 0)
      .paddingOuter(0)

    const segW = Math.max(6, xBand.bandwidth())

    // Subtle overall linear progress underlay for smooth continuity
    const xLinear = d3.scaleLinear().domain([0, 100]).range([0, width])
    trackLayer
      .selectAll<SVGRectElement, number>('rect.rail-progress')
      .data([snapshot.percent])
      .join('rect')
      .attr('class', 'rail-progress')
      .attr('x', 0)
      .attr('y', trackY)
      .attr('height', trackH)
      .attr('rx', 4)
      .attr('fill', snapshot.phase === 'error' ? '#ef4444' : '#10b981')
      .attr('fill-opacity', 0.14)
      .transition()
      .duration(260)
      .attr('width', (d) => xLinear(d))

    // 3. Individual D3 sub-task completion segments
    segLayer
      .selectAll<SVGRectElement, MissionSubtaskItem>('rect.subtask-seg')
      .data(subtasks, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('rect')
            .attr('class', 'subtask-seg')
            .attr('y', trackY)
            .attr('height', trackH)
            .attr('rx', 3.5)
            .attr('x', (d) => xBand(d.id) ?? 0)
            .attr('width', 0)
            .attr('fill', (d) => STATUS_FILL[d.status])
            .attr('fill-opacity', (d) => (d.status === 'pending' ? 0.22 : 0.92))
            .style('cursor', 'pointer')
            .call((sel) =>
              sel
                .transition()
                .duration(280)
                .attr('width', segW)
            ),
        (update) =>
          update
            .style('cursor', 'pointer')
            .call((sel) =>
              sel
                .transition()
                .duration(260)
                .attr('x', (d) => xBand(d.id) ?? 0)
                .attr('width', segW)
                .attr('fill', (d) => STATUS_FILL[d.status])
                .attr('fill-opacity', (d) => (d.status === 'pending' ? 0.22 : 0.92))
            ),
        (exit) => exit.remove()
      )
      .on('mouseenter', (_event, d) => {
        const cx = (xBand(d.id) ?? 0) + segW / 2
        setHoveredTask({ task: d, leftPct: Math.max(8, Math.min(92, (cx / width) * 100)) })
      })
      .on('mouseleave', () => setHoveredTask(null))

    // 4. Center milestone markers on each sub-task segment
    nodeLayer
      .selectAll<SVGCircleElement, MissionSubtaskItem>('circle.subtask-node')
      .data(subtasks, (d) => d.id)
      .join('circle')
      .attr('class', 'subtask-node')
      .attr('cy', trackY + trackH / 2)
      .attr('cx', (d) => (xBand(d.id) ?? 0) + segW / 2)
      .attr('r', (d) => (d.status === 'running' ? 4.5 : 3))
      .attr('fill', (d) => (d.status === 'pending' ? 'transparent' : '#ffffff'))
      .attr('fill-opacity', (d) => (d.status === 'pending' ? 0 : 0.92))
      .attr('stroke', (d) => STATUS_FILL[d.status])
      .attr('stroke-width', (d) => (d.status === 'running' ? 2 : 1.5))
      .style('pointer-events', 'none')
  }, [chartWidth, snapshot])

  const phaseDotClass =
    snapshot.phase === 'done'
      ? 'bg-emerald-500'
      : snapshot.phase === 'error'
        ? 'bg-red-500'
        : snapshot.phase === 'running' || snapshot.phase === 'planning' || snapshot.phase === 'synthesizing'
          ? 'bg-sky-500 pulse-dot'
          : 'bg-muted-foreground/45'

  return (
    <section
      aria-label="Mission Progress status bar"
      data-mission-progress-bar="1"
      data-mission-phase={snapshot.phase}
      className="relative border-b border-border/70 bg-background/85 px-4 py-2 backdrop-blur-sm md:px-6"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        {/* Left: Status & Mission label */}
        <div className="flex min-w-0 items-center gap-2 sm:w-52 sm:shrink-0">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', phaseDotClass)} aria-hidden />
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mission
          </span>
          <span
            className="min-w-0 truncate text-[12px] font-medium text-foreground"
            title={snapshot.title}
          >
            {snapshot.hasMission ? snapshot.title : 'Ready'}
          </span>
        </div>

        {/* Center: D3.js Sub-task Completion Bar */}
        <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center">
          <svg
            ref={svgRef}
            role="img"
            aria-label={
              snapshot.hasMission
                ? `Mission progress: ${snapshot.completed} of ${snapshot.total} sub-tasks completed (${snapshot.percent}%)`
                : 'Mission progress: idle, no active sub-tasks'
            }
            data-d3-mission-svg="1"
            className="block h-[22px] w-full overflow-visible text-foreground"
          />

          {/* Interactive hover tooltip for individual D3 sub-task segment */}
          {hoveredTask && (
            <div
              role="tooltip"
              style={{ left: `${hoveredTask.leftPct}%` }}
              className="pointer-events-none absolute top-full z-30 mt-1.5 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-md"
            >
              <div className="flex items-center justify-between gap-2 text-[10.5px]">
                <span className="inline-flex items-center gap-1 font-mono font-medium">
                  {hoveredTask.task.status === 'done' ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  ) : hoveredTask.task.status === 'running' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-sky-500" />
                  ) : hoveredTask.task.status === 'failed' ? (
                    <XCircle className="h-3 w-3 text-red-500" />
                  ) : (
                    <CircleDashed className="h-3 w-3 text-muted-foreground" />
                  )}
                  Step {String(hoveredTask.task.index).padStart(2, '0')} · {STATUS_LABEL[hoveredTask.task.status]}
                </span>
                <span className="truncate font-mono text-[9.5px] text-muted-foreground">
                  {hoveredTask.task.assignee}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-foreground">
                {hoveredTask.task.description}
              </p>
            </div>
          )}
        </div>

        {/* Right: Tabular progress readout + optional Reasoning Chain shortcut */}
        <div className="flex shrink-0 items-center justify-between gap-2.5 sm:justify-end">
          <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
            {snapshot.hasMission ? (
              <>
                <span className="text-foreground font-medium">
                  {snapshot.completed}/{snapshot.total}
                </span>
                <span aria-hidden className="text-border">·</span>
                <span
                  className={cn(
                    snapshot.phase === 'done'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : snapshot.phase === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : snapshot.phase === 'running' || snapshot.phase === 'planning'
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-muted-foreground'
                  )}
                >
                  {snapshot.percent}%
                </span>
                <span className="hidden text-[10px] text-muted-foreground md:inline">
                  {snapshot.phaseLabel}
                </span>
              </>
            ) : (
              <span className="text-[10.5px]">0/0 · Idle</span>
            )}
          </div>

          {matchingChain && (
            <button
              type="button"
              onClick={() => openReasoningForChain(matchingChain.id)}
              title="Inspect Reasoning Chain for this mission"
              className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <GitBranch className="h-3 w-3 text-sky-500" />
              <span className="hidden lg:inline">Trace</span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
