/**
 * Password credential store.
 *
 * Zero-dependency MVP store: scrypt-hashed password in a single JSON file
 * under $DSH_HOME/login-plugin/password.json (owner-only, atomic rename).
 * Brute-force protection is deliberately out of scope (see PROPOSAL.md §5).
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

/** Resolve the harness home the same way dsh does: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** Absolute path of the password record file. */
export function passwordFilePath() {
  return join(dshHome(), 'login-plugin', 'password.json')
}

/** Whether a password has been set yet (first-run detection). */
export function hasPassword() {
  return existsSync(passwordFilePath())
}

/**
 * Set (or replace) the password. Scrypt with a fresh random salt; the record
 * is written to a temp file and renamed into place so a crash never leaves a
 * half-written file.
 */
export function setPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  const record = {
    version: 1,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    updatedAt: Date.now(),
  }
  const dir = join(dshHome(), 'login-plugin')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = passwordFilePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, target)
}

/** Constant-time password check; false when no password is set yet. */
export function verifyPassword(password) {
  if (!hasPassword()) return false
  const record = JSON.parse(readFileSync(passwordFilePath(), 'utf8'))
  const salt = Buffer.from(record.salt, 'hex')
  const hash = Buffer.from(record.hash, 'hex')
  const candidate = scryptSync(password, salt, hash.length)
  return timingSafeEqual(candidate, hash)
}
