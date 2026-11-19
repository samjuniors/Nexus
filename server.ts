import { createServer } from 'http'
import next from 'next'
import { WebSocketServer } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const rawPort = Number(process.env.PORT ?? 3000)
const port = dev && rawPort === 8080 ? 3000 : Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const nextUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null
  const wss = new WebSocketServer({ noServer: true })

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (url.pathname === '/api/live') {
        wss.handleUpgrade(req, socket, head, async (ws) => {
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
          try {
            const { controlBus } = await import('./src/lib/agent/control-bus')
            const { resolvePermissionDecision } = await import('./src/lib/agent/permissions')
            controlBus.registerUiClient(ws)
            ws.on('message', (raw) => {
              try {
                const msg = JSON.parse(String(raw)) as {
                  type?: string
                  requestId?: string
                  decision?: 'always' | 'once' | 'deny'
                }
                if (msg.type === 'permission:respond' && msg.requestId && msg.decision) {
                  void resolvePermissionDecision(msg.requestId, msg.decision)
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
      if (nextUpgrade) {
        void nextUpgrade(req, socket, head)
      } else {
        socket.destroy()
      }
    } catch {
      socket.destroy()
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> Nexus Agent ready on http://${hostname}:${port} (dev=${dev})`)
    void import('./src/lib/agent/scheduler')
      .then(({ startScheduler }) => startScheduler())
      .catch((err) => {
        console.error('Scheduler initialization warning:', err)
      })
  })

  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}).catch((err) => {
  console.error('Failed to start Nexus Agent server:', err)
  process.exit(1)
})
