'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Cpu,
  Download,
  FileText,
  GitBranch,
  ImageIcon,
  Loader2,
  Maximize2,
  ShieldAlert,
  UserRound,
  Wrench,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { RunDTO, RunEventDTO } from '@/lib/agent/client'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { cn } from '@/lib/utils'

interface StepInfo {
  id: number
  description: string
  assignee: string
}

interface SubagentInfo {
  name: string
  role: string
}

const CAP_LABELS: Record<string, string> = {
  skill: 'SKILL',
  tool: 'TOOL',
  plugin: 'PLUGIN',
  mcp: 'MCP',
  memory: 'MEM',
}

const STATUS_LABEL: Record<string, string> = {
  planning: 'Planning',
  executing: 'Working',
  synthesizing: 'Writing up',
  done: 'Completed',
  error: 'Failed',
  stopped: 'Stopped',
}

function evData<T>(e: RunEventDTO): T {
  return e.data as T
}

/** ChatGPT-style "generating image" placeholder — shimmering box with the prompt. */
function ImageGeneratingCard({ prompt, size }: { prompt: string; size?: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-black/25">
      <div className="relative flex aspect-square max-h-72 w-full max-w-xs items-center justify-center overflow-hidden bg-white/[0.02]">
        <div className="shimmer-line absolute inset-0" />
        <div className="relative flex flex-col items-center gap-2.5 text-center px-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] shimmer-ring">
            <ImageIcon className="h-5 w-5 text-zinc-300" />
          </div>
          <span className="shimmer-text-soft text-[12px] font-medium">Creating image…</span>
          <span className="font-mono text-[9.5px] text-muted-foreground/60">
            {size ?? '1024×1024'} · {elapsed}s
          </span>
        </div>
      </div>
      <div className="border-t border-white/[0.06] px-3 py-2">
        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{prompt}</p>
      </div>
    </div>
  )
}

/** Finished image card — the generated picture with its prompt and actions. */
function ImageResultCard({ url, prompt }: { url: string; prompt: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <figure className="w-fit overflow-hidden rounded-lg border border-border bg-muted/40 dark:border-white/[0.08] dark:bg-black/25">
      {broken ? (
        <div className="flex h-44 w-72 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
          <ImageIcon className="h-5 w-5 opacity-60" />
          <span>Unable to preview image</span>
          <a href={url} target="_blank" rel="noreferrer" className="underline">
            Open file directly
          </a>
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="group relative block">
          <img
            src={url}
            alt={prompt || 'Generated image'}
            className="max-h-80 w-auto max-w-full rounded-t-lg"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-white/15 bg-black/60 px-2 py-1 text-[10px] font-mono text-zinc-200 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
            <Maximize2 className="h-3 w-3" /> open
          </span>
        </a>
      )}
      <figcaption className="flex items-center gap-2 border-t border-border/70 px-3 py-1.5 dark:border-white/[0.06]">
        <ImageIcon className="h-3 w-3 shrink-0 text-zinc-500" />
        <span className="line-clamp-1 text-[10.5px] text-muted-foreground">{prompt}</span>
        <a
          href={url}
          download
          className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Download className="h-3 w-3" /> save
        </a>
      </figcaption>
    </figure>
  )
}

