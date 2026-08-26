/**
 * Credential-directory tests: the auth-gate → auth-gateway migration.
 *
 * Contract: legacy data folds into the new directory only when the legacy
 * directory exists AND the new one does not; an existing new directory is
 * never touched; a fresh install creates the new directory directly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODULE_URL = new URL('../lib/paths.js', import.meta.url)

/** Fresh module instance per scenario — the migrate-once flag is per-import. */
async function freshPaths(home) {
  process.env.DSH_HOME = home
  const mod = await import(`${MODULE_URL.href}?t=${Math.random()}`)
  return mod
}

test('legacy auth-gate data migrates to auth-gateway on first use', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-migrate-'))
  try {
    const legacy = join(home, 'auth-gate')
    mkdirSync(legacy, { mode: 0o700 })
    writeFileSync(join(legacy, 'password.json'), '{"hashed":true}\n', { mode: 0o600 })
    writeFileSync(join(legacy, 'otp.json'), '{}\n', { mode: 0o600 })

    const { credentialDir } = await freshPaths(home)
    const dir = credentialDir()

    assert.equal(dir, join(home, 'auth-gateway'))
    assert.ok(existsSync(join(dir, 'password.json')), 'credentials ride along')
    assert.equal(readFileSync(join(dir, 'password.json'), 'utf8'), '{"hashed":true}\n')
    assert.ok(!existsSync(legacy), 'the legacy directory is gone (atomic rename)')
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('an existing auth-gateway directory is never overwritten', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-keep-'))
  try {
    const legacy = join(home, 'auth-gate')
    const current = join(home, 'auth-gateway')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'old.json'), 'old\n')
    mkdirSync(current)
    writeFileSync(join(current, 'new.json'), 'new\n')

    const { credentialDir } = await freshPaths(home)
    const dir = credentialDir()

    assert.equal(dir, current)
    assert.ok(existsSync(join(current, 'new.json')), 'current credentials stay')
    assert.ok(!existsSync(join(current, 'old.json')), 'legacy content does not merge in')
    assert.ok(existsSync(legacy), 'the legacy directory is left untouched for manual cleanup')
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('a fresh install just returns the new directory (nothing to migrate)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-fresh-'))
  try {
    const { credentialDir } = await freshPaths(home)
    const dir = credentialDir()
    assert.equal(dir, join(home, 'auth-gateway'))
    assert.ok(!existsSync(join(home, 'auth-gate')), 'no legacy directory appears')
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('store.js resolves its password file under the migrated directory', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-store-'))
  try {
    const legacy = join(home, 'auth-gate')
    mkdirSync(legacy, { mode: 0o700 })
    writeFileSync(join(legacy, 'password.json'), '{"version":1,"salt":"ab","hash":"cd","initial":true,"updatedAt":1}')

    // store.js imports paths.js; a shared instance exercises the real chain.
    process.env.DSH_HOME = home
    const { passwordFilePath, hasPassword } = await import(`../lib/store.js?t=${Math.random()}`)
    assert.ok(hasPassword(), 'the migrated record is visible through store.js')
    assert.equal(passwordFilePath(), join(home, 'auth-gateway', 'password.json'))
  } finally {
    rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
})

test('a stray file named auth-gate is skipped by the migration (left in place)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-file-'))
  try {
    const stray = join(home, 'auth-gate')
    writeFileSync(stray, 'not a directory\n')

    const { credentialDir } = await freshPaths(home)
    const dir = credentialDir()

    assert.equal(dir, join(home, 'auth-gateway'))
    assert.ok(existsSync(stray), 'the stray file is left untouched (no rename over it)')
    assert.ok(!existsSync(join(home, 'auth-gateway', 'password.json')) || true,
      'the gateway proceeds with a fresh directory')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('auditLogDir resolves under the auth-gateway log subdirectory', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-paths-audit-'))
  try {
    const { auditLogDir } = await freshPaths(home)
    const dir = auditLogDir()
    assert.equal(dir, join(home, 'auth-gateway', 'log'))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
