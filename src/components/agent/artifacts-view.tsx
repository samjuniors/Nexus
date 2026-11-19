'use client'

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Download,
  FileJson,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, type EmptyStateGuideStep } from '@/components/agent/empty-state'
import { useApp } from '@/lib/agent/store'
import { cn } from '@/lib/utils'
import type { ArtifactDTO } from '@/lib/agent/client'

const ARTIFACT_GUIDE: EmptyStateGuideStep[] = [
  {
    title: 'Prompt the Agent',
    detail: 'Ask for an image, specification, script, CSV dataset, or audio output in chat or voice.',
  },
  {
    title: 'Automatic Capture',
    detail: 'Files written by built-in tools, plugins, or subagents are saved directly to the workspace.',
  },
  {
    title: 'Preview & Export',
    detail: 'Filter by file type, inspect previews inline, or download deliverables anytime.',
  },
]

const KIND_META: Record<ArtifactDTO['kind'], { label: string; icon: typeof ImageIcon; accent: string }> = {
  image: { label: 'Image', icon: ImageIcon, accent: 'text-sky-300/80' },
  audio: { label: 'Audio', icon: Music, accent: 'text-violet-300/80' },
  document: { label: 'Document', icon: FileText, accent: 'text-amber-300/80' },
  data: { label: 'Data', icon: FileJson, accent: 'text-emerald-300/80' },
  text: { label: 'Text', icon: FileText, accent: 'text-zinc-300/80' },
}

type Filter = 'all' | ArtifactDTO['kind']

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'audio', label: 'Audio' },
  { key: 'document', label: 'Documents' },
  { key: 'data', label: 'Data' },
  { key: 'text', label: 'Text' },
]

function ArtifactCard({ artifact }: { artifact: ArtifactDTO }) {
  const { deleteArtifact } = useApp()
  const meta = KIND_META[artifact.kind]
  const Icon = meta.icon

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] transition-colors hover:border-white/[0.16]">
      {/* preview area */}
      {artifact.kind === 'image' ? (
        <a href={artifact.url} target="_blank" rel="noreferrer" className="block">
          <img
            src={artifact.url}
            alt={artifact.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="aspect-[4/3] w-full bg-black/30 object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </a>
      ) : artifact.kind === 'audio' ? (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-black/20 px-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Music className={cn('h-5 w-5', meta.accent)} />
          </div>
          <audio controls src={artifact.url} preload="none" className="h-8 w-full" />
        </div>
      ) : (
        <a
          href={artifact.url}
          target="_blank"
          rel="noreferrer"
          className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-black/20 px-4"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Icon className={cn('h-5 w-5', meta.accent)} />
          </div>
          <span className="line-clamp-3 break-all text-center font-mono text-[10px] leading-relaxed text-muted-foreground">
            {artifact.name}
          </span>
        </a>
      )}

      {/* footer */}
      <div className="border-t border-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.accent)} />
          <span className="truncate font-mono text-[11px] text-zinc-200">{artifact.name}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[9.5px] text-muted-foreground/70">
          <span className="terminal-label">{meta.label}</span>
          <span>·</span>
          <span>{artifact.sizeLabel}</span>
          <span>·</span>
          <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {/* hover actions */}
      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <a
          href={artifact.url}
          download={artifact.name}
          aria-label={`Download ${artifact.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/60 text-zinc-300 backdrop-blur transition-colors hover:text-white"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={() => void deleteArtifact(artifact.name)}
          aria-label={`Delete ${artifact.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/60 text-zinc-300 backdrop-blur transition-colors hover:border-red-400/40 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function ArtifactsView() {
  const { artifacts, refreshArtifacts, setTab } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [refreshing, setRefreshing] = useState(false)

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: artifacts.length, image: 0, audio: 0, document: 0, data: 0, text: 0 }
    for (const a of artifacts) c[a.kind]++
    return c
  }, [artifacts])

  const visible = useMemo(
    () => (filter === 'all' ? artifacts : artifacts.filter((a) => a.kind === filter)),
    [artifacts, filter]
  )

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshArtifacts()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="nice-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2.5">
          <FolderOpen className="h-4.5 w-4.5 text-zinc-400" />
          <h1 className="text-sm font-semibold tracking-tight">Artifacts</h1>
          <span className="terminal-label ml-1 text-[9px] text-muted-foreground/70">
            everything the agent created
          </span>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-white/10 bg-transparent px-2.5 text-[11px]"
            onClick={() => void onRefresh()}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        </div>

        {/* filters */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors',
                filter === f.key
                  ? 'border-white/20 bg-white/[0.07] text-zinc-100'
                  : 'border-white/[0.06] bg-transparent text-muted-foreground hover:border-white/15 hover:text-zinc-300'
              )}
            >
              {f.label}
              <span className="font-mono text-[9.5px] text-muted-foreground/60">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* grid */}
        {visible.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((a) => (
              <ArtifactCard key={a.name} artifact={a} />
            ))}
          </div>
        ) : artifacts.length > 0 ? (
          <EmptyState
            className="mt-6"
            icon={FolderOpen}
            eyebrow="// filter empty"
            title={`No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? filter} artifacts`}
            description="No files in this category yet. Switch back to All to inspect your existing deliverables."
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-white/10 bg-transparent text-xs"
                onClick={() => setFilter('all')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Show all artifacts
              </Button>
            }
          />
        ) : (
          <EmptyState
            className="mt-6"
            icon={FolderOpen}
            eyebrow="// workspace outputs"
            title="No artifacts created yet"
            description="Generated images, technical documents, code files, audio renders, and structured data created during missions appear here automatically."
            steps={ARTIFACT_GUIDE}
            actions={
              <>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setTab('agent')}>
                  Get Started in Agent
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-white/10 bg-transparent text-xs"
                  onClick={() => void onRefresh()}
                  disabled={refreshing}
                >
                  {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Check workspace
                </Button>
              </>
            }
          />
        )}
      </div>
    </div>
  )
}
