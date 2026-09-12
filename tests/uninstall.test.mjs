import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = new URL('../scripts/uninstall.mjs', import.meta.url)

test('uninstall keeps unrelated login-plugin log data', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-uninstall-'))
  try {
    const logDir = join(home, 'login-plugin', 'log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'other-tool.log'), 'keep me\\n')
    const result = spawnSync(process.execPath, [script.pathname], {
      env: { ...process.env, DSH_HOME: home }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(join(home, 'login-plugin')), true)
    assert.equal(readFileSync(join(logDir, 'other-tool.log'), 'utf8'), 'keep me\\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
