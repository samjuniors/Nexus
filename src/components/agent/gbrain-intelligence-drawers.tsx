'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  GitMerge,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import {
  GBRAIN_CATEGORIES,
  GBRAIN_CATEGORY_MAP,
  type GBrainCategoryId,
} from '@/lib/agent/gbrain-categories'
import type {
  TruthAuditFinding,
  TruthAuditReport,
} from '@/lib/agent/brain-truth-audit'
import { cn } from '@/lib/utils'

function findingMeta(kind: TruthAuditFinding['kind']): {
  label: string
  className: string
  icon: typeof AlertTriangle
} {
  switch (kind) {
    case 'contradiction':
      return {
        label: 'Contradiction',
        className: 'text-red-600 dark:text-red-400',
        icon: ShieldAlert,
      }
    case 'duplicate':
      return {
        label: 'Duplicate',
        className: 'text-amber-600 dark:text-amber-400',
        icon: GitMerge,
      }
    case 'stale':
      return {
        label: 'Stale',
        className: 'text-sky-600 dark:text-sky-400',
        icon: Archive,
      }
  }
}

export function GBrainTruthAuditDrawer({
  report,
  loading,
  busyFindingId,
  onRunScan,
  onResolve,
  onFocusNode,
  onClose,
}: {
  report: TruthAuditReport | null
  loading: boolean
  busyFindingId: string | null
  onRunScan: (deep: boolean) => void
  onResolve: (finding: TruthAuditFinding, action: 'keep_newer' | 'merge_entities' | 'archive_stale') => void
  onFocusNode: (nodeId: string) => void
  onClose: () => void
}) {
  return (
    <aside
      data-gbrain-truth-audit="1"
      aria-label="GBrain Truth Audit"
      className="nice-scroll flex h-72 w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-sidebar md:h-auto md:w-96 md:border-t-0 md:border-l"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-semibold text-foreground">Truth Audit</h3>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Detect contradictions, duplicate nodes, and stale memories
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Truth Audit"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Audit Action Strip */}
      <div className="flex items-center gap-1.5 border-b border-border/70 px-4 py-2.5">
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => onRunScan(false)}
          className="h-7 flex-1 gap-1.5 text-xs"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span>Quick Scan</span>
        </Button>
        <Button
          size="sm"
          disabled={loading}
          onClick={() => onRunScan(true)}
          data-gbrain-deep-audit="1"
          className="h-7 flex-1 gap-1.5 text-xs"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          <span>Deep AI Audit</span>
        </Button>
      </div>

      {/* Report Summary */}
      {report && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background/50 px-4 py-2 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          <span>{report.scannedEntities} nodes</span>
          <span>·</span>
          <span>{report.scannedMemories} memories</span>
          <span>·</span>
          <span
            className={cn(
              report.counts.total > 0
                ? 'font-medium text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {report.counts.total} {report.counts.total === 1 ? 'finding' : 'findings'}
          </span>
        </div>
      )}

      {/* Findings List */}
      <div className="flex-1 space-y-2.5 p-3.5">
        {loading && !report ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Auditing GBrain truth graph…</span>
          </div>
        ) : !report || report.findings.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-center">
            <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" />
            <div className="mt-2 text-xs font-semibold text-foreground">GBrain truth is clean</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              No conflicting facts, near-duplicate entities, or stale rules detected across{' '}
              {report?.scannedMemories ?? 0} memories and {report?.scannedEntities ?? 0} nodes.
            </p>
          </div>
        ) : (
          report.findings.map((finding) => {
            const meta = findingMeta(finding.kind)
            const Icon = meta.icon
            const resolving = busyFindingId === finding.id
            return (
              <div
                key={finding.id}
                className="space-y-2.5 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
                      <span className={cn('font-medium', meta.className)}>{meta.label}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {finding.severity}
                      </span>
                    </div>
                    <h4 className="mt-1 text-xs font-semibold text-foreground">{finding.title}</h4>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {finding.explanation}
                </p>

                {/* Competing Items */}
                <div className="space-y-1.5">
                  {finding.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-foreground">{item.label}</span>
                        {finding.entityIds.includes(item.id) && (
                          <button
                            type="button"
                            onClick={() => onFocusNode(item.id)}
                            className="font-mono text-[10px] text-sky-600 hover:underline dark:text-sky-400"
                          >
                            Focus
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Atomic Resolution Controls */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {finding.kind === 'contradiction' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving}
                      onClick={() => onResolve(finding, 'keep_newer')}
                      className="h-7 gap-1 text-[11px]"
                    >
                      {resolving && <Loader2 className="h-3 w-3 animate-spin" />}
                      <span>Keep Newer</span>
                    </Button>
                  )}
                  {finding.kind === 'duplicate' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolving}
                      onClick={() => onResolve(finding, 'merge_entities')}
                      className="h-7 gap-1 text-[11px]"
                    >
                      {resolving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <GitMerge className="h-3 w-3" />
                      )}
                      <span>Merge Entities</span>
                    </Button>
                  )}
                  {(finding.kind === 'stale' || finding.kind === 'contradiction') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolving}
                      onClick={() => onResolve(finding, 'archive_stale')}
                      className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Archive className="h-3 w-3" />
                      <span>Archive Stale</span>
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

export function GBrainContextPacksDrawer({
  selectedNodeId,
  selectedNodeName,
  currentCategoryFilter,
  onClose,
}: {
  selectedNodeId: string | null
  selectedNodeName: string | null
  currentCategoryFilter: GBrainCategoryId | 'all'
  onClose: () => void
}) {
  const packs = useEvaControl((s) => s.contextPacks)
  const activePackEntityIds = useEvaControl((s) => s.activePackEntityIds)
  const busy = useEvaControl((s) => s.contextPacksBusy)
  const toggleContextPack = useEvaControl((s) => s.toggleContextPack)
  const createContextPack = useEvaControl((s) => s.createContextPack)
  const deleteContextPack = useEvaControl((s) => s.deleteContextPack)

  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [selectedCats, setSelectedCats] = useState<GBrainCategoryId[]>(
    currentCategoryFilter === 'all' ? ['projects', 'facts'] : [currentCategoryFilter]
  )
  const [includeSelectedNode, setIncludeSelectedNode] = useState(Boolean(selectedNodeId))

  const toggleCat = (cat: GBrainCategoryId) => {
    setSelectedCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (name.length < 2) return
    const entityIds = includeSelectedNode && selectedNodeId ? [selectedNodeId] : []
    if (selectedCats.length === 0 && entityIds.length === 0) return
    const created = await createContextPack({
      name,
      description: newDesc.trim() || undefined,
      categories: selectedCats,
      entityIds,
      active: true,
    })
    if (created) {
      setNewName('')
      setNewDesc('')
    }
  }

  const activeCount = packs.filter((p) => p.active).length

  return (
    <aside
      data-gbrain-context-packs="1"
      aria-label="Scoped Brain Context Packs"
      className="nice-scroll flex h-72 w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-sidebar md:h-auto md:w-96 md:border-t-0 md:border-l"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-sky-500" />
            <h3 className="text-xs font-semibold text-foreground">Context Packs</h3>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Pin GBrain domains to bias Eva&apos;s chat, planner, and voice recall
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Context Packs"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Active Scope Summary */}
      <div className="flex items-center justify-between border-b border-border/60 bg-background/50 px-4 py-2 font-mono text-[10.5px] tabular-nums text-muted-foreground">
        <span>
          {activeCount > 0 ? `${activeCount} active pack${activeCount === 1 ? '' : 's'}` : 'All domains (unscoped)'}
        </span>
        <span>{activePackEntityIds.length} pinned nodes</span>
      </div>

      {/* Pack List */}
      <div className="space-y-2.5 p-3.5">
        {packs.map((pack) => (
          <div
            key={pack.id}
            data-context-pack-id={pack.id}
            className={cn(
              'rounded-lg border p-3 transition-colors',
              pack.active
                ? 'border-sky-500/40 bg-sky-500/8'
                : 'border-border bg-card'
            )}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-foreground">
                    {pack.name}
                  </span>
                  {pack.builtIn && (
                    <span className="font-mono text-[9.5px] text-muted-foreground">built-in</span>
                  )}
                </div>
                {pack.description && (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {pack.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!pack.builtIn && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteContextPack(pack.id)}
                    aria-label={`Delete ${pack.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <Switch
                  checked={pack.active}
                  disabled={busy}
                  onCheckedChange={(v) => void toggleContextPack(pack.id, v)}
                  aria-label={`Toggle ${pack.name} context pack`}
                />
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-muted-foreground">
              {pack.categories.map((catId) => {
                const meta = GBRAIN_CATEGORY_MAP[catId]
                if (!meta) return null
                return (
                  <span key={catId} className="inline-flex items-center gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: meta.accent }}
                    />
                    <span>{meta.shortLabel}</span>
                  </span>
                )
              })}
              {pack.entityIds.length > 0 && (
                <span className="font-mono tabular-nums">
                  · +{pack.entityIds.length} pinned
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Create Custom Pack Form */}
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-2.5 rounded-lg border border-border bg-card p-3"
        >
          <div className="text-xs font-semibold text-foreground">Create Scoped Context Pack</div>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Pack name (e.g. Release Audit)"
            className="h-8 text-xs"
            disabled={busy}
          />
          <Input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional scope description"
            className="h-7 text-xs"
            disabled={busy}
          />

          <div>
            <div className="mb-1 text-[10.5px] text-muted-foreground">Include categories</div>
            <div className="grid grid-cols-2 gap-1">
              {GBRAIN_CATEGORIES.map((cat) => {
                const checked = selectedCats.includes(cat.id)
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCat(cat.id)}
                    aria-pressed={checked}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] transition-colors',
                      checked
                        ? 'border-sky-500/40 bg-sky-500/10 font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: cat.accent }}
                    />
                    <span className="truncate">{cat.shortLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {selectedNodeId && selectedNodeName && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={includeSelectedNode}
                onChange={(e) => setIncludeSelectedNode(e.target.checked)}
                className="rounded border-border"
              />
              <span className="truncate">Also pin selected node ({selectedNodeName})</span>
            </label>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={
              busy ||
              newName.trim().length < 2 ||
              (selectedCats.length === 0 && !(includeSelectedNode && selectedNodeId))
            }
            className="h-8 w-full gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Save &amp; Activate Pack</span>
          </Button>
        </form>
      </div>
    </aside>
  )
}
