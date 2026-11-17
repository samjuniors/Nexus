import { db } from '@/lib/db'
import { chatText } from '@/lib/agent/zai'
import { getEffectiveTools } from '@/lib/agent/tools'
import { createBrain, parseAppPrefs } from '@brain/index'
import type { Brain, BrainAppPrefs } from '@brain/types'

/**
 * HOST ADAPTER — the socket the NEXUS Brain plugs into.
 *
 * The brain folder (top-level `brain/`) is app-agnostic; this adapter is the
 * only place where the brain meets this app's concrete infrastructure:
 *   llm         → GLM via z-ai-web-dev-sdk
 *   state       → Prisma BrainState singleton row (id: "brain")
 *   capabilities→ effective tools / skills / plugins / MCPs / memory count
 *   now         → system clock
 *
 * TWO-BRAIN NOTE: this app has its own spine brain (orchestrator + LLM
 * routing + tools) that always runs. The NEXUS brain mounted here is the
 * SMART OVERLAY — when connected it routes, recalls, dreams and steers the
 * whole app through its directives (tone / verbosity / auto-dream).
 */

const BRAIN_ROW_ID = 'brain'

async function getBrainRow() {
  let row = await db.brainState.findUnique({ where: { id: BRAIN_ROW_ID } })
  if (!row) {
    try {
      row = await db.brainState.create({
        data: {
          id: BRAIN_ROW_ID,
          connected: true,
          personality: 'NEXUS',
          connectedAt: new Date(),
        },
      })
    } catch {
      // raced another request creating the singleton — just read it
      row = await db.brainState.findUnique({ where: { id: BRAIN_ROW_ID } })
    }
  }
  return row
}

async function setBrainState(patch: {
  connected?: boolean
  personality?: string
  appPrefs?: BrainAppPrefs
}) {
  await getBrainRow() // ensure the singleton exists
  const data: { connected?: boolean; personality?: string; appPrefsJson?: string } = {}
  if (patch.connected !== undefined) data.connected = patch.connected
  if (patch.personality !== undefined) data.personality = patch.personality
  if (patch.appPrefs !== undefined) data.appPrefsJson = JSON.stringify(patch.appPrefs)
  await db.brainState.update({ where: { id: BRAIN_ROW_ID }, data })
}

export function getBrain(): Brain {
  return createBrain({
    llm: {
      complete: (messages, opts) =>
        chatText(messages, { temperature: opts?.temperature, maxTokens: opts?.maxTokens }),
    },
    state: {
      get: async () => {
        const row = await getBrainRow()
        if (!row) return null
        return {
          connected: row.connected,
          personality: row.personality,
          appPrefs: parseAppPrefs(row.appPrefsJson),
        }
      },
      set: setBrainState,
    },
    capabilities: async () => {
      const [tools, skills, plugins, mcps, memCount] = await Promise.all([
        getEffectiveTools(),
        db.skill.findMany({ where: { enabled: true } }),
        db.plugin.findMany({ where: { installed: true, enabled: true } }),
        db.mcpServer.findMany({ where: { status: 'connected', enabled: true } }),
        db.memory.count(),
      ])
      return {
        tools: tools.map((t) => ({ slug: t.slug, name: t.name, description: t.description })),
        skills: skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description })),
        plugins: plugins.map((p) => ({ slug: p.slug, name: p.name, description: p.description })),
        mcps: mcps.map((m) => ({ slug: m.slug, name: m.name, description: m.description })),
        memoryCount: memCount,
      }
    },
    now: () => new Date(),
  })
}

/** Read the brain's app directives directly (used by synthesis + the Brain tab). */
export async function getBrainPrefs(): Promise<{ connected: boolean; prefs: BrainAppPrefs }> {
  const row = await getBrainRow()
  return {
    connected: row?.connected ?? true,
    prefs: parseAppPrefs(row?.appPrefsJson),
  }
}
