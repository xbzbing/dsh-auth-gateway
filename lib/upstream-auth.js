/**
 * Upstream browser-auth cookie for dsh ≥ 0.1.2.
 *
 * dsh 0.1.2 (0.1.2-alpha.2 onward) arms `BrowserAuth` on the internal
 * webserver: the index fallback and every /api route demand either the
 * process launch token (a one-shot `?token=` exchange) or a persistent,
 * authority-bound, HMAC-signed cookie. The browser behind this gateway holds
 * only the gateway's session cookie — it can never earn the upstream cookie
 * through that exchange — so forwarded requests would all 401 with
 * "dsh web authentication required; reopen the URL printed by dsh web".
 *
 * The signing secret, however, is durable: dsh stores it in
 * `$DSH_HOME/.credentials.yaml` under the record
 * `client-connection/browser-session` (kind grant, payload.secret base64url,
 * 32 bytes) and keeps it across restarts precisely so cookies survive
 * process churn. This module reads that secret and mints the same cookie
 * shape the upstream's own token exchange would set:
 *
 *   name  = `dsh-auth-<base64url(sha256(authority))>`
 *   value = `v1.<base64url(json payload)>.<base64url(hmac-sha256(secret, body))>`
 *   payload = { version: 1, authority, issuedAt, expiresAt }
 *
 * with authority being the loopback host:port we forward to. The upstream
 * validates signature, authority and time window only — nothing ties a minted
 * cookie to the launch token — so a cookie minted here is indistinguishable
 * from one the browser earned legitimately.
 *
 * Security posture: the minted cookie exists only on the loopback
 * gateway→upstream hop (it is attached to proxied requests, never set in the
 * browser), and every request that reaches the forwarder has already passed
 * this gateway's password/OTP gate. Reading the secret needs the same
 * filesystem position the gateway already occupies to manage its own
 * credentials under $DSH_HOME.
 *
 * Compatibility: on dsh ≤ 0.1.1 the record does not exist (no browser auth
 * upstream); the minter then yields nothing and forwarding stays verbatim.
 *
 * Pure node:crypto/fs, zero dependencies. The YAML scrape is deliberately
 * narrow — the file is machine-written by dsh with a fixed shape — and never
 * logs values.
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './paths.js'

/** dsh pins the browser-session cookie to exactly 32 secret bytes. */
const SECRET_BYTES = 32
/** Cookie payload version dsh's decoder accepts (COOKIE_PAYLOAD_VERSION). */
const PAYLOAD_VERSION = 1
/** Cookie name prefix dsh derives from the authority hash. */
const COOKIE_PREFIX = 'dsh-auth-'
/** How long one minted cookie stays valid upstream (24h, conservative vs
 *  dsh's own 30-day default; the gateway re-mints transparently). */
const MINT_TTL_MS = 24 * 60 * 60 * 1000
/** Re-read the secret at most this often, so a dsh-side rotation is picked
 *  up without a gateway restart. */
const SECRET_REFRESH_MS = 60 * 1000

/** base64url without padding, matching dsh's encodeBase64Url. */
function b64u(input) {
  return Buffer.from(input).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Scrape the browser-session secret out of $DSH_HOME/.credentials.yaml.
 *
 * The file is written by dsh's own `yaml` emitter with a stable layout:
 * top-level `records:` map, one entry per credential key. A full YAML parse
 * would need a dependency; instead this walks the block for the exact key and
 * reads its single-line `secret:` scalar. Base64url never needs YAML quoting,
 * so the raw capture is the decoded secret's exact spelling. Any structural
 * surprise returns undefined and the caller degrades to verbatim forwarding.
 * @returns {Buffer | undefined} the 32-byte secret, or undefined when absent.
 */
export function readBrowserSessionSecret(home = dshHome()) {
  let text
  try {
    text = readFileSync(join(home, '.credentials.yaml'), 'utf8')
  } catch {
    return undefined
  }
  const lines = text.split('\n')
  // Locate the record's mapping key at its exact nesting depth: the key is a
  // top-level entry under `records:` — zero indentation, quoted or bare.
  const keyRe = /^ {2}'?client-connection\/browser-session'?:\s*$/
  const start = lines.findIndex((line) => keyRe.test(line))
  if (start === -1) return undefined
  const secretRe = /^ {6}secret:\s*([A-Za-z0-9_-]+)\s*$/
  for (const line of lines.slice(start + 1, start + 20)) {
    // Stop at the next sibling record rather than scanning the whole file.
    if (/^ {2}\S/.test(line)) break
    const match = secretRe.exec(line)
    if (match) {
      const secret = Buffer.from(
        match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64',
      )
      return secret.length === SECRET_BYTES ? secret : undefined
    }
  }
  return undefined
}

/**
 * Create a cookie minter bound to one upstream authority.
 * @param {string} authority - the loopback `host:port` requests forward to.
 * @param {string} [home] - DSH home override (tests); defaults to dshHome().
 * @returns {{ cookieHeader: () => string | undefined }} call per request;
 *   undefined means "no secret known — forward verbatim" (dsh ≤ 0.1.1).
 */
export function createUpstreamCookieMinter(authority, home = dshHome()) {
  let cachedSecret
  let secretReadAt = 0
  let cookieValue
  let cookieExpiresAt = 0
  const cookieName = COOKIE_PREFIX + b64u(createHash('sha256').update(authority).digest())

  const secret = () => {
    if (cachedSecret === undefined || Date.now() - secretReadAt > SECRET_REFRESH_MS) {
      secretReadAt = Date.now()
      cachedSecret = readBrowserSessionSecret(home)
    }
    return cachedSecret
  }

  const mint = (now) => {
    const expiresAt = now + MINT_TTL_MS
    const body = b64u(JSON.stringify({
      version: PAYLOAD_VERSION,
      authority,
      issuedAt: now,
      expiresAt,
    }))
    const signature = createHmac('sha256', secret()).update(body).digest()
    return { value: `v1.${body}.${b64u(signature)}`, expiresAt }
  }

  const cookieHeader = () => {
    const current = secret()
    if (current === undefined) return undefined
    // Reuse the live cookie instead of re-signing on every request; mint a
    // fresh one when it lapses (clock backwards just re-mints, still valid).
    if (cookieValue === undefined || Date.now() >= cookieExpiresAt) {
      const fresh = mint(Date.now())
      cookieValue = fresh.value
      cookieExpiresAt = fresh.expiresAt
    }
    return `${cookieName}=${cookieValue}`
  }

  return { cookieHeader }
}