function ToolDisplay({ display }: { display: Record<string, unknown> | null | undefined }) {
  if (!display) return null
  const kind = String(display.kind ?? '')

  if (kind === 'search') {
    const results = (display.results as { title: string; url: string; snippet: string; host: string; date?: string }[]) ?? []
    return (
      <div className="space-y-1.5">
        {results.map((r, i) => (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border border-white/6 bg-black/25 px-2.5 py-2 hover:border-white/20 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-zinc-100 truncate">{r.title}</span>
              <span className="terminal-label text-[8px] text-muted-foreground shrink-0">{r.host}</span>
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{r.snippet}</p>
          </a>
        ))}
      </div>
    )
  }

  if (kind === 'image') {
    return <ImageResultCard url={String(display.url ?? '')} prompt={String(display.prompt ?? '')} />
  }

  if (kind === 'images') {
    const items = (display.items as { url: string; caption?: string }[]) ?? []
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((it, i) => (
          <figure key={i} className="space-y-1">
            <img
              src={it.url}
              alt={it.caption ?? 'Search result'}
              className="h-28 w-full rounded-md border border-border object-cover dark:border-white/10"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {it.caption && <figcaption className="text-[10px] text-muted-foreground line-clamp-1">{it.caption}</figcaption>}
          </figure>
        ))}
      </div>
    )
  }

  if (kind === 'code') {
    return (
      <div className="space-y-1.5">
        <pre className="nice-scroll overflow-x-auto rounded-md bg-black/40 border border-white/5 p-2.5 text-[11px] font-mono text-zinc-200">
          {String(display.code ?? '')}
        </pre>
        <pre
          className={cn(
            'nice-scroll overflow-x-auto rounded-md border p-2.5 text-[11px] font-mono whitespace-pre-wrap',
            display.ok ? 'border-white/5 bg-black/30 text-zinc-300' : 'border-red-400/30 bg-red-400/5 text-red-200'
          )}
        >
          {String(display.output ?? '')}
        </pre>
      </div>
    )
  }

  if (kind === 'audio') {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground line-clamp-2">{String(display.text ?? '')}</p>
        <audio controls src={String(display.url ?? '')} className="w-full h-8" preload="none" />
      </div>
    )
  }

  if (kind === 'weather') {
    const place = String(display.place ?? '')
    const temperature = display.temperature as number | undefined
    const forecast = (display.forecast as { date: string; condition: string; min: number; max: number }[]) ?? []
    return (
      <div className="rounded-lg border border-sky-400/20 bg-sky-400/[0.04] px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[13px] font-semibold text-zinc-100">{place}</span>
          <span className="text-[20px] font-semibold tabular-nums text-zinc-50">
            {temperature !== undefined ? `${Math.round(temperature)}°C` : '—'}
          </span>
          <span className="text-[12px] capitalize text-sky-200/90">{String(display.condition ?? '')}</span>
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          feels {display.feelsLike !== undefined ? `${Math.round(display.feelsLike as number)}°C` : '—'} ·{' '}
          {display.humidity !== undefined ? `${Math.round(display.humidity as number)}% humidity` : '—'} ·{' '}
          {display.windKmh !== undefined ? `${Math.round(display.windKmh as number)} km/h wind` : '—'}
        </div>
        {forecast.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {forecast.map((f) => (
              <span
                key={f.date}
                className="rounded border border-white/[0.08] bg-black/25 px-2 py-1 font-mono text-[9.5px] text-zinc-300"
              >
                {f.date.slice(5)} {Math.round(f.min)}–{Math.round(f.max)}°C
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (kind === 'files') {
    const files = (display.files as string[]) ?? []
    return (
      <div className="flex flex-wrap gap-1.5">
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] font-mono text-zinc-300">
            <FileText className="h-3 w-3" /> {f}
          </span>
        ))}
      </div>
    )
  }

  const text = String((display as { text?: string }).text ?? '')
  if (text) {
    return <p className="whitespace-pre-wrap text-[12px] text-zinc-300 max-h-44 overflow-y-auto nice-scroll">{text}</p>
  }
  return null
}

/** Compact, collapsible agent trace attached below the user message that started the run. */
export function MissionBlock({ run, live }: { run: RunDTO; live: boolean }) {
  const events = useMemo(() => [...run.events].sort((a, b) => a.seq - b.seq), [run.events])
  const [open, setOpen] = useState(live)
  const wasLive = useRef(live)
  const reasoningChainItem = useEvaControl((s) => s.reasoningChains.find((c) => c.runId === run.id) ?? null)
  const openReasoningForChain = useEvaControl((s) => s.openReasoningForChain)

  // auto-open while live, auto-collapse once the run finishes (Claude-style)
  useEffect(() => {
    if (live) {
      setOpen(true)
    } else if (wasLive.current) {
      setOpen(false)
    }
    wasLive.current = live
  }, [live])

  const analysis = events.find((e) => e.type === 'analysis')
  const analysisData = analysis
    ? evData<{ analysis: string; steps: StepInfo[]; subagents: SubagentInfo[]; task: string }>(analysis)
    : null

  const steps: StepInfo[] = analysisData?.steps ?? []
  const subagents: SubagentInfo[] = analysisData?.subagents ?? []
  const startedStepIds = new Set(
    events.filter((e) => e.type === 'step_start').map((e) => evData<{ stepId: number }>(e).stepId)
  )
  const doneStepIds = new Set(
    events.filter((e) => e.type === 'step_done').map((e) => evData<{ stepId: number }>(e).stepId)
  )
  const toolCalls = events.filter((e) => e.type === 'tool_call').length
  const errorEvent = events.find((e) => e.type === 'error')

  const isWorking = live && !['done', 'error', 'stopped'].includes(run.status)
  const isError = run.status === 'error' || Boolean(errorEvent)
  const isDone = run.status === 'done'

  // pair tool_call with the following tool_result
  const feed: { kind: 'thought' | 'tool' | 'subagent' | 'memory' | 'error' | 'brain'; e: RunEventDTO; pair?: RunEventDTO }[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.type === 'thought') feed.push({ kind: 'thought', e })
    else if (e.type === 'tool_call') {
      const pair = events[i + 1]?.type === 'tool_result' ? events[i + 1] : undefined
      feed.push({ kind: 'tool', e, pair })
      if (pair) i++
    } else if (e.type === 'subagent_spawn') feed.push({ kind: 'subagent', e })
    else if (e.type === 'memory_saved') feed.push({ kind: 'memory', e })
    else if (e.type === 'error') feed.push({ kind: 'error', e })
    else if (e.type === 'brain_context' || e.type === 'coach') feed.push({ kind: 'brain', e })
  }

  // current activity label for the header while working
  let activity = 'Analyzing the task'
  if (events.length > 0) {
    const last = feed[feed.length - 1]
    if (isWorking && last) {
      if (last.kind === 'tool') {
        const d = evData<{ toolName: string; tool: string }>(last.e)
        activity = `Running ${d.toolName ?? d.tool}`
      } else if (last.kind === 'thought') {
        activity = 'Thinking'
      } else if (last.kind === 'subagent') {
        activity = `Delegating to ${evData<{ name: string }>(last.e).name}`
      }
    }
    if (run.status === 'synthesizing') activity = 'Writing the final answer'
  }

  const durationSec = Math.max(
    0,
    Math.round(((events.length > 0 ? new Date(events[events.length - 1].createdAt).getTime() : Date.now()) - new Date(run.createdAt).getTime()) / 1000)
  )

  const summary = isWorking
    ? activity
    : isError
      ? 'Mission failed'
      : [
          steps.length > 0 ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : null,
          toolCalls > 0 ? `${toolCalls} tool call${toolCalls === 1 ? '' : 's'}` : null,
          subagents.length > 0 ? `${subagents.length} subagent${subagents.length === 1 ? '' : 's'}` : null,
          `${durationSec}s`,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <section aria-label="Agent activity trace" className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
      {/* summary header — always visible, toggles the trace */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isWorking ? 'bg-zinc-300 pulse-dot' : isError ? 'bg-red-400' : isDone ? 'bg-emerald-400/80' : 'bg-zinc-500'
          )}
        />
        {isWorking ? (
          <span className="shimmer-text-soft min-w-0 flex-1 truncate text-[12px] font-medium">{summary}</span>
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-[12px]', isError ? 'text-red-300' : 'text-muted-foreground')}>
            <span className="text-foreground/70">{STATUS_LABEL[run.status] ?? 'Agent'}{' '}</span>
            {summary}
          </span>
        )}
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-90')} />
      </button>

      {reasoningChainItem && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-1.5 text-[11px]">
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            <span className="truncate font-mono text-[10.5px] tabular-nums">
              {reasoningChainItem.decisionCount} decision{reasoningChainItem.decisionCount === 1 ? '' : 's'}
              {reasoningChainItem.correctionCount > 0
                ? ` · ${reasoningChainItem.correctionCount} self-correction${reasoningChainItem.correctionCount === 1 ? '' : 's'}`
                : ''}
              {reasoningChainItem.verificationPassed !== null
                ? reasoningChainItem.verificationPassed
                  ? ' · verified'
                  : ' · unverified'
                : ' · active'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => openReasoningForChain(reasoningChainItem.id)}
            className="shrink-0 font-mono text-[10.5px] font-medium text-sky-600 transition-colors hover:underline dark:text-sky-400"
          >
            Inspect chain
          </button>
        </div>
      )}

      {open && (
        <div className="space-y-4 border-t border-white/[0.06] p-4">
          {/* planning state */}
          {events.length === 0 && (
            <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              <span className="blink-cursor">Analyzing task and selecting capabilities</span>
            </div>
          )}

          {/* analysis + plan */}
          {analysisData && (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                <p className="text-[13px] leading-relaxed text-zinc-300">{analysisData.analysis}</p>
              </div>

              {/* capability chips */}
              {events.filter((e) => e.type === 'capability').length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {events
                    .filter((e) => e.type === 'capability')
                    .map((e, i) => {
                      const d = evData<{ type: string; name: string; reason: string }>(e)
                      return (
                        <span
                          key={i}
                          title={d.reason}
                          className="inline-flex max-w-full items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10.5px] font-mono text-zinc-300"
                        >
                          <span className="terminal-label text-[8px] text-muted-foreground/80">{CAP_LABELS[d.type] ?? 'CAP'}</span>
                          <span className="truncate">{d.name}</span>
                        </span>
                      )
                    })}
                </div>
              )}

              {/* plan checklist */}
              {steps.length > 0 && (
                <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                  <div className="terminal-label mb-2 text-[9px] text-muted-foreground/70">plan</div>
                  <ol className="space-y-1.5">
                    {steps.map((s, i) => {
                      const done = doneStepIds.has(s.id)
                      const active = startedStepIds.has(s.id) && !done
                      return (
                        <li key={s.id} className="flex items-start gap-2.5 text-[12.5px]">
                          {done ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                          ) : active ? (
                            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-zinc-300" />
                          ) : (
                            <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className={cn('leading-snug', done ? 'text-zinc-500' : active ? 'text-foreground' : 'text-muted-foreground')}>
                              <span className="font-mono text-[10px] text-muted-foreground/60 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
                              {s.description}
                            </span>
                            {s.assignee !== 'Lead Agent' && s.assignee !== 'Eva' && (
                              <Badge variant="outline" className="ml-2 h-4 border-white/[0.1] bg-white/[0.04] px-1.5 text-[9px] text-zinc-300">
                                <UserRound className="mr-1 h-2.5 w-2.5" /> {s.assignee}
                              </Badge>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* live feed */}
          {feed.length > 0 && (
            <div className="space-y-2.5 border-l-2 border-white/[0.07] pl-3.5 ml-1">
              {feed.map((f, i) => {
                if (f.kind === 'thought') {
                  const d = evData<{ actor: string; text: string }>(f.e)
                  return (
                    <div key={i} className="flex items-start gap-2 text-[12px]">
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      <span className="text-muted-foreground">
                        <span className="font-mono text-[10.5px] text-zinc-400">{d.actor}</span>
                        <span className="mx-1.5 text-muted-foreground/40">·</span>
                        {d.text}
                      </span>
                    </div>
                  )
                }
                if (f.kind === 'subagent') {
                  const d = evData<{ name: string; role: string }>(f.e)
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                      <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="terminal-label text-[9px] text-zinc-400">subagent — {d.name}</div>
                        <p className="text-[12px] text-zinc-300">{d.role}</p>
                      </div>
                    </div>
                  )
                }
                if (f.kind === 'memory') {
                  const d = evData<{ content: string; type: string }>(f.e)
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                      <Brain className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="terminal-label text-[9px] text-zinc-400">memory saved [{d.type}]</div>
                        <p className="text-[12px] text-zinc-300">{d.content}</p>
                      </div>
                    </div>
                  )
                }
                if (f.kind === 'brain') {
                  const d = evData<{ note?: string; recalled?: number; lessons?: number }>(f.e)
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                      <Brain className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="terminal-label text-[9px] text-zinc-400">
                          {f.e.type === 'coach' ? 'coach — lessons applied' : 'nexus brain — memory recalled'}
                        </div>
                        <p className="text-[12px] text-zinc-300">
                          {f.e.type === 'coach'
                            ? `${d.lessons ?? 0} lesson${(d.lessons ?? 0) === 1 ? '' : 's'} from past missions injected into this plan`
                            : d.note ?? `${d.recalled ?? 0} memories recalled`}
                        </p>
                      </div>
                    </div>
                  )
                }
                if (f.kind === 'error') {
                  const d = evData<{ message: string }>(f.e)
                  return (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-red-400/25 bg-red-400/6 px-3 py-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                      <p className="text-[12px] text-red-200">{d.message}</p>
                    </div>
                  )
                }
                // tool call + result
                const d = evData<{ actor: string; tool: string; toolName: string; args: Record<string, unknown> }>(f.e)
                const rd = f.pair ? evData<{ ok: boolean; summary: string; display: Record<string, unknown> | null }>(f.pair) : null

                // image generation gets its own visual treatment — generating
                // placeholder while running, image card when done (like ChatGPT)
                const isImageTool = d.tool === 'generate_image'
                const imagePrompt = String(d.args?.prompt ?? '')
                const imageDone = isImageTool && rd?.ok && rd.display?.kind === 'image'
                if (isImageTool && !imageDone) {
                  return (
                    <div key={i} className="space-y-2">
                      {!rd && (
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Wrench className="h-3.5 w-3.5" />
                          <span className="font-mono text-zinc-300">Generate Image</span>
                          <span>via {d.actor}</span>
                        </div>
                      )}
                      {!rd ? (
                        isWorking ? (
                          <ImageGeneratingCard prompt={imagePrompt} size={String(d.args?.size ?? '')} />
                        ) : (
                          <div className="rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2.5 text-[12px] text-muted-foreground">
                            Image generation was interrupted before completing.
                          </div>
                        )
                      ) : (
                        <div className="rounded-lg border border-red-400/25 bg-red-400/6 px-3 py-2.5 text-[12px] text-red-200">
                          Image generation failed — {rd.summary}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={i} className="rounded-lg border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                      <Wrench className="h-3.5 w-3.5 text-zinc-400" />
                      <span className="font-mono text-[11px] text-zinc-200">{d.toolName ?? d.tool}</span>
                      <span className="text-[10px] text-muted-foreground">via {d.actor}</span>
                      <span className="ml-auto">
                        {!f.pair ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-300" />
                        ) : rd?.ok ? (
                          <Zap className="h-3.5 w-3.5 text-zinc-400" />
                        ) : (
                          <ShieldAlert className="h-3.5 w-3.5 text-red-300" />
                        )}
                      </span>
                    </div>
                    <div className="px-3 py-2.5 space-y-2">
                      {isImageTool ? null : (
                        <p className="font-mono text-[10.5px] text-muted-foreground truncate">
                          {JSON.stringify(d.args ?? {}).slice(0, 160)}
                        </p>
                      )}
                      {rd ? (
                        <>
                          <p className="text-[11px] text-zinc-400">{rd.summary}</p>
                          <ToolDisplay display={rd.display} />
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground blink-cursor">executing</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* working shimmer hairline */}
          {isWorking && <div className="h-0.5 rounded shimmer-line" />}
        </div>
      )}
    </section>
  )
}
