import { NextResponse } from 'next/server'
import { buildCompanionRunnerScript } from '@/lib/agent/device-bridge'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = fwdHost || request.headers.get('host')?.trim() || url.host
  const proto = fwdProto ? `${fwdProto}:` : url.protocol
  const origin = `${proto}//${host}`
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
