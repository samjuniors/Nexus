import { GBRAIN_CATEGORY_MAP, isValidCategory, type GBrainCategoryId } from './gbrain-categories'

export type GBrainLayoutMode = 'clustered' | 'hierarchy' | 'force'

export interface GBrainLayoutNodeInput {
  id: string
  name: string
  degree: number
  origin: string
  category?: GBrainCategoryId
}

export interface GBrainLayoutEdgeInput {
  id: string
  sourceId: string
  targetId: string
  relation: string
  kind: string
}

export interface LaidGBrainNode<T extends GBrainLayoutNodeInput = GBrainLayoutNodeInput> {
  node: T
  x: number
  y: number
  r: number
  tier: number
  clusterKey: string
}

export interface ClusterHalo {
  key: string
  label: string
  origin: string
  category?: GBrainCategoryId
  cx: number
  cy: number
  radius: number
  x?: number
  y?: number
  width?: number
  height?: number
  count: number
}

export interface GBrainLayoutResult<T extends GBrainLayoutNodeInput = GBrainLayoutNodeInput> {
  nodes: LaidGBrainNode<T>[]
  clusters: ClusterHalo[]
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    width: number
    height: number
  }
}

export interface LayoutOptions {
  width?: number
  height?: number
  /** When true, spaces nodes for structured architectural node cards (~164x52) rather than compact dots */
  cardSpacing?: boolean
}

const DEFAULT_W = 1280
const DEFAULT_H = 820

/** Deterministic PRNG (mulberry32) so every layout is reproducible per graph. */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(nodes: GBrainLayoutNodeInput[]): number {
  let h = 2166136261
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      h ^= n.id.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return h >>> 0
}

function nodeRadius(degree: number, maxDeg: number): number {
  const ratio = maxDeg > 0 ? Math.min(1, degree / maxDeg) : 0
  return Math.round((10 + ratio * 12) * 10) / 10
}

/**
 * Iterative collision separation (supports circular nodes or elliptical card footprints)
 * to guarantee zero overlapping nodes while keeping semantic category clusters coherent.
 */
function resolveCollisions<T extends GBrainLayoutNodeInput>(
  laid: LaidGBrainNode<T>[],
  paddingX = 20,
  paddingY = 20,
  iterations = 28,
  lockY = false
) {
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]
        const b = laid[j]
        const minX = a.r + b.r + paddingX
        const minY = a.r + b.r + paddingY
        let dx = b.x - a.x
        let dy = lockY ? 0 : b.y - a.y

        if (lockY && Math.abs(b.y - a.y) > minY * 0.7) continue

        // Normalized elliptical distance for card-aware separation
        const nx = dx / minX
        const ny = lockY ? 0 : dy / minY
        let nd = Math.hypot(nx, ny)
        if (nd < 0.001) {
          dx = (i % 2 === 0 ? 1 : -1) * 1.2
          dy = lockY ? 0 : (j % 2 === 0 ? 1 : -1) * 1.2
          nd = Math.hypot(dx / minX, lockY ? 0 : dy / minY)
        }
        if (nd < 1) {
          const push = (1 - nd) * 0.54
          const ux = (dx / Math.max(0.001, Math.hypot(dx, dy))) * push * minX
          const uy = lockY ? 0 : (dy / Math.max(0.001, Math.hypot(dx, dy))) * push * minY
          a.x -= ux
          b.x += ux
          if (!lockY) {
            a.y -= uy
            b.y += uy
          }
          moved = true
        }
      }
    }
    if (!moved) break
  }
}

