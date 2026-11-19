/**
 * Pure audio utilities for Eva's Acoustic VAD fallback ear and wake confirmation chime.
 */

export const WAKE_VAD_SAMPLE_RATE = 16000

/**
 * Computes normalized RMS speech amplitude (0..1) from PCM float samples.
 */
export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    sum += v * v
  }
  const rms = Math.sqrt(sum / samples.length)
  return Math.max(0, Math.min(1, rms))
}

/**
 * Linearly resamples mono Float32 PCM audio to targetSampleRate (default 16kHz).
 */
export function downsampleMonoFloat32(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = WAKE_VAD_SAMPLE_RATE
): Float32Array {
  if (input.length === 0 || inputSampleRate <= 0) return new Float32Array(0)
  if (inputSampleRate === targetSampleRate) return input
  const ratio = inputSampleRate / targetSampleRate
  const newLength = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = input[idx] ?? 0
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0
    out[i] = s0 + (s1 - s0) * frac
  }
  return out
}

/**
 * Encodes mono Float32 PCM samples into a standard RIFF/WAVE 16-bit PCM buffer.
 */
export function encodePcm16ToWavBytes(
  samples: Float32Array,
  sampleRate = WAKE_VAD_SAMPLE_RATE
): Uint8Array {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset + i, s.charCodeAt(i))
    }
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function encodePcm16ToWavBase64(
  samples: Float32Array,
  sampleRate = WAKE_VAD_SAMPLE_RATE
): string {
  return uint8ToBase64(encodePcm16ToWavBytes(samples, sampleRate))
}

/**
 * Plays a gentle, crisp two-tone chime when Eva wakes up (fails silently if autoplay blocked).
 */
export function playEvaWakeChime(): void {
  if (typeof window === 'undefined') return
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [
      { freq: 587.33, start: now, duration: 0.09 }, // D5
      { freq: 880.0, start: now + 0.08, duration: 0.14 }, // A5
    ]
    for (const n of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(n.freq, n.start)
      gain.gain.setValueAtTime(0.0001, n.start)
      gain.gain.exponentialRampToValueAtTime(0.08, n.start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, n.start + n.duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(n.start)
      osc.stop(n.start + n.duration + 0.01)
    }
    setTimeout(() => {
      void ctx.close().catch(() => {})
    }, 350)
  } catch {
    /* ignore audio errors */
  }
}
