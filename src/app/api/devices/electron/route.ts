import { NextRequest, NextResponse } from 'next/server'
import { getTrustedNexusOrigin } from '@/lib/agent/trusted-origin'

/**
 * GET /api/devices/electron
 * Returns a ready-to-use Electron Desktop launch configuration targeting the current
 * web deployment (or localhost:3000) so users can manage Nexus & their computer from
 * both the Web app and a native Electron desktop shell.
 */
export async function GET(req: NextRequest) {
  const origin = getTrustedNexusOrigin(req)
  const wsOrigin = origin.replace(/^http/, 'ws')

  const config = {
    name: 'nexus-eva-desktop',
    appUrl: origin,
    deviceBridgeUrl: `${wsOrigin}/api/device-bridge`,
    electronDir: 'electron',
    hotkey: 'CommandOrControl+Shift+E',
    quickStart: [
      'cd electron',
      'npm install',
      `NEXUS_APP_URL="${origin}" npm start`,
    ],
    capabilities: [
      'native_window',
      'always_on_top_companion',
      'global_summon_hotkey',
      'camera_and_screen_vision_eyes',
      'web_and_local_os_hybrid_control',
    ],
  }

  return new NextResponse(JSON.stringify(config, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nexus-electron-config.json"',
    },
  })
}
