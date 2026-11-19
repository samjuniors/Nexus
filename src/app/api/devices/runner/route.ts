import { NextResponse } from 'next/server'
import { buildCompanionRunnerScript } from '@/lib/agent/device-bridge'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
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