function computeBounds<T extends GBrainLayoutNodeInput>(
  laid: LaidGBrainNode<T>[],
  clusters: ClusterHalo[],
  fallbackW: number,
  fallbackH: number,
  cardSpacing: boolean
) {
  if (laid.length === 0) {
    return { minX: 0, minY: 0, maxX: fallbackW, maxY: fallbackH, width: fallbackW, height: fallbackH }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const padX = cardSpacing ? 105 : 48
  const padY = cardSpacing ? 46 : 36

  for (const l of laid) {
    minX = Math.min(minX, l.x - l.r - padX)
    minY = Math.min(minY, l.y - l.r - padY)
    maxX = Math.max(maxX, l.x + l.r + padX)
    maxY = Math.max(maxY, l.y + l.r + padY)
  }
  for (const c of clusters) {
    if (c.x !== undefined && c.y !== undefined && c.width !== undefined && c.height !== undefined) {
      minX = Math.min(minX, c.x - 24)
      minY = Math.min(minY, c.y - 24)
      maxX = Math.max(maxX, c.x + c.width + 24)
      maxY = Math.max(maxY, c.y + c.height + 24)
    } else {
      minX = Math.min(minX, c.cx - c.radius - 28)
      minY = Math.min(minY, c.cy - c.radius - 34)
      maxX = Math.max(maxX, c.cx + c.radius + 28)
      maxY = Math.max(maxY, c.cy + c.radius + 28)
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(320, maxX - minX),
    height: Math.max(240, maxY - minY),
  }
}

/**
 * Recomputes exact cluster zone bounding box & enclosing halo after placement
 * so every semantic category container cleanly frames its member nodes.
 */
function fitClusterHalos<T extends GBrainLayoutNodeInput>(
  laid: LaidGBrainNode<T>[],
  clusters: ClusterHalo[],
  cardSpacing: boolean
) {
  const byCluster = new Map<string, LaidGBrainNode<T>[]>()
  for (const l of laid) {
    if (!byCluster.has(l.clusterKey)) byCluster.set(l.clusterKey, [])
    byCluster.get(l.clusterKey)!.push(l)
  }

  for (const cluster of clusters) {
    const members = byCluster.get(cluster.key)
    if (!members || members.length === 0) continue

    if (cardSpacing) {
      let bx1 = Infinity
      let by1 = Infinity
      let bx2 = -Infinity
      let by2 = -Infinity
      for (const m of members) {
        bx1 = Math.min(bx1, m.x - 84)
        by1 = Math.min(by1, m.y - 28)
        bx2 = Math.max(bx2, m.x + 84)
        by2 = Math.max(by2, m.y + 28)
      }
      const padX = 22
      const padTop = 44
      const padBottom = 22
      cluster.x = bx1 - padX
      cluster.y = by1 - padTop
      cluster.width = bx2 - bx1 + padX * 2
      cluster.height = by2 - by1 + padTop + padBottom
      cluster.cx = cluster.x + cluster.width / 2
      cluster.cy = cluster.y + cluster.height / 2
      cluster.radius = Math.hypot(cluster.width / 2, cluster.height / 2)
    } else {
      const avgX = members.reduce((acc, m) => acc + m.x, 0) / members.length
      const avgY = members.reduce((acc, m) => acc + m.y, 0) / members.length
      let maxDist = 0
      for (const m of members) {
        const d = Math.hypot(m.x - avgX, m.y - avgY) + m.r + 26
        if (d > maxDist) maxDist = d
      }
      cluster.cx = avgX
      cluster.cy = avgY
      cluster.radius = Math.max(62, maxDist)
    }
  }
}

/**
 * 1. CLUSTERED ORBITAL LAYOUT (Default)
 * Organizes high-centrality core hubs in the center and orbits semantic category zones
 * (Agents & Team, Projects & Systems, Tools & Skills, Concepts & Tech, People & Orgs, Facts & Decisions)
 * around the core with collision-free concentric placement.
 */
function layoutClusteredOrbital<T extends GBrainLayoutNodeInput>(
  nodes: T[],
  edges: GBrainLayoutEdgeInput[],
  w: number,
  h: number,
  cardSpacing: boolean
): GBrainLayoutResult<T> {
  const cx = w / 2
  const cy = h / 2
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree))
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))

  const hasCategories = nodes.some((n) => isValidCategory(n.category))

  // Top 1–3 highest centrality anchors form the central Core Hubs (keeping category zones rich)
  const hubCap = Math.min(cardSpacing ? 3 : 6, Math.max(1, Math.floor(sorted.length * 0.12)))
  const hubs: T[] = []
  const rest: T[] = []

  for (const n of sorted) {
    if (hubs.length < hubCap && n.degree >= 2) {
      hubs.push(n)
    } else {
      rest.push(n)
    }
  }
  if (hubs.length === 0 && sorted.length > 0) {
    hubs.push(sorted[0])
    rest.splice(0, 1)
  }

  const laid: LaidGBrainNode<T>[] = []
  const clusters: ClusterHalo[] = []

  // Architectural Zone Board layout for structured node cards (zero overlap, crisp readability)
  if (cardSpacing) {
    const stepX = 190
    const stepY = 74
    const padX = 24
    const padTop = 44
    const padBottom = 22
    const zoneGapX = 44
    const zoneGapY = 44

    // 1. Place Core Hubs centered across the top row
    const coreCols = hubs.length
    const coreBoxW = coreCols > 0 ? (coreCols - 1) * stepX + 168 + padX * 2 : 0
    const coreBoxH = coreCols > 0 ? 54 + padTop + padBottom : 0
    const topStartY = 40

    if (hubs.length > 0) {
      const rowStartX = cx - ((hubs.length - 1) * stepX) / 2
      const cardY = topStartY + padTop + 27
      hubs.forEach((n, idx) => {
        laid.push({
          node: n,
          x: rowStartX + idx * stepX,
          y: cardY,
          r: nodeRadius(n.degree, maxDeg),
          tier: 0,
          clusterKey: 'core',
        })
      })
      clusters.push({
        key: 'core',
        label: 'Core Hubs',
        origin: 'core',
        cx,
        cy: topStartY + coreBoxH / 2,
        radius: Math.hypot(coreBoxW / 2, coreBoxH / 2),
        count: hubs.length,
      })
    }

    // 2. Group remaining nodes by semantic category
    const groups = new Map<
      string,
      { label: string; origin: string; category?: GBrainCategoryId; items: T[] }
    >()
    const ensureGroup = (key: string, label: string, origin: string, category?: GBrainCategoryId) => {
      let g = groups.get(key)
      if (!g) {
        g = { label, origin, category, items: [] }
        groups.set(key, g)
      }
      return g
    }

    for (const n of rest) {
      if (hasCategories && isValidCategory(n.category)) {
        const meta = GBRAIN_CATEGORY_MAP[n.category]
        ensureGroup(`cat_${meta.id}`, meta.label, meta.id, meta.id).items.push(n)
      } else if (n.degree === 0 && n.origin !== 'manual') {
        ensureGroup('unlinked', 'Unlinked Entities', 'orphan').items.push(n)
      } else if (n.origin === 'manual') {
        ensureGroup('manual', 'Manual Concepts', 'manual').items.push(n)
      } else {
        ensureGroup('memory', 'Memory Entities', 'memory').items.push(n)
      }
    }

    // Order largest groups first so they sit side-by-side cleanly on wide rows
    const zoneSpecs = Array.from(groups.entries())
      .filter(([, g]) => g.items.length > 0)
      .sort((a, b) => b[1].items.length - a[1].items.length)
      .map(([key, g]) => {
        const count = g.items.length
        const cols =
          count >= 12 ? 4 : count >= 6 ? 3 : count >= 2 ? 2 : 1
        const rows = Math.ceil(count / cols)
        const boxW = (cols - 1) * stepX + 168 + padX * 2
        const boxH = (rows - 1) * stepY + 54 + padTop + padBottom
        return { key, g, count, cols, rows, boxW, boxH }
      })

    // Shelf-pack semantic category zones into balanced horizontal rows (~1460px target width)
    const maxRowW = 1480
    const shelves: typeof zoneSpecs[] = []
    let currentShelf: typeof zoneSpecs = []
    let currentShelfW = 0

    for (const z of zoneSpecs) {
      const nextW = currentShelf.length === 0 ? z.boxW : currentShelfW + zoneGapX + z.boxW
      if (currentShelf.length > 0 && nextW > maxRowW) {
        shelves.push(currentShelf)
        currentShelf = [z]
        currentShelfW = z.boxW
      } else {
        currentShelf.push(z)
        currentShelfW = nextW
      }
    }
    if (currentShelf.length > 0) shelves.push(currentShelf)

    let curY = hubs.length > 0 ? topStartY + coreBoxH + zoneGapY + 28 : 40
    for (const shelf of shelves) {
      const shelfW =
        shelf.reduce((acc, z) => acc + z.boxW, 0) + Math.max(0, shelf.length - 1) * zoneGapX
      const shelfH = Math.max(...shelf.map((z) => z.boxH))
      let curX = cx - shelfW / 2

      for (const z of shelf) {
        const zoneTop = curY
        const zoneLeft = curX
        z.g.items.forEach((item, idx) => {
          const col = idx % z.cols
          const row = Math.floor(idx / z.cols)
          const rowCount = row === z.rows - 1 ? z.count - row * z.cols : z.cols
          const rowSpanW = (rowCount - 1) * stepX + 168
          const innerStartX = zoneLeft + (z.boxW - rowSpanW) / 2 + 84
          const cardX = innerStartX + col * stepX
          const cardY = zoneTop + padTop + 27 + row * stepY
          laid.push({
            node: item,
            x: cardX,
            y: cardY,
            r: nodeRadius(item.degree, maxDeg),
            tier: 1,
            clusterKey: z.key,
          })
        })

        clusters.push({
          key: z.key,
          label: z.g.label,
          origin: z.g.origin,
          category: z.g.category,
          cx: zoneLeft + z.boxW / 2,
          cy: zoneTop + z.boxH / 2,
          radius: Math.hypot(z.boxW / 2, z.boxH / 2),
          count: z.count,
        })

        curX += z.boxW + zoneGapX
      }
      curY += shelfH + zoneGapY
    }

    fitClusterHalos(laid, clusters, true)
    const bounds = computeBounds(laid, clusters, w, h, true)
    return { nodes: laid, clusters, bounds }
  }

  // Compact orbital layout (for non-card dot views / unit tests)
  const coreRadius = hubs.length <= 1 ? 0 : Math.min(110, 44 + hubs.length * 10)

  hubs.forEach((n, idx) => {
    const angle = (idx / Math.max(1, hubs.length)) * Math.PI * 2 - Math.PI / 2
    laid.push({
      node: n,
      x: cx + Math.cos(angle) * coreRadius,
      y: cy + Math.sin(angle) * coreRadius,
      r: nodeRadius(n.degree, maxDeg),
      tier: 0,
      clusterKey: 'core',
    })
  })

  if (hubs.length > 0) {
    clusters.push({
      key: 'core',
      label: 'Core Hubs',
      origin: 'core',
      cx,
      cy,
      radius: Math.max(62, coreRadius + 44),
      count: hubs.length,
    })
  }

  const groups = new Map<
    string,
    { label: string; origin: string; category?: GBrainCategoryId; items: T[] }
  >()
  const ensureGroup = (key: string, label: string, origin: string, category?: GBrainCategoryId) => {
    let g = groups.get(key)
    if (!g) {
      g = { label, origin, category, items: [] }
      groups.set(key, g)
    }
    return g
  }

  for (const n of rest) {
    if (hasCategories && isValidCategory(n.category)) {
      const meta = GBRAIN_CATEGORY_MAP[n.category]
      ensureGroup(`cat_${meta.id}`, meta.label, meta.id, meta.id).items.push(n)
    } else if (n.degree === 0 && n.origin !== 'manual') {
      ensureGroup('unlinked', 'Unlinked Entities', 'orphan').items.push(n)
    } else if (n.origin === 'manual') {
      ensureGroup('manual', 'Manual Concepts', 'manual').items.push(n)
    } else if (n.origin === 'dream') {
      ensureGroup('dream', 'Dream Synthesis', 'dream').items.push(n)
    } else {
      ensureGroup('memory', 'Memory Entities', 'memory').items.push(n)
    }
  }

  const groupEntries = Array.from(groups.entries()).filter(([, g]) => g.items.length > 0)
  const orbitBase = Math.max(240, coreRadius + 170)

  groupEntries.forEach(([key, g], gIdx) => {
    const sectorAngle =
      groupEntries.length === 1
        ? 0
        : (gIdx / groupEntries.length) * Math.PI * 2 - Math.PI / 2 + 0.18

    const count = g.items.length
    const clusterR = Math.max(66, Math.min(165, 42 + Math.sqrt(count) * 28))
    const orbitDist = orbitBase + (count > 5 ? 36 : 0)
    const gcx = cx + Math.cos(sectorAngle) * orbitDist
    const gcy = cy + Math.sin(sectorAngle) * orbitDist

    clusters.push({
      key,
      label: g.label,
      origin: g.origin,
      category: g.category,
      cx: gcx,
      cy: gcy,
      radius: clusterR + 22,
      count,
    })

    let placed = 0
    let ringIdx = 0
    while (placed < count) {
      const ringCapacity =
        ringIdx === 0 ? Math.min(count, 7) : Math.min(count - placed, 8 + ringIdx * 5)
      const ringRadius =
        count === 1
          ? 0
          : ringIdx === 0
            ? Math.min(clusterR * 0.52, 30 + ringCapacity * 7)
            : Math.min(clusterR, 30 + ringIdx * 48)

      for (let i = 0; i < ringCapacity && placed < count; i++) {
        const item = g.items[placed]
        const theta = (i / Math.max(1, ringCapacity)) * Math.PI * 2 + ringIdx * 0.42
        laid.push({
          node: item,
          x: gcx + Math.cos(theta) * ringRadius,
          y: gcy + Math.sin(theta) * ringRadius,
          r: nodeRadius(item.degree, maxDeg),
          tier: ringIdx + 1,
          clusterKey: key,
        })
        placed += 1
      }
      ringIdx += 1
    }
  })

  resolveCollisions(laid, 22, 22, 22, false)
  fitClusterHalos(laid, clusters, false)
  const bounds = computeBounds(laid, clusters, w, h, false)
  return { nodes: laid, clusters, bounds }
}

