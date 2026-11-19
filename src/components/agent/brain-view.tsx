'use client'

import { useRef, useState } from 'react'
import {
  Brain as BrainIcon,
  Cable,
  Check,
  ChevronDown,
  Cpu,
  Download,
  FolderSearch,
  GraduationCap,
  Loader2,
  Moon,
  Plus,
  Puzzle,
  Server,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wrench,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useApp } from '@/lib/agent/store'
import { cn } from '@/lib/utils'
import { api, type BrainCapabilityGroup, type PortableBrainBundleDTO } from '@/lib/agent/client'
import { KnowledgeGraphSection } from '@/components/agent/graph-section'
import { GBrainGraphButton } from '@/components/agent/gbrain-graph'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import { useToast } from '@/hooks/use-toast'

const GROUP_ICONS: Record<BrainCapabilityGroup['key'], typeof Wrench> = {
  tools: Wrench,
  skills: Sparkles,
  plugins: Puzzle,
  mcps: Server,
  memory: BrainIcon,
}

function CapabilityGroupCard({ group, brainOn }: { group: BrainCapabilityGroup; brainOn: boolean }) {
  const [open, setOpen] = useState(false)
  const Icon = GROUP_ICONS[group.key]
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button
        onClick={() => group.items.length > 0 && setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
          group.items.length > 0 && 'hover:bg-white/[0.03]'
        )}
      >
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
            brainOn
              ? 'border-white/10 bg-white/[0.05] text-zinc-300'
              : 'border-white/[0.06] bg-transparent text-zinc-600'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium">{group.label}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{group.count}</span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{group.description}</p>
        </div>
        {group.items.length > 0 && (
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {open && group.items.length > 0 && (
        <ul className="divide-y divide-white/[0.05] border-t border-white/[0.06]">
          {group.items.slice(0, 40).map((item) => (
            <li key={item.slug} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11.5px] text-zinc-200">{item.name}</span>
                <span className="font-mono text-[9.5px] text-muted-foreground/70">{item.slug}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {item.description}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BrainView() {
  const { toast } = useToast()
  const {
    brain,
    toggleBrain,
    setBrainPrefs,
    runDream,
    memories,
    runCoachReview,
    teachBrain,
    refreshBrain,
    refreshMemories,
    refreshSkills,
  } = useApp()
  const [busy, setBusy] = useState(false)
  const [dreamBusy, setDreamBusy] = useState(false)
  const [dreamReport, setDreamReport] = useState<{ summary: string; mergedCount: number; before: number; after: number } | null>(null)
  const [coachBusy, setCoachBusy] = useState(false)
  const [coachReport, setCoachReport] = useState<{ lessons: number; summary: string } | null>(null)
  const [teachText, setTeachText] = useState('')
  const [teachBusy, setTeachBusy] = useState(false)
  const [taught, setTaught] = useState<{ content: string; entities: number } | null>(null)
  const setGbrainGraphOpen = useEvaControl((s) => s.setGbrainGraphOpen)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexSummary, setIndexSummary] = useState<string | null>(null)
  const [portableBusy, setPortableBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const connected = brain?.connected ?? true
  const prefs = brain?.appPrefs

  const onToggle = async () => {
    setBusy(true)
    try {
      await toggleBrain(!connected)
    } finally {
      setBusy(false)
    }
  }

  const onPrefs = async (patch: { tone?: 'concise' | 'balanced' | 'thorough'; missionVerbosity?: 'brief' | 'balanced' | 'detailed'; autoDream?: boolean }) => {
    await setBrainPrefs(patch)
  }

  const onCoachReview = async () => {
    setCoachBusy(true)
    setCoachReport(null)
    try {
      const r = await runCoachReview()
      if (r) setCoachReport(r)
    } finally {
      setCoachBusy(false)
    }
  }

  const onTeach = async () => {
    const fact = teachText.trim()
    if (!fact) return
    setTeachBusy(true)
    setTaught(null)
    try {
      const r = await teachBrain(fact)
      if (r) {
        setTaught(r)
        setTeachText('')
      }
    } finally {
      setTeachBusy(false)
    }
  }

  const onDream = async () => {
    setDreamBusy(true)
    setDreamReport(null)
    try {
      const r = await runDream()
      if (r) setDreamReport(r)
    } finally {
      setDreamBusy(false)
    }
  }

  const onIndexProject = async () => {
    setIndexBusy(true)
    setIndexSummary(null)
    try {
      const res = await api.brainIndexProject()
      const scan = res.projectIndex.scan
      setIndexSummary(
        `Indexed ${scan.name} (${scan.framework}, ${scan.apiRoutes.length} routes, ${scan.prismaModels.length} models) — ${res.projectIndex.memoriesSaved} architectural facts stored.`
      )
      await Promise.all([refreshBrain(), refreshMemories()])
      toast({ title: 'Project indexed into brain' })
    } catch (e) {
      toast({
        title: 'Project scan failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setIndexBusy(false)
    }
  }

  const onExportPortable = async () => {
    setPortableBusy(true)
    try {
      const { bundle } = await api.brainExportPortable()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nexus-portable-brain-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast({
        title: 'Portable brain exported',
        description: `${bundle.memories.length} memories and ${bundle.skills.length} skills packaged.`,
      })
    } catch (e) {
      toast({
        title: 'Export failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setPortableBusy(false)
    }
  }

  const onImportPortable = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPortableBusy(true)
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as PortableBrainBundleDTO
      const res = await api.brainImportPortable(parsed)
      await Promise.all([refreshBrain(), refreshMemories(), refreshSkills()])
      toast({
        title: 'Portable brain imported',
        description: `Imported ${res.imported.memories} memories and ${res.imported.skills} skills.`,
      })
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setPortableBusy(false)
    }
  }

  return (
    <div className="nice-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        {/* header */}
        <div className="flex items-center gap-2.5">
          <BrainIcon className="h-4.5 w-4.5 text-zinc-400" />
          <h1 className="text-sm font-semibold tracking-tight">Brain</h1>
          <span className="terminal-label ml-1 text-[9px] text-muted-foreground/70">
            the smart overlay · two-brain architecture
          </span>
        </div>

        {/* ---- hero: the brain chip ---- */}
        <section
          className={cn(
            'relative mt-4 overflow-hidden rounded-2xl border transition-colors',
            connected
              ? 'border-white/[0.09] bg-white/[0.025]'
              : 'border-amber-400/20 bg-amber-400/[0.03]'
          )}
        >
          {connected && <div className="shimmer-line absolute inset-x-0 top-0 h-0.5" />}
          {!connected && <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-400/30" />}
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
            {/* brain visual */}
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border transition-all duration-500',
                  connected
                    ? 'border-white/15 bg-white/[0.05] shimmer-ring'
                    : 'border-white/[0.07] bg-black/20'
                )}
              >
                <BrainIcon
                  className={cn(
                    'h-8 w-8 transition-colors duration-500',
                    connected ? 'shimmer-text' : 'text-zinc-700'
                  )}
                />
                <span
                  className={cn(
                    'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-background transition-colors',
                    connected ? 'bg-emerald-400 pulse-dot glow-dot' : 'bg-zinc-600'
                  )}
                />
              </div>
              <div className="sm:hidden">
                <BrainStatusText connected={connected} personality={brain?.personality} />
              </div>
            </div>

            {/* status + summary */}
            <div className="min-w-0 flex-1">
              <div className="hidden sm:block">
                <BrainStatusText connected={connected} personality={brain?.personality} />
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                {connected
                  ? brain?.summary ?? 'Loading capability inventory…'
                  : 'Overlay paused — the app\'s own spine brain keeps routing, planning, tools and memory running like a normal agent app. You only lose the extras: recall citations, graph intelligence, dreams and app directives.'}
              </p>
              {brain?.llm && (
                <p className="mt-2 font-mono text-[10.5px] text-muted-foreground/80">
                  LLM: <span className={brain.llm.configured ? 'text-emerald-300/90' : 'text-amber-300/90'}>{brain.llm.provider}</span>
                  {brain.llm.model ? ` · ${brain.llm.model}` : ''}
                  {!brain.llm.configured && ' — add GEMINI_API_KEY in Settings > Secrets to run'}
                </p>
              )}
            </div>

            {/* master toggle */}
            <div className="flex shrink-0 items-center gap-3 self-start sm:self-center">
              <div className="text-right">
                <div className="terminal-label text-[8.5px] text-muted-foreground/70">
                  {connected ? 'disconnect' : 'connect'}
                </div>
                <div className={cn('text-[11px] font-medium', connected ? 'text-emerald-300/90' : 'text-amber-300/90')}>
                  {busy ? 'switching…' : connected ? 'overlay brain' : 'overlay brain'}
                </div>
              </div>
              <Switch
                checked={connected}
                disabled={busy}
                onCheckedChange={() => void onToggle()}
                aria-label={connected ? 'Disconnect brain' : 'Connect brain'}
                className="data-[state=checked]:bg-emerald-400/70 data-[state=unchecked]:bg-zinc-700"
              />
            </div>
          </div>

          {/* disconnected notice — honest, not scary */}
          {!connected && (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-amber-400/15 bg-amber-400/[0.04] px-5 py-3">
              <Cpu className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
              <p className="min-w-0 flex-1 text-[11.5px] text-amber-100/80">
                Spine brain active — the app still answers and runs missions with the LLM. Reconnect for the smart overlay.
              </p>
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
                disabled={busy}
                onClick={() => void onToggle()}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Connect overlay
              </Button>
            </div>
          )}
        </section>

        {/* ---- project intelligence & portable brain ---- */}
        <section className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <FolderSearch className="h-3.5 w-3.5 text-amber-300/80" />
                <h2 className="text-[12.5px] font-semibold">Project intelligence &amp; portable brain</h2>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Scan your codebase architecture into episodic memory or export/import the self-contained brain bundle across apps.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-white/10 bg-black/20 px-2.5 text-[11px]"
                disabled={indexBusy}
                onClick={() => void onIndexProject()}
              >
                {indexBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSearch className="h-3 w-3" />}
                Index Project
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-white/10 bg-black/20 px-2.5 text-[11px]"
                disabled={portableBusy}
                onClick={() => void onExportPortable()}
              >
                <Download className="h-3 w-3" />
                Export Brain
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-white/10 bg-black/20 px-2.5 text-[11px]"
                disabled={portableBusy}
                onClick={() => importRef.current?.click()}
              >
                <Upload className="h-3 w-3" />
                Import Bundle
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void onImportPortable(e)}
              />
            </div>
          </div>
          {indexSummary && (
            <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-[11.5px] text-amber-100/90">
              {indexSummary}
            </p>
          )}
        </section>

        {/* ---- app control: the brain's levers over the whole app ---- */}
        <section className={cn('mt-7 rounded-2xl border p-5 transition-colors', connected ? 'border-white/[0.07] bg-white/[0.02]' : 'border-white/[0.05] bg-white/[0.01] opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className={cn('h-3.5 w-3.5', connected ? 'text-sky-300/80' : 'text-zinc-600')} />
            <h2 className="text-[12.5px] font-semibold">App control</h2>
            <span className="text-[11px] text-muted-foreground">
              — the levers the connected brain holds over the whole app
            </span>
          </div>

          <div className="mt-3.5 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-200">Chat tone</div>
                <p className="text-[11px] text-muted-foreground">how every streamed chat answer is written</p>
              </div>
              <div className="flex overflow-hidden rounded-lg border border-white/10">
                {(['concise', 'balanced', 'thorough'] as const).map((t) => (
                  <button
                    key={t}
                    disabled={!connected || !prefs}
                    onClick={() => void onPrefs({ tone: t })}
                    className={cn(
                      'px-3 py-1.5 font-mono text-[10.5px] transition-colors disabled:cursor-not-allowed',
                      prefs?.tone === t
                        ? 'bg-sky-400/15 text-sky-200'
                        : 'text-muted-foreground hover:bg-white/[0.04] hover:text-zinc-200'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-200">Mission verbosity</div>
                <p className="text-[11px] text-muted-foreground">how detailed mission reports are</p>
              </div>
              <div className="flex overflow-hidden rounded-lg border border-white/10">
                {(['brief', 'balanced', 'detailed'] as const).map((v) => (
                  <button
                    key={v}
                    disabled={!connected || !prefs}
                    onClick={() => void onPrefs({ missionVerbosity: v })}
                    className={cn(
                      'px-3 py-1.5 font-mono text-[10.5px] transition-colors disabled:cursor-not-allowed',
                      prefs?.missionVerbosity === v
                        ? 'bg-sky-400/15 text-sky-200'
                        : 'text-muted-foreground hover:bg-white/[0.04] hover:text-zinc-200'
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-200">Auto-dream</div>
                <p className="text-[11px] text-muted-foreground">memory consolidation may run by itself when enough new memories pile up</p>
              </div>
              <Switch
                checked={prefs?.autoDream ?? true}
                disabled={!connected || !prefs}
                onCheckedChange={(v) => void onPrefs({ autoDream: v })}
                aria-label="Toggle auto-dream"
                className="data-[state=checked]:bg-violet-400/70 data-[state=unchecked]:bg-zinc-700"
              />
            </div>
          </div>
          {!connected && (
            <p className="mt-3 text-[11px] text-muted-foreground/70">
              Connect the brain to issue directives — while it&apos;s away the app uses its default behavior.
            </p>
          )}
        </section>

        {/* ---- capability inventory ---- */}
        <section className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5 text-zinc-500" />
            <h2 className="text-[12.5px] font-semibold">Capability inventory</h2>
            <span className="text-[11px] text-muted-foreground">
              — installed in the body; the overlay brain surfaces them smartly while connected
            </span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(brain?.inventory ?? []).map((group) => (
              <CapabilityGroupCard key={group.key} group={group} brainOn={connected} />
            ))}
            {!brain && (
              <div className="flex h-24 items-center justify-center rounded-xl border border-white/[0.06]">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
              </div>
            )}
          </div>
        </section>

        {/* ---- dream cycle (gbrain-inspired memory consolidation) ---- */}
        <section className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Moon className={cn('h-3.5 w-3.5', connected ? 'text-violet-300/80' : 'text-zinc-600')} />
            <h2 className="text-[12.5px] font-semibold">Dream cycle</h2>
            <span className="text-[11px] text-muted-foreground">
              — the brain sleeps on its memories: merges duplicates, senses relations, distills insights
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
              disabled={dreamBusy || !connected || memories.length === 0}
              onClick={() => void onDream()}
            >
              {dreamBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Moon className="h-3 w-3" />}
              {dreamBusy ? 'dreaming…' : 'Run dream cycle'}
            </Button>
          </div>

          {dreamReport ? (
            <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.05] px-3.5 py-3">
              <p className="text-[12px] leading-relaxed text-violet-100/90">{dreamReport.summary}</p>
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] text-violet-200/70">
                <span>memories: {dreamReport.before} → {dreamReport.after}</span>
                <span>duplicates folded: {dreamReport.mergedCount}</span>
              </div>
            </div>
          ) : brain?.lastDream ? (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3.5 py-3">
              <p className="text-[12px] leading-relaxed text-zinc-300">{brain.lastDream.summary}</p>
              <p className="mt-1.5 font-mono text-[9.5px] text-muted-foreground/60">
                last dream · {new Date(brain.lastDream.createdAt).toLocaleString()} · {brain.lastDream.totalMemories} memories reviewed
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              The brain has never dreamed. Running a cycle consolidates {memories.length} memor
              {memories.length === 1 ? 'y' : 'ies'} — near-duplicates are folded together, latent relations are
              sensed for the knowledge graph, and the oldest memories are distilled into compact insights.
            </p>
          )}
        </section>

        {/* ---- the coach ---- */}
        <section className={cn('mt-7 rounded-2xl border p-5 transition-colors', connected ? 'border-white/[0.07] bg-white/[0.02]' : 'border-white/[0.05] bg-white/[0.01] opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <GraduationCap className={cn('h-3.5 w-3.5', connected ? 'text-sky-300/80' : 'text-zinc-600')} />
            <h2 className="text-[12.5px] font-semibold">The coach</h2>
            <span className="text-[11px] text-muted-foreground">
              — a teacher inside the brain: reviews every mission, stores lessons, re-teaches them when a similar task returns
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
              disabled={coachBusy || !connected}
              onClick={() => void onCoachReview()}
            >
              {coachBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GraduationCap className="h-3 w-3" />}
              {coachBusy ? 'reviewing…' : 'Review last mission'}
            </Button>
          </div>

          {coachReport ? (
            <div className="mt-3 rounded-lg border border-sky-400/20 bg-sky-400/[0.05] px-3.5 py-3">
              <p className="text-[12px] leading-relaxed text-sky-100/90">{coachReport.summary}</p>
              <p className="mt-1.5 font-mono text-[10px] text-sky-200/70">
                {coachReport.lessons} new lesson{coachReport.lessons === 1 ? '' : 's'} stored
              </p>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.coach?.lessons ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">lessons learned</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{Math.round((brain?.coach?.avgWeight ?? 0) * 100)}%</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">avg credibility</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.refine?.rewrites ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">prompts refined</div>
            </div>
          </div>

          {(brain?.coach?.topLessons ?? []).length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {brain!.coach!.topLessons!.map((l, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2">
                  <span className="mt-0.5 font-mono text-[9px] text-sky-300/70">L{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-zinc-300">{l.content}</span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground/60">
                    w={l.weight}{l.timesUsed > 0 ? ` · ${l.timesUsed}×` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* teach the brain */}
          <div className="mt-3.5 border-t border-white/[0.06] pt-3.5">
            <div className="terminal-label text-[8.5px] text-muted-foreground/70">teach the brain — it stores this as a high-salience fact and indexes it in the graph</div>
            <div className="mt-2 flex gap-2">
              <input
                value={teachText}
                onChange={(e) => setTeachText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onTeach()
                }}
                placeholder="e.g. remember that I prefer concise answers with code examples"
                disabled={!connected || teachBusy}
                className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.09] bg-black/25 px-3 text-[12px] text-zinc-200 placeholder:text-muted-foreground/50 focus:border-white/25 focus:outline-none disabled:opacity-50"
              />
              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3 text-[11.5px]"
                disabled={!connected || teachBusy || teachText.trim().length < 4}
                onClick={() => void onTeach()}
              >
                {teachBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Teach
              </Button>
            </div>
            {taught && (
              <p className="mt-2 text-[11.5px] text-emerald-300/80">
                Learned: “{taught.content}” — {taught.entities} entities linked in the memory graph.
              </p>
            )}
          </div>
        </section>

        {/* ---- graph memory ---- */}
        <section className={cn('mt-7 rounded-2xl border p-5 transition-colors', connected ? 'border-white/[0.07] bg-white/[0.02]' : 'border-white/[0.05] bg-white/[0.01] opacity-70')}>
          <div className="flex flex-wrap items-center gap-2">
            <Share2 className={cn('h-3.5 w-3.5', connected ? 'text-emerald-300/80' : 'text-zinc-600')} />
            <h2 className="text-[12.5px] font-semibold">Graph memory</h2>
            <span className="text-[11px] text-muted-foreground">
              — all memory as an entity graph: recall walks it (Personalized PageRank) and only the activated slice ever enters a prompt
            </span>
            <span className="ml-auto">
              <GBrainGraphButton onClick={() => setGbrainGraphOpen(true)} />
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.graphMemory?.entities ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">entities</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.graphMemory?.edges ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">typed edges</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.graphMemory?.extracted ?? 0}<span className="text-[11px] text-muted-foreground/60">/{brain?.graphMemory?.inferred ?? 0}</span></div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">extracted / inferred</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.graphMemory?.indexedMemories ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">memories indexed</div>
            </div>
          </div>

          {(brain?.graphMemory?.hubEntities ?? []).length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="terminal-label text-[8.5px] text-muted-foreground/70">hub entities:</span>
              {brain!.graphMemory!.hubEntities!.map((h) => (
                <span key={h.name} className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-300">
                  {h.name} <span className="text-muted-foreground/60">×{h.degree}</span>
                </span>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Every saved memory is parsed into entities and typed triples (deterministic, zero LLM cost). Recall seeds the graph
            with your query's entities and lets activation spread — multi-hop connections surface in one computation, under a
            strict token budget. Ask “take me down the rabbit hole about X” to explore surprising cross-links.
          </p>
        </section>

        {/* ---- token economy: context cache ---- */}
        <section className={cn('mt-7 rounded-2xl border p-5 transition-colors', connected ? 'border-white/[0.07] bg-white/[0.02]' : 'border-white/[0.05] bg-white/[0.01] opacity-70')}>
          <div className="flex items-center gap-2">
            <Zap className={cn('h-3.5 w-3.5', connected ? 'text-amber-300/80' : 'text-zinc-600')} />
            <h2 className="text-[12.5px] font-semibold">Token economy</h2>
            <span className="text-[11px] text-muted-foreground">
              — context cache + prompt refinement + budgeted recall keep the brain's token burn low
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{Math.round((brain?.cache?.hitRate ?? 0) * 100)}%</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">route cache hit rate</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.cache?.hits ?? 0}<span className="text-[11px] text-muted-foreground/60">/{(brain?.cache?.hits ?? 0) + (brain?.cache?.misses ?? 0)}</span></div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">hits / total routes</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">~{brain?.cache?.estTokensSaved ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">tokens never sent</div>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <div className="font-mono text-[18px] font-semibold text-zinc-100">{brain?.refine?.rewrites ?? 0}</div>
              <div className="terminal-label mt-0.5 text-[8.5px] text-muted-foreground/70">follow-ups rewritten</div>
            </div>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Identical routing decisions are served from an in-memory cache (LLM never called again); follow-up questions are
            rewritten into standalone queries once, then reused; graph recall only ever reads the activated slice of memory.
          </p>
        </section>

        {/* ---- knowledge graph ---- */}
        <KnowledgeGraphSection />

        {/* ---- how the two-brain architecture works ---- */}
        <section className="mt-7 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2">
            <Cable className="h-3.5 w-3.5 text-zinc-500" />
            <h2 className="text-[12.5px] font-semibold">Two brains, one app</h2>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            This app deliberately runs with two brains. The <b className="text-zinc-200">spine</b> is the app
            itself — the standard agent loop (LLM routing, planning, tools, memory) that every normal agent
            app has, and it is always on. The{' '}
            <b className="text-zinc-200">NEXUS brain</b> is a pluggable overlay in a self-contained{' '}
            <code className="rounded border border-white/[0.07] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-zinc-300">
              brain/
            </code>{' '}
            folder with zero app-specific imports — a spirit you plug in to make the same app smarter.
          </p>

          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3.5">
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-[12px] font-semibold text-zinc-200">Spine brain</span>
                <span className="ml-auto rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">always on</span>
              </div>
              <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                <li>LLM routing — chat answers or missions</li>
                <li>Planning, tools, skills, plugins, MCPs</li>
                <li>Memory that persists across sessions</li>
                <li>Runs with or without the overlay</li>
              </ul>
            </div>
            <div className={cn('rounded-xl border p-3.5 transition-colors', connected ? 'border-emerald-400/20 bg-emerald-400/[0.04]' : 'border-white/[0.07] bg-black/20')}>
              <div className="flex items-center gap-2">
                <BrainIcon className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-[12px] font-semibold text-zinc-200">NEXUS overlay</span>
                <span className={cn('ml-auto rounded border px-1.5 py-0.5 font-mono text-[9px]', connected ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/25 bg-amber-400/10 text-amber-300')}>
                  {connected ? 'connected' : 'paused'}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                <li>Reflex routing + brain-first recall with citations</li>
                <li>Knowledge graph, dream cycles, follow-up chips</li>
                <li>Injects brain context into mission plans</li>
                <li>App directives — tone, verbosity, auto-dream</li>
              </ul>
            </div>
          </div>

          <ul className="mt-3.5 space-y-1.5">
            {[
              'Disconnecting never disables the spine — the app keeps working like a normal LLM agent app, it just loses the overlay extras.',
              'Capabilities are never deleted — skills, tools, plugins and MCPs stay installed while the overlay is away.',
              'Portable — copy the brain/ folder into any TypeScript app, implement BrainHost, and that app gains a second brain.',
              'Ideas credited with love: gbrain (cited synthesis, dream cycles, brain-drives-body), graphify (edge provenance, graph reports), HippoRAG (Personalized PageRank recall), Generative Agents (recency × importance × relevance) and Reflexion (the coach).',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12px] text-zinc-300">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="leading-snug">{line}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3.5 font-mono text-[10px] text-muted-foreground/80">
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/index.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/gate.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/cognition.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/coach.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/memory-graph.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/cache.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/core/refine.ts</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/gbrain/* (gbrain port)</span>
            <span className="rounded border border-white/[0.07] bg-black/25 px-2 py-1">brain/manifest.json</span>
          </div>
        </section>
      </div>
    </div>
  )
}

function BrainStatusText({ connected, personality }: { connected: boolean; personality?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'terminal-label rounded px-1.5 py-0.5 text-[9px]',
          connected
            ? 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
            : 'border border-amber-400/25 bg-amber-400/10 text-amber-300'
        )}
      >
        {connected ? 'overlay connected' : 'overlay paused'}
      </span>
      <span className="text-[15px] font-semibold tracking-tight">
        {personality ?? 'NEXUS'} <span className="text-muted-foreground/70 font-normal">Brain</span>
      </span>
    </div>
  )
}
