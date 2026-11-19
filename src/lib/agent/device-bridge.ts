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

export async function createPairedDevice(name: string, platform = 'macos'): Promise<{
  device: ConnectedDeviceDTO
  pairingToken: string
}> {
  const cleanName = name.trim().slice(0, 60) || 'My Computer'
  const cleanPlatform = ['macos', 'windows', 'linux'].includes(platform) ? platform : 'unknown'
  const pairingToken = `nxs_${crypto.randomBytes(20).toString('hex')}`
  const tokenHash = hashToken(pairingToken)

  const row = await db.connectedDevice.create({
    data: {
      name: cleanName,
      platform: cleanPlatform,
      tokenHash,
      status: 'offline',
      capabilitiesJson: JSON.stringify(['open_url', 'open_app', 'shell', 'system_info']),
    },
  })

  return {
    device: {
      id: row.id,
      name: row.name,
      platform: row.platform,
      status: 'offline',
      capabilities: ['open_url', 'open_app', 'shell', 'system_info'],
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
  const capabilities = ['open_url', 'open_app', 'shell', 'system_info']

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
