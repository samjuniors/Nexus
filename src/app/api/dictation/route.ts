import { NextResponse } from 'next/server'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { generateGeminiWithFallback } from '@/lib/agent/zai'

export const dynamic = 'force-dynamic'

function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null
}

function getGemini(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
    },
  })
}

/**
 * Quick Dictation endpoint:
 * 1) Transcribes raw audio with `gemini-3.5-transcribe` (when audioBase64 is supplied).
 * 2) Polishes filler words, punctuation, and formatting with `gemini-4-hydrogen` (with automatic 503 failover)
 *    so the returned text is immediately paste-ready for any active Windows app or chat field.
 */
export async function POST(req: Request) {
  try {
    const apiKey = getGeminiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured on the server.' },
        { status: 500 }
      )
    }

    const body = (await req.json()) as {
      audioBase64?: string
      mimeType?: string
      rawText?: string
      style?: 'clean' | 'email' | 'bullets'
    }

    let transcript = (body.rawText ?? '').trim()

    if (!transcript && body.audioBase64) {
      const ai = getGemini(apiKey)
      const cleanBase64 = body.audioBase64.replace(/^data:[^;]+;base64,/, '')
      const mimeType = body.mimeType || 'audio/webm'
      const asrRes = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data: cleanBase64 } },
            { text: 'Transcribe this spoken dictation accurately. Return only the spoken words.' },
          ],
        },
      })
      transcript = (asrRes.text ?? '').trim()
    }

    if (!transcript) {
      return NextResponse.json({ ok: true, rawTranscript: '', formattedText: '' })
    }

    const styleInstruction =
      body.style === 'email'
        ? 'Format as a clear, concise, professional email body with proper paragraphs.'
        : body.style === 'bullets'
          ? 'Format as clean concise bullet points.'
          : 'Fix punctuation, capitalization, and remove filler words ("um", "uh", "like") while preserving the speaker’s exact meaning and voice.'

    const polishRes = await generateGeminiWithFallback({
      apiKey,
      model: 'gemini-4-hydrogen',
      contents: `Raw dictation:\n${transcript}`,
      config: {
        systemInstruction: `You are a precision dictation formatter. ${styleInstruction} Return ONLY the final formatted text with no preamble, quotes, or commentary.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })

    const formattedText = (polishRes.text ?? transcript).trim()

    return NextResponse.json({
      ok: true,
      rawTranscript: transcript,
      formattedText,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Dictation processing failed' },
      { status: 500 }
    )
  }
}
