'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Cpu,
  FileCheck2,
  FolderKanban,
  GitBranch,
  GitFork,
  Layers,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  MousePointerClick,
  Network,
  Orbit,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Target,
  Trash2,
  User,
  Users,
  Waypoints,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/agent/client'
import type { GBrainGraphDTO, GBrainNodeDTO, GBrainNodeDetailDTO } from '@/lib/agent/client'
import {
  classifyGBrainEntity,
  GBRAIN_CATEGORIES,
  GBRAIN_CATEGORY_MAP,
  visibleAliases,
  type GBrainCategoryId,
} from '@/lib/agent/gbrain-categories'
import {
  computeGBrainLayout,
  type GBrainLayoutMode,
  type LaidGBrainNode,
} from '@/lib/agent/gbrain-layout'
import {
  buildMissionOverlayGraph,
  computeMissionOverlayLayout,
  MISSION_STATUS_META,
  selectActiveMissionRun,
  type LaidMissionNode,
  type MissionTaskStatus,
} from '@/lib/agent/gbrain-mission-graph'
import { useApp } from '@/lib/agent/store'
import { useEvaControl } from '@/lib/agent/eva-control-store'
import type { TruthAuditFinding, TruthAuditReport } from '@/lib/agent/brain-truth-audit'
import type { BrainTraceOperation } from '@/lib/agent/brain-trace'
import {
  GBrainContextPacksDrawer,
  GBrainTruthAuditDrawer,
} from '@/components/agent/gbrain-intelligence-drawers'
import { GBrainMissionInspector } from '@/components/agent/gbrain-mission-inspector'
import { cn } from '@/lib/utils'

type GraphViewMode = GBrainLayoutMode | 'mission'

const LAYOUT_OPTIONS: { id: GraphViewMode; label: string; icon: typeof Orbit }[] = [
  { id: 'clustered', label: 'Clustered', icon: Orbit },
  { id: 'hierarchy', label: 'Hierarchy', icon: GitFork },
  { id: 'force', label: 'Force', icon: Waypoints },
  { id: 'mission', label: 'Mission', icon: Target },
]

const MISSION_STATUS_KEYS: MissionTaskStatus[] = ['done', 'running', 'failed', 'blocked', 'pending']

function MissionRailStatusIcon({ status }: { status: MissionTaskStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
    case 'running':
      return <Loader2 className="h-3 w-3 shrink-0 motion-safe:animate-spin text-sky-500" />
    case 'failed':
      return <XCircle className="h-3 w-3 shrink-0 text-red-500" />
    case 'blocked':
      return <Lock className="h-3 w-3 shrink-0 text-amber-500" />
    case 'pending':
      return <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
  }
}

