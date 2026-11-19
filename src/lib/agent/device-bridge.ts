import crypto from 'crypto'
import type { IncomingMessage } from 'http'
import type WebSocket from 'ws'
import { db } from '@/lib/db'
import { controlBus } from '@/lib/agent/control-bus'

export interface ConnectedDeviceDTO {
  id: string
  name: string
  platform: string
  status: 'online' | 'offline'
  capabilities: string[]
  lastSeenAt: string | null
  createdAt: string
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function listConnectedDevices(): Promise<ConnectedDeviceDTO[]> {
  const rows = await db.connectedDevice.findMany({ orderBy: { createdAt: 'desc' } })
  const onlineIds = new Set(controlBus.getOnlineDeviceIds())
  return rows.map((r) => {
    let capabilities: string[] = []
    try {
      const parsed = JSON.parse(r.capabilitiesJson) as unknown
      if (Array.isArray(parsed)) capabilities = parsed.map(String)
    } catch {
      capabilities = []
    }
    return {
      id: r.id,
      name: r.name,
      platform: r.platform,
      status: onlineIds.has(r.id) ? 'online' : 'offline',
      capabilities,
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    }
  })
}

const MOBILE_CAPABILITIES = [
  'android_tap',
  'android_swipe',
  'android_type',
  'android_press_key',
  'android_open_app',
  'android_open_url',
  'android_screenshot',
  'android_notifications',
]

const DESKTOP_CAPABILITIES = ['open_url', 'open_app', 'shell', 'system_info']

export async function createPairedDevice(name: string, platform = 'macos'): Promise<{
  device: ConnectedDeviceDTO
  pairingToken: string
}> {
  const cleanName = name.trim().slice(0, 60) || (platform === 'android' ? 'Android Phone' : platform === 'ios' ? 'iPhone' : 'My Computer')
  const cleanPlatform = ['macos', 'windows', 'linux', 'android', 'ios'].includes(platform) ? platform : 'unknown'
  const isMobile = cleanPlatform === 'android' || cleanPlatform === 'ios'
  const capabilities = isMobile ? MOBILE_CAPABILITIES : DESKTOP_CAPABILITIES
  const pairingToken = `nxs_${crypto.randomBytes(20).toString('hex')}`
  const tokenHash = hashToken(pairingToken)

  const row = await db.connectedDevice.create({
    data: {
      name: cleanName,
      platform: cleanPlatform,
      tokenHash,
      status: 'offline',
      capabilitiesJson: JSON.stringify(capabilities),
    },
  })

  return {
    device: {
      id: row.id,
      name: row.name,
      platform: row.platform,
      status: 'offline',
      capabilities,
      lastSeenAt: null,
      createdAt: new Date(row.createdAt).toISOString(),
    },
    pairingToken,
  }
}

export async function revokeDevice(id: string): Promise<boolean> {
  controlBus.unregisterDevice(id)
  try {
    await db.connectedDevice.delete({ where: { id } })
    return true
  } catch {
    return false
  }
}

export async function handleDeviceBridgeSocket(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!token) {
    ws.close(4001, 'Missing pairing token')
    return
  }

  const tokenHash = hashToken(token)
  const device = await db.connectedDevice.findUnique({ where: { tokenHash } })
  if (!device) {
    ws.close(4003, 'Invalid or revoked device pairing token')
    return
  }

  const platformParam = (url.searchParams.get('platform') ?? device.platform).trim() || device.platform
  const capabilities =
    platformParam === 'android' || platformParam === 'ios'
      ? MOBILE_CAPABILITIES
      : DESKTOP_CAPABILITIES

  await db.connectedDevice.update({
    where: { id: device.id },
    data: {
      status: 'online',
      platform: platformParam,
      lastSeenAt: new Date(),
      capabilitiesJson: JSON.stringify(capabilities),
    },
  })

  controlBus.registerDevice({
    deviceId: device.id,
    name: device.name,
    platform: platformParam,
    capabilities,
    ws,
    connectedAt: new Date().toISOString(),
  })

  ws.send(JSON.stringify({ type: 'bridge:welcome', deviceId: device.id, name: device.name }))

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string
        commandId?: string
        ok?: boolean
        output?: string
        error?: string
      }
      if (msg.type === 'device:result' && msg.commandId) {
        controlBus.resolveDeviceCommand(msg.commandId, {
          ok: Boolean(msg.ok),
          output: String(msg.output ?? ''),
          error: msg.error ? String(msg.error) : undefined,
        })
      } else if (msg.type === 'bridge:ping') {
        ws.send(JSON.stringify({ type: 'bridge:pong', ts: Date.now() }))
        void db.connectedDevice
          .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
          .catch(() => {})
      }
    } catch {
      /* ignore malformed frames */
    }
  })

  const cleanup = () => {
    controlBus.unregisterDevice(device.id, ws)
    void db.connectedDevice
      .update({ where: { id: device.id }, data: { status: 'offline', lastSeenAt: new Date() } })
      .catch(() => {})
  }

  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