/**
 * 2. HIERARCHICAL LAYERED LAYOUT
 * Computes shortest-path BFS tiers from the highest-centrality anchor hubs,
 * orders each tier using barycenter coordinates to reduce crossings, and spaces
 * nodes cleanly along horizontal strata.
 */
function layoutHierarchy<T extends GBrainLayoutNodeInput>(
  nodes: T[],
  edges: GBrainLayoutEdgeInput[],
  w: number,
  h: number,
  cardSpacing: boolean
): GBrainLayoutResult<T> {
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree))
  const sorted = [...nodes].sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))

  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    if (adj.has(e.sourceId) && adj.has(e.targetId)) {
      adj.get(e.sourceId)!.push(e.targetId)
      adj.get(e.targetId)!.push(e.sourceId)
    }
  }

  const tierOf = new Map<string, number>()
  const rootCount = Math.min(3, Math.max(1, Math.ceil(sorted.length * 0.08)))
  const queue: string[] = []

  for (const n of sorted.slice(0, rootCount)) {
    if (n.degree > 0 || queue.length === 0) {
      tierOf.set(n.id, 0)
      queue.push(n.id)
    }
  }

  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const curTier = tierOf.get(cur) ?? 0
    for (const nxt of adj.get(cur) ?? []) {
      if (!tierOf.has(nxt)) {
        tierOf.set(nxt, Math.min(4, curTier + 1))
        queue.push(nxt)
      }
    }
  }

  let maxTier = 0
  for (const t of tierOf.values()) maxTier = Math.max(maxTier, t)
  const orphanTier = Math.min(5, maxTier + 1)
  for (const n of sorted) {
    if (!tierOf.has(n.id)) {
      tierOf.set(n.id, n.degree === 0 ? orphanTier : Math.min(4, maxTier))
    }
  }

  const tiers = new Map<number, T[]>()
  for (const n of sorted) {
    const t = tierOf.get(n.id) ?? 0
    if (!tiers.has(t)) tiers.set(t, [])
    tiers.get(t)!.push(n)
  }

  const tierKeys = Array.from(tiers.keys()).sort((a, b) => a - b)
  const xIndex = new Map<string, number>()

  for (const t of tierKeys) {
    const row = tiers.get(t)!
    if (t > 0) {
      row.sort((a, b) => {
        const avg = (id: string) => {
          const parents = (adj.get(id) ?? []).filter((p) => (tierOf.get(p) ?? 99) < t)
          if (parents.length === 0) return 999
          return parents.reduce((acc, p) => acc + (xIndex.get(p) ?? 0), 0) / parents.length
        }
        return avg(a.id) - avg(b.id) || b.degree - a.degree || a.name.localeCompare(b.name)
      })
    }
    row.forEach((n, idx) => xIndex.set(n.id, idx))
  }

  const laid: LaidGBrainNode<T>[] = []

  if (cardSpacing) {
    const maxPerRow = 6
    const spacingX = 196
    const subRowGap = 82
    const tierGap = 112
    let currentY = 86

    tierKeys.forEach((t) => {
      const row = tiers.get(t)!
      const subRows = Math.ceil(row.length / maxPerRow)
      for (let sr = 0; sr < subRows; sr++) {
        const slice = row.slice(sr * maxPerRow, (sr + 1) * maxPerRow)
        const totalWidth = (slice.length - 1) * spacingX
        const startX = w / 2 - totalWidth / 2
        const y = currentY + sr * subRowGap
        slice.forEach((n, idx) => {
          laid.push({
            node: n,
            x: startX + idx * spacingX,
            y,
            r: nodeRadius(n.degree, maxDeg),
            tier: t,
            clusterKey: `tier_${t}`,
          })
        })
      }
      currentY += (subRows - 1) * subRowGap + tierGap
    })
  } else {
    const rowGap = Math.max(125, Math.min(175, Math.floor((h - 100) / Math.max(1, tierKeys.length))))
    tierKeys.forEach((t, rowIdx) => {
      const row = tiers.get(t)!
      const spacing = Math.max(
        88,
        Math.min(168, Math.floor(Math.max(w - 140, row.length * 96) / Math.max(1, row.length)))
      )
      const totalWidth = (row.length - 1) * spacing
      const startX = w / 2 - totalWidth / 2
      const y = 96 + rowIdx * rowGap

      row.forEach((n, idx) => {
        laid.push({
          node: n,
          x: startX + idx * spacing,
          y,
          r: nodeRadius(n.degree, maxDeg),
          tier: t,
          clusterKey: `tier_${t}`,
        })
      })
    })
    resolveCollisions(laid, 22, 22, 18, true)
  }

  const bounds = computeBounds(laid, [], w, h, cardSpacing)
  return { nodes: laid, clusters: [], bounds }
}

