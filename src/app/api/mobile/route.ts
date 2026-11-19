import { NextResponse } from 'next/server'
import { mobileManager, type MobileActionInput } from '@/lib/agent/mobile-manager'
import { listConnectedDevices } from '@/lib/agent/device-bridge'

export async function GET() {
  try {
    const devices = await listConnectedDevices()
    const mobileDevices = devices.filter((d) => d.platform === 'android' || d.platform === 'ios')
    return NextResponse.json({
      ok: true,
      frame: mobileManager.getFrame(),
      mobileDevices,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MobileActionInput
    if (!body || typeof body.action !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing mobile action' }, { status: 400 })
    }
    const res = await mobileManager.execute(body, { broadcast: true, openPanel: false })
    return NextResponse.json({
      ok: res.ok,
      summary: res.summary,
      output: res.output,
      frame: res.frame,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