/**
 * Generates an inspectable standalone Node.js (v22+ native WebSocket) Local OS Companion Bridge script.
 * Users can run this once on their Mac/Windows/Linux computer to pair it with Eva.
 */
export function buildCompanionRunnerScript(origin: string): string {
  const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/api/device-bridge'
  return `#!/usr/bin/env node
/**
 * Nexus Agent OS — Local OS Companion Bridge (Optional)
 * Connects your local Mac/Windows/Linux machine to Eva via an authenticated WebSocket.
 * Usage: node nexus-companion.mjs --token <YOUR_PAIRING_TOKEN>
 */
import os from 'node:os';
import { execFile } from 'node:child_process';

const tokenIdx = process.argv.indexOf('--token');
const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : process.env.NEXUS_DEVICE_TOKEN;
if (!token) {
  console.error('Missing token. Run: node nexus-companion.mjs --token <YOUR_PAIRING_TOKEN>');
  process.exit(1);
}

const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const endpoint = '${wsUrl}?token=' + encodeURIComponent(token) + '&platform=' + platform;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 12000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, output: stdout || '', error: stderr || err.message });
      resolve({ ok: true, output: (stdout || stderr || 'Done').trim() });
    });
  });
}

async function executeAction(action, args = {}) {
  if (action === 'system_info') {
    return {
      ok: true,
      output: JSON.stringify({
        hostname: os.hostname(),
        platform,
        release: os.release(),
        arch: os.arch(),
        cpus: os.cpus().length,
        freeMemMB: Math.round(os.freemem() / 1048576),
      }, null, 2),
    };
  }
  if (action === 'open_url' && typeof args.url === 'string') {
    if (platform === 'macos') return run('open', [args.url]);
    if (platform === 'windows') return run('cmd', ['/c', 'start', '', args.url]);
    return run('xdg-open', [args.url]);
  }
  if (action === 'open_app' && typeof args.app === 'string') {
    if (platform === 'macos') return run('open', ['-a', args.app]);
    if (platform === 'windows') return run('cmd', ['/c', 'start', '', args.app]);
    return run(args.app, []);
  }
  if (action === 'shell' && typeof args.command === 'string') {
    const parts = args.command.match(/"[^"]*"|'[^']*'|\\S+/g)?.map((s) => s.replace(/^['"]|['"]$/g, '')) ?? [];
    if (!parts.length) return { ok: false, output: '', error: 'Empty command' };
    return run(parts[0], parts.slice(1));
  }
  return { ok: false, output: '', error: 'Unsupported action: ' + action };
}

function connect() {
  console.log('[Nexus Bridge] Connecting to', endpoint.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(endpoint);
  let pingTimer;
  ws.addEventListener('open', () => {
    console.log('[Nexus Bridge] Connected to Eva.');
    pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'bridge:ping' }));
    }, 20000);
  });
  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'device:exec' && msg.commandId) {
        console.log('[Nexus Bridge] Executing:', msg.action, msg.args);
        const res = await executeAction(msg.action, msg.args);
        ws.send(JSON.stringify({ type: 'device:result', commandId: msg.commandId, ...res }));
      }
    } catch (e) {
      console.error('[Nexus Bridge] Message error:', e);
    }
  });
  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log('[Nexus Bridge] Disconnected — reconnecting in 4s...');
    setTimeout(connect, 4000);
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

connect();
`
}

/**
 * Generates an inspectable standalone Node.js (v22+) Android ADB / Termux Bridge.
 * Connects a real Android device over USB or Wireless ADB (or Termux) to Eva via `/api/device-bridge`,
 * executing real tap, swipe, text input, keyevent, app launch, URL intent, and live screencap actions.
 */
