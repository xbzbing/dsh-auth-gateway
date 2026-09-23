/** Credential-directory tests. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODULE_URL = new URL('../lib/paths.js', import.meta.url)

async function freshPaths(home) {
  process.env.DSH_HOME = home
  return import(`${MODULE_URL.href}?t=${Math.random()}`)
}

test('credentialDir resolves the canonical directory without creating it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-'))
  try {
    const { credentialDir } = await freshPaths(home)
    const dir = credentialDir()
    assert.equal(dir, join(home, 'auth-gateway'))
    assert.ok(!existsSync(dir))
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('ensureCredentialDir creates the canonical directory', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-'))
  try {
    const { ensureCredentialDir } = await freshPaths(home)
    const dir = ensureCredentialDir()
    assert.equal(dir, join(home, 'auth-gateway'))
    assert.ok(existsSync(dir))
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('auditLogDir resolves under the credential directory', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-'))
  try {
    const { auditLogDir } = await freshPaths(home)
    assert.equal(auditLogDir(), join(home, 'auth-gateway', 'log'))
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})
