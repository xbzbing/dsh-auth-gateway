/**
 * In-memory session tokens and cookie handling.
 *
 * Session model: a random 256-bit token per login, kept in process
 * memory with an expiry. dsh restart logs everyone out — an accepted
 * limitation (see docs/zh/SECURITY.md「已知限制」). Password changes revoke the
 * whole table.
 *
 * The Secure attribute is decided per response by the caller (the
 * `cookieSecure` config: 'auto' follows {@link requestIsSecure}, true/false
 * pin it) — see docs/zh/SECURITY.md「明文 HTTP」for the deployment trade-off.
 */

import { randomBytes } from 'node:crypto'

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const COOKIE_NAME = 'dsh_auth'

/** One live session. */
class Session {
  constructor(expiresAt) {
    this.expiresAt = expiresAt
    /** Temporary OTP secret during setup (not yet verified). */
    this.tempOTP = null
    /** Whether OTP verification has been completed for this session. */
    this.otpVerified = false
    /** Whether this session logged in with the auto-generated initial
     * password and still owes the onboarding step (set a new password). */
    this.needsOnboarding = false
  }
}

/** Session table owned by one gateway instance. */
export class SessionStore {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map()
  }

  /** Mint a new token (hex, 64 chars) valid for SESSION_TTL_SECONDS. */
  issue() {
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, new Session(Date.now() + SESSION_TTL_SECONDS * 1000))
    return token
  }

  /** True when the token exists and has not expired; lazy-expires. */
  isValid(token) {
    if (token === undefined) return false
    const session = this.sessions.get(token)
    if (session === undefined) return false
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  /** Drop one token (logout). */
  revoke(token) {
    this.sessions.delete(token)
  }

  /** Drop every token (password change). */
  revokeAll() {
    this.sessions.clear()
  }

  /** Set temporary OTP secret during setup. */
  setTempOTP(token, secret) {
    const session = this.sessions.get(token)
    if (session) {
      session.tempOTP = secret
    }
  }

  /** Get temporary OTP secret during setup. */
  getTempOTP(token) {
    const session = this.sessions.get(token)
    return session?.tempOTP || null
  }

  /** Clear temporary OTP secret after setup. */
  clearTempOTP(token) {
    const session = this.sessions.get(token)
    if (session) {
      session.tempOTP = null
    }
  }

  /** Mark session as OTP-verified. */
  markOTPVerified(token) {
    const session = this.sessions.get(token)
    if (session) {
      session.otpVerified = true
    }
  }

  /** Check if session has OTP verification completed. */
  isOTPVerified(token) {
    const session = this.sessions.get(token)
    return session?.otpVerified || false
  }

  /** Mark a session as logged in with the initial password (owes onboarding). */
  markNeedsOnboarding(token) {
    const session = this.sessions.get(token)
    if (session) {
      session.needsOnboarding = true
    }
  }

  /** Whether the session still owes the onboarding step. */
  isNeedsOnboarding(token) {
    const session = this.sessions.get(token)
    return session?.needsOnboarding || false
  }
}

/** Parse the Cookie header and return the dsh_auth value, if any. */
export function tokenFromCookieHeader(cookieHeader) {
  if (cookieHeader === undefined) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      return part.slice(eq + 1).trim() || undefined
    }
  }
  return undefined
}

/**
 * Whether this request reached the gateway over an encrypted link, as far as
 * the gateway can tell: a TLS socket of its own (`socket.encrypted`) or the
 * `X-Forwarded-Proto: https` a reverse proxy sets when it terminates TLS.
 *
 * The header is deliberately trusted without a trusted-proxy allowlist. It is
 * per-request and self-directed — a client forging `https` only makes its OWN
 * cookie Secure, which its plain-HTTP user agent then refuses to store (a
 * self-inflicted lockout), and forging `http` only downgrades that same
 * client. No cross-client gain exists, so there is nothing to fence off; a
 * multi-hop header list is read at the first (closest-proxy) entry.
 */
export function requestIsSecure(req) {
  if (req?.socket?.encrypted === true) return true
  const forwarded = req?.headers?.['x-forwarded-proto']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
  if (typeof first !== 'string') return false
  return first.split(',')[0].trim().toLowerCase() === 'https'
}

/** Set-Cookie value for a fresh token. HttpOnly + SameSite=Strict always;
 * `secure` adds the Secure attribute. Plain-HTTP deployments leave it off:
 * a Secure cookie is never sent back over http, so forcing it there would
 * break the login instead of protecting it. */
export function sessionCookie(token, secure = false) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`
}

/** Expired-cookie value used on logout. `secure` mirrors the attribute the
 * session cookie was set with, so the clearing cookie matches it. */
export function expiredCookie(secure = false) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}
