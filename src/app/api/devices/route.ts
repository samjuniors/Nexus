import { NextResponse } from 'next/server'
import { createPairedDevice, listConnectedDevices, revokeDevice } from '@/lib/agent/device-bridge'

export async function GET() {
  try {
    const devices = await listConnectedDevices()
    return NextResponse.json({ ok: true, devices })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; platform?: string }
    const name = String(body.name ?? 'My Computer').trim()
    const platform = String(body.platform ?? 'macos').trim()
    const { device, pairingToken } = await createPairedDevice(name, platform)
    const devices = await listConnectedDevices()
    return NextResponse.json({ ok: true, device, pairingToken, devices })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ ok: false, error: 'Missing device id' }, { status: 400 })
    await revokeDevice(id)
    const devices = await listConnectedDevices()
    return NextResponse.json({ ok: true, devices })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
