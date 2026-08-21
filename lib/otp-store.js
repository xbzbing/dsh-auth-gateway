/**
 * OTP credential store.
 *
 * Manages TOTP secrets and backup codes in $DSH_HOME/auth-gate/otp.json.
 * Follows the same security patterns as the password store:
 * - Atomic writes (temp file + rename)
 * - File permissions 0600 (owner-only read/write)
 * - Directory permissions 0700
 *
 * The OTP secret is sealed at rest with AES-256-GCM (see lib/otp-crypto.js)
 * before being written to otp.json, so a `$DSH_HOME` file disclosure does not
 * hand over the second-factor root key. The master key lives in the
 * environment (`DSH_AUTH_GATEWAY_MASTER_KEY`) or an 0600 key file; both follow
 * the local-machine trust model documented in README "安全特性".
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateSecret, hashBackupCode, verifyBackupCode, generateBackupCodes } from './totp.js'
import { dshHome } from './store.js'
import { seal, unseal, isSealed, OTPCryptoError } from './otp-crypto.js'

/** Absolute path of the OTP record file. */
export function otpFilePath() {
  return join(dshHome(), 'auth-gate', 'otp.json')
}

/** Whether OTP has been configured. */
export function hasOTP() {
  return existsSync(otpFilePath())
}

/** Default OTP record structure. */
function defaultRecord() {
  return {
    version: 1,
    enabled: false,
    secret: null,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    backupCodes: [],
    lastCounter: null,
    createdAt: null,
    updatedAt: null,
  }
}

/**
 * Parsed-record cache keyed by (mtimeMs, size). `#otpActive()` runs on every
 * authenticated request's gate, so re-reading and re-parsing otp.json each
 * time puts synchronous FS work on the hot path; the cache keeps one stat()
 * per read instead of a full read+parse. The key makes externally modified
 * files (tests, manual edits) visible immediately — mtime or size change
 * forces a re-read.
 */
let recordCache = null

/** Read the OTP record, or return default if not configured. */
function readRecord() {
  if (!hasOTP()) {
    recordCache = null
    return defaultRecord()
  }
  const path = otpFilePath()
  const st = statSync(path)
  const key = `${st.mtimeMs}:${st.size}`
  if (recordCache !== null && recordCache.key === key) return recordCache.record
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    // Merge with defaults for forward compatibility
    const record = { ...defaultRecord(), ...data }
    recordCache = { key, record }
    return record
  } catch (err) {
    // A corrupt record must fail loud, never silently degrade to
    // `enabled: false`: that would let the next login skip 2FA entirely.
    // (password.json corrupts the same way — 500 until the file is fixed.)
    // Parse failures are not cached — every request re-reads and re-throws.
    throw new Error(`dsh-auth-gateway: cannot read ${path}: ${err.message}`)
  }
}

/** Write the OTP record atomically and refresh the cache. */
function writeRecord(record) {
  const dir = join(dshHome(), 'auth-gate')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = otpFilePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, target)
  const st = statSync(target)
  recordCache = { key: `${st.mtimeMs}:${st.size}`, record }
}

/**
 * Enable OTP and generate a new secret.
 * @param {object} [options] - Configuration options.
 * @param {string} [options.secret] - Base32 secret to persist. When omitted, a
 *   fresh secret is generated. Pass the already-verified setup secret here so
 *   the stored secret matches the one the user scanned in the QR code.
 * @param {string} [options.algorithm='SHA1'] - Hash algorithm.
 * @param {number} [options.digits=6] - Number of digits.
 * @param {number} [options.period=30] - Time step in seconds.
 * @param {number} [options.backupCodeCount=10] - Number of backup codes.
 * @param {number} [options.backupCodeLength=8] - Length of backup codes.
 * @returns {{ secret: string, backupCodes: string[] }} The new secret and backup codes.
 */
