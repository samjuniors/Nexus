import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export interface ProjectScanSummary {
  name: string
  version: string
  framework: string
  dependencies: string[]
  prismaModels: string[]
  apiRoutes: string[]
  brainModules: string[]
  topDirectories: string[]
  summaryText: string
  truths: string[]
  entities: { slug: string; name: string; kind: string }[]
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo', 'coverage', 'workspace'])

async function listShallowFiles(dir: string, depth: number, maxDepth: number, base = ''): Promise<string[]> {
  if (depth > maxDepth) return []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.name.startsWith('.env')) continue
      if (SKIP_DIRS.has(e.name)) continue
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth === 0) out.push(`${rel}/`)
        out.push(...(await listShallowFiles(path.join(dir, e.name), depth + 1, maxDepth, rel)))
      } else {
        out.push(rel)
      }
      if (out.length > 250) break
    }
    return out
  } catch {
    return []
  }
}

/** Deterministic local project architecture scanner — never leaks secrets or env values. */
export async function scanProjectStructure(): Promise<ProjectScanSummary> {
  const root = process.cwd()

  let pkgName = path.basename(root)
  let pkgVersion = '0.0.0'
  let deps: string[] = []
  try {
    const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf-8')
    const pkg = JSON.parse(pkgRaw) as {
      name?: string
      version?: string
      dependencies?: Record<string, string>
    }
    if (pkg.name) pkgName = pkg.name
    if (pkg.version) pkgVersion = pkg.version
    deps = Object.keys(pkg.dependencies ?? {})
  } catch {
    /* package.json optional */
  }

  const prismaModels: string[] = []
  try {
    const schema = await fs.readFile(path.join(root, 'prisma', 'schema.prisma'), 'utf-8')
    for (const m of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)) {
      prismaModels.push(m[1])
    }
  } catch {
    /* schema optional */
  }

  const topEntries = await listShallowFiles(root, 0, 1)
  const topDirectories = topEntries.filter((f) => f.endsWith('/')).map((f) => f.slice(0, -1))

  const apiFiles = await listShallowFiles(path.join(root, 'src', 'app', 'api'), 0, 3, 'src/app/api')
  const apiRoutes = apiFiles
    .filter((f) => f.endsWith('/route.ts') || f.endsWith('/route.js'))
    .map((f) => f.replace(/^src\/app/, '').replace(/\/route\.(ts|js)$/, '') || '/')

  const brainFiles = await listShallowFiles(path.join(root, 'brain'), 0, 2, 'brain')
  const brainModules = brainFiles.filter((f) => f.endsWith('.ts') || f.endsWith('.json'))

  const frameworkParts: string[] = []
  if (deps.includes('next')) frameworkParts.push('Next.js')
  if (deps.includes('react')) frameworkParts.push('React')
  if (deps.includes('@prisma/client')) frameworkParts.push('Prisma')
  if (deps.includes('@google/genai')) frameworkParts.push('Google GenAI SDK')
  if (deps.includes('zustand')) frameworkParts.push('Zustand')
  if (deps.includes('tailwindcss') || topEntries.some((f) => f.includes('postcss'))) frameworkParts.push('Tailwind CSS')
  const framework = frameworkParts.join(' + ') || 'TypeScript App'

  const entities: { slug: string; name: string; kind: string }[] = [
    { slug: `app-${pkgName}`, name: `${pkgName} (${framework})`, kind: 'project' },
  ]
  for (const model of prismaModels.slice(0, 8)) {
    entities.push({ slug: `model-${model.toLowerCase()}`, name: `DB:${model}`, kind: 'schema' })
  }
  for (const route of apiRoutes.slice(0, 10)) {
    entities.push({ slug: `api-${route.replace(/[^a-z0-9]+/gi, '-')}`, name: route, kind: 'api' })
  }

  const truths: string[] = [
    `Project "${pkgName}" v${pkgVersion} uses ${framework} with ${deps.length} dependencies and ${apiRoutes.length} API routes.`,
    prismaModels.length > 0
      ? `Project "${pkgName}" database schema defines models: ${prismaModels.join(', ')}.`
      : `Project "${pkgName}" directories: ${topDirectories.slice(0, 10).join(', ')}.`,
    brainModules.length > 0
      ? `Portable brain lives in brain/ (${brainModules.length} self-contained files with zero app imports).`
      : '',
  ].filter(Boolean)

  const summaryText = [
    `PROJECT INTELLIGENCE: ${pkgName} (v${pkgVersion})`,
    `Stack: ${framework}`,
    `Top directories: ${topDirectories.join(', ') || '(none)'}`,
    `Prisma models (${prismaModels.length}): ${prismaModels.join(', ') || '(none)'}`,
    `API routes (${apiRoutes.length}): ${apiRoutes.join(', ') || '(none)'}`,
    `Portable brain modules (${brainModules.length}): ${brainModules.slice(0, 12).join(', ')}`,
    `Key dependencies: ${deps.slice(0, 20).join(', ')}`,
  ].join('\n')

  return {
    name: pkgName,
    version: pkgVersion,
    framework,
    dependencies: deps,
    prismaModels,
    apiRoutes,
    brainModules,
    topDirectories,
    summaryText,
    truths,
    entities,
  }
}

/** Index discovered project truths into GBrain memory + knowledge graph so the portable brain understands the repo. */
export async function indexProjectIntoBrain(): Promise<{
  scan: ProjectScanSummary
  memoriesSaved: number
}> {
  const scan = await scanProjectStructure()
  let memoriesSaved = 0
  try {
    const { saveMemoryGbrain } = await import('@/lib/agent/gbrain-store')
    for (const truth of scan.truths) {
      const res = await saveMemoryGbrain({
        content: truth,
        type: 'fact',
        kind: 'semantic',
        importance: 7,
      })
      if (!res.deduplicated) memoriesSaved++
    }
  } catch {
    for (const truth of scan.truths) {
      const existing = await db.memory.findFirst({ where: { content: truth } })
      if (!existing) {
        await db.memory.create({
          data: {
            content: truth,
            type: 'fact',
            kind: 'semantic',
            source: 'agent',
            importance: 7,
            strength: 0.4,
            truth,
          },
        })
        memoriesSaved++
      }
    }
  }
  return { scan, memoriesSaved }
}
