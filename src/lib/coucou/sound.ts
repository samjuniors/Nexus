// Browser-safe WebAudio adapter for Coucou BotEngine sound cues (replaces Tauri audio bridge).

export type CoucouSoundName = 'slap' | 'annoyed' | 'greet'

let audioCtx: AudioContext | null = null
let muted = false

function getAudioContext(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) {
    try {
      audioCtx = new Ctx()
    } catch {
      return null
    }
  }
  return audioCtx
}

export const Sound = {
  setMuted(value: boolean) {
    muted = value
  },

  play(name: CoucouSoundName) {
    const ctx = getAudioContext()
    if (!ctx || ctx.state !== 'running') return
    try {
      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      if (name === 'greet') {
        osc.type = 'sine'
        osc.frequency.setValueAtTime(520, now)
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.09)
        gain.gain.setValueAtTime(0.035, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
        osc.start(now)
        osc.stop(now + 0.15)
      } else if (name === 'slap') {
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(280, now)
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.06)
        gain.gain.setValueAtTime(0.04, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
        osc.start(now)
        osc.stop(now + 0.09)
      } else {
        osc.type = 'sine'
        osc.frequency.setValueAtTime(340, now)
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.12)
        gain.gain.setValueAtTime(0.03, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
        osc.start(now)
        osc.stop(now + 0.15)
      }
    } catch {
      /* ignore audio unlock errors */
    }
  },
}