export async function enableOTP(options = {}) {
  const {
    secret = null,
    algorithm = 'SHA1',
    digits = 6,
    period = 30,
    backupCodeCount = 10,
    backupCodeLength = 8,
  } = options

  if (hasOTP()) {
    const record = readRecord()
    if (record.enabled) {
      throw new Error('OTP is already enabled')
    }
  }

  const useSecret = secret || generateSecret()
  const rawBackupCodes = generateBackupCodes(backupCodeCount, backupCodeLength)

  // Hash backup codes for storage
  const hashedBackupCodes = await Promise.all(
    rawBackupCodes.map(async (code) => {
      const { hash, salt } = await hashBackupCode(code)
      return { hash, salt, used: false }
    })
  )

  const record = readRecord()
  record.enabled = true
  record.secret = seal(useSecret)
  record.algorithm = algorithm
  record.digits = digits
  record.period = period
  record.backupCodes = hashedBackupCodes
  record.createdAt = record.createdAt || Date.now()
  record.updatedAt = Date.now()
  writeRecord(record)

  return { secret: useSecret, backupCodes: rawBackupCodes }
}

/**
 * Disable OTP and clear all data.
 */
export function disableOTP() {
  if (!hasOTP()) return

  const record = readRecord()
  if (!record.enabled) return

  // If OTP is required for disabling, verify here
  // (The caller should handle verification before calling this function)

  // Fully clear the record so hasOTP() reports false again
  try {
    unlinkSync(otpFilePath())
    rmSync(`${otpFilePath()}.tmp`, { force: true })
    recordCache = null
  } catch {
    // best effort — file may already be gone
  }
}

/**
 * Get OTP configuration (without the secret for security).
 * @returns {object} OTP status and configuration.
 */
export function getOTPStatus() {
  const record = readRecord()
  return {
    enabled: record.enabled,
    algorithm: record.algorithm,
    digits: record.digits,
    period: record.period,
    backupCodesCount: record.backupCodes.filter(bc => !bc.used).length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Get the OTP secret (for verification).
 * @returns {string|null} The Base32 encoded secret, or null if not enabled.
 */
export function getOTPSecret() {
  const record = readRecord()
  if (!record.enabled || !record.secret) return null
  // Legacy plaintext records (pre-encryption) are returned as-is; sealed blobs
  // are decrypted with the master key. Crypto failures are categorised into a
  // typed error so the gateway maps them to JSON codes (otp-master-key-missing
  // / otp-secret-corrupted) instead of a bare 500. readRecord() errors (e.g. a
  // corrupt otp.json) are left to bubble as-is — they must fail loud.
  if (!isSealed(record.secret)) return record.secret
  try {
    return unseal(record.secret)
  } catch (err) {
    if (err instanceof OTPCryptoError) throw err
    throw new OTPCryptoError(
      'otp-secret-corrupted',
      `dsh-auth-gateway: failed to unseal OTP secret: ${err.message}`,
    )
  }
}

/**
 * Get the highest time-step counter already accepted for this secret
 * (anti-replay watermark).
 * @returns {number|null} The last accepted TOTP counter, or null.
 */
export function getLastCounter() {
  const record = readRecord()
  return record.enabled ? (record.lastCounter ?? null) : null
}

/**
 * Record the highest time-step counter accepted for this secret.
 * @param {number} counter - The accepted TOTP counter.
 */
export function setLastCounter(counter) {
  const record = readRecord()
  if (!record.enabled) return
  if (typeof counter !== 'number' || !Number.isFinite(counter)) return
  if (record.lastCounter !== null && counter <= record.lastCounter) return
  record.lastCounter = counter
  record.updatedAt = Date.now()
  writeRecord(record)
}

/**
 * Verify a backup code and mark it as used.
 * @param {string} code - Backup code to verify.
 * @returns {Promise<boolean>} Whether the code was valid and unused.
 */
export async function verifyAndUseBackupCode(code) {
  const record = readRecord()
  if (!record.enabled) return false

  for (let i = 0; i < record.backupCodes.length; i++) {
    const bc = record.backupCodes[i]
    if (bc.used) continue

    const isValid = await verifyBackupCode(code, bc.hash, bc.salt)
    if (isValid) {
      // Mark as used
      record.backupCodes[i].used = true
      record.updatedAt = Date.now()
      writeRecord(record)
      return true
    }
  }

  return false
}
