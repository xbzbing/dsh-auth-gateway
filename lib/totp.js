/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Zero-dependency implementation using only Node.js built-in crypto module.
 * Compliant with RFC 6238 (TOTP) and RFC 4226 (HOTP).
 *
 * Features:
 * - Base32 encoding/decoding (RFC 4648)
 * - TOTP code generation and verification
 * - otpauth:// URI generation for authenticator apps
 * - Backup code generation
 * - Timing-safe comparison
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Base32 encode a buffer (RFC 4648).
 * @param {Buffer} buffer - Input bytes.
 * @returns {string} Base32 encoded string.
 */
export function base32Encode(buffer) {
  let bits = ''
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0')
  }
  let result = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    result += BASE32_CHARS[parseInt(chunk, 2)]
  }
  return result
}

/**
 * Base32 decode a string (RFC 4648).
 * @param {string} str - Base32 encoded string.
 * @returns {Buffer} Decoded bytes.
 */
export function base32Decode(str) {
  str = str.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const char of str) {
    const val = BASE32_CHARS.indexOf(char)
    if (val === -1) throw new Error(`Invalid base32 character: ${char}`)
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  }
  return Buffer.from(bytes)
}

/**
 * Generate a random TOTP secret.
 * @param {number} length - Number of random bytes (default 20 = 160 bits).
 * @returns {string} Base32 encoded secret.
 */
export function generateSecret(length = 20) {
  return base32Encode(randomBytes(length))
}

/**
 * Compute the time counter as a Buffer (64-bit big-endian).
 * @param {number} timestamp - Current time in milliseconds.
 * @param {number} period - Time step in seconds (default 30).
 * @param {number} epoch - TOTP epoch in seconds (default 0).
 * @returns {Buffer} 8-byte big-endian counter.
 */
function getTimeCounter(timestamp, period = 30, epoch = 0) {
  const T = Math.floor((timestamp / 1000 - epoch) / period)
  const buf = Buffer.alloc(8)
  // Write as big-endian 64-bit int
  buf.writeUInt32BE(Math.floor(T / 0x100000000), 0)
  buf.writeUInt32BE(T >>> 0, 4)
  return buf
}

/**
 * HMAC-based truncation (RFC 4226 §5.4).
 * @param {Buffer} hmac - HMAC digest.
 * @param {number} digits - Number of digits in output (default 6).
 * @returns {string} Zero-padded code.
 */
function hotpTruncate(hmac, digits = 6) {
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % Math.pow(10, digits)
  return code.toString().padStart(digits, '0')
}

/**
 * Generate a TOTP code.
 * @param {string} secret - Base32 encoded secret.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.digits=6] - Number of digits.
 * @param {number} [options.period=30] - Time step in seconds.
 * @param {string} [options.algorithm='sha1'] - Hash algorithm.
 * @param {number} [options.timestamp=Date.now()] - Current time in ms.
 * @param {number} [options.epoch=0] - TOTP epoch in seconds.
 * @returns {string} TOTP code.
 */
export function generateTOTP(secret, options = {}) {
  const {
    digits = 6,
    period = 30,
    algorithm = 'sha1',
    timestamp = Date.now(),
    epoch = 0
  } = options

  const key = base32Decode(secret)
  const counter = getTimeCounter(timestamp, period, epoch)
  const hmac = createHmac(algorithm, key).update(counter).digest()
  return hotpTruncate(hmac, digits)
}

/**
 * Verify a TOTP code with time window tolerance.
 * @param {string} secret - Base32 encoded secret.
 * @param {string} token - Code to verify.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.window=1] - Number of time steps to check on each side.
 * @param {number} [options.digits=6] - Number of digits.
 * @param {number} [options.period=30] - Time step in seconds.
 * @param {string} [options.algorithm='sha1'] - Hash algorithm.
 * @param {number} [options.timestamp=Date.now()] - Current time in ms.
 * @param {number} [options.epoch=0] - TOTP epoch in seconds.
 * @param {number|null} [options.lastCounter=null] - Highest time-step counter
 *   already accepted for this secret. A code whose counter is <= lastCounter
 *   is rejected (replay protection) even though it falls inside the window.
 * @returns {{ valid: boolean, delta: number|null, counter: number|null }}
 *   Verification result; counter is the accepted time-step counter (null on
 *   failure).
 */
