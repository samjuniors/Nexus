import { NextResponse } from 'next/server'
import { buildAndroidBridgeScript } from '@/lib/agent/device-bridge'
import { getTrustedNexusOrigin } from '@/lib/agent/trusted-origin'

export async function GET(request: Request) {
  const origin = getTrustedNexusOrigin(request)
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
