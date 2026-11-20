'use client'

import type { KeyboardEvent, RefObject } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Camera,
  CameraOff,
  Ear,
  EarOff,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  RefreshCw,
  Square,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { VisionPreviewStrip } from '@/components/agent/vision-preview-pip'
import type { useLiveVoice } from '@/lib/agent/use-live-voice'
import type { useWakeWord } from '@/lib/agent/use-wake-word'
import type { useVisionEyes } from '@/lib/agent/use-vision-eyes'
import { deriveEffectiveComposerState } from '@/lib/agent/voice-state'
import { cn } from '@/lib/utils'

type VoiceHook = ReturnType<typeof useLiveVoice>
type WakeHook = ReturnType<typeof useWakeWord>
type VisionHook = ReturnType<typeof useVisionEyes>

/**
 * Minimalistic two-line text, vision-eyes, and live-voice composer.
 * Settings (voice timbre, wake phrase, ear sleep, theme, brain plug) live in Settings
 * so the primary chat input stays calm, clean, and uncluttered.
 */
export function VoiceComposer({
  voice,
  wake,
  vision,
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
  vision: VisionHook
  onToggleWake?: () => void
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

  const voiceBlockedOrError =
    effectiveState === 'error' ||
    Boolean(voice.lastError) ||
    wake.status === 'error' ||
    wake.status === 'unsupported'
  const showLiveStrip = voice.isActive || voiceBlockedOrError
  const hasDraft = Boolean(input.trim() || vision.anyActive)

  const placeholder = isRunning
    ? 'Eva is executing the current mission…'
    : vision.anyActive
      ? 'Ask Eva about what she sees…'
      : voice.isActive
        ? voice.muted
          ? 'Mic muted — type or unmute…'
          : 'Speak aloud or type…'
        : 'Message Eva…'

  return (
    <div className="border-t border-border/60 bg-background/95 px-3 py-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] md:px-6 md:py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div
          data-voice-state={effectiveState}
          data-minimal-composer="2line"
          className={cn(
            'overflow-hidden rounded-2xl border bg-card transition-colors focus-within:border-ring/60',
            voice.isActive || vision.anyActive
              ? 'border-sky-500/45'
              : voiceBlockedOrError
                ? 'border-amber-500/45'
                : 'border-border'
          )}
        >
          {/* Compact inline strip ONLY while live voice is active or voice is blocked/errored */}
          {showLiveStrip && (
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/35 px-3 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                {voiceBlockedOrError && !voice.isActive ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="truncate text-[11.5px] text-muted-foreground">
                      {voice.lastError || 'Voice unavailable — type below'}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        voice.isSpeaking
                          ? 'bg-emerald-500 pulse-dot'
                          : voice.agentState === 'thinking'
                            ? 'bg-violet-500 pulse-dot'
                            : voice.muted
                              ? 'bg-amber-500'
                              : 'bg-sky-500 pulse-dot'
                      )}
                    />
                    <span className="font-mono text-[11px] font-medium text-foreground">
                      {voice.status === 'connecting'
                        ? 'Connecting…'
                        : voice.isSpeaking
                          ? 'Eva speaking'
                          : voice.agentState === 'thinking'
                            ? 'Eva thinking…'
                            : voice.muted
                              ? 'Mic muted'
                              : 'Listening'}
                    </span>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {voiceBlockedOrError && !voice.isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11.5px] text-sky-500 hover:text-sky-400"
                    onClick={() => void voice.startVoice(activeConvId)}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </Button>
                ) : (
                  <>
                    {voice.isSpeaking && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={voice.interruptAudio}
                        aria-label="Interrupt speech playback"
                      >
                        <VolumeX className="h-3 w-3" />
                        Interrupt
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={voice.toggleMute}
                      aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      {voice.muted ? (
                        <MicOff className="h-3 w-3 text-amber-500" />
                      ) : (
                        <Mic className="h-3 w-3" />
                      )}
                      {voice.muted ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={voice.stopVoice}
                      aria-label="End live voice session"
                    >
                      <PhoneOff className="h-3 w-3" />
                      End
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Live Camera / Screen Eye preview strip when toggled on */}
          <VisionPreviewStrip vision={vision} />

          {/* Mobile (< md): ultra-minimal single-row dynamic composer */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 md:hidden">
            {!voiceBlockedOrError && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                data-vision-toggle="camera"
                onClick={() => void vision.toggleCamera()}
                aria-pressed={vision.cameraActive}
                aria-label={vision.cameraActive ? 'Turn off camera' : 'Turn on camera'}
                className={cn(
                  'h-10 w-10 shrink-0 rounded-full',
                  vision.cameraActive
                    ? 'bg-sky-500/15 text-sky-500'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {vision.cameraActive ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              </Button>
            )}

            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={isRunning}
              rows={1}
              className="max-h-28 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[14px] leading-snug text-foreground placeholder:text-muted-foreground/75 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
              aria-label="Message input"
            />

            {!voice.isActive && !voiceBlockedOrError && wake.supported && wake.status === 'awaiting-mic' && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                data-eva-ear-control="1"
                data-wake-status={wake.status}
                onClick={() => wake.armNow()}
                aria-label="Tap to unlock Eva wake ear"
                title="Tap once to unlock Hey Eva ear"
                className="h-10 w-10 shrink-0 rounded-full bg-amber-500/12 text-amber-500 hover:bg-amber-500/20"
              >
                <Ear className="h-4 w-4" />
              </Button>
            )}

            {isRunning ? (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="h-10 w-10 shrink-0 rounded-full"
                onClick={() => void onStopTask()}
                aria-label="Stop mission"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : hasDraft || voiceBlockedOrError ? (
              <Button
                type="button"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={!hasDraft || isSending}
                onClick={() => void onSubmit()}
                aria-label="Send message"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                variant={voice.isActive ? 'destructive' : 'default'}
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={voice.status === 'connecting' && !voice.isActive}
                onClick={() => {
                  if (voice.isActive) {
                    voice.stopVoice()
                  } else {
                    void voice.startVoice(activeConvId)
                  }
                }}
                aria-label={voice.isActive ? 'Stop voice conversation' : 'Start voice conversation'}
              >
                {voice.status === 'connecting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : voice.isActive ? (
                  <PhoneOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>

          {/* Desktop (>= md): full two-line text, vision, ear & voice composer */}
          <div className="hidden flex-col px-2.5 pt-2 pb-1.5 md:flex">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={isRunning}
              rows={2}
              className="max-h-40 min-h-[52px] w-full resize-none border-0 bg-transparent px-1.5 py-1 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
              aria-label="Message input"
            />

            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/40 pt-1.5">
              {/* Left: On-demand Eva Vision Eyes (Camera + Screen) & Wake Ear */}
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-vision-toggle="camera"
                  onClick={() => void vision.toggleCamera()}
                  aria-pressed={vision.cameraActive}
                  aria-label={vision.cameraActive ? 'Turn off Eva camera eye' : 'Turn on Eva camera eye'}
                  title={vision.cameraActive ? 'Camera Eye active — click to turn off' : 'Attach Camera Eye so Eva can see'}
                  className={cn(
                    'h-7 gap-1.5 rounded-lg px-2 text-[11.5px] font-medium',
                    vision.cameraActive
                      ? 'bg-sky-500/15 text-sky-600 hover:bg-sky-500/20 dark:text-sky-400'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {vision.cameraActive ? <CameraOff className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                  <span>Camera</span>
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-vision-toggle="screen"
                  onClick={() => void vision.toggleScreen()}
                  aria-pressed={vision.screenActive}
                  aria-label={vision.screenActive ? 'Turn off Eva screen eye' : 'Turn on Eva screen eye'}
                  title={vision.screenActive ? 'Screen Eye active — click to turn off' : 'Share screen/browser so Eva can see'}
                  className={cn(
                    'h-7 gap-1.5 rounded-lg px-2 text-[11.5px] font-medium',
                    vision.screenActive
                      ? 'bg-sky-500/15 text-sky-600 hover:bg-sky-500/20 dark:text-sky-400'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {vision.screenActive ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                  <span>Screen</span>
                </Button>

                {!voice.isActive && wake.supported && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-eva-ear-control="1"
                    data-wake-status={wake.status}
                    onClick={() => {
                      if (!wake.sleepMode && (wake.status === 'awaiting-mic' || wake.status === 'error')) {
                        wake.armNow()
                      } else if (onToggleWake) {
                        onToggleWake()
                      } else {
                        wake.toggleSleepMode()
                      }
                    }}
                    aria-pressed={!wake.sleepMode && wake.status === 'armed'}
                    aria-label={
                      wake.sleepMode
                        ? 'Wake Eva always-on ear'
                        : wake.status === 'armed'
                          ? 'Eva ear listening — click to pause'
                          : 'Enable Eva always-on ear'
                    }
                    title={
                      wake.sleepMode
                        ? 'Eva ear asleep — click to listen for "Eva" or "Hey Eva"'
                        : wake.status === 'armed'
                          ? `Listening (${wake.engine}) — say "Eva" or "${wake.wakePhrase}" anytime`
                          : wake.error || 'Click once to unlock mic so Eva hears "Eva" or "Hey Eva"'
                    }
                    className={cn(
                      'h-7 gap-1.5 rounded-lg px-2 text-[11.5px] font-medium',
                      wake.sleepMode
                        ? 'text-muted-foreground/75 hover:bg-muted hover:text-foreground'
                        : wake.status === 'armed'
                          ? 'bg-sky-500/12 text-sky-600 hover:bg-sky-500/20 dark:text-sky-400'
                          : 'bg-amber-500/12 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
                    )}
                  >
                    {wake.sleepMode ? (
                      <EarOff className="h-3.5 w-3.5" />
                    ) : (
                      <span className="relative flex items-center">
                        <Ear className="h-3.5 w-3.5" />
                        {wake.status === 'armed' && (
                          <span
                            className={cn(
                              'ml-1 h-1.5 w-1.5 rounded-full bg-sky-500',
                              wake.earLevel > 0.12 && 'scale-125 bg-emerald-400'
                            )}
                          />
                        )}
                      </span>
                    )}
                    <span>
                      {wake.sleepMode
                        ? 'Asleep'
                        : wake.status === 'armed'
                          ? 'Eva Ear'
                          : 'Tap Ear'}
                    </span>
                  </Button>
                )}
              </div>

              {/* Right: Voice Focus Mic + Send / Stop */}
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="icon"
                  variant={voice.isActive ? 'destructive' : 'ghost'}
                  className={cn(
                    'h-8 w-8 rounded-xl',
                    !voice.isActive && 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  disabled={voice.status === 'connecting' && !voice.isActive}
                  onClick={() => {
                    if (voice.isActive) {
                      voice.stopVoice()
                    } else {
                      void voice.startVoice(activeConvId)
                    }
                  }}
                  aria-label={voice.isActive ? 'Stop voice conversation' : 'Start hands-free voice mode'}
                  title={voice.isActive ? 'End Live Voice' : `Hands-free Voice Focus (${voice.voiceName})`}
                >
                  {voice.status === 'connecting' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : voice.isActive ? (
                    <PhoneOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>

                {isRunning ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="h-8 w-8 rounded-xl"
                    onClick={() => void onStopTask()}
                    aria-label="Stop mission"
                    title="Stop mission"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8 rounded-xl"
                    disabled={(!input.trim() && !vision.anyActive) || isSending}
                    onClick={() => void onSubmit()}
                    aria-label="Send message"
                    title={vision.anyActive && !input.trim() ? 'Ask Eva what she sees' : 'Send message'}
                  >
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
