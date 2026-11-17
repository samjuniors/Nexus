'use client'

import { create } from 'zustand'
import {
  api,
  type ArtifactDTO,
  type BrainInfo,
  type ConversationDTO,
  type McpDTO,
  type MemoryDTO,
  type PluginDTO,
  type SkillDTO,
  type Tab,
  type ToolDTO,
  type EventOutDTO,
} from '@/lib/agent/client'

interface AppState {
  activeTab: Tab
  conversations: ConversationDTO[]
  activeConvId: string | null
  plugins: PluginDTO[]
  skills: SkillDTO[]
  tools: ToolDTO[]
  mcps: McpDTO[]
  memories: MemoryDTO[]
  artifacts: ArtifactDTO[]
  brain: BrainInfo | null
  loading: boolean
  runningRunId: string | null
  /** true while the router decides chat-vs-mission (drives the shimmer indicator) */
  isRouting: boolean
  /** the assistant message currently being typed out by the live token stream */
  streamingAssistantId: string | null
  /** live memory-citation chips per assistant message id (gbrain cited synthesis) */
  recalledByMessage: Record<string, { id: string; content: string; type: string; cite: number }[]>

  setTab: (tab: Tab) => void
  bootstrap: () => Promise<void>
  setActiveConv: (id: string | null) => void
  newConversation: () => Promise<string>
  deleteConversation: (id: string) => Promise<void>

  refreshPlugins: () => Promise<void>
  refreshSkills: () => Promise<void>
  refreshTools: () => Promise<void>
  refreshMcps: () => Promise<void>
  refreshMemories: () => Promise<void>
  refreshArtifacts: () => Promise<void>
  refreshBrain: () => Promise<void>
  toggleBrain: (connect: boolean) => Promise<void>
  setBrainPrefs: (prefs: Partial<BrainInfo['appPrefs']>) => Promise<void>
  runDream: () => Promise<{ before: number; after: number; mergedCount: number; relationsFound: number; summary: string } | null>
  runCoachReview: () => Promise<{ lessons: number; summary: string } | null>
  teachBrain: (fact: string) => Promise<{ content: string; entities: number } | null>
  deleteArtifact: (name: string) => Promise<void>

  sendTask: (message: string) => Promise<void>
  stopTask: () => Promise<void>
  appendEvents: (runId: string, events: EventOutDTO[], status?: string) => void
}

