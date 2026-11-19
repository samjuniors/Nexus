import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { DEFAULT_WAKE_PHRASE, matchSleepCommand, matchWakeWord } from '@/lib/agent/wake-word'

export const runtime = 'nodejs'

const MAX_AUDIO_BASE64_LEN = 1_400_000 // ~1MB audio clip max (~30s at 16kHz mono PCM16)
const WAKE_MODELS = ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'] as const

const MIN_WAV_RMS_THRESHOLD = 0.004

/**
 * Inspects a RIFF/WAVE 16-bit PCM buffer and returns its normalized RMS level (0..1),
 * or null if the buffer is not a standard PCM16 WAV.
 */
function measureWavPcm16Rms(bytes: Buffer): number | null {
  if (bytes.length < 46) return null
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }
  const audioFormat = bytes.readUInt16LE(20)
  const bitsPerSample = bytes.readUInt16LE(34)
  if (audioFormat !== 1 || bitsPerSample !== 16) return null

  const dataOffset = 44
  const sampleCount = Math.floor((bytes.length - dataOffset) / 2)
  if (sampleCount <= 0) return 0

  let sumSq = 0
  for (let i = 0; i < sampleCount; i++) {
    const sample = bytes.readInt16LE(dataOffset + i * 2) / 32768
    sumSq += sample * sample
  }
  return Math.sqrt(sumSq / sampleCount)
}

/**
 * Server-side acoustic wake-word transcription endpoint for Eva's fallback VAD ear.
 * Used automatically whenever browser Web Speech API (`SpeechRecognition`) is unavailable
 * or blocked (e.g. inside iframes, Firefox, Safari, or when Chrome SpeechRecognition throws network errors).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      audioBase64?: string
      mimeType?: string
      wakePhrase?: string
    }

    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : ''
    const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'audio/wav'
    const wakePhrase = typeof body.wakePhrase === 'string' && body.wakePhrase.trim() ? body.wakePhrase.trim() : DEFAULT_WAKE_PHRASE

    if (!audioBase64 || audioBase64.length > MAX_AUDIO_BASE64_LEN) {
      return NextResponse.json({ ok: false, error: 'Invalid audio payload' }, { status: 400 })
    }

    // Fast server-side silence gate to prevent ASR hallucinations on silent clips
    if (mimeType === 'audio/wav') {
      const rawBytes = Buffer.from(audioBase64, 'base64')
      const rms = measureWavPcm16Rms(rawBytes)
      if (rms !== null && rms < MIN_WAV_RMS_THRESHOLD) {
        return NextResponse.json({
          ok: true,
          transcript: '',
          matched: false,
          matchedPhrase: '',
          trailingCommand: '',
          sleepRequested: false,
        })
      }
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
      return NextResponse.json({
        ok: true,
        transcript: '',
        matched: false,
        matchedPhrase: '',
        trailingCommand: '',
        sleepRequested: false,
      })
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    })

    let transcript = ''
    for (const model of WAKE_MODELS) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: audioBase64,
                  },
                },
                {
                  text: 'Transcribe any clear human speech in this short audio clip verbatim as plain text without commentary or timestamps. Do not guess or invent words. If there is only silence, static, or unclear background noise, output exactly: NONE',
                },
              ],
            },
          ],
          config: {
            temperature: 0,
            maxOutputTokens: 64,
          },
        })
        const raw = (resp.text ?? '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
        const cleaned = /^(\[?(none|silence|no speech|inaudible|background noise)\]?|\(?silence\)?)$/i.test(raw)
          ? ''
          : raw
        transcript = cleaned
        break
      } catch {
        /* try next fast free-tier model */
      }
    }

    const sleepRequested = matchSleepCommand(transcript)
    const wakeMatch = sleepRequested
      ? { matched: false, matchedPhrase: '', trailingCommand: '' }
      : matchWakeWord(transcript, wakePhrase)

    return NextResponse.json({
      ok: true,
      transcript,
      matched: wakeMatch.matched,
      matchedPhrase: wakeMatch.matchedPhrase,
      trailingCommand: wakeMatch.trailingCommand,
      sleepRequested,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
