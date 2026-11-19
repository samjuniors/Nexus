import { NextResponse } from 'next/server'
import { buildAndroidBridgeScript } from '@/lib/agent/device-bridge'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const script = buildAndroidBridgeScript(origin)
  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nexus-android-bridge.mjs"',
      'Cache-Control': 'no-store',
    },
  })
}