/**
 * 3. FORCE-RELAXED LAYOUT
 * Deterministic seeded force-directed simulation with repulsive charges,
 * edge springs, gentle center gravity, and final collision separation.
 */
function layoutForce<T extends GBrainLayoutNodeInput>(
  nodes: T[],
  edges: GBrainLayoutEdgeInput[],
  w: number,
  h: number,
  cardSpacing: boolean
): GBrainLayoutResult<T> {
  const rng = mulberry32(hashSeed(nodes))
  const maxDeg = Math.max(1, ...nodes.map((n) => n.degree))
  const cx = w / 2
  const cy = h / 2

  const laid: LaidGBrainNode<T>[] = nodes.map((n, idx) => {
    const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2 + (rng() - 0.5) * 0.4
    const ring = n.degree === 0 ? 0.42 + rng() * 0.2 : 0.14 + (1 - n.degree / maxDeg) * 0.34
    const spread = cardSpacing ? 1.45 : 1
    return {
      node: n,
      x: cx + Math.cos(angle) * ring * (w * 0.46 * spread),
      y: cy + Math.sin(angle) * ring * (h * 0.44 * spread),
      r: nodeRadius(n.degree, maxDeg),
      tier: 0,
      clusterKey: n.category ?? n.origin,
    }
  })

  const byId = new Map(laid.map((l) => [l.node.id, l]))
  const iters = nodes.length > 90 ? 110 : 150
  const repScale = cardSpacing ? 26000 : 7800

  for (let iter = 0; iter < iters; iter++) {
    const fx = new Float64Array(laid.length)
    const fy = new Float64Array(laid.length)

    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]
        const b = laid[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 4) {
          dx = (rng() - 0.5) * 2
          dy = (rng() - 0.5) * 2
          d2 = dx * dx + dy * dy + 1
        }
        const rep = repScale / d2
        const d = Math.sqrt(d2)
        const ux = dx / d
        const uy = dy / d
        fx[i] += ux * rep
        fy[i] += uy * rep
        fx[j] -= ux * rep
        fy[j] -= uy * rep
      }
    }

    for (const e of edges) {
      const a = byId.get(e.sourceId)
      const b = byId.get(e.targetId)
      if (!a || !b) continue
      const ai = laid.indexOf(a)
      const bi = laid.indexOf(b)
      if (ai < 0 || bi < 0) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const ideal = cardSpacing
        ? e.kind === 'INFERRED'
          ? 290
          : 235
        : e.kind === 'INFERRED'
          ? 175
          : 135
      const pull = (d - ideal) * 0.015
      const ux = (dx / d) * pull
      const uy = (dy / d) * pull
      fx[ai] += ux
      fy[ai] += uy
      fx[bi] -= ux
      fy[bi] -= uy
    }

    const cooling = 0.84 * (1 - iter / (iters * 1.45))
    for (let i = 0; i < laid.length; i++) {
      const l = laid[i]
      fx[i] += (cx - l.x) * 0.008
      fy[i] += (cy - l.y) * 0.008
      const stepX = Math.max(-34, Math.min(34, fx[i] * cooling))
      const stepY = Math.max(-34, Math.min(34, fy[i] * cooling))
      l.x += stepX
      l.y += stepY
    }
  }

  resolveCollisions(
    laid,
    cardSpacing ? 156 : 18,
    cardSpacing ? 46 : 18,
    cardSpacing ? 34 : 20,
    false
  )
  const bounds = computeBounds(laid, [], w, h, cardSpacing)
  return { nodes: laid, clusters: [], bounds }
}

/**
 * Computes a deterministic, collision-free layout for the GBrain entity graph
 * across Clustered Orbital (default), Hierarchical Layered, and Force-Relaxed modes.
 */
export function computeGBrainLayout<T extends GBrainLayoutNodeInput>(
  nodes: T[],
  edges: GBrainLayoutEdgeInput[],
  mode: GBrainLayoutMode = 'clustered',
  opts?: LayoutOptions
): GBrainLayoutResult<T> {
  const w = opts?.width ?? DEFAULT_W
  const h = opts?.height ?? DEFAULT_H
  const cardSpacing = Boolean(opts?.cardSpacing)

  if (nodes.length === 0) {
    return {
      nodes: [],
      clusters: [],
      bounds: { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h },
    }
  }

  if (mode === 'hierarchy') {
    return layoutHierarchy(nodes, edges, w, h, cardSpacing)
  }
  if (mode === 'force') {
    return layoutForce(nodes, edges, w, h, cardSpacing)
  }
  return layoutClusteredOrbital(nodes, edges, w, h, cardSpacing)
}