export function buildAndroidBridgeScript(origin: string): string {
  const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/api/device-bridge'
  return `#!/usr/bin/env node
/**
 * Nexus Agent OS — Android & Mobile Takeover Bridge (ADB / Wireless Debugging)
 * Connects your Android phone or tablet (via USB or Wireless ADB) to Eva so she can
 * tap, swipe, type, launch apps, open URLs, and capture live screens just like Computer Use.
 *
 * Requirements: Node.js 22+ and Android platform-tools (adb) on PATH.
 * Usage: node nexus-android-bridge.mjs --token <YOUR_PAIRING_TOKEN> [--serial <ADB_SERIAL>]
 */
import { execFile } from 'node:child_process';

const tokenIdx = process.argv.indexOf('--token');
const token = tokenIdx !== -1 ? process.argv[tokenIdx + 1] : process.env.NEXUS_DEVICE_TOKEN;
const serialIdx = process.argv.indexOf('--serial');
const serial = serialIdx !== -1 ? process.argv[serialIdx + 1] : process.env.ANDROID_SERIAL;

if (!token) {
  console.error('Missing token. Run: node nexus-android-bridge.mjs --token <YOUR_PAIRING_TOKEN>');
  process.exit(1);
}

const endpoint = '${wsUrl}?token=' + encodeURIComponent(token) + '&platform=android';

function adb(args, opts = {}) {
  const finalArgs = serial ? ['-s', serial, ...args] : args;
  return new Promise((resolve) => {
    execFile('adb', finalArgs, { timeout: 15000, maxBuffer: 12 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, output: '', error: String(stderr || err.message) });
      resolve({ ok: true, output: Buffer.isBuffer(stdout) ? stdout : String(stdout || '').trim() });
    });
  });
}

const KEY_CODES = {
  home: '3',
  back: '4',
  call: '5',
  endcall: '6',
  volume_up: '24',
  volume_down: '25',
  power: '26',
  enter: '66',
  recents: '187',
};

const APP_PACKAGES = {
  settings: 'com.android.settings',
  chrome: 'com.android.chrome',
  messages: 'com.google.android.apps.messaging',
  phone: 'com.google.android.dialer',
  camera: 'com.android.camera2',
  maps: 'com.google.android.apps.maps',
  calendar: 'com.google.android.calendar',
  notes: 'com.google.android.keep',
};

async function executeAndroidAction(action, args = {}) {
  if (action === 'android_tap') {
    const x = Math.round(Number(args.x ?? 540));
    const y = Math.round(Number(args.y ?? 1200));
    return adb(['shell', 'input', 'tap', String(x), String(y)]);
  }
  if (action === 'android_swipe' || action === 'android_scroll') {
    const fx = Math.round(Number(args.fromX ?? 540));
    const fy = Math.round(Number(args.fromY ?? 1600));
    const tx = Math.round(Number(args.toX ?? 540));
    const ty = Math.round(Number(args.toY ?? 600));
    return adb(['shell', 'input', 'swipe', String(fx), String(fy), String(tx), String(ty), '280']);
  }
  if (action === 'android_type' && typeof args.text === 'string') {
    const escaped = args.text.replace(/\\s+/g, '%s').replace(/["'\\\\$&;|<>()]/g, '');
    return adb(['shell', 'input', 'text', escaped]);
  }
  if (action === 'android_press_key') {
    const code = KEY_CODES[String(args.key || 'home').toLowerCase()] || '3';
    return adb(['shell', 'input', 'keyevent', code]);
  }
  if (action === 'android_open_app' && typeof args.app === 'string') {
    const pkg = APP_PACKAGES[args.app.toLowerCase()] || args.app;
    return adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  }
  if (action === 'android_open_url' && typeof args.url === 'string') {
    return adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', args.url]);
  }
  if (action === 'android_notifications') {
    return adb(['shell', 'cmd', 'statusbar', args.open === false ? 'collapse' : 'expand-notifications']);
  }
  if (action === 'android_screenshot') {
    const res = await adb(['exec-out', 'screencap', '-p'], { encoding: 'buffer' });
    if (!res.ok) return res;
    const b64 = Buffer.from(res.output).toString('base64');
    return { ok: true, output: 'data:image/png;base64,' + b64 };
  }
  return { ok: false, output: '', error: 'Unsupported Android action: ' + action };
}

function connect() {
  console.log('[Nexus Android Bridge] Connecting to', endpoint.replace(/token=[^&]+/, 'token=***'));
  const ws = new WebSocket(endpoint);
  let pingTimer;
  ws.addEventListener('open', () => {
    console.log('[Nexus Android Bridge] Connected to Eva. Ready for ADB takeover.');
    pingTimer = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'bridge:ping' }));
    }, 20000);
  });
  ws.addEventListener('message', async (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'device:exec' && msg.commandId) {
        console.log('[Nexus Android Bridge] Executing:', msg.action, msg.args);
        const res = await executeAndroidAction(msg.action, msg.args);
        ws.send(JSON.stringify({ type: 'device:result', commandId: msg.commandId, ...res }));
      }
    } catch (e) {
      console.error('[Nexus Android Bridge] Message error:', e);
    }
  });
  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log('[Nexus Android Bridge] Disconnected — reconnecting in 4s...');
    setTimeout(connect, 4000);
  });
  ws.addEventListener('error', () => {
    try { ws.close(); } catch {}
  });
}

connect();
`
}

