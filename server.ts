import { createServer } from 'http'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handleLiveSocket } from './src/lib/agent/live-session'

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = Number(process.env.PORT ?? 3000)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const nextUpgrade = app.getUpgradeHandler()
  const wss = new WebSocketServer({ noServer: true })

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (url.pathname === '/api/live') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          void handleLiveSocket(ws, req)
        })
        return
      }
      void nextUpgrade(req, socket, head)
    } catch {
      socket.destroy()
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> Nexus Agent ready on http://${hostname}:${port} (dev=${dev})`)
  })
})
