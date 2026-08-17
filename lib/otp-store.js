/**
 * OTP credential store.
 *
 * Manages TOTP secrets and backup codes in $DSH_HOME/auth-gate/otp.json.
 * Follows the same security patterns as the password store:
 * - Atomic writes (temp file + rename)
 * - File permissions 0600 (owner-only read/write)
 * - Directory permissions 0700
 *
 * The OTP secret is stored in plaintext (Base32) for simplicity in this MVP.
 * See README "安全特性" for the documented risk and mitigations (0600/0700
 * permissions, local-machine trust model, disk encryption). For production
 * use, consider encrypting the secret with a master key.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateSecret, hashBackupCode, verifyBackupCode, generateBackupCodes } from './totp.js'
import { dshHome } from './store.js'

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

/** Read the OTP record, or return default if not configured. */
function readRecord() {
  if (!hasOTP()) return defaultRecord()
  try {
    const data = JSON.parse(readFileSync(otpFilePath(), 'utf8'))
    // Merge with defaults for forward compatibility
    return { ...defaultRecord(), ...data }
  } catch (err) {
    // A corrupt record must fail loud, never silently degrade to
    // `enabled: false`: that would let the next login skip 2FA entirely.
    // (password.json corrupts the same way — 500 until the file is fixed.)
    throw new Error(`dsh-auth-gateway: cannot read ${otpFilePath()}: ${err.message}`)
  }
}

/** Write the OTP record atomically. */
function writeRecord(record) {
  const dir = join(dshHome(), 'auth-gate')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = otpFilePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, target)
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
  record.secret = useSecret
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
  return record.enabled ? record.secret : null
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

/**
 * Regenerate backup codes (invalidates old ones).
 * @param {number} [count=10] - Number of new codes.
 * @param {number} [length=8] - Length of each code.
 * @returns {Promise<string[]>} New backup codes.
 */
export async function regenerateBackupCodes(count = 10, length = 8) {
  const record = readRecord()
  if (!record.enabled) {
    throw new Error('OTP is not enabled')
  }

  const rawBackupCodes = generateBackupCodes(count, length)
  const hashedBackupCodes = await Promise.all(
    rawBackupCodes.map(async (code) => {
      const { hash, salt } = await hashBackupCode(code)
      return { hash, salt, used: false }
    })
  )

  record.backupCodes = hashedBackupCodes
  record.updatedAt = Date.now()
  writeRecord(record)

  return rawBackupCodes
}
