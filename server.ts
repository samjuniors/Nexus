import { createServer } from 'http'
import next from 'next'
import { loadEnvConfig } from '@next/env'
import { WebSocketServer } from 'ws'
import { createOwnerGateway } from './security/owner-gateway.cjs'

// Load .env and .env.local before owner authentication reads process.env.
// This follows Next.js's documented out-of-runtime environment initialization.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

const dev = process.env.NODE_ENV !== 'production'
const rawPort = Number(process.env.PORT ?? 3000)
const nginxPort = Number(process.env.NGINX_PORT ?? 0)
const port =
  !Number.isFinite(rawPort) || rawPort <= 0 || (nginxPort > 0 && rawPort === nginxPort) || (dev && rawPort === 8080)
    ? 3000
    : rawPort

const ownerGateway = createOwnerGateway({ port })
const hostname = ownerGateway.bindHost

const startedAt = Date.now()
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()
const wss = new WebSocketServer({ noServer: true })

let nextReady = false
let nextPrepareError: Error | null = null
let nextUpgrade: ReturnType<typeof app.getUpgradeHandler> | null = null

const preparePromise = app
  .prepare()
  .then(() => {
    nextUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null
    nextReady = true
    console.log(`> Next.js prepared in ${Date.now() - startedAt}ms (dev=${dev})`)
    void import('./src/lib/agent/scheduler')
      .then(({ startScheduler }) => startScheduler())
      .catch((err) => {
        console.error('Scheduler initialization warning:', err)
      })
  })
  .catch((err) => {
    nextPrepareError = err instanceof Error ? err : new Error(String(err))
    console.error('Failed to prepare Next.js app:', nextPrepareError)
  })

const server = createServer(async (req, res) => {
  try {
    // Authenticate before Next.js, API routing, and the health response.
    if (!(await ownerGateway.guardHttp(req, res))) return
    const pathname = (req.url ?? '/').split('?')[0]

    // Fast readiness endpoint for container & proxy health checks
    if (pathname === '/api/health') {
      res.statusCode = nextPrepareError ? 500 : 200
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          ok: !nextPrepareError,
          ready: nextReady,
          dev,
          uptimeMs: Date.now() - startedAt,
        })
      )
      return
    }

    // Immediate HEAD readiness response while Next.js finishes cold preparation
    if (req.method === 'HEAD' && pathname === '/' && !nextReady && !nextPrepareError) {
      res.statusCode = 200
      res.end()
      return
    }

    if (!nextReady) {
      await preparePromise
    }

    if (nextPrepareError) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Server failed to prepare: ${nextPrepareError.message}`)
      return
    }

    await handle(req, res)
  } catch (err) {
    console.error('Unhandled request error:', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Internal Server Error')
    }
  }
})

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost:' + port)
    if (!ownerGateway.guardUpgrade(req, url.pathname)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    if (url.pathname === '/api/live') {
      wss.handleUpgrade(req, socket, head, async (ws) => {
        ownerGateway.registerOwnerSocket(ws, req)
        try {
          const { handleLiveSocket } = await import('./src/lib/agent/live-session')
          await handleLiveSocket(ws, req)
        } catch (err) {
          console.error('Failed to handle /api/live WebSocket:', err)
          try {
            ws.close(1011, 'Live session initialization error')
          } catch {
            /* ignore */
          }
        }
      })
      return
    }
    if (url.pathname === '/api/control') {
      wss.handleUpgrade(req, socket, head, async (ws) => {
        ownerGateway.registerOwnerSocket(ws, req)
        try {
          const { controlBus } = await import('./src/lib/agent/control-bus')
          const { resolvePermissionDecision } = await import('./src/lib/agent/permissions')
          controlBus.registerUiClient(ws)
          ws.on('message', (raw) => {
            if (!ownerGateway.guardUpgrade(req, '/api/control')) {
              ws.terminate()
              return
            }
            try {
              const msg = JSON.parse(String(raw)) as {
                type?: string
                requestId?: string
                actionHash?: string
                decision?: 'always' | 'once' | 'deny'
              }
              if (msg.type === 'permission:respond' && msg.requestId && msg.actionHash && msg.decision) {
                void resolvePermissionDecision(msg.requestId, msg.decision, msg.actionHash)
              }
            } catch {
              /* ignore malformed frames */
            }
          })
        } catch (err) {
          console.error('Failed to handle /api/control WebSocket:', err)
          try {
            ws.close(1011, 'Control bus initialization error')
          } catch {
            /* ignore */
          }
        }
      })
      return
    }
    if (url.pathname === '/api/device-bridge') {
      wss.handleUpgrade(req, socket, head, async (ws) => {
        try {
          const { handleDeviceBridgeSocket } = await import('./src/lib/agent/device-bridge')
          await handleDeviceBridgeSocket(ws, req)
        } catch (err) {
          console.error('Failed to handle /api/device-bridge WebSocket:', err)
          try {
            ws.close(1011, 'Device bridge initialization error')
          } catch {
            /* ignore */
          }
        }
      })
      return
    }
    if (nextReady && nextUpgrade) {
      void nextUpgrade(req, socket, head)
    } else if (!nextReady) {
      void preparePromise.then(() => {
        if (nextUpgrade) {
          void nextUpgrade(req, socket, head)
        } else {
          socket.destroy()
        }
      })
    } else {
      socket.destroy()
    }
  } catch {
    socket.destroy()
  }
})

server.on('error', (err) => {
  console.error(`Nexus Agent HTTP server error on ${hostname}:${port}:`, err)
  process.exit(1)
})

server.listen(port, hostname, () => {
  console.log(`> Nexus Agent listening on http://${hostname}:${port} (dev=${dev}, ownerAuth=${ownerGateway.requiresOwnerToken})`)
})

const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