export const useApp = create<AppState>((set, get) => ({
  activeTab: 'agent',
  conversations: [],
  activeConvId: null,
  plugins: [],
  skills: [],
  tools: [],
  mcps: [],
  memories: [],
  artifacts: [],
  brain: null,
  loading: true,
  runningRunId: null,
  isRouting: false,
  streamingAssistantId: null,
  recalledByMessage: {},

  setTab: (tab) => set({ activeTab: tab }),

  bootstrap: async () => {
    try {
      const { conversations } = await api.conversations()
      set({
        conversations,
        activeConvId: conversations[0]?.id ?? null,
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
    // capabilities load lazily but kick off now for sidebar badges
    get().refreshPlugins()
    get().refreshSkills()
    get().refreshTools()
    get().refreshMcps()
    get().refreshMemories()
    get().refreshArtifacts()
    get().refreshBrain()
  },

  setActiveConv: (id) => set({ activeConvId: id }),

  newConversation: async () => {
    const { conversation } = await api.createConversation()
    set((s) => ({
      conversations: [conversation, ...s.conversations],
      activeConvId: conversation.id,
    }))
    return conversation.id
  },

  deleteConversation: async (id) => {
    await api.deleteConversation(id)
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id)
      return {
        conversations,
        activeConvId: s.activeConvId === id ? (conversations[0]?.id ?? null) : s.activeConvId,
      }
    })
  },

  refreshPlugins: async () => {
    try {
      const { plugins } = await api.plugins()
      set({ plugins })
    } catch { /* ignore */ }
  },
  refreshSkills: async () => {
    try {
      const { skills } = await api.skills()
      set({ skills })
    } catch { /* ignore */ }
  },
  refreshTools: async () => {
    try {
      const { tools } = await api.tools()
      set({ tools })
    } catch { /* ignore */ }
  },
  refreshMcps: async () => {
    try {
      const { servers } = await api.mcps()
      set({ mcps: servers })
    } catch { /* ignore */ }
  },
  refreshMemories: async () => {
    try {
      const { memories } = await api.memories()
      set({ memories })
    } catch { /* ignore */ }
  },

  refreshArtifacts: async () => {
    try {
      const { artifacts } = await api.artifacts()
      set({ artifacts })
    } catch { /* ignore */ }
  },

  deleteArtifact: async (name) => {
    try {
      await api.deleteArtifact(name)
      set((s) => ({ artifacts: s.artifacts.filter((a) => a.name !== name) }))
    } catch { /* ignore */ }
  },

  refreshBrain: async () => {
    try {
      const { status, summary, inventory, appControl, lastDream, coach, graphMemory, cache, refine } = await api.brain()
      set({ brain: { ...status, summary, inventory, appControl, lastDream, coach, graphMemory, cache, refine } })
    } catch { /* ignore */ }
  },

  setBrainPrefs: async (prefs) => {
    try {
      await api.brainPrefs(prefs)
    } finally {
      await get().refreshBrain()
    }
  },

  runDream: async () => {
    const res = await api.brainToggle('dream')
    await get().refreshBrain()
    await get().refreshMemories()
    return res.dream ?? null
  },

  runCoachReview: async () => {
    try {
      const r = await api.brainToggle('coach')
      await get().refreshBrain()
      return r.review ?? null
    } catch {
      return null
    }
  },

  teachBrain: async (fact) => {
    try {
      const r = await api.brainToggle('teach', { fact })
      await get().refreshBrain()
      return r.taught ?? null
    } catch {
      return null
    }
  },

  toggleBrain: async (connect) => {
    // optimistic flip so the UI feels instant
    set((s) => ({ brain: s.brain ? { ...s.brain, connected: connect } : s.brain }))
    try {
      await api.brainToggle(connect ? 'connect' : 'disconnect')
    } finally {
      await get().refreshBrain()
    }
  },

  appendEvents: (runId, events, status) => {
    set((s) => ({
      conversations: s.conversations.map((c) => ({
        ...c,
        runs: c.runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: status ?? r.status,
                events: [
                  ...r.events,
                  ...events.map((e, i) => ({
                    id: `${runId}-${e.seq}-${i}`,
                    seq: e.seq,
                    type: e.type,
                    data: e.data,
                    createdAt: new Date().toISOString(),
                  })),
                ],
              }
            : r
        ),
      })),
    }))
  },

  sendTask: async (message) => {
    const { activeConvId, runningRunId } = get()
    if (runningRunId) return

    const pendingId = `pending-${Date.now()}`
    const placeholderConvId = activeConvId ?? `local-conv-${Date.now()}`
    const isNewLocalConv = activeConvId === null
    const now = new Date().toISOString()

    // ---- instant optimistic feedback: the user message shows immediately,
    // ---- and the thinking shimmer appears while the router decides
    set((s) => ({
      isRouting: true,
      activeConvId: placeholderConvId,
      conversations: isNewLocalConv
        ? [
            {
              id: placeholderConvId,
              title: message.slice(0, 60),
              messages: [{ id: pendingId, role: 'user', content: message, runId: null, createdAt: now }],
              runs: [],
              suggestions: [],
              updatedAt: now,
            },
            ...s.conversations,
          ]
        : s.conversations.map((c) =>
            c.id === placeholderConvId
              ? {
                  ...c,
                  title: c.title === 'New Mission' ? message.slice(0, 60) : c.title,
                  messages: [...c.messages, { id: pendingId, role: 'user', content: message, runId: null, createdAt: now }],
                }
              : c
          ),
    }))

    /** patch the conversation the stream landed on */
    const patchConv = (convId: string, fn: (c: ConversationDTO) => ConversationDTO) =>
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? fn(c) : c)) }))

    try {
      // ---- live stream: meta (routing) → tokens (typing) → done ----
      await api.startRunStream(activeConvId, message, {
        onEvent: (ev) => {
          if (ev.type === 'error') {
            throw new Error(ev.error)
          }

          if (ev.type === 'meta') {
            const convId = ev.conversationId

            // adopt the local placeholder as the real server conversation
            if (!get().conversations.some((c) => c.id === convId)) {
              set((s) => ({
                conversations: s.conversations.map((c) =>
                  c.id === placeholderConvId && isNewLocalConv ? { ...c, id: convId } : c
                ),
                activeConvId: convId,
              }))
            } else if (get().activeConvId !== convId) {
              set({ activeConvId: convId })
            }

            if (ev.mode === 'task' && ev.runId) {
              // ---- mission mode: swap the pending message for run-attached
              // ---- user message + optimistic run, then the step loop drives
              const runId = ev.runId
              patchConv(convId, (c) => ({
                ...c,
                title: c.title === 'New Mission' ? message.slice(0, 60) : c.title,
                messages: [
                  ...c.messages.filter((m) => m.id !== pendingId),
                  { id: `local-${runId}-user`, role: 'user', content: message, runId, createdAt: new Date().toISOString() },
                ],
                runs: [
                  ...c.runs,
                  { id: runId, status: 'planning', userMessage: message, events: [], createdAt: new Date().toISOString() },
                ],
              }))
              set({ runningRunId: runId, isRouting: false })
              return
            }

            // ---- chat mode: keep the pending user message (same content),
            // ---- open a streaming assistant shell that tokens will fill
            const assistantId = `stream-${Date.now()}`
            set((s) => ({
              isRouting: false,
              streamingAssistantId: assistantId,
              recalledByMessage:
                ev.recalled && ev.recalled.length > 0
                  ? { ...s.recalledByMessage, [assistantId]: ev.recalled }
                  : s.recalledByMessage,
            }))
            patchConv(convId, (c) => ({
              ...c,
              title: c.title === 'New Mission' ? message.slice(0, 60) : c.title,
              messages: [
                ...c.messages.map((m) => (m.id === pendingId ? { ...m, id: `${assistantId}-u` } : m)),
                { id: assistantId, role: 'assistant', content: '', runId: null, createdAt: new Date().toISOString() },
              ],
            }))
            return
          }

          if (ev.type === 'token') {
            // append to the streaming message — the answer types itself out
            const sid = get().streamingAssistantId
            if (!sid) return
            set((s) => ({
              conversations: s.conversations.map((c) => ({
                ...c,
                messages: c.messages.map((m) => (m.id === sid ? { ...m, content: m.content + ev.text } : m)),
              })),
            }))
            return
          }

          if (ev.type === 'done') {
            // finalize: adopt the server message id, attach chips + citations
            const sid = get().streamingAssistantId
            const conv = get().conversations.find((c) => c.id === get().activeConvId)
            const chatNext = ev.suggestions.map((title, i) => ({
              id: `${ev.messageId}-s${i}`,
              runId: null,
              title,
              description: title,
              kind: 'chat-next',
              createdAt: new Date().toISOString(),
            }))
            set((s) => {
              const recalled = { ...s.recalledByMessage }
              if (sid && recalled[sid] && sid !== ev.messageId) {
                recalled[ev.messageId] = recalled[sid]
                delete recalled[sid]
              }
              return {
                streamingAssistantId: null,
                recalledByMessage: ev.recalled.length > 0 ? { ...recalled, [ev.messageId]: ev.recalled } : recalled,
                conversations: s.conversations.map((c) =>
                  c.id === (conv?.id ?? c.id) && sid
                    ? {
                        ...c,
                        messages: c.messages.map((m) => (m.id === sid ? { ...m, id: ev.messageId } : m)),
                        suggestions: [...c.suggestions, ...chatNext],
                      }
                    : c
                ),
              }
            })
          }
        },
      })

      // ---- mission drive loop (task mode) ----
      const runId = get().runningRunId
      if (runId) {
        for (let guard = 0; guard < 60; guard++) {
          const step = await api.stepRun(runId)
          if (step.events?.length) {
            get().appendEvents(runId, step.events, step.status)
          } else if (step.status) {
            get().appendEvents(runId, [], step.status)
          }
          if (step.busy) {
            await new Promise((r) => setTimeout(r, 800))
            continue
          }
          if (['done', 'error', 'stopped'].includes(step.status)) break
        }

        // refresh memories (agent may have saved some) + usage stats + new artifacts
        get().refreshMemories()
        get().refreshTools()
        get().refreshPlugins()
        get().refreshMcps()
        get().refreshSkills()
        get().refreshArtifacts()

        // refetch conversations so the final mission answer + its next-step
        // suggestions appear live in the chat (and stream in via typewriter)
        try {
          const { conversations } = await api.conversations()
          set({ conversations })
        } catch { /* ignore */ }
      }
    } catch (e) {
      // clean up the optimistic pending state, then surface the error
      set((s) => ({
        conversations: isNewLocalConv
          ? s.conversations.filter((c) => c.id !== placeholderConvId)
          : s.conversations.map((c) => ({ ...c, messages: c.messages.filter((m) => m.id !== pendingId) })),
        isRouting: false,
      }))
      // drop an empty streaming shell if the stream died before any token
      const sid = get().streamingAssistantId
      if (sid) {
        set((s) => ({
          streamingAssistantId: null,
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.filter((m) => !(m.id === sid && m.content === '')),
          })),
        }))
      }
      const currentRun = get().runningRunId
      if (currentRun) {
        get().appendEvents(currentRun, [], 'error')
      }
      throw e
    } finally {
      set({ runningRunId: null, isRouting: false, streamingAssistantId: null })
    }
  },

  stopTask: async () => {
    const { runningRunId } = get()
    if (!runningRunId) return
    try {
      await api.stopRun(runningRunId)
      get().appendEvents(runningRunId, [], 'stopped')
    } catch { /* ignore */ }
    set({ runningRunId: null })
  },
}))
