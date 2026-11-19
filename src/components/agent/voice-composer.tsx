'use client'

import type { KeyboardEvent, RefObject } from 'react'
import {
  AlertCircle,
  ArrowUp,
  AudioLines,
  BrainCog,
  Ear,
  Loader2,
  Mic,
  MicOff,
  Moon,
  PhoneOff,
  Radio,
  RefreshCw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { useLiveVoice } from '@/lib/agent/use-live-voice'
import type { useWakeWord } from '@/lib/agent/use-wake-word'
import { WAKE_PHRASE_PRESETS } from '@/lib/agent/wake-word'
import {
  VOICES,
  type VoiceAgentState,
  type VoiceName,
  computeDynamicHaloScale,
  computeEqualizerBarHeight,
  deriveEffectiveComposerState,
  getVoiceStateMeta,
} from '@/lib/agent/voice-state'
import { cn } from '@/lib/utils'

type VoiceHook = ReturnType<typeof useLiveVoice>
type WakeHook = ReturnType<typeof useWakeWord>

function StateIcon({ state, className }: { state: VoiceAgentState; className: string }) {
  switch (state) {
    case 'wake':
      return <Ear className={cn('h-3.5 w-3.5 shrink-0 pulse-dot', className)} />
    case 'sleeping':
      return <Moon className={cn('h-3.5 w-3.5 shrink-0', className)} />
    case 'connecting':
      return <Loader2 className={cn('h-3.5 w-3.5 shrink-0 animate-spin', className)} />
    case 'listening':
      return <Radio className={cn('h-3.5 w-3.5 shrink-0 pulse-dot', className)} />
    case 'hearing':
      return <AudioLines className={cn('h-3.5 w-3.5 shrink-0', className)} />
    case 'thinking':
      return <BrainCog className={cn('h-3.5 w-3.5 shrink-0 animate-pulse', className)} />
    case 'executing':
      return <Wrench className={cn('h-3.5 w-3.5 shrink-0 animate-spin', className)} />
    case 'speaking':
      return <Volume2 className={cn('h-3.5 w-3.5 shrink-0', className)} />
    case 'muted':
      return <MicOff className={cn('h-3.5 w-3.5 shrink-0', className)} />
    case 'error':
      return <AlertCircle className={cn('h-3.5 w-3.5 shrink-0', className)} />
    case 'idle':
    default:
      return <Sparkles className={cn('h-3.5 w-3.5 shrink-0', className)} />
  }
}

export function VoiceComposer({
  voice,
  wake,
  onToggleWake,
  input,
  setInput,
  textareaRef,
  isRunning,
  isSending,
  isThinking,
  activeConvId,
  onSubmit,
  onStopTask,
  onKeyDown,
}: {
  voice: VoiceHook
  wake: WakeHook
  onToggleWake: () => void
  input: string
  setInput: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  isRunning: boolean
  isSending: boolean
  isThinking: boolean
  activeConvId: string | null
  onSubmit: () => Promise<void>
  onStopTask: () => Promise<void>
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  const effectiveState = deriveEffectiveComposerState({
    isActive: voice.isActive,
    voiceStatus: voice.status,
    voiceAgentState: voice.agentState,
    activeTool: voice.activeTool,
    isSpeaking: voice.isSpeaking,
    isRunning,
    isThinking,
    isSending,
    wakeStatus: wake.status,
    isSleeping: wake.sleepMode,
  })

  const meta = getVoiceStateMeta(
    effectiveState,
    voice.voiceName,
    voice.activeTool?.tool ?? (isRunning ? 'mission' : undefined),
    wake.wakePhrase
  )

  const effectiveLevel = effectiveState === 'wake' ? wake.earLevel : voice.micLevel
  const dynamicHaloScale = computeDynamicHaloScale(effectiveState, effectiveLevel)

  const showVoiceHeader =
    voice.isActive ||
    effectiveState === 'wake' ||
    effectiveState === 'sleeping' ||
    effectiveState === 'error' ||
    effectiveState === 'thinking' ||
    effectiveState === 'executing' ||
    wake.status === 'error'

  const earNeedsUnlock = !wake.sleepMode && (wake.status === 'awaiting-mic' || wake.status === 'error')
  const earBadgeLabel =
    effectiveState === 'wake' && wake.status === 'awaiting-mic'
      ? 'Ear · Tap to Arm Mic'
      : effectiveState === 'wake' && wake.engine === 'vad'
        ? `Ear Live · "${wake.wakePhrase}"`
        : wake.status === 'error' && !voice.isActive
          ? 'Ear Mic Blocked'
          : meta.label

  const wakeHintText =
    effectiveState === 'error' && voice.lastError
      ? voice.lastError
      : wake.status === 'error' && wake.error && !voice.isActive
        ? wake.error
        : effectiveState === 'wake' && wake.status === 'awaiting-mic'
          ? 'Click "Arm Ear" (or anywhere) to unlock your mic for always-on "Hey Eva"'
          : effectiveState === 'wake' && wake.lastHeard
            ? `Heard: "${wake.lastHeard}"`
            : effectiveState === 'wake' && wake.engine === 'vad'
              ? `Acoustic ear active — say "${wake.wakePhrase}" anytime across all tabs`
              : effectiveState === 'wake' && !wake.supported
                ? 'Microphone unavailable for wake ear — click Voice to speak'
                : meta.hint

  return (
    <div className="border-t border-border bg-sidebar px-4 py-3.5 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* Composer wrapper with state-reactive rainbow layers behind */}
        <div
          className="group/composer relative"
          data-voice-state={effectiveState}
          data-wake-status={wake.status}
          data-wake-engine={wake.engine}
        >
          {/* Blurred ambient rainbow aura behind composer */}
          <div
            aria-hidden
            style={{ transform: `scale(${dynamicHaloScale})` }}
            className={cn(
              'pointer-events-none absolute -inset-1.5 rounded-3xl blur-xl transition-all duration-500',
              meta.auraClass,
              meta.glowOpacity
            )}
          />

          {/* Crisp prismatic gradient rim behind composer card */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -inset-[1.5px] rounded-[18px] transition-opacity duration-300',
              meta.auraClass,
              meta.ringOpacity
            )}
          />

          {/* Foreground composer surface */}
          <div className="relative z-10 overflow-hidden rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md dark:border-white/10">
            {/* Voice Agent State Bar */}
            {showVoiceHeader && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/45 px-3 py-2 text-xs dark:border-white/[0.07] dark:bg-black/25">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <StateIcon state={effectiveState} className={meta.iconClass} />
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-medium',
                      earNeedsUnlock
                        ? 'border-amber-500/45 bg-amber-500/12 text-amber-700 dark:border-amber-400/40 dark:text-amber-200'
                        : meta.badgeClass
                    )}
                  >
                    {earBadgeLabel}
                  </span>

                  {/* 7-bar state-reactive equalizer / activity indicator */}
                  <div className="flex h-4 items-center gap-0.5" aria-hidden>
                    {[0.38, 0.72, 1, 0.56, 0.9, 0.62, 0.35].map((scale, i) => {
                      const isAnimated =
                        effectiveState === 'speaking' ||
                        effectiveState === 'thinking' ||
                        effectiveState === 'executing' ||
                        effectiveState === 'connecting'
                      const barPct =
                        effectiveState === 'wake'
                          ? Math.max(20, Math.min(100, Math.round(wake.earLevel * 100 * scale + 20)))
                          : computeEqualizerBarHeight(effectiveState, scale, voice.micLevel)

                      return (
                        <span
                          key={i}
                          style={{
                            height: `${barPct}%`,
                            animationDelay: isAnimated ? `${i * 95}ms` : undefined,
                          }}
                          className={cn(
                            'w-0.5 rounded-full transition-[height] duration-75',
                            meta.barClass,
                            isAnimated && 'voice-bar-animate'
                          )}
                        />
                      )
                    })}
                  </div>

                  <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
                    {wakeHintText}
                  </span>
                </div>

                {/* Voice session controls */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {effectiveState === 'error' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 border-border bg-transparent px-2.5 text-[11px] dark:border-white/15"
                      onClick={() => void voice.startVoice(activeConvId)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry
                    </Button>
                  ) : voice.isActive ? (
                    <>
                      {voice.isSpeaking && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-border bg-transparent px-2 text-[11px] dark:border-white/15"
                          onClick={voice.interruptAudio}
                          title="Stop Eva speech playback"
                          aria-label="Interrupt speech playback"
                        >
                          <VolumeX className="h-3 w-3 text-pink-600 dark:text-pink-300" />
                          <span className="hidden sm:inline">Interrupt</span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-border bg-transparent px-2 text-[11px] dark:border-white/15"
                        onClick={voice.toggleMute}
                        aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                      >
                        {voice.muted ? (
                          <MicOff className="h-3 w-3 text-amber-600 dark:text-amber-300" />
                        ) : (
                          <Mic className="h-3 w-3" />
                        )}
                        <span className="hidden sm:inline">{voice.muted ? 'Unmute' : 'Mute'}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-border bg-transparent px-2 text-[11px] dark:border-white/15"
                        onClick={onToggleWake}
                        aria-label="Put Eva in Sleep Mode"
                        title="End voice and put Eva into Sleep Mode"
                      >
                        <Moon className="h-3 w-3 text-indigo-400" />
                        <span className="hidden sm:inline">Sleep</span>
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
                  ) : earNeedsUnlock ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        data-eva-ear-control="1"
                        className="h-7 gap-1 border-amber-500/45 bg-amber-500/12 px-2.5 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-200"
                        onClick={wake.armNow}
                        aria-label="Arm Eva microphone ear"
                      >
                        <Ear className="h-3 w-3" />
                        Arm Ear
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        data-eva-ear-control="1"
                        className="h-7 gap-1 border-border bg-transparent px-2 text-[11px] dark:border-white/15"
                        onClick={wake.enterSleepMode}
                        aria-label="Put Eva in Sleep Mode"
                      >
                        <Moon className="h-3 w-3" />
                        Sleep
                      </Button>
                    </>
                  ) : effectiveState === 'wake' ? (
                    <>
                      <select
                        aria-label="Wake word phrase"
                        value={wake.wakePhrase}
                        onChange={(e) => wake.setWakePhrase(e.target.value)}
                        className="h-7 rounded-md border border-border bg-background/70 px-2 font-mono text-[10.5px] text-foreground outline-none dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-200"
                        title="Select wake word phrase"
                      >
                        {WAKE_PHRASE_PRESETS.map((phrase) => (
                          <option key={phrase} value={phrase} className="bg-popover text-popover-foreground">
                            &quot;{phrase}&quot;
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-border bg-transparent px-2 text-[11px] dark:border-white/15"
                        onClick={onToggleWake}
                        aria-label="Put Eva in Sleep Mode"
                      >
                        <Moon className="h-3 w-3" />
                        Sleep
                      </Button>
                    </>
                  ) : effectiveState === 'sleeping' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 border-indigo-400/35 bg-indigo-500/10 px-2.5 text-[11px] text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-200"
                      onClick={onToggleWake}
                      aria-label="Wake Eva always-on ear"
                    >
                      <Ear className="h-3 w-3" />
                      Wake Eva
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Text & Voice Action Row */}
            <div className="flex items-end gap-2 p-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  effectiveState === 'executing'
                    ? 'Eva & team are executing — send a follow-up note or wait…'
                    : effectiveState === 'speaking'
                      ? 'Eva is speaking — speak to barge in or type a follow-up…'
                      : effectiveState === 'listening' || effectiveState === 'hearing'
                        ? 'Speak aloud to Eva, or type into the live voice session…'
                        : effectiveState === 'muted'
                          ? 'Mic muted — type a message or unmute to speak to Eva…'
                          : effectiveState === 'sleeping'
                            ? 'Eva is in Sleep Mode — type a message or click Wake Eva to re-arm her ear…'
                            : earNeedsUnlock
                              ? 'Click "Arm Ear" to unlock mic for "Hey Eva", or type a message…'
                              : effectiveState === 'wake'
                                ? `Always-on "${wake.wakePhrase}" ear listening — speak or ask Eva anything…`
                                : 'Ask Eva anything, say "Hey Eva", or describe a mission…'
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
                    className="hidden h-9 rounded-xl border border-border bg-background/70 px-2 font-mono text-[11px] text-foreground outline-none transition-colors hover:border-ring/50 focus:border-ring dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:border-white/20 dark:focus:border-white/30 sm:block"
                    title="Eva Gemini Live voice"
                  >
                    {VOICES.map((v) => (
                      <option key={v} value={v} className="bg-popover text-popover-foreground">
                        {v}
                      </option>
                    ))}
                  </select>
                )}
                {!voice.isActive && (
                  <Button
                    size="sm"
                    variant={wake.sleepMode ? 'outline' : 'secondary'}
                    className={cn(
                      'h-9 gap-1.5 rounded-xl px-2.5 text-xs',
                      wake.sleepMode
                        ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 dark:border-indigo-400/30 dark:text-indigo-200'
                        : earNeedsUnlock
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:border-amber-400/35 dark:text-amber-200'
                          : 'border-sky-500/40 bg-sky-500/15 text-sky-700 hover:bg-sky-500/20 dark:border-sky-400/35 dark:text-sky-200'
                    )}
                    disabled={isRunning}
                    onClick={onToggleWake}
                    aria-label={
                      wake.sleepMode
                        ? 'Wake Eva always-on ear'
                        : earNeedsUnlock
                          ? 'Arm Eva microphone ear'
                          : 'Put Eva in Sleep Mode'
                    }
                    aria-pressed={!wake.sleepMode && !earNeedsUnlock}
                    title={
                      wake.sleepMode
                        ? 'Eva is in Sleep Mode — click to wake her always-on ear'
                        : earNeedsUnlock
                          ? 'Click to unlock microphone for always-on "Hey Eva" ear'
                          : `Always-on ear (${wake.engine}) listening for "${wake.wakePhrase}" — click for Sleep Mode`
                    }
                  >
                    {wake.sleepMode ? (
                      <Moon className="h-3.5 w-3.5" />
                    ) : (
                      <Ear className={cn('h-3.5 w-3.5', wake.status === 'armed' && 'pulse-dot')} />
                    )}
                    <span className="hidden md:inline">
                      {wake.sleepMode ? 'Sleep' : earNeedsUnlock ? 'Arm Ear' : 'Ear On'}
                    </span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={voice.isActive ? 'destructive' : 'outline'}
                  className={cn(
                    'h-9 gap-1.5 rounded-xl px-2.5 text-xs',
                    !voice.isActive &&
                      'border-border bg-background/70 text-foreground hover:bg-muted dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200 dark:hover:bg-white/[0.08]'
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
                  title={voice.isActive ? 'End Live Voice' : `Talk to Eva Live (${voice.voiceName})`}
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
                    onClick={() => void onStopTask()}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-9 rounded-xl px-3 text-xs"
                    disabled={!input.trim() || isSending}
                    onClick={() => void onSubmit()}
                    aria-label="Send message"
                  >
                    {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[10px] text-muted-foreground/80">
          {meta.hint}
        </p>
      </div>
    </div>
  )
}
