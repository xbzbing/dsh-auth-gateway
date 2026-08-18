/**
 * OTP secret encryption at rest.
 *
 * The TOTP secret is the root key of the second factor: whoever reads it can
 * generate valid codes. To stop a `$DSH_HOME` file disclosure from handing over
 * that key, the secret is sealed with AES-256-GCM before it is written to
 * otp.json. The master key is resolved (once, then cached) from, in order:
 *
 *   1. the environment variable `DSH_AUTH_GATEWAY_MASTER_KEY` (hex or base64);
 *   2. a per-deployment key file `auth-gate/otp-master.key` (0600), generated
 *      on first use (seal path only) if absent.
 *
 * The key file is generated only when sealing a freshly minted secret. When
 * unsealing an existing `v1.` ciphertext, a missing key is a hard error
 * ("master key missing") rather than a silent regeneration — regenerating
 * would write a mismatched key and then fail GCM auth on every request.
 *
 * The local-machine trust model still holds (a local user who can read
 * `$DSH_HOME` can read both the key file and the sealed blob). The real win is
 * when the operator supplies the master key via the environment on an
 * encrypted/secret volume, or rotates it out-of-band: the sealed secret in
 * otp.json is then useless without that key.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './store.js'

/** Env var that may carry the master key (hex or base64), overriding the key file. */
export const MASTER_KEY_ENV = 'DSH_AUTH_GATEWAY_MASTER_KEY'

/** Absolute path of the auto-generated master key file. */
export function masterKeyPath() {
  return join(dshHome(), 'auth-gate', 'otp-master.key')
}

const KEY_LEN = 32
const SEAL_PREFIX = 'v1.'

/** In-memory cache so the master key is resolved at most once per process. */
let cachedKey = null

/**
 * Resolve the 32-byte AES master key.
 *
 * Auto-generation of the key file only happens on the seal path (first OTP
 * enable, when there is no ciphertext to decrypt yet). On the unseal path
 * `generateIfMissing` must be `false`: if a sealed `otp.json` exists but the
 * key (env or file) is missing — e.g. a backup restore that copied only
 * `otp.json` — generating a fresh key would silently write a mismatched key
 * file and then fail GCM authentication on every request, masking the real
 * "master key missing" root cause. In that case we throw instead.
 *
 * @param {{ generateIfMissing?: boolean }} [opts]
 * @returns {Buffer} the master key.
 */
export function getMasterKey({ generateIfMissing = true } = {}) {
  if (cachedKey && cachedKey.length === KEY_LEN) return cachedKey

  // 1. Environment override (operator-managed secret).
  const envVal = process.env[MASTER_KEY_ENV]
  if (envVal && envVal.length > 0) {
    const key = decodeKey(envVal)
    if (key.length !== KEY_LEN) {
      throw new Error(
        `dsh-auth-gateway: ${MASTER_KEY_ENV} must decode to ${KEY_LEN} bytes, got ${key.length}`,
      )
    }
    cachedKey = key
    return cachedKey
  }

  // 2. Per-deployment key file.
  const path = masterKeyPath()
  if (existsSync(path)) {
    const key = readFileSync(path)
    if (key.length !== KEY_LEN) {
      throw new Error(`dsh-auth-gateway: master key file ${path} must be ${KEY_LEN} bytes, got ${key.length}`)
    }
    cachedKey = key
    return cachedKey
  }

  if (!generateIfMissing) {
    throw new Error(
      `dsh-auth-gateway: master key missing (no ${MASTER_KEY_ENV} and no key file ${path}); ` +
        'cannot decrypt OTP secret. Restore the key file / set the env var, or delete otp.json to re-bind.',
    )
  }

  // 3. First use (seal path only): generate and persist a new key file.
  const key = randomBytes(KEY_LEN)
  const dir = join(dshHome(), 'auth-gate')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(path, key, { mode: 0o600 })
  cachedKey = key
  return cachedKey
}

/**
 * Decode a master key from an env var value (hex or base64).
 * @param {string} value
 * @returns {Buffer}
 */
function decodeKey(value) {
  const trimmed = value.trim()
  if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, 'hex')
  }
  return Buffer.from(trimmed, 'base64')
}

/**
 * Seal a plaintext string with AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} `v1.<ivHex>.<tagHex>.<cipherHex>`
 */
export function seal(plaintext) {
  const key = getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${SEAL_PREFIX}${iv.toString('hex')}.${tag.toString('hex')}.${ciphertext.toString('hex')}`
}

/**
 * Unseal a token produced by {@link seal}.
 * @param {string} token
 * @returns {string} the plaintext.
 * @throws {Error} if the token is malformed or fails authentication.
 */
export function unseal(token) {
  if (typeof token !== 'string' || !token.startsWith(SEAL_PREFIX)) {
    throw new Error('dsh-auth-gateway: malformed sealed secret')
  }
  const parts = token.slice(SEAL_PREFIX.length).split('.')
  if (parts.length !== 3) {
    throw new Error('dsh-auth-gateway: malformed sealed secret')
  }
  const [ivHex, tagHex, ctHex] = parts
  const key = getMasterKey({ generateIfMissing: false })
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
}

/** Whether a stored secret value is a sealed blob (vs legacy plaintext). */
export function isSealed(value) {
  return typeof value === 'string' && value.startsWith(SEAL_PREFIX)
}

/** Reset the cached master key (test helper). */
export function _resetMasterKeyCache() {
  cachedKey = null
}
