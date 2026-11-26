/**
 * Cross-platform launcher for Nexus: starts the Next.js/Eva backend server
 * and launches the native Electron desktop shell once ready.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const electronDir = path.join(rootDir, 'electron')

const PORT = Number(process.env.PORT || 3000)
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 1500 }, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(Boolean(json && json.ok))
        } catch {
          resolve(res.statusCode === 200)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) return true
    await new Promise((r) => setTimeout(r, 800))
  }
  return false
}

function killProcessTree(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      child.kill('SIGTERM')
    }
  } else {
    child.kill('SIGTERM')
  }
}

async function main() {
  console.log('==============================================')
  console.log('       Nexus Agent OS — Desktop Launcher      ')
  console.log('==============================================')

  let serverProcess = null
  const alreadyRunning = await checkHealth()

  if (alreadyRunning) {
    console.log(`[Nexus] Backend server is already running on port ${PORT}.`)
  } else {
    console.log(`[Nexus] Starting backend server on http://127.0.0.1:${PORT}...`)
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    serverProcess = spawn(npmCmd, ['run', 'dev'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PORT: String(PORT) },
    })

    serverProcess.on('error', (err) => {
      console.error('[Nexus] Failed to spawn server:', err)
    })

    const ready = await waitForServer(60000)
    if (!ready) {
      console.error('[Nexus] Server failed to become healthy within 60s.')
      if (serverProcess) killProcessTree(serverProcess)
      process.exit(1)
    }
    console.log('[Nexus] Backend server is ready!')
  }

  console.log('[Nexus] Launching Electron desktop shell...')
  const electronBin =
    process.platform === 'win32'
      ? path.join(electronDir, 'node_modules', '.bin', 'electron.cmd')
      : path.join(electronDir, 'node_modules', '.bin', 'electron')

  const electronProcess = spawn(electronBin, ['.'], {
    cwd: electronDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NEXUS_APP_URL: `http://127.0.0.1:${PORT}` },
  })

  const cleanup = () => {
    if (serverProcess) {
      console.log('\n[Nexus] Electron closed. Shutting down backend server...')
      killProcessTree(serverProcess)
      serverProcess = null
    }
  }

  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })

  electronProcess.on('exit', (code) => {
    cleanup()
    process.exit(code ?? 0)
  })
}

main().catch((err) => {
  console.error('[Nexus] Unexpected error:', err)
  process.exit(1)
})
