import { NextResponse } from 'next/server'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Nexus-Client',
  'Cache-Control': 'no-store',
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      app: 'nexus-eva',
      version: '1.0.0',
      platforms: ['android-apk', 'web-pwa', 'desktop-electron'],
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: CORS_HEADERS }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