export function verifyTOTP(secret, token, options = {}) {
  const {
    window = 1,
    digits = 6,
    period = 30,
    algorithm = 'sha1',
    timestamp = Date.now(),
    epoch = 0,
    lastCounter = null,
  } = options

  if (typeof token !== 'string' || token.length !== digits) {
    return { valid: false, delta: null, counter: null }
  }

  for (let i = -window; i <= window; i++) {
    const adjustedTime = timestamp + (i * period * 1000)
    const expected = generateTOTP(secret, {
      digits, period, algorithm, timestamp: adjustedTime, epoch
    })

    // Constant-time comparison
    try {
      if (timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
        // Numeric time-step counter (getTimeCounter() returns the 8-byte
        // Buffer used as HMAC input; the watermark needs the number).
        const counter = Math.floor((timestamp / 1000 - epoch) / period) + i
        if (typeof lastCounter === 'number' && counter <= lastCounter) {
          // The code matches a time step that was already used — replay.
          return { valid: false, delta: i, counter }
        }
        return { valid: true, delta: i, counter }
      }
    } catch {
      // Ignore timingSafeEqual errors (different lengths)
    }
  }
  return { valid: false, delta: null, counter: null }
}

/**
 * Generate otpauth:// URI for authenticator apps.
 * @param {string} secret - Base32 encoded secret.
 * @param {object} [options] - Configuration options.
 * @param {string} [options.issuer='dsh-auth-gateway'] - Issuer name.
 * @param {string} [options.account='user'] - Account name.
 * @param {string} [options.algorithm='SHA1'] - Hash algorithm.
 * @param {number} [options.digits=6] - Number of digits.
 * @param {number} [options.period=30] - Time step in seconds.
 * @returns {string} otpauth:// URI.
 */
export function generateOTPAuthURI(secret, options = {}) {
  const {
    issuer = 'dsh-auth-gateway',
    account = 'user',
    algorithm = 'SHA1',
    digits = 6,
    period = 30
  } = options

  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm,
    digits: digits.toString(),
    period: period.toString()
  })

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params.toString()}`
}

/**
 * Generate cryptographically secure backup codes.
 * @param {number} count - Number of codes to generate (default 10).
 * @param {number} length - Length of each code (default 8).
 * @returns {string[]} Array of formatted backup codes (XXXX-XXXX).
 */
export function generateBackupCodes(count = 10, length = 8) {
  // Remove confusing characters: i, l, o, 0, 1
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const codes = []

  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(length)
    let code = ''
    for (let j = 0; j < length; j++) {
      code += alphabet[bytes[j] % alphabet.length]
    }
    // Format as XXXX-XXXX for readability
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }

  return codes
}

/**
 * Hash a backup code for storage.
 * @param {string} code - Backup code (with or without dash).
 * @returns {{ hash: string, salt: string }} Hashed code with salt.
 */
export async function hashBackupCode(code) {
  const { scrypt } = await import('node:crypto')
  const normalizedCode = code.replace('-', '')
  const salt = randomBytes(16)

  return new Promise((resolve, reject) => {
    scrypt(normalizedCode, salt, 32, (err, key) => {
      if (err) reject(err)
      else resolve({
        hash: key.toString('hex'),
        salt: salt.toString('hex')
      })
    })
  })
}

/**
 * Verify a backup code against stored hash.
 * @param {string} code - Backup code to verify.
 * @param {string} storedHash - Stored hash (hex).
 * @param {string} storedSalt - Stored salt (hex).
 * @returns {Promise<boolean>} Whether the code matches.
 */
export async function verifyBackupCode(code, storedHash, storedSalt) {
  const { scrypt } = await import('node:crypto')
  const normalizedCode = code.replace('-', '')
  const salt = Buffer.from(storedSalt, 'hex')

  return new Promise((resolve, reject) => {
    scrypt(normalizedCode, salt, 32, (err, key) => {
      if (err) reject(err)
      else resolve(timingSafeEqual(key, Buffer.from(storedHash, 'hex')))
    })
  })
}
