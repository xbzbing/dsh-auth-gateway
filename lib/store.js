/**
 * Password credential store.
 *
 * Zero-dependency store: scrypt-hashed password in a single JSON file
 * under $DSH_HOME/auth-gate/password.json (owner-only, atomic rename).
 * Scrypt runs on the async pool (never scryptSync): a synchronous CPU-bound
 * hash on every login would block the whole dsh process when attackers
 * hammer /login/auth.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

/** Resolve the harness home the same way dsh does: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** Absolute path of the password record file. */
export function passwordFilePath() {
  return join(dshHome(), 'auth-gate', 'password.json')
}

/** Whether a password has been set yet (first-run detection). */
export function hasPassword() {
  return existsSync(passwordFilePath())
}

/** Async scrypt over the libuv thread pool (non-blocking). */
function scryptHash(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

/**
 * Set (or replace) the password. Scrypt with a fresh random salt; the record
 * is written to a temp file and renamed into place so a crash never leaves a
 * half-written file.
 * @param {string} password - the new password.
 * @param {object} [options] - `{ initial }`: mark the record as the
 *   auto-generated first-run credential (sessions logged in with it are
 *   forced through the onboarding flow until the password is replaced).
 */
export async function setPassword(password, options = {}) {
  const salt = randomBytes(16)
  const hash = await scryptHash(password, salt, 64)
  const record = {
    version: 1,
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    initial: options.initial === true,
    updatedAt: Date.now(),
  }
  const dir = join(dshHome(), 'auth-gate')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = passwordFilePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, target)
}

/** Constant-time password check; false when no password is set yet. */
export async function verifyPassword(password) {
  if (!hasPassword()) return false
  const record = JSON.parse(readFileSync(passwordFilePath(), 'utf8'))
  const salt = Buffer.from(record.salt, 'hex')
  const hash = Buffer.from(record.hash, 'hex')
  const candidate = await scryptHash(password, salt, hash.length)
  return timingSafeEqual(candidate, hash)
}

/** Whether the current password is the auto-generated first-run credential. */
export function isInitialPassword() {
  if (!hasPassword()) return false
  const record = JSON.parse(readFileSync(passwordFilePath(), 'utf8'))
  return record.initial === true
}

/**
 * Generate a first-run password that satisfies the default policy
 * (8+ chars, mixed case or special) — 16 chars, uppercase/lowercase/digit +
 * special, unambiguous alphabet.
 * @returns {string} the plaintext initial password.
 */
export function generateInitialPassword() {
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  const digit = '23456789'
  const special = '!@#$%^&*-_=+'
  const all = lower + upper + digit + special
  const pick = (set) => set[randomBytes(1)[0] % set.length]
  // Guarantee one of each class, then fill randomly; shuffle lightly.
  let pw = pick(lower) + pick(upper) + pick(digit) + pick(special)
  while (pw.length < 16) pw += pick(all)
  const chars = pw.split('')
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
