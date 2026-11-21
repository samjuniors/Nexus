import { NextRequest, NextResponse } from 'next/server'
import { ThinkingLevel } from '@google/genai'
import { generateGeminiWithFallback } from '@/lib/agent/zai'

export const dynamic = 'force-dynamic'

function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null
}

async function googleFetch(url: string, authHeader: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader,
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { ok: res.ok, status: res.status, data: json }
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function extractHeader(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  if (!Array.isArray(headers)) return ''
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function extractDocPlainText(doc: Record<string, unknown>): string {
  const body = doc.body as { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } | undefined
  if (!body?.content) return ''
  const chunks: string[] = []
  for (const block of body.content) {
    const els = block.paragraph?.elements
    if (!els) continue
    for (const el of els) {
      if (el.textRun?.content) chunks.push(el.textRun.content)
    }
  }
  return chunks.join('').trim()
}

/**
 * Real Google Workspace API proxy (Gmail, Drive, Docs, Calendar).
 * Uses client-provided `Authorization: Bearer <token>` header from Firebase Google Sign-In.
 * Never persists user OAuth tokens on the server.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Google Workspace sign-in required.', needsAuth: true },
      { status: 401 }
    )
  }

  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '').trim()

    // ---- GMAIL ----
    if (action === 'gmail_list') {
      const q = String(body.query ?? '').trim()
      const maxResults = Math.min(20, Math.max(1, Number(body.maxResults ?? 10)))
      const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q ? `&q=${encodeURIComponent(q)}` : ''}`
      const listRes = await googleFetch(listUrl, authHeader)
      if (!listRes.ok) {
        return NextResponse.json(
          { error: 'Failed to list Gmail messages', details: listRes.data, needsAuth: listRes.status === 401 },
          { status: listRes.status }
        )
      }
      const ids = ((listRes.data as { messages?: { id: string }[] }).messages ?? []).slice(0, maxResults)
      const items = await Promise.all(
        ids.map(async (m) => {
          const detail = await googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            authHeader
          )
          const payload = (detail.data as { payload?: { headers?: { name?: string; value?: string }[] }; snippet?: string; threadId?: string }) ?? {}
          return {
            id: m.id,
            threadId: payload.threadId ?? '',
            subject: extractHeader(payload.payload?.headers, 'Subject') || '(No subject)',
            from: extractHeader(payload.payload?.headers, 'From') || 'Unknown sender',
            date: extractHeader(payload.payload?.headers, 'Date') || '',
            snippet: payload.snippet ?? '',
          }
        })
      )
      return NextResponse.json({ ok: true, messages: items })
    }

    if (action === 'gmail_send') {
      const to = String(body.to ?? '').trim()
      const subject = String(body.subject ?? '').trim()
      const text = String(body.body ?? '').trim()
      if (!to || !subject) {
        return NextResponse.json({ error: 'Recipient and subject are required.' }, { status: 400 })
      }
      const mime = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        text,
      ].join('\r\n')
      const sendRes = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', authHeader, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeBase64Url(mime) }),
      })
      if (!sendRes.ok) {
        return NextResponse.json(
          { error: 'Failed to send email', details: sendRes.data, needsAuth: sendRes.status === 401 },
          { status: sendRes.status }
        )
      }
      return NextResponse.json({ ok: true, result: sendRes.data })
    }

    // ---- GOOGLE DRIVE & DOCS ----
    if (action === 'drive_list') {
      const q = String(body.query ?? '').trim()
      const pageSize = Math.min(25, Math.max(1, Number(body.pageSize ?? 12)))
      const driveQ = q
        ? `trashed = false and name contains '${q.replace(/'/g, "\\'")}'`
        : 'trashed = false'
      const url = `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&orderBy=modifiedTime desc&q=${encodeURIComponent(driveQ)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink)')}`
      const res = await googleFetch(url, authHeader)
      if (!res.ok) {
        return NextResponse.json(
          { error: 'Failed to list Google Drive files', details: res.data, needsAuth: res.status === 401 },
          { status: res.status }
        )
      }
      const files = (res.data as { files?: unknown[] }).files ?? []
      return NextResponse.json({ ok: true, files })
    }

    if (action === 'drive_summarize') {
      const fileId = String(body.fileId ?? '').trim()
      const fileName = String(body.fileName ?? 'Document').trim()
      const mimeType = String(body.mimeType ?? '').trim()
      if (!fileId) return NextResponse.json({ error: 'fileId is required.' }, { status: 400 })

      let plainText = ''
      if (mimeType === 'application/vnd.google-apps.document') {
        const docRes = await googleFetch(
          `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
          authHeader
        )
        if (!docRes.ok) {
          return NextResponse.json(
            { error: 'Could not read Google Doc content', details: docRes.data, needsAuth: docRes.status === 401 },
            { status: docRes.status }
          )
        }
        plainText = extractDocPlainText(docRes.data as Record<string, unknown>)
      } else {
        const exportUrl = mimeType.startsWith('application/vnd.google-apps.')
          ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`
          : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
        const rawRes = await fetch(exportUrl, { headers: { Authorization: authHeader } })
        if (!rawRes.ok) {
          return NextResponse.json(
            { error: 'Could not read Drive file text', needsAuth: rawRes.status === 401 },
            { status: rawRes.status }
          )
        }
        plainText = (await rawRes.text()).slice(0, 24000)
      }

      const apiKey = getGeminiKey()
      if (!apiKey || !plainText) {
        return NextResponse.json({
          ok: true,
          summary: plainText ? plainText.slice(0, 600) : 'This file appears to have no extractable text content.',
          excerpt: plainText.slice(0, 1200),
        })
      }

      const sumRes = await generateGeminiWithFallback({
        apiKey,
        model: 'gemini-4-hydrogen',
        contents: `Summarize this Google Drive document ("${fileName}") into 3–5 crisp key takeaways and any action items:\n\n${plainText.slice(0, 18000)}`,
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      })

      return NextResponse.json({
        ok: true,
        summary: (sumRes.text ?? '').trim(),
        excerpt: plainText.slice(0, 1200),
      })
    }

    if (action === 'docs_create') {
      const title = String(body.title ?? '').trim() || 'Eva Document'
      const content = String(body.content ?? '').trim()
      const createRes = await googleFetch('https://docs.googleapis.com/v1/documents', authHeader, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!createRes.ok) {
        return NextResponse.json(
          { error: 'Failed to create Google Doc', details: createRes.data, needsAuth: createRes.status === 401 },
          { status: createRes.status }
        )
      }
      const docId = (createRes.data as { documentId?: string }).documentId
      if (docId && content) {
        await googleFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, authHeader, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: content,
                },
              },
            ],
          }),
        })
      }
      return NextResponse.json({
        ok: true,
        documentId: docId,
        url: docId ? `https://docs.google.com/document/d/${docId}/edit` : null,
      })
    }

    // ---- GOOGLE CALENDAR ----
    if (action === 'calendar_list') {
      const timeMin = new Date().toISOString()
      const maxResults = Math.min(20, Math.max(1, Number(body.maxResults ?? 10)))
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`
      const res = await googleFetch(url, authHeader)
      if (!res.ok) {
        return NextResponse.json(
          { error: 'Failed to list Calendar events', details: res.data, needsAuth: res.status === 401 },
          { status: res.status }
        )
      }
      const items = (res.data as { items?: unknown[] }).items ?? []
      return NextResponse.json({ ok: true, events: items })
    }

    if (action === 'calendar_create') {
      const summary = String(body.summary ?? '').trim()
      const startIso = String(body.startIso ?? '').trim()
      const endIso = String(body.endIso ?? '').trim()
      const description = String(body.description ?? '').trim()
      if (!summary || !startIso || !endIso) {
        return NextResponse.json(
          { error: 'Event title, start time, and end time are required.' },
          { status: 400 }
        )
      }
      const res = await googleFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', authHeader, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          description,
          start: { dateTime: startIso },
          end: { dateTime: endIso },
        }),
      })
      if (!res.ok) {
        return NextResponse.json(
          { error: 'Failed to create Calendar event', details: res.data, needsAuth: res.status === 401 },
          { status: res.status }
        )
      }
      return NextResponse.json({ ok: true, event: res.data })
    }

    return NextResponse.json({ error: `Unsupported Google Workspace action: ${action}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Google Workspace request failed' },
      { status: 500 }
    )
  }
}
