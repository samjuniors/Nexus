import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import {
  detectHostShells,
  extractCwdFromOutput,
  isCommandBlocked,
  terminalManager,
} from './terminal-manager'

test('detectHostShells finds real executable shell binaries on this host', () => {
  const info = detectHostShells()
  assert.ok(info.available.length >= 1, 'Expected at least one real shell binary')
  assert.ok(info.binaries[info.defaultShell], 'Expected resolved binary path for default shell')
})

test('isCommandBlocked rejects destructive OS commands and allows normal commands', () => {
  assert.ok(isCommandBlocked('rm -rf /'))
  assert.ok(isCommandBlocked('shutdown -h now'))
  assert.ok(isCommandBlocked('Format-Volume -DriveLetter C'))
  assert.equal(isCommandBlocked('echo hello && pwd'), null)
  assert.equal(isCommandBlocked('Get-Process | Select-Object -First 5'), null)
})

test('extractCwdFromOutput strips internal marker cleanly', () => {
  const { cleanOutput, nextCwd } = extractCwdFromOutput(
    'hello world\n__NEXUS_CWD_MARKER_9f2a__:/tmp/demo\n'
  )
  assert.equal(cleanOutput, 'hello world')
  assert.equal(nextCwd, '/tmp/demo')
})

test('terminalManager executes real host commands, tracks real exit codes and persistent cwd', async () => {
  const startCwd = terminalManager.getSnapshot().cwd

  // 1. Real command execution
  const echoRes = await terminalManager.execute({
    command: 'echo "NEXUS_REAL_SHELL_OK"',
    actor: 'eva',
    target: 'host',
  })
  assert.equal(echoRes.ok, true)
  assert.equal(echoRes.exitCode, 0)
  assert.match(echoRes.stdout, /NEXUS_REAL_SHELL_OK/)

  // 2. Real non-zero exit code
  const failRes = await terminalManager.execute({
    command: 'exit 7',
    actor: 'user',
    target: 'host',
  })
  assert.equal(failRes.ok, false)
  assert.equal(failRes.exitCode, 7)

  // 3. Real persistent cd tracking across commands
  const tmpDir = os.tmpdir()
  const sep = process.platform === 'win32' ? ';' : '&&'
  const cdRes = await terminalManager.execute({
    command: `cd "${tmpDir}" ${sep} pwd`,
    actor: 'user',
    target: 'host',
  })
  assert.equal(cdRes.ok, true)
  assert.equal(path.resolve(terminalManager.getSnapshot().cwd), path.resolve(tmpDir))

  // Restore original cwd
  await terminalManager.execute({
    command: `cd "${startCwd}"`,
    actor: 'user',
    target: 'host',
  })
  assert.equal(path.resolve(terminalManager.getSnapshot().cwd), path.resolve(startCwd))
})
