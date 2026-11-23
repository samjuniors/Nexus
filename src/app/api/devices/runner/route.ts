import { NextResponse } from 'next/server'
import { buildCompanionRunnerScript } from '@/lib/agent/device-bridge'
import { getTrustedNexusOrigin } from '@/lib/agent/trusted-origin'

export async function GET(request: Request) {
  const origin = getTrustedNexusOrigin(request)
  const script = buildCompanionRunnerScript(origin)
  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nexus-companion.mjs"',
      'Cache-Control': 'no-store',
    },
  })
}
