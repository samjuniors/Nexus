'use client'

import type { KeyboardEvent, RefObject } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Camera,
  CameraOff,
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

  const showLiveStrip = voice.isActive || effectiveState === 'error'

  const placeholder = isRunning
    ? 'Eva is executing the current mission…'
    : vision.anyActive
      ? 'Ask Eva about what she sees through her eyes, or describe an action…'
      : voice.isActive
        ? voice.muted
          ? 'Mic muted — type a message or unmute…'
          : 'Speak aloud to Eva, or type a follow-up…'
        : 'Message Eva, attach eyes, or describe a mission…\nShift + Enter for a new line'

  return (
    <div className="border-t border-border/70 bg-background/95 px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div
          data-voice-state={effectiveState}
          data-minimal-composer="2line"
          className={cn(
            'overflow-hidden rounded-2xl border bg-card transition-colors focus-within:border-ring/60',
            voice.isActive || vision.anyActive
              ? 'border-sky-500/45'
              : effectiveState === 'error'
                ? 'border-red-500/45'
                : 'border-border'
          )}
        >
          {/* Compact inline strip ONLY while live voice is active or errored */}
          {showLiveStrip && (
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/35 px-3 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                {effectiveState === 'error' ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    <span className="truncate text-[11.5px] text-red-600 dark:text-red-300">
                      {voice.lastError || 'Voice connection error'}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        voice.isSpeaking
                          ? 'bg-emerald-500 pulse-dot'
                          : voice.muted
                            ? 'bg-amber-500'
                            : 'bg-sky-500 pulse-dot'
                      )}
                    />
                    <span className="font-mono text-[11px] font-medium text-foreground">
                      {voice.status === 'connecting'
                        ? 'Connecting live voice…'
                        : voice.isSpeaking
                          ? 'Eva speaking'
                          : voice.muted
                            ? 'Mic muted'
                            : 'Listening'}
                    </span>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {effectiveState === 'error' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-2 text-[11px]"
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
                        className="h-6 gap-1 px-2 text-[11px]"
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
                      className="h-6 gap-1 px-2 text-[11px]"
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
                      className="h-6 gap-1 px-2 text-[11px]"
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

          {/* Two-line comfortable input + bottom control row */}
          <div className="flex flex-col px-2.5 pt-2 pb-1.5">
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
              {/* Left: On-demand Eva Vision Eyes (Camera + Screen) */}
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
                  <span className="hidden sm:inline">Camera</span>
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
                  <span className="hidden sm:inline">Screen</span>
                </Button>
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
