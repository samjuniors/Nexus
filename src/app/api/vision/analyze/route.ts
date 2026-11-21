import { NextResponse } from 'next/server'
import { ThinkingLevel } from '@google/genai'
import { db } from '@/lib/db'
import { ensureSeeded } from '@/lib/agent/seed'
import { generateGeminiWithFallback } from '@/lib/agent/zai'

export const runtime = 'nodejs'

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null
}

/**
 * Server-side Multimodal Vision Eye endpoint for Eva.
 * Accepts an on-demand Camera or Screen/Browser JPEG frame + user prompt,
 * analyzes the image using `@google/genai` (`gemini-4-hydrogen`), and persists
 * both turns into the active conversation so Eva remembers what she saw.
 */
export async function POST(request: Request) {
  try {
    await ensureSeeded()
    const body = (await request.json()) as {
      conversationId?: string | null
      prompt?: string
      imageBase64?: string
      mimeType?: string
      source?: 'camera' | 'screen' | 'browser'
    }

    const prompt = (body.prompt ?? '').trim() || 'Describe what you see and suggest the best next step.'
    const imageBase64 = (body.imageBase64 ?? '').trim()
    const mimeType = body.mimeType || 'image/jpeg'
    const source = body.source || 'camera'

    if (!imageBase64) {
      return NextResponse.json({ ok: false, error: 'Visual frame is required' }, { status: 400 })
    }

    const apiKey = getGeminiApiKey()
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to enable Eva Vision Eyes.',
        },
        { status: 503 }
      )
    }

    let conv = body.conversationId
      ? await db.conversation.findUnique({ where: { id: body.conversationId } })
      : null
    if (!conv) {
      conv = await db.conversation.create({
        data: { title: prompt.replace(/\s+/g, ' ').slice(0, 60) },
      })
    }

    const sourceTag = source === 'camera' ? '[Camera Eye]' : source === 'screen' ? '[Screen Eye]' : '[Browser Eye]'
    const userMessage = await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'user',
        content: `${sourceTag} ${prompt}`,
      },
    })

    const response = await generateGeminiWithFallback({
      apiKey,
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        systemInstruction:
          'You are Eva, the Lead AI Agent inside Nexus OS. You are looking directly through your live visual eyes (camera or screen share). Be clear, grounded strictly in what is visible in the frame, concise, and immediately helpful with concrete next steps.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })

    const reply =
      (response.text ?? '').trim() ||
      'I received the visual frame, though no clear text answer was returned. Try adjusting lighting or sharing a closer view.'

    const assistantMessage = await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'assistant',
        content: reply,
      },
    })

    await db.conversation.update({
      where: { id: conv.id },
      data: { updatedAt: new Date() },
    })

    return NextResponse.json({
      ok: true,
      conversationId: conv.id,
      userMessage,
      assistantMessage,
      reply,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
