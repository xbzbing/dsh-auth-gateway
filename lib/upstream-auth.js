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
 * The signing secret, however, is durable: dsh keeps it in the official
 * credential record `client-connection/browser-session` (kind grant,
 * payload.secret base64url, 32 bytes) precisely so cookies survive process
 * churn. The secret is read through the OFFICIAL channel — the injected
 * `credentials` service's readRecord(), the same seam dsh's own BrowserAuth
 * uses (initializeSecret/modifyRecord) — never by touching private file
 * formats (index.js owns the service wiring; see there for the 60s refresh).
 * This module validates the record (same criteria as dsh's storedSecret)
 * and mints the same cookie shape the upstream's own token exchange sets:
 *
 *   name  = `dsh-auth-<base64url(sha256(authority))>`
 *   value = `v1.<base64url(json payload)>.<base64url(hmac-sha256(secret, body))>`
 *   payload = { version: 1, authority, issuedAt, expiresAt }
 *
 * with authority being the loopback host:port we forward to (identical to
 * dsh's requestAuthority, which derives it from the rewritten Host header).
 * The upstream validates signature, authority and time window only — nothing
 * ties a minted cookie to the launch token — so a cookie minted here is
 * indistinguishable from one the browser earned legitimately.
 *
 * Security posture: the minted cookie exists only on the loopback
 * gateway→upstream hop (it is attached to proxied requests, never set in the
 * browser), and every request that reaches the forwarder has already passed
 * this gateway's password/OTP gate.
 *
 * Compatibility: on dsh ≤ 0.1.1 the record does not exist (no browser auth
 * upstream); the minter then yields nothing and forwarding stays verbatim.
 *
 * Pure node:crypto, zero dependencies. Never logs secret values.
 */

import { createHash, createHmac } from 'node:crypto'

/** dsh pins the browser-session cookie to exactly 32 secret bytes. */
const SECRET_BYTES = 32
/** Cookie payload version dsh's decoder accepts (COOKIE_PAYLOAD_VERSION). */
const PAYLOAD_VERSION = 1
/** Record kind dsh's storedSecret() demands for the browser-session grant. */
const RECORD_KIND = 'grant'
/** Cookie name prefix dsh derives from the authority hash. */
const COOKIE_PREFIX = 'dsh-auth-'
/** How long one minted cookie stays valid upstream (24h, conservative vs
 *  dsh's own 30-day default; the gateway re-mints transparently). */
const MINT_TTL_MS = 24 * 60 * 60 * 1000

/** base64url without padding, matching dsh's encodeBase64Url. */
function b64u(input) {
  return Buffer.from(input).toString('base64')
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

/**
 * Extract the 32-byte signing secret from the official credential record,
 * with the same acceptance criteria as dsh's own storedSecret(): kind
 * `grant`, payload version 1, base64url secret decoding to exactly 32
 * bytes. Anything else — including a missing record — yields undefined and
 * the caller degrades to verbatim forwarding.
 * @param {{ kind?: string, payload?: { version?: unknown, secret?: unknown } } | undefined} record
 * @returns {Buffer | undefined} the 32-byte secret, or undefined.
 */
export function extractSessionSecret(record) {
  if (typeof record !== 'object' || record === null) return undefined
  if (record.kind !== RECORD_KIND) return undefined
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  if (payload.version !== PAYLOAD_VERSION) return undefined
  if (typeof payload.secret !== 'string') return undefined
  if (!/^[A-Za-z0-9_-]*$/.test(payload.secret)) return undefined
  const secret = Buffer.from(
    payload.secret.replaceAll('-', '+').replaceAll('_', '/'), 'base64',
  )
  return secret.length === SECRET_BYTES ? secret : undefined
}

/**
 * Create a cookie minter bound to one upstream authority.
 * @param {string} authority - the loopback `host:port` requests forward to.
 * @param {() => (Buffer | undefined)} [readSecret] - synchronous secret
 *   source (the index.js cache over ctx.credentials.readRecord). Defaults
 *   to "never known" — forwarding stays verbatim.
 * @returns {{ cookieHeader: () => string | undefined }} call per request;
 *   undefined means "no secret known — forward verbatim" (dsh ≤ 0.1.1).
 */
export function createUpstreamCookieMinter(authority, readSecret) {
  let cookieValue
  let cookieExpiresAt = 0
  /** The secret the live cookie was minted with — a changed secret (dsh-side
   *  rotation) must re-mint immediately, or every request 401s until the
   *  full TTL lapses on a cookie the upstream can no longer verify. */
  let mintedWith
  const cookieName = COOKIE_PREFIX + b64u(createHash('sha256').update(authority).digest())

  const mint = (now, secret) => {
    const expiresAt = now + MINT_TTL_MS
    const body = b64u(JSON.stringify({
      version: PAYLOAD_VERSION,
      authority,
      issuedAt: now,
      expiresAt,
    }))
    const signature = createHmac('sha256', secret).update(body).digest()
    return { value: `v1.${body}.${b64u(signature)}`, expiresAt }
  }

  const cookieHeader = () => {
    const current = readSecret?.()
    if (current === undefined) {
      // No secret known (old dsh, or the record was just revoked): drop any
      // live cookie — attaching a stale one could only leak it verbatim.
      cookieValue = undefined
      mintedWith = undefined
      return undefined
    }
    // Reuse the live cookie instead of re-signing on every request; mint a
    // fresh one when it lapses OR when the upstream secret changed since it
    // was minted (clock backwards just re-mints, still valid).
    if (cookieValue === undefined
      || Date.now() >= cookieExpiresAt
      || mintedWith === undefined
      || !mintedWith.equals(current)) {
      const fresh = mint(Date.now(), current)
      cookieValue = fresh.value
      cookieExpiresAt = fresh.expiresAt
      mintedWith = current
    }
    return `${cookieName}=${cookieValue}`
  }

  return { cookieHeader }
}