function MissionNodeStatusSvg({
  status,
  x,
  y,
}: {
  status: MissionTaskStatus
  x: number
  y: number
}) {
  const accent = MISSION_STATUS_META[status].accent
  switch (status) {
    case 'done':
      return (
        <g transform={`translate(${x}, ${y})`} pointerEvents="none">
          <circle r={6} fill={accent} />
          <path
            d="M -2.7 0.2 L -0.7 2.2 L 3 -2"
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )
    case 'running':
      return (
        <g transform={`translate(${x}, ${y})`} pointerEvents="none">
          <circle r={6} fill={accent} fillOpacity={0.14} stroke={accent} strokeOpacity={0.35} strokeWidth={1.3} />
          <path
            d="M 0 -5.5 A 5.5 5.5 0 0 1 5.5 0"
            fill="none"
            stroke={accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            className="motion-safe:animate-spin"
            style={{ transformOrigin: '0px 0px' }}
          />
          <circle r={2} fill={accent} />
        </g>
      )
    case 'failed':
      return (
        <g transform={`translate(${x}, ${y})`} pointerEvents="none">
          <circle r={6} fill={accent} />
          <path
            d="M -2.4 -2.4 L 2.4 2.4 M 2.4 -2.4 L -2.4 2.4"
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        </g>
      )
    case 'blocked':
      return (
        <g transform={`translate(${x}, ${y})`} pointerEvents="none">
          <circle r={6} fill={accent} fillOpacity={0.16} stroke={accent} strokeWidth={1.3} />
          <path
            d="M -2.6 0 L 2.6 0"
            fill="none"
            stroke={accent}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </g>
      )
    case 'pending':
      return (
        <g transform={`translate(${x}, ${y})`} pointerEvents="none">
          <circle r={5.2} fill="none" stroke={accent} strokeWidth={1.4} strokeDasharray="2.5 2" />
        </g>
      )
  }
}

const CATEGORY_ICONS: Record<GBrainCategoryId, typeof Bot> = {
  agents: Bot,
  projects: FolderKanban,
  tools: Wrench,
  concepts: Cpu,
  people: Users,
  facts: FileCheck2,
}

type OriginFilter = 'all' | 'auto' | 'manual'
type EdgeFilter = 'all' | 'EXTRACTED' | 'INFERRED'

const CARD_W = 166
const CARD_H = 52
const HALF_W = CARD_W / 2
const HALF_H = CARD_H / 2

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Interactive GBrain Knowledge Graph — fullscreen categorized architectural graph studio.
 * Features a Left Category Explorer Rail, Structured Node Cards organized into semantic clusters,
 * Clustered Orbital / Hierarchy / Force layout modes, direct node linking, category management,
 * live workspace sync, cursor-centered zoom, drag-to-pan, and draggable nodes.
 */
export function GBrainGraph({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [graph, setGraph] = useState<GBrainGraphDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [layoutMode, setLayoutMode] = useState<GraphViewMode>('clustered')
  const [showMissionLayer, setShowMissionLayer] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<GBrainCategoryId | 'all'>('all')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>('all')
  const [showDirectory, setShowDirectory] = useState(true)
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({
    agents: true,
    projects: true,
    tools: false,
    concepts: false,
    people: false,
    facts: false,
  })

  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [detail, setDetail] = useState<GBrainNodeDetailDTO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<GBrainCategoryId>('concepts')
  const [note, setNote] = useState('')
  const [renaming, setRenaming] = useState('')
  const [alias, setAlias] = useState('')
  const [linkTargetId, setLinkTargetId] = useState('')
  const [linkRelation, setLinkRelation] = useState('related_to')
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({})
  const [rightPanel, setRightPanel] = useState<'inspector' | 'audit' | 'packs'>('inspector')
  const [auditReport, setAuditReport] = useState<TruthAuditReport | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null)

  const conversations = useApp((s) => s.conversations)
  const activeConvId = useApp((s) => s.activeConvId)
  const runningRunId = useApp((s) => s.runningRunId)

  const gbrainInitialPanel = useEvaControl((s) => s.gbrainInitialPanel)
  const brainTraces = useEvaControl((s) => s.brainTraces)
  const reasoningChains = useEvaControl((s) => s.reasoningChains)
  const selfHealSessions = useEvaControl((s) => s.selfHealSessions)
  const activePackEntityIds = useEvaControl((s) => s.activePackEntityIds)
  const activePackNames = useEvaControl((s) => s.activePackNames)
  const refreshContextPacks = useEvaControl((s) => s.refreshContextPacks)
  const refreshBrainTraces = useEvaControl((s) => s.refreshBrainTraces)
  const openReasoningForChain = useEvaControl((s) => s.openReasoningForChain)

  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const missionNodeIdsRef = useRef<Set<string>>(new Set())
  const panRef = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null)
  const dragNodeRef = useRef<{
    nodeId: string
    startClientX: number
    startClientY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)

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

  const runTruthAudit = useCallback(async (deep = false) => {
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/brain/truth-audit${deep ? '?deep=1' : ''}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as {
        ok?: boolean
        report?: TruthAuditReport
        error?: string
      }
      if (data.ok && data.report) {
        setAuditReport(data.report)
      } else if (data.error) {
        setMessage({ kind: 'warn', text: data.error })
      }
    } catch (e) {
      setMessage({ kind: 'warn', text: e instanceof Error ? e.message : 'Truth audit failed' })
    } finally {
      setAuditLoading(false)
    }
  }, [])

  const resolveAuditFinding = useCallback(
    async (
      finding: TruthAuditFinding,
      action: 'keep_newer' | 'merge_entities' | 'archive_stale'
    ) => {
      setBusyFindingId(finding.id)
      try {
        const res = await fetch('/api/brain/truth-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            memoryIds: finding.memoryIds,
            entityIds: finding.entityIds,
          }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          message?: string
          report?: TruthAuditReport
          error?: string
        }
        if (data.ok) {
          if (data.report) setAuditReport(data.report)
          if (data.message) setMessage({ kind: 'ok', text: data.message })
          await refresh()
        } else if (data.error) {
          setMessage({ kind: 'warn', text: data.error })
        }
      } catch (e) {
        setMessage({ kind: 'warn', text: e instanceof Error ? e.message : 'Resolution failed' })
      } finally {
        setBusyFindingId(null)
      }
    },
    [refresh]
  )

  useEffect(() => {
    if (!open) return
    void refresh()
    void refreshContextPacks()
    void refreshBrainTraces()
    if (gbrainInitialPanel === 'audit') {
      setRightPanel('audit')
      void runTruthAudit(false)
    } else if (gbrainInitialPanel === 'packs') {
      setRightPanel('packs')
    } else {
      setRightPanel('inspector')
    }
  }, [open, gbrainInitialPanel, refresh, refreshContextPacks, refreshBrainTraces, runTruthAudit])

  const inspect = useCallback(async (nodeId: string) => {
    setSelected(nodeId)
    setRightPanel('inspector')
    if (missionNodeIdsRef.current.has(nodeId)) {
      setDetail(null)
      setDetailLoading(false)
      detailRef.current?.scrollTo({ top: 0 })
      return
    }
    setDetail(null)
    setDetailLoading(true)
    setRenaming('')
    setAlias('')
    setLinkTargetId('')
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

  // Normalized nodes with guaranteed semantic category
  const categorizedNodes = useMemo(() => {
    if (!graph) return [] as (GBrainNodeDTO & { category: GBrainCategoryId })[]
    return graph.nodes.slice(0, 140).map((n) => ({
      ...n,
      category: n.category ?? classifyGBrainEntity(n.name, n.variants),
    }))
  }, [graph])

  // Category directory counts & grouped lists
  const directoryGroups = useMemo(() => {
    const map = new Map<GBrainCategoryId, (GBrainNodeDTO & { category: GBrainCategoryId })[]>()
    for (const c of GBRAIN_CATEGORIES) map.set(c.id, [])
    for (const n of categorizedNodes) {
      map.get(n.category)!.push(n)
    }
    return GBRAIN_CATEGORIES.map((meta) => ({
      meta,
      items: (map.get(meta.id) ?? []).sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name)),
    }))
  }, [categorizedNodes])

  // Filtered nodes & edges for canvas
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!graph) {
      return {
        visibleNodes: [] as (GBrainNodeDTO & { category: GBrainCategoryId })[],
        visibleEdges: [] as GBrainGraphDTO['edges'],
      }
    }
    const q = search.trim().toLowerCase()
    const rawEdges =
      edgeFilter === 'all' ? graph.edges : graph.edges.filter((e) => e.kind === edgeFilter)

    const matchedIds = new Set<string>()
    for (const n of categorizedNodes) {
      if (categoryFilter !== 'all' && n.category !== categoryFilter) continue
      if (originFilter !== 'all' && n.origin !== originFilter) continue
      if (
        q &&
        !n.name.toLowerCase().includes(q) &&
        !visibleAliases(n.variants).some((v) => v.toLowerCase().includes(q))
      ) {
        continue
      }
      matchedIds.add(n.id)
    }

    const keepIds = new Set<string>(matchedIds)
    // Preserve 1-hop context when searching so graph connections stay meaningful
    if (q) {
      for (const e of rawEdges) {
        if (matchedIds.has(e.sourceId)) keepIds.add(e.targetId)
        if (matchedIds.has(e.targetId)) keepIds.add(e.sourceId)
      }
    }

    const nodes = categorizedNodes.filter((n) => keepIds.has(n.id))
    const idSet = new Set(nodes.map((n) => n.id))
    const edges = rawEdges.filter((e) => idSet.has(e.sourceId) && idSet.has(e.targetId))
    return { visibleNodes: nodes, visibleEdges: edges }
  }, [graph, categorizedNodes, search, categoryFilter, originFilter, edgeFilter])

  // Active Mission Path & Agentic Task DAG (live from active run, self-heal session, or reasoning chain)
  const activeMissionSelection = useMemo(
    () => selectActiveMissionRun(conversations, activeConvId, runningRunId),
    [conversations, activeConvId, runningRunId]
  )

  const missionGraph = useMemo(
    () =>
      buildMissionOverlayGraph({
        run: activeMissionSelection.run,
        live: activeMissionSelection.live,
        reasoningChain: reasoningChains[0] ?? null,
        selfHealSession: selfHealSessions[0] ?? null,
        gbrainNodes: categorizedNodes,
      }),
    [activeMissionSelection, reasoningChains, selfHealSessions, categorizedNodes]
  )

  const missionNodeById = useMemo(
    () => new Map(missionGraph.nodes.map((n) => [n.id, n])),
    [missionGraph.nodes]
  )

  useEffect(() => {
    missionNodeIdsRef.current = new Set(missionGraph.nodes.map((n) => n.id))
  }, [missionGraph.nodes])

  const showMissionOnCanvas =
    missionGraph.hasMission && (layoutMode === 'mission' || showMissionLayer)

  // Deterministic card-aware GBrain entity layout
  const baseLayoutMode: GBrainLayoutMode = layoutMode === 'mission' ? 'clustered' : layoutMode
  const layoutResult = useMemo(
    () =>
      computeGBrainLayout(visibleNodes, visibleEdges, baseLayoutMode, {
        width: 1280,
        height: 820,
        cardSpacing: true,
      }),
    [visibleNodes, visibleEdges, baseLayoutMode]
  )

  // Deterministic topological DAG layout for the Active Mission Path & Agentic Tasks
  const missionLayoutResult = useMemo(() => {
    if (!showMissionOnCanvas) return null
    return computeMissionOverlayLayout(
      missionGraph,
      layoutMode === 'mission' ? null : layoutResult.bounds,
      layoutMode === 'mission'
    )
  }, [showMissionOnCanvas, missionGraph, layoutMode, layoutResult.bounds])

  // In focused 'mission' mode, render only directly bridged GBrain entities cleanly beneath the Mission DAG
  const { canvasLaidNodes, canvasVisibleEdges, bridgedZone } = useMemo(() => {
    if (layoutMode === 'mission') {
      if (!missionLayoutResult?.zone || missionGraph.linkedEntityIds.length === 0) {
        return {
          canvasLaidNodes: [] as LaidGBrainNode<GBrainNodeDTO & { category: GBrainCategoryId }>[],
          canvasVisibleEdges: [] as GBrainGraphDTO['edges'],
          bridgedZone: null as { x: number; y: number; width: number; height: number; count: number } | null,
        }
      }
      const linkedSet = new Set(missionGraph.linkedEntityIds)
      const bridgedEntities = categorizedNodes.filter((n) => linkedSet.has(n.id))
      if (bridgedEntities.length === 0) {
        return {
          canvasLaidNodes: [] as LaidGBrainNode<GBrainNodeDTO & { category: GBrainCategoryId }>[],
          canvasVisibleEdges: [] as GBrainGraphDTO['edges'],
          bridgedZone: null as { x: number; y: number; width: number; height: number; count: number } | null,
        }
      }
      const z = missionLayoutResult.zone
      const centerX = z.x + z.width / 2
      const maxPerRow = 6
      const gapX = CARD_W + 26
      const gapY = CARD_H + 26
      const startY = z.y + z.height + 92

      const placed: LaidGBrainNode<GBrainNodeDTO & { category: GBrainCategoryId }>[] = []
      bridgedEntities.forEach((ent, idx) => {
        const row = Math.floor(idx / maxPerRow)
        const col = idx % maxPerRow
        const rowCount = Math.min(maxPerRow, bridgedEntities.length - row * maxPerRow)
        const rowStartX = centerX - ((rowCount - 1) * gapX) / 2
        const baseX = rowStartX + col * gapX
        const baseY = startY + row * gapY
        const ov = nodeOverrides[ent.id]
        placed.push({
          node: ent,
          x: ov ? ov.x : baseX,
          y: ov ? ov.y : baseY,
          r: 26,
          tier: 1,
          clusterKey: ent.category,
        })
      })

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of placed) {
        minX = Math.min(minX, p.x - HALF_W)
        minY = Math.min(minY, p.y - HALF_H)
        maxX = Math.max(maxX, p.x + HALF_W)
        maxY = Math.max(maxY, p.y + HALF_H)
      }
      const bZone = {
        x: minX - 24,
        y: minY - 40,
        width: maxX - minX + 48,
        height: maxY - minY + 62,
        count: placed.length,
      }
      const bEdges = (graph?.edges ?? []).filter(
        (e) => linkedSet.has(e.sourceId) && linkedSet.has(e.targetId)
      )
      return {
        canvasLaidNodes: placed,
        canvasVisibleEdges: bEdges,
        bridgedZone: bZone,
      }
    }

    const laid = layoutResult.nodes.map((item) => {
      const ov = nodeOverrides[item.node.id]
      return ov ? { ...item, x: ov.x, y: ov.y } : item
    })
    return {
      canvasLaidNodes: laid,
      canvasVisibleEdges: visibleEdges,
      bridgedZone: null as { x: number; y: number; width: number; height: number; count: number } | null,
    }
  }, [
    layoutMode,
    missionLayoutResult,
    missionGraph.linkedEntityIds,
    categorizedNodes,
    nodeOverrides,
    graph?.edges,
    layoutResult.nodes,
    visibleEdges,
  ])

  const laidMissionNodes: LaidMissionNode[] = useMemo(() => {
    if (!missionLayoutResult) return []
    return missionLayoutResult.nodes.map((item) => {
      const ov = nodeOverrides[item.node.id]
      return ov ? { ...item, x: ov.x, y: ov.y } : item
    })
  }, [missionLayoutResult, nodeOverrides])

  const byId = useMemo(() => new Map(canvasLaidNodes.map((l) => [l.node.id, l])), [canvasLaidNodes])
  const missionById = useMemo(
    () => new Map(laidMissionNodes.map((l) => [l.node.id, l])),
    [laidMissionNodes]
  )
  const entityLookup = useMemo(
    () =>
      new Map(
        categorizedNodes.map((n) => [n.id, { id: n.id, name: n.name, category: n.category }])
      ),
    [categorizedNodes]
  )

  const combinedBounds = useMemo(() => {
    if (layoutMode === 'mission') {
      if (!missionLayoutResult) return layoutResult.bounds
      let minX = missionLayoutResult.bounds.minX
      let minY = missionLayoutResult.bounds.minY
      let maxX = missionLayoutResult.bounds.maxX
      let maxY = missionLayoutResult.bounds.maxY
      if (bridgedZone) {
        minX = Math.min(minX, bridgedZone.x - 24)
        minY = Math.min(minY, bridgedZone.y - 24)
        maxX = Math.max(maxX, bridgedZone.x + bridgedZone.width + 24)
        maxY = Math.max(maxY, bridgedZone.y + bridgedZone.height + 24)
      }
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      }
    }

    if (!showMissionOnCanvas || !missionLayoutResult?.zone) return layoutResult.bounds
    if (canvasLaidNodes.length === 0) return missionLayoutResult.bounds
    const minX = Math.min(layoutResult.bounds.minX, missionLayoutResult.bounds.minX)
    const minY = Math.min(layoutResult.bounds.minY, missionLayoutResult.bounds.minY)
    const maxX = Math.max(layoutResult.bounds.maxX, missionLayoutResult.bounds.maxX)
    const maxY = Math.max(layoutResult.bounds.maxY, missionLayoutResult.bounds.maxY)
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  }, [layoutMode, missionLayoutResult, layoutResult.bounds, bridgedZone, showMissionOnCanvas, canvasLaidNodes.length])

  const fitToView = useCallback(() => {
    const el = canvasWrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return
    const b = combinedBounds
    const pad = 44
    const sx = (rect.width - pad * 2) / Math.max(1, b.width)
    const sy = (rect.height - pad * 2) / Math.max(1, b.height)
    const scale = clamp(Math.min(sx, sy, 1.12), 0.28, 1.12)
    const cx = b.minX + b.width / 2
    const cy = b.minY + b.height / 2
    setView({
      scale,
      tx: rect.width / 2 - cx * scale,
      ty: rect.height / 2 - cy * scale,
    })
  }, [combinedBounds])

  useEffect(() => {
    if (!open) return
    setNodeOverrides({})
    const raf = requestAnimationFrame(() => fitToView())
    return () => cancelAnimationFrame(raf)
  }, [
    open,
    layoutMode,
    visibleNodes.length,
    showDirectory,
    showMissionOnCanvas,
    missionGraph.runId,
    missionGraph.nodes.length,
    fitToView,
  ])

  const focusNode = useCallback(
    (nodeId: string) => {
      const target = byId.get(nodeId) ?? missionById.get(nodeId)
      const el = canvasWrapRef.current
      if (target && el) {
        const rect = el.getBoundingClientRect()
        const nextScale = clamp(Math.max(view.scale, 0.92), 0.55, 1.35)
        setView({
          scale: nextScale,
          tx: rect.width / 2 - target.x * nextScale,
          ty: rect.height / 2 - target.y * nextScale,
        })
      }
      void inspect(nodeId)
    },
    [byId, missionById, inspect, view.scale]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') {
        if (selected) {
          setSelected(null)
          setDetail(null)
        } else {
          onOpenChange(false)
        }
      } else if (e.key === '+' || e.key === '=') {
        setView((v) => ({ ...v, scale: clamp(v.scale * 1.16, 0.25, 2.4) }))
      } else if (e.key === '-') {
        setView((v) => ({ ...v, scale: clamp(v.scale / 1.16, 0.25, 2.4) }))
      } else if (e.key === '0') {
        fitToView()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, selected, onOpenChange, fitToView])

  const activeFocusId = hovered ?? selected

  const activePackSet = useMemo(() => new Set(activePackEntityIds), [activePackEntityIds])

  // Map nodeId -> most recent live Working Memory Trace operation for glowing canvas state
  const tracedNodeMap = useMemo(() => {
    const map = new Map<string, BrainTraceOperation>()
    for (const ev of brainTraces.slice(0, 4)) {
      for (const id of ev.nodeIds) {
        if (!map.has(id)) map.set(id, ev.operation)
      }
    }
    return map
  }, [brainTraces])

  const latestTrace = brainTraces[0] ?? null

  const neighborSet = useMemo(() => {
    const s = new Set<string>()
    if (!activeFocusId) return s
    s.add(activeFocusId)
    for (const e of canvasVisibleEdges) {
      if (e.sourceId === activeFocusId) s.add(e.targetId)
      if (e.targetId === activeFocusId) s.add(e.sourceId)
    }
    if (showMissionOnCanvas) {
      for (const me of missionGraph.edges) {
        if (me.sourceId === activeFocusId) s.add(me.targetId)
        if (me.targetId === activeFocusId) s.add(me.sourceId)
      }
    }
    return s
  }, [activeFocusId, canvasVisibleEdges, showMissionOnCanvas, missionGraph.edges])

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const el = canvasWrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14
    setView((prev) => {
      const nextScale = clamp(prev.scale * factor, 0.25, 2.4)
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        tx: mx - (mx - prev.tx) * ratio,
        ty: my - (my - prev.ty) * ratio,
      }
    })
  }

  const onCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('[data-graph-node="1"]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origTx: view.tx,
      origTy: view.ty,
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragNodeRef.current
    if (drag) {
      const dx = (e.clientX - drag.startClientX) / view.scale
      const dy = (e.clientY - drag.startClientY) / view.scale
      if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 4) {
        drag.moved = true
      }
      if (drag.moved) {
        const id = drag.nodeId
        const nextX = drag.origX + dx
        const nextY = drag.origY + dy
        setNodeOverrides((prev) => ({
          ...prev,
          [id]: { x: nextX, y: nextY },
        }))
      }
      return
    }
    const pan = panRef.current
    if (!pan) return
    const nextTx = pan.origTx + (e.clientX - pan.startX)
    const nextTy = pan.origTy + (e.clientY - pan.startY)
    setView((prev) => ({
      ...prev,
      tx: nextTx,
      ty: nextTy,
    }))
  }

  const onCanvasPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragNodeRef.current) {
      const { nodeId, moved } = dragNodeRef.current
      dragNodeRef.current = null
      if (!moved) {
        void inspect(nodeId)
      }
    }
    if (panRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      panRef.current = null
    }
  }

  const zoomBy = (factor: number) => {
    const el = canvasWrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = rect.width / 2
    const my = rect.height / 2
    setView((prev) => {
      const nextScale = clamp(prev.scale * factor, 0.25, 2.4)
      const ratio = nextScale / prev.scale
      return {
        scale: nextScale,
        tx: mx - (mx - prev.tx) * ratio,
        ty: my - (my - prev.ty) * ratio,
      }
    })
  }

  if (!open) return null

  const selectedMissionNode = selected ? (missionNodeById.get(selected) ?? null) : null
  const activeCategory: GBrainCategoryId =
    detail?.entity.category ??
    (detail ? classifyGBrainEntity(detail.entity.name, detail.entity.variants) : 'concepts')

  return (
    <div
      data-gbrain-modal="1"
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="GBrain interactive knowledge graph"
    >
      {/* Top Bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-sidebar px-3.5 py-2 md:px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDirectory((v) => !v)}
            aria-label={showDirectory ? 'Hide category directory' : 'Show category directory'}
            title={showDirectory ? 'Hide category directory' : 'Show category directory'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors',
              showDirectory
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
          <Network className="h-4 w-4 text-sky-500" />
          <h2 className="text-sm font-semibold tracking-tight whitespace-nowrap">GBrain Knowledge Graph</h2>
        </div>

        {/* Clean tabular stats */}
        {graph && (
          <div className="hidden items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground 2xl:flex">
            <span>
              {visibleNodes.length}/{graph.stats.nodes} nodes
            </span>
            <span>·</span>
            <span>
              {visibleEdges.length}/{graph.stats.edges} edges
            </span>
            {missionGraph.hasMission && (
              <>
                <span>·</span>
                <span className={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].textClass}>
                  {missionGraph.completed}/{missionGraph.total} tasks
                </span>
              </>
            )}
            <span>·</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              {graph.stats.extracted} extracted
            </span>
            <span>·</span>
            <span className="text-violet-600 dark:text-violet-400">
              {graph.stats.inferred} inferred
            </span>
          </div>
        )}

        {/* Layout Mode Switcher */}
        <div
          role="group"
          aria-label="Graph layout arrangement"
          className="flex items-center rounded-lg border border-border bg-background p-0.5"
        >
          {LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => {
            const active = layoutMode === id
            return (
              <button
                key={id}
                type="button"
                data-gbrain-layout={id}
                onClick={() => setLayoutMode(id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={rightPanel === 'packs' || activePackNames.length > 0 ? 'secondary' : 'outline'}
            size="sm"
            data-gbrain-open-packs="1"
            className={cn(
              'h-8 gap-1.5 text-xs',
              activePackNames.length > 0 && 'border-sky-500/40 text-sky-600 dark:text-sky-400'
            )}
            onClick={() => {
              if (rightPanel === 'packs') setRightPanel('inspector')
              else {
                setRightPanel('packs')
                void refreshContextPacks()
              }
            }}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>
              {activePackNames.length > 0
                ? `Packs (${activePackNames.length})`
                : 'Context Packs'}
            </span>
          </Button>
          <Button
            variant={rightPanel === 'audit' ? 'secondary' : 'outline'}
            size="sm"
            data-gbrain-open-audit="1"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              if (rightPanel === 'audit') setRightPanel('inspector')
              else {
                setRightPanel('audit')
                if (!auditReport) void runTruthAudit(false)
              }
            }}
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
            <span>Truth Audit</span>
            {auditReport && auditReport.counts.total > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                {auditReport.counts.total}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            title="Create new categorized node"
            onClick={() => setCreateOpen((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">New</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            title="Sync workspace into GBrain"
            disabled={busy || loading}
            onClick={() =>
              void act(async () => {
                const r = (await api.gbrainGraphAction('sync_workspace')) as {
                  entities: number
                  edges: number
                }
                return `Workspace synced — ${r.entities} categorized entities (+${r.edges} new links)`
              })
            }
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
            <span className="hidden lg:inline">Sync</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            title="Prune orphaned entities"
            disabled={busy || loading}
            onClick={() =>
              void act(async () => {
                const r = (await api.gbrainGraphAction('prune')) as { pruned: number }
                return r.pruned > 0
                  ? `Pruned ${r.pruned} orphaned entities`
                  : 'No orphaned entities to prune'
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Prune</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onOpenChange(false)}
            aria-label="Close GBrain graph"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter + Viewport Controls Bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-background px-4 py-2 md:px-5">
        <div className="relative w-52 sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities or aliases…"
            aria-label="Search GBrain entities"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Origin Filter */}
        <div className="flex items-center gap-1" role="group" aria-label="Filter by origin">
          {(
            [
              { id: 'all', label: 'All sources' },
              { id: 'auto', label: 'Auto-indexed' },
              { id: 'manual', label: 'Manual' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setOriginFilter(id)}
              aria-pressed={originFilter === id}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
                originFilter === id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-border sm:inline-block" />

        {/* Edge Kind Filter */}
        <div className="flex items-center gap-1" role="group" aria-label="Filter by edge kind">
          {(
            [
              { id: 'all', label: 'All edges' },
              { id: 'EXTRACTED', label: 'Extracted' },
              { id: 'INFERRED', label: 'Inferred' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setEdgeFilter(id)}
              aria-pressed={edgeFilter === id}
              className={cn(
                'rounded-md px-2 py-1 font-mono text-[10.5px] whitespace-nowrap transition-colors',
                edgeFilter === id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-border sm:inline-block" />

        {/* Active Mission Path Overlay Toggle */}
        <button
          type="button"
          data-gbrain-mission-toggle="1"
          onClick={() => {
            if (layoutMode === 'mission') {
              setLayoutMode('clustered')
            } else {
              setShowMissionLayer((v) => !v)
            }
          }}
          aria-pressed={showMissionOnCanvas}
          title={
            missionGraph.hasMission
              ? 'Toggle Active Mission Path & Agentic Tasks layer'
              : 'No active mission yet — run a task with Eva'
          }
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
            showMissionOnCanvas
              ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400'
              : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <Target className="h-3 w-3 shrink-0" />
          <span>Mission Path</span>
          <span className="font-mono text-[10px] tabular-nums opacity-80">
            {missionGraph.hasMission ? `${missionGraph.completed}/${missionGraph.total}` : 'Idle'}
          </span>
        </button>

        {/* Zoom & Fit Controls */}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out"
            title="Zoom out (-)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in"
            title="Zoom in (+)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fitToView}
            aria-label="Fit graph to view"
            title="Fit graph (0)"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Scan className="h-3 w-3" />
            <span>Fit</span>
          </button>
          {Object.keys(nodeOverrides).length > 0 && (
            <button
              type="button"
              onClick={() => {
                setNodeOverrides({})
                requestAnimationFrame(() => fitToView())
              }}
              aria-label="Reset dragged positions"
              title="Reset layout positions"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {message && (
        <div
          className={cn(
            'flex shrink-0 items-center justify-between border-b px-4 py-1.5 text-xs',
            message.kind === 'ok'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          )}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss notice"
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 3-Column Body: Category Directory + Graph Canvas + Inspector */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left Category Explorer Rail */}
        {showDirectory && (
          <aside
            data-gbrain-directory="1"
            aria-label="GBrain categories"
            className="nice-scroll hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar md:flex"
          >
            {/* Active Mission Sub-Goal Navigator */}
            <div data-gbrain-mission-rail="1" className="border-b border-border/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <Target className="h-3.5 w-3.5 text-sky-500" />
                  <span>Active Mission</span>
                </span>
                {missionGraph.hasMission && (
                  <button
                    type="button"
                    onClick={() => setLayoutMode(layoutMode === 'mission' ? 'clustered' : 'mission')}
                    className="font-mono text-[10px] text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {layoutMode === 'mission' ? 'All Graph' : 'Focus'}
                  </button>
                )}
              </div>

              {!missionGraph.hasMission ? (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  No active mission yet — run a task with Eva to trace live sub-goals here.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="flex items-center justify-between gap-1.5 text-[10.5px]">
                      <span
                        className={cn(
                          'font-medium',
                          MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].textClass
                        )}
                      >
                        {missionGraph.phaseLabel}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {missionGraph.completed}/{missionGraph.total} · {missionGraph.percent}%
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${missionGraph.percent}%`,
                          backgroundColor:
                            MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent,
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    {missionGraph.nodes.map((mn) => (
                      <button
                        key={mn.id}
                        type="button"
                        onClick={() => {
                          if (!showMissionOnCanvas) setShowMissionLayer(true)
                          focusNode(mn.id)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors',
                          selected === mn.id
                            ? 'bg-sky-500/12 font-medium text-sky-600 dark:text-sky-400'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          {mn.nodeKind === 'mission_root' ? (
                            <Target className="h-3 w-3 shrink-0 text-sky-500" />
                          ) : (
                            <MissionRailStatusIcon status={mn.status} />
                          )}
                          <span className="truncate">
                            {mn.nodeKind === 'mission_root'
                              ? mn.title
                              : `${mn.stepIndex}. ${mn.title}`}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 font-mono text-[9.5px]',
                            MISSION_STATUS_META[mn.status].textClass
                          )}
                        >
                          {mn.statusLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-b border-border/60 px-3.5 py-2.5">
              <div className="text-[11px] font-semibold text-foreground">Categories</div>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                Filter clusters or jump straight to a node
              </p>
            </div>

            <div className="p-2 space-y-1">
              <button
                type="button"
                data-gbrain-category="all"
                onClick={() => setCategoryFilter('all')}
                aria-pressed={categoryFilter === 'all'}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                  categoryFilter === 'all'
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <span>All Categories</span>
                <span className="font-mono text-[10.5px] tabular-nums">{categorizedNodes.length}</span>
              </button>

              {directoryGroups.map(({ meta, items }) => {
                const Icon = CATEGORY_ICONS[meta.id]
                const isSelectedCat = categoryFilter === meta.id
                const isExpanded = Boolean(expandedCats[meta.id])
                return (
                  <div key={meta.id} className="space-y-0.5">
                    <div
                      className={cn(
                        'flex items-center rounded-lg transition-colors',
                        isSelectedCat ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCats((prev) => ({ ...prev, [meta.id]: !prev[meta.id] }))
                        }
                        aria-label={isExpanded ? `Collapse ${meta.label}` : `Expand ${meta.label}`}
                        className="flex h-7 w-6 shrink-0 items-center justify-center opacity-70 hover:opacity-100"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        data-gbrain-category={meta.id}
                        onClick={() => setCategoryFilter(isSelectedCat ? 'all' : meta.id)}
                        aria-pressed={isSelectedCat}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-2.5 text-left text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: meta.accent }}
                          />
                          <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                          <span className={cn('truncate', isSelectedCat && 'font-medium')}>
                            {meta.label}
                          </span>
                        </span>
                        <span className="font-mono text-[10.5px] tabular-nums opacity-80">
                          {items.length}
                        </span>
                      </button>
                    </div>

                    {isExpanded && items.length > 0 && (
                      <div className="ml-6 space-y-0.5 border-l border-border/60 pl-2">
                        {items.slice(0, 12).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              if (layoutMode === 'mission' && !byId.has(item.id)) {
                                setLayoutMode('clustered')
                              }
                              if (categoryFilter !== 'all' && categoryFilter !== item.category) {
                                setCategoryFilter('all')
                              }
                              focusNode(item.id)
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors',
                              selected === item.id
                                ? 'bg-sky-500/12 font-medium text-sky-600 dark:text-sky-400'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            )}
                          >
                            <span className="truncate">{item.name}</span>
                            <span className="shrink-0 font-mono text-[9.5px] tabular-nums opacity-70">
                              {item.degree}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>
        )}

        {/* Center Interactive Architectural Canvas */}
        <div
          ref={canvasWrapRef}
          className="relative flex min-h-0 flex-1 overflow-hidden bg-muted/15"
        >
          {/* Optional Create Node Drawer */}
          {createOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = newName.trim()
                if (name.length < 2) return
                void act(async () => {
                  const r = (await api.gbrainGraphAction('create', {
                    name,
                    note: note.trim() || undefined,
                    category: newCategory,
                  })) as {
                    kind: 'created' | 'exists' | 'near_match'
                    entity?: { id: string; name: string }
                    hint?: string
                  }
                  setNewName('')
                  setNote('')
                  setCreateOpen(false)
                  if (r.entity?.id) void inspect(r.entity.id)
                  if (r.kind === 'near_match' && r.hint) return r.hint
                  if (r.kind === 'exists' && r.entity) {
                    return `Entity "${r.entity.name}" already exists — opened inspector`
                  }
                  return `Created ${GBRAIN_CATEGORY_MAP[newCategory].shortLabel} node "${r.entity?.name ?? name}"`
                })
              }}
              className="absolute top-3 left-3 z-20 flex w-76 flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Add categorized entity</span>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  aria-label="Close new entity form"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Entity name (e.g. Payments API)"
                className="h-8 text-xs"
                autoFocus
              />
              <div>
                <label className="mb-1 block text-[10.5px] text-muted-foreground">Category</label>
                <div className="grid grid-cols-2 gap-1">
                  {GBRAIN_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setNewCategory(cat.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] transition-colors',
                        newCategory === cat.id
                          ? 'border-foreground/30 bg-muted font-medium text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: cat.accent }}
                      />
                      <span className="truncate">{cat.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional truth note to attach"
                className="h-8 text-xs"
              />
              <Button
                type="submit"
                size="sm"
                className="h-8 text-xs"
                disabled={busy || newName.trim().length < 2}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Create node
              </Button>
            </form>
          )}

          {loading && !graph ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading categorized knowledge graph…
            </div>
          ) : layoutMode === 'mission' && !missionGraph.hasMission ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Target className="h-7 w-7 text-muted-foreground/50" />
              <p className="text-xs font-medium text-foreground">No active mission path yet</p>
              <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
                Run an agentic task with Eva to visualize the live mission path, dynamic sub-goal statuses, and task dependencies here.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setLayoutMode('clustered')}
              >
                View Knowledge Graph
              </Button>
            </div>
          ) : canvasLaidNodes.length === 0 && laidMissionNodes.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <Network className="h-7 w-7 text-muted-foreground/50" />
              <p className="text-xs font-medium text-foreground">
                {graph && graph.nodes.length > 0
                  ? 'No entities match the current category or filter'
                  : 'No entities indexed yet'}
              </p>
              <div className="flex items-center gap-2">
                {categoryFilter !== 'all' || search ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setCategoryFilter('all')
                      setOriginFilter('all')
                      setSearch('')
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() =>
                      void act(async () => {
                        const r = (await api.gbrainGraphAction('sync_workspace')) as {
                          entities: number
                          edges: number
                        }
                        return `Synced ${r.entities} entities from workspace`
                      })
                    }
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sync workspace into GBrain
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <svg
              onWheel={onWheel}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              className="h-full w-full cursor-grab select-none active:cursor-grabbing"
              role="img"
              aria-label={`Interactive GBrain knowledge graph (${layoutMode} layout)`}
            >
              <defs>
                <pattern id="gbrain-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <circle cx="1.5" cy="1.5" r="0.9" fill="currentColor" opacity="0.08" />
                </pattern>
                <marker
                  id="gbrain-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="currentColor" opacity="0.45" />
                </marker>
                <marker
                  id="gbrain-arrow-active"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6.5"
                  markerHeight="6.5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#38bdf8" />
                </marker>
                {MISSION_STATUS_KEYS.map((st) => (
                  <marker
                    key={st}
                    id={`gbrain-mission-arrow-${st}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6.5"
                    markerHeight="6.5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill={MISSION_STATUS_META[st].accent} />
                  </marker>
                ))}
              </defs>
              <rect width="100%" height="100%" fill="url(#gbrain-grid)" />

              <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
                {/* Active Mission Path Zone Container */}
                {showMissionOnCanvas && missionLayoutResult?.zone && (
                  <g pointerEvents="none" data-gbrain-mission-zone="1">
                    <rect
                      x={missionLayoutResult.zone.x}
                      y={missionLayoutResult.zone.y}
                      width={missionLayoutResult.zone.width}
                      height={missionLayoutResult.zone.height}
                      rx={14}
                      fill={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent}
                      fillOpacity={0.04}
                      stroke={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent}
                      strokeOpacity={0.34}
                      strokeWidth={1.3 / Math.sqrt(Math.max(0.4, view.scale))}
                    />
                    <circle
                      cx={missionLayoutResult.zone.x + 16}
                      cy={missionLayoutResult.zone.y + 20}
                      r={4}
                      fill={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent}
                    />
                    <text
                      x={missionLayoutResult.zone.x + 28}
                      y={missionLayoutResult.zone.y + 24}
                      fontSize={12.5}
                      fontWeight={600}
                      fill={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent}
                      opacity={0.96}
                      className="tracking-tight"
                    >
                      Active Mission Path · {missionGraph.phaseLabel}
                    </text>
                    <text
                      x={missionLayoutResult.zone.x + missionLayoutResult.zone.width - 16}
                      y={missionLayoutResult.zone.y + 24}
                      textAnchor="end"
                      fontSize={11}
                      fill={MISSION_STATUS_META[missionGraph.nodes[0]?.status ?? 'pending'].accent}
                      opacity={0.82}
                      className="font-mono"
                    >
                      {missionGraph.completed}/{missionGraph.total} tasks · {missionGraph.percent}%
                      {missionGraph.failed > 0 ? ` · ${missionGraph.failed} failed` : ''}
                      {missionGraph.blocked > 0 ? ` · ${missionGraph.blocked} blocked` : ''}
                    </text>
                  </g>
                )}

                {/* Linked GBrain Entities Zone (Mission Focused mode) */}
                {layoutMode === 'mission' && bridgedZone && (
                  <g pointerEvents="none" data-gbrain-bridged-zone="1">
                    <rect
                      x={bridgedZone.x}
                      y={bridgedZone.y}
                      width={bridgedZone.width}
                      height={bridgedZone.height}
                      rx={14}
                      fill="#94a3b8"
                      fillOpacity={0.035}
                      stroke="#94a3b8"
                      strokeOpacity={0.26}
                      strokeWidth={1.2 / Math.sqrt(Math.max(0.4, view.scale))}
                      strokeDasharray="6 4"
                    />
                    <text
                      x={bridgedZone.x + 16}
                      y={bridgedZone.y + 22}
                      fontSize={11.5}
                      fontWeight={600}
                      fill="var(--muted-foreground)"
                      className="tracking-tight"
                    >
                      Linked GBrain Entities
                    </text>
                    <text
                      x={bridgedZone.x + bridgedZone.width - 16}
                      y={bridgedZone.y + 22}
                      textAnchor="end"
                      fontSize={10.5}
                      fill="var(--muted-foreground)"
                      className="font-mono"
                    >
                      {bridgedZone.count} bridged
                    </text>
                  </g>
                )}

                {/* Semantic Category Cluster Zones (Clustered mode) */}
                {layoutMode === 'clustered' &&
                  layoutResult.clusters.map((cluster) => {
                    const accent =
                      cluster.category && GBRAIN_CATEGORY_MAP[cluster.category]
                        ? GBRAIN_CATEGORY_MAP[cluster.category].accent
                        : cluster.key === 'core'
                          ? '#38bdf8'
                          : '#94a3b8'
                    if (
                      cluster.x !== undefined &&
                      cluster.y !== undefined &&
                      cluster.width !== undefined &&
                      cluster.height !== undefined
                    ) {
                      return (
                        <g key={cluster.key} pointerEvents="none" data-gbrain-zone={cluster.key}>
                          <rect
                            x={cluster.x}
                            y={cluster.y}
                            width={cluster.width}
                            height={cluster.height}
                            rx={14}
                            fill={accent}
                            fillOpacity={0.04}
                            stroke={accent}
                            strokeOpacity={0.28}
                            strokeWidth={1.25 / Math.sqrt(Math.max(0.4, view.scale))}
                          />
                          <circle
                            cx={cluster.x + 16}
                            cy={cluster.y + 20}
                            r={4}
                            fill={accent}
                          />
                          <text
                            x={cluster.x + 28}
                            y={cluster.y + 24}
                            fontSize={12.5}
                            fontWeight={600}
                            fill={accent}
                            opacity={0.95}
                            className="tracking-tight"
                          >
                            {cluster.label}
                          </text>
                          <text
                            x={cluster.x + cluster.width - 16}
                            y={cluster.y + 24}
                            textAnchor="end"
                            fontSize={11}
                            fill={accent}
                            opacity={0.72}
                            className="font-mono"
                          >
                            {cluster.count} {cluster.count === 1 ? 'node' : 'nodes'}
                          </text>
                        </g>
                      )
                    }
                    return (
                      <g key={cluster.key} pointerEvents="none">
                        <circle
                          cx={cluster.cx}
                          cy={cluster.cy}
                          r={cluster.radius}
                          fill={accent}
                          fillOpacity={0.035}
                          stroke={accent}
                          strokeOpacity={0.24}
                          strokeWidth={1.3 / Math.sqrt(view.scale)}
                          strokeDasharray="6 5"
                        />
                        <text
                          x={cluster.cx}
                          y={cluster.cy - cluster.radius - 10}
                          textAnchor="middle"
                          fontSize={11.5}
                          fontWeight={600}
                          fill={accent}
                          opacity={0.92}
                          className="font-mono tracking-wide"
                        >
                          {cluster.label} · {cluster.count}
                        </text>
                      </g>
                    )
                  })}

                {/* Curved Directed GBrain Knowledge Edges */}
                {canvasVisibleEdges.map((e) => {
                  const a = byId.get(e.sourceId)
                  const b = byId.get(e.targetId)
                  if (!a || !b) return null
                  const isHighlighted =
                    activeFocusId !== null &&
                    (e.sourceId === activeFocusId || e.targetId === activeFocusId)
                  const dimmed = activeFocusId !== null && !isHighlighted

                  const stroke = isHighlighted
                    ? '#38bdf8'
                    : e.kind === 'INFERRED'
                      ? '#a78bfa'
                      : '#64748b'

                  const dx = b.x - a.x
                  const dy = b.y - a.y
                  const len = Math.max(1, Math.hypot(dx, dy))
                  // Shorten endpoints to card edge so arrows cleanly kiss the node box
                  const padStart = Math.min(len * 0.35, HALF_W * 0.65)
                  const padEnd = Math.min(len * 0.35, HALF_W * 0.72)
                  const sx = a.x + (dx / len) * padStart
                  const sy = a.y + (dy / len) * (padStart * 0.55)
                  const ex = b.x - (dx / len) * padEnd
                  const ey = b.y - (dy / len) * (padEnd * 0.55)

                  const mx = (sx + ex) / 2
                  const my = (sy + ey) / 2
                  const bend = Math.min(28, len * 0.08)
                  const cx = mx - (dy / len) * bend
                  const cy = my + (dx / len) * bend

                  return (
                    <g key={e.id}>
                      <path
                        d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
                        fill="none"
                        stroke={stroke}
                        strokeOpacity={isHighlighted ? 0.92 : dimmed ? 0.08 : 0.36}
                        strokeWidth={isHighlighted ? 2.1 : 1.25}
                        strokeDasharray={e.kind === 'INFERRED' ? '5 4' : undefined}
                        markerEnd={
                          isHighlighted ? 'url(#gbrain-arrow-active)' : 'url(#gbrain-arrow)'
                        }
                      />
                      {isHighlighted && (
                        <g transform={`translate(${cx}, ${cy})`} pointerEvents="none">
                          <rect
                            x={-(e.relation.length * 3.4 + 8)}
                            y={-9}
                            width={e.relation.length * 6.8 + 16}
                            height={17}
                            rx={4}
                            fill="var(--background)"
                            stroke="#38bdf8"
                            strokeOpacity={0.45}
                            strokeWidth={0.9}
                          />
                          <text
                            y={3}
                            textAnchor="middle"
                            fontSize={9.5}
                            fill="currentColor"
                            className="font-mono"
                          >
                            {e.relation}
                          </text>
                        </g>
                      )}
                    </g>
                  )
                })}

                {/* Mission Knowledge-Bridge Edges (Agentic Tasks -> GBrain Knowledge Entities) */}
                {showMissionOnCanvas &&
                  missionGraph.edges
                    .filter((me) => me.edgeKind === 'knowledge_bridge')
                    .map((me) => {
                      const src = missionById.get(me.sourceId)
                      const dst = byId.get(me.targetId)
                      if (!src || !dst) return null
                      const isHighlighted =
                        activeFocusId !== null &&
                        (me.sourceId === activeFocusId || me.targetId === activeFocusId)
                      const dimmed = activeFocusId !== null && !isHighlighted

                      const sx = src.x
                      const sy = src.y + src.height / 2
                      const ex = dst.x
                      const ey = dst.y - HALF_H
                      const midY = (sy + ey) / 2
                      const stroke = isHighlighted ? '#38bdf8' : MISSION_STATUS_META[me.status].accent

                      return (
                        <g key={me.id} data-mission-edge="knowledge_bridge">
                          <path
                            d={`M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`}
                            fill="none"
                            stroke={stroke}
                            strokeOpacity={isHighlighted ? 0.85 : dimmed ? 0.06 : 0.34}
                            strokeWidth={isHighlighted ? 1.8 : 1.15}
                            strokeDasharray="4 4"
                            markerEnd={
                              isHighlighted
                                ? 'url(#gbrain-arrow-active)'
                                : `url(#gbrain-mission-arrow-${me.status})`
                            }
                          />
                        </g>
                      )
                    })}

                {/* Mission Dependency DAG Edges (Mission Goal -> Sub-goals -> Downstream Tasks) */}
                {showMissionOnCanvas &&
                  missionGraph.edges
                    .filter((me) => me.edgeKind !== 'knowledge_bridge')
                    .map((me) => {
                      const src = missionById.get(me.sourceId)
                      const dst = missionById.get(me.targetId)
                      if (!src || !dst) return null
                      const isHighlighted =
                        activeFocusId !== null &&
                        (me.sourceId === activeFocusId || me.targetId === activeFocusId)
                      const dimmed = activeFocusId !== null && !isHighlighted

                      const sx = src.x + src.width / 2
                      const sy = src.y
                      const ex = dst.x - dst.width / 2 - 2
                      const ey = dst.y
                      const dx = Math.max(36, Math.abs(ex - sx) * 0.45)
                      const stroke = MISSION_STATUS_META[me.status].accent
                      const mx = (sx + ex) / 2
                      const my = (sy + ey) / 2

                      return (
                        <g
                          key={me.id}
                          data-mission-edge={me.edgeKind}
                          data-mission-edge-status={me.status}
                        >
                          <path
                            d={`M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`}
                            fill="none"
                            stroke={stroke}
                            strokeOpacity={isHighlighted ? 0.98 : dimmed ? 0.14 : 0.78}
                            strokeWidth={isHighlighted ? 2.4 : me.status === 'running' ? 2.1 : 1.65}
                            strokeDasharray={me.status === 'blocked' ? '5 4' : undefined}
                            markerEnd={`url(#gbrain-mission-arrow-${me.status})`}
                          />
                          {isHighlighted && (
                            <g transform={`translate(${mx}, ${my})`} pointerEvents="none">
                              <rect
                                x={-(me.relation.length * 3.4 + 8)}
                                y={-9}
                                width={me.relation.length * 6.8 + 16}
                                height={17}
                                rx={4}
                                fill="var(--background)"
                                stroke={stroke}
                                strokeOpacity={0.55}
                                strokeWidth={0.9}
                              />
                              <text
                                y={3}
                                textAnchor="middle"
                                fontSize={9.5}
                                fill="currentColor"
                                className="font-mono"
                              >
                                {me.relation}
                              </text>
                            </g>
                          )}
                        </g>
                      )
                    })}

                {/* Structured Architectural GBrain Entity Node Cards */}
                {canvasLaidNodes.map((l) => {
                  const isSelected = l.node.id === selected
                  const isHovered = l.node.id === hovered
                  const inNeighborhood = activeFocusId === null || neighborSet.has(l.node.id)
                  const cat = GBRAIN_CATEGORY_MAP[l.node.category] ?? GBRAIN_CATEGORY_MAP.concepts
                  const traceOp = tracedNodeMap.get(l.node.id) ?? null
                  const inActivePack = activePackSet.has(l.node.id)
                  const traceColor =
                    traceOp === 'write'
                      ? '#10b981'
                      : traceOp === 'reason'
                        ? '#a78bfa'
                        : '#38bdf8'

                  return (
                    <g
                      key={l.node.id}
                      data-graph-node="1"
                      data-node-category={l.node.category}
                      data-node-traced={traceOp ?? undefined}
                      data-node-in-pack={inActivePack ? '1' : undefined}
                      transform={`translate(${l.x}, ${l.y})`}
                      className="cursor-pointer"
                      opacity={inNeighborhood ? 1 : 0.22}
                      onMouseEnter={() => setHovered(l.node.id)}
                      onMouseLeave={() => setHovered((cur) => (cur === l.node.id ? null : cur))}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        dragNodeRef.current = {
                          nodeId: l.node.id,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origX: l.x,
                          origY: l.y,
                          moved: false,
                        }
                      }}
                    >
                      <title>{`${l.node.name} · ${cat.label} (${l.node.degree} links, ${l.node.memoryCount} memories)${traceOp ? ` · Live ${traceOp}` : ''}${inActivePack ? ' · Active Context Pack' : ''} — click to inspect, drag to move`}</title>

                      {/* Live Working Memory Trace Halo */}
                      {traceOp && (
                        <>
                          <rect
                            x={-HALF_W - 6}
                            y={-HALF_H - 6}
                            width={CARD_W + 12}
                            height={CARD_H + 12}
                            rx={13}
                            fill="none"
                            stroke={traceColor}
                            strokeWidth={1.8}
                            strokeDasharray="6 3"
                            strokeOpacity={0.9}
                          />
                          <g transform={`translate(${HALF_W - 24}, ${-HALF_H - 9})`} pointerEvents="none">
                            <rect
                              x={-22}
                              y={-8}
                              width={44}
                              height={15}
                              rx={4}
                              fill={traceColor}
                            />
                            <text
                              y={2.5}
                              textAnchor="middle"
                              fontSize={8.5}
                              fontWeight={600}
                              fill="#09090b"
                              className="font-mono"
                            >
                              {traceOp}
                            </text>
                          </g>
                        </>
                      )}

                      {/* Selection / Hover halo */}
                      {(isSelected || isHovered) && (
                        <rect
                          x={-HALF_W - 4}
                          y={-HALF_H - 4}
                          width={CARD_W + 8}
                          height={CARD_H + 8}
                          rx={12}
                          fill="none"
                          stroke={isSelected ? '#38bdf8' : cat.accent}
                          strokeWidth={isSelected ? 2 : 1.4}
                          strokeOpacity={0.85}
                        />
                      )}

                      {/* Node Card Surface */}
                      <rect
                        x={-HALF_W}
                        y={-HALF_H}
                        width={CARD_W}
                        height={CARD_H}
                        rx={9}
                        fill="var(--card)"
                        stroke={
                          isSelected
                            ? '#38bdf8'
                            : inActivePack
                              ? '#38bdf8'
                              : 'var(--border)'
                        }
                        strokeWidth={isSelected || inActivePack ? 1.5 : 1}
                      />

                      {/* Subtle top semantic category strip (clean horizontal accent, not a thick left border) */}
                      <rect
                        x={-HALF_W + 10}
                        y={-HALF_H + 0.5}
                        width={CARD_W - 20}
                        height={2.5}
                        rx={1.25}
                        fill={cat.accent}
                        opacity={isSelected || isHovered || inActivePack ? 1 : 0.85}
                      />

                      {/* Category dot + Node Title */}
                      <circle
                        cx={-HALF_W + 14}
                        cy={-6}
                        r={3.5}
                        fill={cat.accent}
                      />
                      <text
                        x={-HALF_W + 24}
                        y={-2.5}
                        fontSize={11.5}
                        fontWeight={600}
                        fill="var(--foreground)"
                        className="pointer-events-none select-none"
                      >
                        {truncateText(l.node.name, 19)}
                      </text>

                      {/* Active Context Pack Pin Indicator */}
                      {inActivePack && (
                        <circle
                          cx={HALF_W - 12}
                          cy={-6}
                          r={3}
                          fill="#38bdf8"
                        />
                      )}

                      {/* Clean unboxed metadata subline */}
                      <text
                        x={-HALF_W + 14}
                        y={14}
                        fontSize={9.5}
                        fill="var(--muted-foreground)"
                        className="pointer-events-none select-none font-mono"
                      >
                        {cat.shortLabel} · {l.node.degree} links
                        {l.node.memoryCount > 0 ? ` · ${l.node.memoryCount}m` : ''}
                      </text>
                    </g>
                  )
                })}

                {/* Dynamic Active Mission Root & Agentic Task Node Cards */}
                {showMissionOnCanvas &&
                  laidMissionNodes.map((l) => {
                    const isSelected = l.node.id === selected
                    const isHovered = l.node.id === hovered
                    const inNeighborhood = activeFocusId === null || neighborSet.has(l.node.id)
                    const statusMeta = MISSION_STATUS_META[l.node.status]
                    const hw = l.width / 2
                    const hh = l.height / 2
                    const isRoot = l.node.nodeKind === 'mission_root'
                    const isRunning = l.node.status === 'running'
                    const maxChars = isRoot ? 24 : 21

                    return (
                      <g
                        key={l.node.id}
                        data-graph-node="1"
                        data-mission-node="1"
                        data-mission-kind={l.node.nodeKind}
                        data-mission-status={l.node.status}
                        transform={`translate(${l.x}, ${l.y})`}
                        className="cursor-pointer"
                        opacity={inNeighborhood ? 1 : 0.25}
                        onMouseEnter={() => setHovered(l.node.id)}
                        onMouseLeave={() => setHovered((cur) => (cur === l.node.id ? null : cur))}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          dragNodeRef.current = {
                            nodeId: l.node.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            origX: l.x,
                            origY: l.y,
                            moved: false,
                          }
                        }}
                      >
                        <title>{`${isRoot ? 'Mission Goal' : `Sub-goal #${l.node.stepIndex}`}: ${l.node.description} · Status: ${l.node.statusLabel} · Assignee: ${l.node.assignee} — click to inspect dependencies, drag to arrange`}</title>

                        {/* Dynamic Running Halo */}
                        {isRunning && (
                          <rect
                            x={-hw - 5}
                            y={-hh - 5}
                            width={l.width + 10}
                            height={l.height + 10}
                            rx={14}
                            fill="none"
                            stroke={statusMeta.accent}
                            strokeWidth={1.6}
                            strokeDasharray="6 4"
                            strokeOpacity={0.85}
                          />
                        )}

                        {/* Selection / Hover Halo */}
                        {(isSelected || isHovered) && (
                          <rect
                            x={-hw - 4}
                            y={-hh - 4}
                            width={l.width + 8}
                            height={l.height + 8}
                            rx={13}
                            fill="none"
                            stroke={isSelected ? '#38bdf8' : statusMeta.accent}
                            strokeWidth={isSelected ? 2 : 1.4}
                            strokeOpacity={0.9}
                          />
                        )}

                        {/* Card Surface */}
                        <rect
                          x={-hw}
                          y={-hh}
                          width={l.width}
                          height={l.height}
                          rx={10}
                          fill="var(--card)"
                          stroke={
                            isSelected
                              ? '#38bdf8'
                              : l.node.status === 'failed' || l.node.status === 'running'
                                ? statusMeta.accent
                                : 'var(--border)'
                          }
                          strokeWidth={
                            isSelected || l.node.status === 'failed' || l.node.status === 'running'
                              ? 1.5
                              : 1
                          }
                        />

                        {/* Clean horizontal top status accent bar */}
                        <rect
                          x={-hw + 12}
                          y={-hh + 0.5}
                          width={l.width - 24}
                          height={2.5}
                          rx={1.25}
                          fill={statusMeta.accent}
                        />

                        {/* Explicit Status Glyph */}
                        <MissionNodeStatusSvg status={l.node.status} x={-hw + 18} y={-8} />

                        {/* Card Title */}
                        <text
                          x={-hw + 32}
                          y={-4.5}
                          fontSize={11.5}
                          fontWeight={600}
                          fill="var(--foreground)"
                          className="pointer-events-none select-none"
                        >
                          {truncateText(l.node.title, maxChars)}
                        </text>

                        {/* Explicit unboxed status + assignee + step metadata */}
                        <text
                          x={-hw + 14}
                          y={14}
                          fontSize={9.5}
                          fill="var(--muted-foreground)"
                          className="pointer-events-none select-none font-mono"
                        >
                          {isRoot
                            ? `GOAL · ${l.node.statusLabel} · ${missionGraph.completed}/${missionGraph.total} · ${missionGraph.percent}%`
                            : `#${l.node.stepIndex} · ${l.node.statusLabel} · ${truncateText(l.node.assignee, 11)}${l.node.toolExecutions.length > 0 ? ` · ${l.node.toolExecutions.length}t` : ''}`}
                        </text>

                        {/* Compact progress bar along Mission Root bottom */}
                        {isRoot && (
                          <g pointerEvents="none">
                            <rect
                              x={-hw + 14}
                              y={hh - 7}
                              width={l.width - 28}
                              height={2.5}
                              rx={1.25}
                              fill="var(--border)"
                            />
                            <rect
                              x={-hw + 14}
                              y={hh - 7}
                              width={((l.width - 28) * missionGraph.percent) / 100}
                              height={2.5}
                              rx={1.25}
                              fill={statusMeta.accent}
                            />
                          </g>
                        )}
                      </g>
                    )
                  })}
              </g>
            </svg>
          )}

          {/* Minimal bottom-left spatial hint */}
          <div className="pointer-events-none absolute bottom-3 left-3 hidden items-center gap-2 rounded-md border border-border/70 bg-background/85 px-2.5 py-1 text-[10.5px] text-muted-foreground backdrop-blur sm:flex">
            <span>Scroll to zoom</span>
            <span>·</span>
            <span>Drag canvas to pan</span>
            <span>·</span>
            <span>Drag cards to arrange</span>
          </div>

          {/* Live Working Memory Trace Strip */}
          {latestTrace && (
            <div
              data-gbrain-live-trace="1"
              className="absolute right-3 bottom-3 z-10 flex max-w-md items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-[11px] shadow-md backdrop-blur"
            >
              <Activity className="h-3.5 w-3.5 shrink-0 text-sky-500" />
              <span className="shrink-0 font-mono text-[10px] font-semibold uppercase text-sky-600 dark:text-sky-400">
                {latestTrace.operation}
              </span>
              <span className="min-w-0 truncate text-foreground">
                {latestTrace.nodeNames.slice(0, 3).join(', ') || latestTrace.summary}
              </span>
              {latestTrace.nodeIds[0] && (
                <button
                  type="button"
                  onClick={() => focusNode(latestTrace.nodeIds[0])}
                  className="shrink-0 font-mono text-[10px] text-sky-600 hover:underline dark:text-sky-400"
                >
                  Focus
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  openReasoningForChain()
                }}
                title="Open Eva Reasoning Chain"
                className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                <GitBranch className="h-3 w-3" />
                <span>Chain</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Contextual Drawer: Truth Audit, Context Packs, or Node Inspector */}
        {rightPanel === 'audit' ? (
          <GBrainTruthAuditDrawer
            report={auditReport}
            loading={auditLoading}
            busyFindingId={busyFindingId}
            onRunScan={(deep) => void runTruthAudit(deep)}
            onResolve={(finding, action) => void resolveAuditFinding(finding, action)}
            onFocusNode={(id) => focusNode(id)}
            onClose={() => setRightPanel('inspector')}
          />
        ) : rightPanel === 'packs' ? (
          <GBrainContextPacksDrawer
            selectedNodeId={selected}
            selectedNodeName={detail?.entity.name ?? null}
            currentCategoryFilter={categoryFilter}
            onClose={() => setRightPanel('inspector')}
          />
        ) : (
        <aside
          ref={detailRef}
          className="nice-scroll flex h-64 w-full shrink-0 flex-col overflow-y-auto border-t border-border bg-sidebar md:h-auto md:w-80 md:border-t-0 md:border-l"
        >
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
              <MousePointerClick className="h-5 w-5 text-muted-foreground/60" />
              <p className="mt-2.5 text-xs font-medium text-foreground">Select any node or task</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Inspect Agentic Task status and dependencies, or explore GBrain entity memories and links.
              </p>
              {missionGraph.hasMission && (
                <div className="mt-5 w-full space-y-1 text-left">
                  <div className="font-mono text-[10px] tracking-wide text-muted-foreground">
                    Active mission sub-goals
                  </div>
                  {missionGraph.nodes.slice(0, 5).map((mn) => (
                    <button
                      key={mn.id}
                      type="button"
                      onClick={() => {
                        if (!showMissionOnCanvas) setShowMissionLayer(true)
                        focusNode(mn.id)
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {mn.nodeKind === 'mission_root' ? (
                          <Target className="h-3 w-3 shrink-0 text-sky-500" />
                        ) : (
                          <MissionRailStatusIcon status={mn.status} />
                        )}
                        <span className="truncate">
                          {mn.nodeKind === 'mission_root' ? mn.title : `#${mn.stepIndex} ${mn.title}`}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'ml-2 shrink-0 font-mono text-[10px]',
                          MISSION_STATUS_META[mn.status].textClass
                        )}
                      >
                        {mn.statusLabel}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {canvasLaidNodes.length > 0 && (
                <div className="mt-5 w-full space-y-1 text-left">
                  <div className="font-mono text-[10px] tracking-wide text-muted-foreground">
                    Top connected hubs
                  </div>
                  {canvasLaidNodes
                    .slice()
                    .sort((a, b) => b.node.degree - a.node.degree)
                    .slice(0, 6)
                    .map((l) => {
                      const cat = GBRAIN_CATEGORY_MAP[l.node.category] ?? GBRAIN_CATEGORY_MAP.concepts
                      return (
                        <button
                          key={l.node.id}
                          type="button"
                          onClick={() => focusNode(l.node.id)}
                          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.accent }}
                            />
                            <span className="truncate">{l.node.name}</span>
                          </span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] tabular-nums">
                            {l.node.degree} links
                          </span>
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          ) : selectedMissionNode ? (
            <GBrainMissionInspector
              node={selectedMissionNode}
              mission={missionGraph}
              entityLookup={entityLookup}
              onFocusMissionNode={(id) => focusNode(id)}
              onFocusEntityNode={(id) => {
                if (layoutMode === 'mission' && !byId.has(id)) {
                  setLayoutMode('clustered')
                }
                focusNode(id)
              }}
              onOpenReasoningChain={() => {
                onOpenChange(false)
                openReasoningForChain()
              }}
            />
          ) : detailLoading || !detail ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading entity…
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {/* Entity Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: GBRAIN_CATEGORY_MAP[activeCategory].accent }}
                    />
                    <h3 className="truncate text-sm font-semibold">{detail.entity.name}</h3>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                    {detail.entity.origin === 'manual' ? (
                      <User className="h-3 w-3 text-sky-500" />
                    ) : (
                      <Bot className="h-3 w-3 text-emerald-500" />
                    )}
                    <span>{GBRAIN_CATEGORY_MAP[activeCategory].label}</span>
                    <span>·</span>
                    <span>{detail.entity.origin === 'manual' ? 'manual' : 'auto'}</span>
                    <span>·</span>
                    <span className="tabular-nums">{detail.neighbors.length} links</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  aria-label="Remove entity"
                  title="Remove entity (memories remain)"
                  onClick={() => {
                    const id = detail.entity.id
                    const label = detail.entity.name
                    void act(async () => {
                      await api.gbrainGraphAction('remove', { nodeId: id })
                      setSelected(null)
                      setDetail(null)
                      return `Removed "${label}"`
                    })
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Category Reassignment */}
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Category</div>
                <div className="grid grid-cols-2 gap-1">
                  {GBRAIN_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const id = detail.entity.id
                        void act(async () => {
                          await api.gbrainGraphAction('set_category', {
                            nodeId: id,
                            category: cat.id,
                          })
                          await inspect(id)
                          return `Moved "${detail.entity.name}" to ${cat.label}`
                        })
                      }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[11px] transition-colors',
                        activeCategory === cat.id
                          ? 'border-foreground/30 bg-muted font-medium text-foreground'
                          : 'border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: cat.accent }}
                      />
                      <span className="truncate">{cat.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Aliases */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Tag className="h-3 w-3" /> Aliases
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-foreground/85">
                  {visibleAliases(detail.entity.variants).length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    visibleAliases(detail.entity.variants).map((v) => (
                      <span key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">
                        {v}
                      </span>
                    ))
                  )}
                </div>
                <form
                  className="mt-2 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const a = alias.trim()
                    if (!a) return
                    const id = detail.entity.id
                    void act(async () => {
                      await api.gbrainGraphAction('alias', { nodeId: id, alias: a })
                      setAlias('')
                      await inspect(id)
                      return `Added alias "${a}"`
                    })
                  }}
                >
                  <Input
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="Add alias…"
                    className="h-7 text-xs"
                  />
                  <Button type="submit" variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={busy || !alias.trim()}>
                    Add
                  </Button>
                </form>
              </div>

              {/* Rename */}
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault()
                  const next = renaming.trim()
                  if (next.length < 2) return
                  const id = detail.entity.id
                  void act(async () => {
                    await api.gbrainGraphAction('rename', { nodeId: id, name: next })
                    setRenaming('')
                    await inspect(id)
                    return `Renamed to "${next}"`
                  })
                }}
              >
                <Input
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  placeholder="Rename entity…"
                  className="h-7 text-xs"
                />
                <Button type="submit" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy || renaming.trim().length < 2}>
                  <Pencil className="h-3 w-3" /> Rename
                </Button>
              </form>

              {/* Connect to another node */}
              <div className="border-t border-border/60 pt-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Link2 className="h-3 w-3" /> Connect to node
                </div>
                <form
                  className="space-y-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!linkTargetId) return
                    const id = detail.entity.id
                    void act(async () => {
                      await api.gbrainGraphAction('link', {
                        nodeId: id,
                        targetId: linkTargetId,
                        relation: linkRelation.trim() || 'related_to',
                      })
                      setLinkTargetId('')
                      await inspect(id)
                      return `Linked via "${linkRelation.trim() || 'related_to'}"`
                    })
                  }}
                >
                  <select
                    value={linkTargetId}
                    onChange={(e) => setLinkTargetId(e.target.value)}
                    aria-label="Select target entity to link"
                    className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">Choose target entity…</option>
                    {categorizedNodes
                      .filter((n) => n.id !== detail.entity.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} ({GBRAIN_CATEGORY_MAP[n.category].shortLabel})
                        </option>
                      ))}
                  </select>
                  <div className="flex gap-1.5">
                    <Input
                      value={linkRelation}
                      onChange={(e) => setLinkRelation(e.target.value)}
                      placeholder="Relation (e.g. depends_on)"
                      className="h-7 text-xs"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={busy || !linkTargetId}
                    >
                      Link
                    </Button>
                  </div>
                </form>
              </div>

              {/* Connected Neighbors */}
              <div className="border-t border-border/60 pt-3">
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  Connected neighbors ({detail.neighbors.length})
                </div>
                {detail.neighbors.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No connected neighbors yet.</p>
                ) : (
                  <div className="space-y-1">
                    {detail.neighbors.map((nb) => {
                      const edge = detail.edges.find(
                        (e) =>
                          (e.sourceId === detail.entity.id && e.targetId === nb.id) ||
                          (e.targetId === detail.entity.id && e.sourceId === nb.id)
                      )
                      return (
                        <button
                          key={nb.id}
                          type="button"
                          onClick={() => focusNode(nb.id)}
                          className="flex w-full items-center justify-between rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-left text-xs transition-colors hover:border-sky-500/40 hover:bg-muted"
                        >
                          <span className="truncate font-medium text-foreground">{nb.name}</span>
                          {edge && (
                            <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
                              {edge.relation}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Linked Memories */}
              <div className="border-t border-border/60 pt-3">
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                  Indexed memories ({detail.memories.length})
                </div>
                {detail.memories.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No memories linked yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.memories.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-lg border border-border/70 bg-background/70 p-2.5 text-[11.5px]"
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                          <span>
                            {m.type} · trust {Math.round(m.trust * 100)}%
                          </span>
                          {m.alwaysLoad && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                              <BadgeCheck className="h-3 w-3" /> core
                            </span>
                          )}
                        </div>
                        <p className="mt-1 leading-relaxed text-foreground/90">{m.truth || m.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>
        )}
      </div>
    </div>
  )
}

export function GBrainGraphButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onClick}>
      <Maximize2 className="h-3.5 w-3.5" />
      <span>Open GBrain Graph</span>
    </Button>
  )
}
