'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  BrainCog,
  Hexagon,
  History,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles as SparklesIcon,
  Square,
  Trash2,
  Volume2,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useApp } from '@/lib/agent/store'
import { useLiveVoice, type VoiceName } from '@/lib/agent/use-live-voice'
import { MissionBlock } from '@/components/agent/mission-block'
import { Typewriter } from '@/components/agent/typewriter'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type { SuggestionDTO } from '@/lib/agent/client'

const VOICES: VoiceName[] = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir']

const SUGGESTIONS = [
  { text: "What's today's date and time?", kind: 'instant' },
  { text: 'Write a TypeScript function that debounces another function', kind: 'instant' },
  { text: 'Research the latest breakthroughs in fusion energy and summarize with sources', kind: 'mission' },
  { text: 'Generate a logo concept for a coffee startup called "Ember", then critique it', kind: 'mission' },
] as const

function AssistantAvatar({ thinking }: { thinking?: boolean }) {
  return (
    <div
      className={cn(
        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-white/[0.04]',
        thinking ? 'shimmer-ring' : 'border-white/10'
      )}
      aria-hidden
    >
      <Hexagon className={cn('h-3.5 w-3.5', thinking ? 'shimmer-text' : 'text-zinc-400')} />
    </div>
  )
}

export function ChatView() {
  const {
    conversations,
    activeConvId,
    runningRunId,
    isRouting,
    brain,
    setTab,
    sendTask,
    stopTask,
    newConversation,
    deleteConversation,
    setActiveConv,
    loading,
  } = useApp()
  const { toast } = useToast()
  const streamingAssistantId = useApp((s) => s.streamingAssistantId)
  const voice = useLiveVoice({
    onError: (msg) => {
      toast({
        title: 'Live voice error',
        description: msg,
        variant: 'destructive',
      })
    },
  })
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // messages younger than this mount are new → they get the typewriter reveal
  const mountTimeRef = useRef<number>(Date.now())

  const conversation = conversations.find((c) => c.id === activeConvId) ?? null
  const isRunning = runningRunId !== null
  const isThinking = isRouting && !isRunning
  const brainConnected = brain?.connected ?? true
  const recalledByMessage = useApp((s) => s.recalledByMessage)
  const lastRunEventCount = conversation?.runs.length
    ? conversation.runs[conversation.runs.length - 1].events.length
    : 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [
    conversation?.messages.length,
    conversation?.runs.length,
    lastRunEventCount,
    isThinking,
    voice.liveInputTranscript,
    voice.liveOutputTranscript,
  ])

  const runsById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof conversation>['runs'][number]>()
    conversation?.runs.forEach((r) => map.set(r.id, r))
    return map
  }, [conversation?.runs])

  // next-step suggestions live under the answer of the latest mission that produced them
  const latestSuggestionRunId = useMemo(() => {
    if (!conversation) return null
    const withSuggestions = new Set(conversation.suggestions.map((s) => s.runId))
    for (let i = conversation.runs.length - 1; i >= 0; i--) {
      const r = conversation.runs[i]
      if (withSuggestions.has(r.id) && ['done'].includes(r.status)) return r.id
    }
    return null
  }, [conversation])

  const suggestionsFor = (runId: string | null): SuggestionDTO[] =>
    runId ? (conversation?.suggestions ?? []).filter((s) => s.runId === runId) : []

  // chat-mode "what's next": attach to the latest chat answer that has suggestions
  const latestChatSuggestionMsgId = useMemo(() => {
    if (!conversation) return null
    const chatSuggestions = conversation.suggestions.filter((s) => s.runId === null)
    if (chatSuggestions.length === 0) return null
    const chatAnswers = conversation.messages.filter((m) => m.role === 'assistant' && !m.runId)
    const last = chatAnswers[chatAnswers.length - 1]
    if (!last) return null
    const hasForLast = chatSuggestions.some(
      (s) => new Date(s.createdAt).getTime() >= new Date(last.createdAt).getTime() - 1000
    )
    return hasForLast ? last.id : null
  }, [conversation])

  const chatSuggestionsFor = (msgId: string): SuggestionDTO[] => {
    const msg = conversation?.messages.find((m) => m.id === msgId)
    if (!msg) return []
    return (conversation?.suggestions ?? []).filter(
      (s) => s.runId === null && new Date(s.createdAt).getTime() >= new Date(msg.createdAt).getTime() - 1000
    )
  }

  const isNewMessage = (m: { createdAt: string }) =>
    new Date(m.createdAt).getTime() > mountTimeRef.current - 15_000

  const submit = async () => {
    const text = input.trim()
    if (!text || isRunning || isSending) return
    setInput('')
    if (voice.status === 'connected' && voice.sendLiveText(text)) {
      return
    }
    setIsSending(true)
    try {
      await sendTask(text)
    } catch (e) {
      toast({
        title: 'Message failed',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const empty =
    (!conversation || (conversation.messages.length === 0 && conversation.runs.length === 0)) &&
    !voice.isActive &&
    !voice.liveInputTranscript &&
    !voice.liveOutputTranscript

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-white/[0.06] bg-sidebar px-4 py-3 md:px-6">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{conversation?.title ?? 'New chat'}</h1>
          <p className="text-[10.5px] text-muted-foreground">
            {brainConnected
              ? 'NEXUS brain connected — recall, graph & dream intelligence active'
              : 'app brain active · connect the NEXUS brain for recall, dream & graph intelligence'}
          </p>
        </div>
        <button
          onClick={() => setTab('brain')}
          title={brainConnected ? 'NEXUS overlay connected — manage in the Brain tab' : 'Spine mode — normal LLM app. Click to reconnect the smart overlay'}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10.5px] font-mono transition-colors',
            brainConnected
              ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-300 hover:border-emerald-400/45'
              : 'border-amber-400/30 bg-amber-400/8 text-amber-300 hover:border-amber-400/55'
          )}
        >
          <BrainCog className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{brainConnected ? 'brain' : 'spine'}</span>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', brainConnected ? 'bg-emerald-400 pulse-dot' : 'bg-amber-400')}
          />
        </button>
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 border-white/10 bg-transparent text-xs">
              <History className="h-3.5 w-3.5" /> History
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 border-white/[0.08] bg-popover p-0">
            <SheetHeader className="border-b border-white/[0.06] px-4 py-4">
              <SheetTitle className="text-sm">Conversations</SheetTitle>
              <SheetDescription className="text-xs">
                All chats and missions are saved in the local database.
              </SheetDescription>
            </SheetHeader>
            <div className="p-3">
              <Button
                size="sm"
                className="mb-3 w-full gap-1.5 text-xs"
                onClick={() => {
                  if (voice.isActive) voice.stopVoice()
                  void newConversation()
                  setHistoryOpen(false)
                }}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" /> New chat
              </Button>
              <ScrollArea className="h-[calc(100vh-10.5rem)] nice-scroll">
                <div className="space-y-1.5 pr-2">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className={cn(
                        'group flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                        c.id === activeConvId
                          ? 'border-primary/25 bg-primary/10'
                          : 'border-white/[0.06] bg-black/15 hover:border-white/15'
                      )}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          if (voice.isActive && c.id !== activeConvId) voice.stopVoice()
                          setActiveConv(c.id)
                          setHistoryOpen(false)
                        }}
                      >
                        <div className="truncate text-[13px]">{c.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(c.updatedAt).toLocaleDateString()} · {c.runs.length} mission
                          {c.runs.length === 1 ? '' : 's'}
                        </div>
                      </button>
                      <button
                        aria-label={`Delete ${c.title}`}
                        className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-red-300"
                        onClick={() => void deleteConversation(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {conversations.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">No conversations yet.</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      {/* stream */}
      <div className="grid-bg flex-1 overflow-y-auto nice-scroll">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center pt-10 sm:pt-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] shimmer-ring">
                <Hexagon className="h-7 w-7 shimmer-text" />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight">
                <span className="shimmer-text">Nexus</span> <span className="text-foreground/80">Agent</span>
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Ask me anything — quick questions get instant answers. Real missions get planned and executed
                with tools, plugins, MCP servers and subagents.
              </p>
              <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => {
                      setInput(s.text)
                      textareaRef.current?.focus()
                    }}
                    className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-left text-[12.5px] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-foreground"
                  >
                    <span className="mr-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                      {s.kind === 'instant' ? 'chat' : 'mission'}
                    </span>
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {conversation?.messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="space-y-3">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/[0.07] bg-white/[0.07] px-4 py-2.5">
                          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">{m.content}</p>
                        </div>
                      </div>
                      {m.runId && runsById.get(m.runId) && (
                        <MissionBlock run={runsById.get(m.runId)!} live={runningRunId === m.runId} />
                      )}
                    </div>
                  )
                }
                // assistant message — the answer (live stream, instant reply or mission result)
                const isStreaming = m.id === streamingAssistantId
                const animate = isNewMessage(m) && !isStreaming
                const suggestions = m.runId && m.runId === latestSuggestionRunId ? suggestionsFor(m.runId) : []
                const chatSuggestions = !m.runId && m.id === latestChatSuggestionMsgId ? chatSuggestionsFor(m.id) : []
                const recalled = recalledByMessage[m.id] ?? []
                const allSuggestions = [...suggestions, ...chatSuggestions]
                const nextChips = allSuggestions.filter((s) => s.kind !== 'improve')
                const improveChips = allSuggestions.filter((s) => s.kind === 'improve')
                return (
                  <div key={m.id} className="flex gap-3">
                    <AssistantAvatar thinking={isStreaming} />
                    <div className="min-w-0 flex-1">
                      <div className={isStreaming ? 'cursor-text' : undefined}>
                        <Typewriter text={m.content} animate={animate} className="md-body" />
                        {isStreaming && (
                          <span
                            aria-hidden
                            className="mt-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse rounded-[2px] bg-zinc-400/80"
                          />
                        )}
                      </div>
                      {recalled.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
                            <BrainCog className="h-3 w-3" /> recalled
                          </span>
                          {recalled.map((r) => (
                            <span
                              key={r.id}
                              title={r.content}
                              className="rounded border border-emerald-400/20 bg-emerald-400/[0.06] px-1.5 py-0.5 font-mono text-[9.5px] text-emerald-200/80"
                            >
                              [{r.cite}] {r.type}
                            </span>
                          ))}
                        </div>
                      )}
                      {nextChips.length > 0 && (
                        <div className="mt-3">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
                            <SparklesIcon className="h-3 w-3" /> what's next
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {nextChips.map((s) => (
                              <button
                                key={s.id}
                                title={s.description}
                                onClick={() => {
                                  setInput(s.description || s.title)
                                  textareaRef.current?.focus()
                                }}
                                className="group flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11.5px] text-zinc-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-zinc-100"
                              >
                                <ArrowUp className="h-3 w-3 shrink-0 rotate-45 text-muted-foreground/50 transition-colors group-hover:text-zinc-300" />
                                <span className="max-w-64 truncate">{s.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {improveChips.length > 0 && (
                        <div className="mt-2">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
                            <Wrench className="h-3 w-3" /> improve this app
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {improveChips.map((s) => (
                              <button
                                key={s.id}
                                title={s.description}
                                onClick={() => {
                                  setInput(s.description || s.title)
                                  textareaRef.current?.focus()
                                }}
                                className="group flex items-center gap-1.5 rounded-lg border border-sky-400/15 bg-sky-400/[0.04] px-2.5 py-1.5 text-[11.5px] text-sky-200/80 transition-colors hover:border-sky-400/35 hover:bg-sky-400/[0.08] hover:text-sky-100"
                              >
                                <Wrench className="h-3 w-3 shrink-0 text-sky-300/50 transition-colors group-hover:text-sky-200" />
                                <span className="max-w-64 truncate">{s.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* live voice user draft bubble */}
              {voice.liveInputTranscript && (
                <div className="flex justify-end" aria-live="polite">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-2.5">
                    <div className="mb-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-emerald-300/80">
                      <Mic className="h-2.5 w-2.5" /> voice input
                    </div>
                    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
                      {voice.liveInputTranscript}
                    </p>
                  </div>
                </div>
              )}

              {/* live voice assistant draft bubble */}
              {(voice.liveOutputTranscript || (voice.isActive && (voice.isSpeaking || voice.activeTool))) && (
                <div className="flex gap-3" aria-live="polite">
                  <AssistantAvatar thinking={voice.isSpeaking || Boolean(voice.activeTool)} />
                  <div className="min-w-0 flex-1">
                    {voice.activeTool && (
                      <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-sky-400/25 bg-sky-400/[0.07] px-2 py-0.5 font-mono text-[10.5px] text-sky-200">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Executing {voice.activeTool.tool}…</span>
                      </div>
                    )}
                    {voice.liveOutputTranscript && (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-200">
                        {voice.liveOutputTranscript}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* live voice ready empty hint */}
              {voice.isActive &&
                !voice.liveInputTranscript &&
                !voice.liveOutputTranscript &&
                !voice.activeTool &&
                (!conversation || conversation.messages.length === 0) && (
                  <div className="flex gap-3" aria-live="polite">
                    <AssistantAvatar thinking={voice.status === 'connecting'} />
                    <div className="flex h-7 items-center font-mono text-xs text-zinc-400">
                      {voice.status === 'connecting'
                        ? `Connecting Gemini Live voice (${voice.voiceName})…`
                        : `Listening (${voice.voiceName}) — ask anything, run tools, spawn subagents, or create bots & skills.`}
                    </div>
                  </div>
                )}

              {/* thinking indicator — while routing or writing an instant reply */}
              {isThinking && (
                <div className="flex gap-3" aria-live="polite">
                  <AssistantAvatar thinking />
                  <div className="flex h-7 items-center">
                    <span className="shimmer-text text-[13px]">Thinking…</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* input */}
      <div className="border-t border-white/[0.06] bg-sidebar px-4 py-3.5 md:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {(voice.isActive || (voice.status === 'error' && voice.lastError)) && (
            <div
              className={cn(
                'mb-2 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs',
                voice.status === 'error'
                  ? 'border-red-400/30 bg-red-500/10 text-red-200'
                  : 'border-emerald-400/25 bg-emerald-400/[0.06] text-zinc-200'
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {voice.status === 'connecting' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-300" />
                ) : voice.isSpeaking ? (
                  <Volume2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                ) : voice.muted ? (
                  <MicOff className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 pulse-dot" />
                )}

                <span className="truncate font-mono text-[11px]">
                  {voice.status === 'error'
                    ? voice.lastError
                    : voice.status === 'connecting'
                      ? `Connecting ${voice.voiceName}…`
                      : voice.activeTool
                        ? `Running ${voice.activeTool.tool}…`
                        : voice.isSpeaking
                          ? `Speaking (${voice.voiceName})`
                          : voice.muted
                            ? `Mic muted (${voice.voiceName})`
                            : `Listening (${voice.voiceName})`}
                </span>

                {voice.status === 'connected' && (
                  <div className="flex h-4 items-center gap-0.5" aria-hidden>
                    {[0.35, 0.7, 1, 0.7, 0.35].map((scale, i) => {
                      const barPct = voice.muted
                        ? 18
                        : Math.max(18, Math.min(100, Math.round((voice.isSpeaking ? 0.45 : voice.micLevel) * 100 * scale + 18)))
                      return (
                        <span
                          key={i}
                          style={{ height: `${barPct}%` }}
                          className={cn(
                            'w-0.5 rounded-full transition-[height] duration-75',
                            voice.muted ? 'bg-zinc-600' : voice.isSpeaking ? 'bg-sky-300' : 'bg-emerald-400'
                          )}
                        />
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {voice.status === 'error' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-white/15 bg-transparent px-2.5 text-[11px]"
                    onClick={() => void voice.startVoice(activeConvId)}
                  >
                    Retry
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 border-white/15 bg-transparent px-2 text-[11px]"
                      onClick={voice.toggleMute}
                      aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      {voice.muted ? <MicOff className="h-3 w-3 text-amber-300" /> : <Mic className="h-3 w-3" />}
                      <span className="hidden sm:inline">{voice.muted ? 'Unmute' : 'Mute'}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 gap-1 px-2.5 text-[11px]"
                      onClick={voice.stopVoice}
                      aria-label="End live voice session"
                    >
                      <PhoneOff className="h-3 w-3" />
                      <span className="hidden sm:inline">End</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-black/25 p-2 transition-colors focus-within:border-white/25">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isRunning
                  ? 'Agent is working…'
                  : voice.status === 'connected'
                    ? 'Speak aloud, or type into the live voice session…'
                    : 'Ask anything, or describe a mission…'
              }
              disabled={isRunning}
              rows={1}
              className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-[13.5px] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
              aria-label="Message input"
            />
            <div className="flex items-center gap-1.5">
              {!voice.isActive && (
                <select
                  aria-label="Select voice"
                  value={voice.voiceName}
                  onChange={(e) => voice.setVoiceName(e.target.value as VoiceName)}
                  disabled={isRunning}
                  className="hidden h-9 rounded-xl border border-white/10 bg-white/[0.03] px-2 font-mono text-[11px] text-zinc-300 outline-none transition-colors hover:border-white/20 focus:border-white/30 sm:block"
                  title="Gemini Live voice"
                >
                  {VOICES.map((v) => (
                    <option key={v} value={v} className="bg-zinc-900 text-zinc-100">
                      {v}
                    </option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                variant={voice.isActive ? 'destructive' : 'outline'}
                className={cn(
                  'h-9 gap-1.5 rounded-xl px-2.5 text-xs',
                  !voice.isActive && 'border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.08]'
                )}
                disabled={voice.status === 'connecting' && !voice.isActive}
                onClick={() => {
                  if (voice.isActive) {
                    voice.stopVoice()
                  } else {
                    void voice.startVoice(activeConvId)
                  }
                }}
                aria-label={voice.isActive ? 'Stop voice conversation' : 'Start voice conversation'}
                title={voice.isActive ? 'End Live Voice' : `Talk to NEXUS Live (${voice.voiceName})`}
              >
                {voice.status === 'connecting' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : voice.isActive ? (
                  <PhoneOff className="h-3.5 w-3.5" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{voice.isActive ? 'Live' : 'Voice'}</span>
              </Button>
              {isRunning ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-9 gap-1.5 rounded-xl px-3 text-xs"
                  onClick={() => void stopTask()}
                >
                  <Square className="h-3.5 w-3.5 fill-current" /> Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-9 rounded-xl px-3 text-xs"
                  disabled={!input.trim() || isSending}
                  onClick={() => void submit()}
                  aria-label="Send message"
                >
                  {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
            Enter to send · Shift+Enter for a new line · Voice supports live tools, subagents, skills & bots
          </p>
        </div>
      </div>
    </div>
  )
}
