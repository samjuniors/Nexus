import { NextResponse } from 'next/server'
import { liveBrowser } from '@/lib/agent/browser-manager'

export async function GET() {
  return NextResponse.json({
    ok: true,
    frame: liveBrowser.getLatestFrame(),
  })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string
      url?: string
      query?: string
      goal?: string
      maxSteps?: number
      selector?: string
      text?: string
      x?: number
      y?: number
      key?: string
      deltaY?: number
      submit?: boolean
    }
    const action = String(body.action ?? 'snapshot').trim()

    if (action === 'close') {
      await liveBrowser.close()
      return NextResponse.json({ ok: true, frame: null })
    }
    if (action === 'clear_media') {
      const res = await liveBrowser.clearMedia()
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'play_media') {
      const query = String(body.query ?? body.url ?? body.text ?? '').trim()
      if (!query) return NextResponse.json({ ok: false, error: 'Missing query or url' }, { status: 400 })
      const res = await liveBrowser.playMedia(query)
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'autopilot') {
      const goal = String(body.goal ?? body.text ?? body.query ?? '').trim()
      if (!goal) return NextResponse.json({ ok: false, error: 'Missing goal' }, { status: 400 })
      const res = await liveBrowser.runAutopilot(goal, body.url, body.maxSteps)
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'navigate') {
      const url = String(body.url ?? '').trim()
      if (!url) return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 })
      const res = await liveBrowser.navigate(url)
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'click') {
      const res = await liveBrowser.click({
        selector: body.selector,
        text: body.text,
        x: typeof body.x === 'number' ? body.x : undefined,
        y: typeof body.y === 'number' ? body.y : undefined,
      })
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'type') {
      const text = String(body.text ?? '')
      const res = await liveBrowser.type({ text, selector: body.selector, submit: Boolean(body.submit) })
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'press') {
      const res = await liveBrowser.press(String(body.key ?? 'Enter'))
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'scroll') {
      const res = await liveBrowser.scroll(typeof body.deltaY === 'number' ? body.deltaY : 480)
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'back') {
      const res = await liveBrowser.back()
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    if (action === 'reload') {
      const res = await liveBrowser.reload()
      return NextResponse.json(res, { status: res.ok ? 200 : 400 })
    }
    const res = await liveBrowser.snapshot()
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
