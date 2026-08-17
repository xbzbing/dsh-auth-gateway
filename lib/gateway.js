/**
 * Login gateway: the single external HTTP/WebSocket surface.
 *
 * Every request passes the auth check first; authenticated traffic is
 * forwarded verbatim (Host/Origin headers preserved — the internal trust
 * fence depends on them) to the upstream dsh webserver. Unauthenticated
 * requests are refused: /api/* answers 401 JSON, page-like paths redirect
 * to /login, WebSocket upgrades are rejected by destroying the socket.
 *
 * Pure node:http, zero dependencies.
 */

import http from 'node:http'
import os from 'node:os'
import { URL } from 'node:url'
import { SessionStore, sessionCookie, expiredCookie, tokenFromCookieHeader } from './auth.js'
import { hasPassword, setPassword, verifyPassword } from './store.js'
import { validatePasswordStrength } from './policy.js'
import { loginPageHtml } from './login-page.js'
import { hasOTP, getOTPStatus, getOTPSecret, getLastCounter, setLastCounter, enableOTP, disableOTP, verifyAndUseBackupCode } from './otp-store.js'
import { verifyTOTP, generateOTPAuthURI, generateSecret } from './totp.js'
import { otpSetupPage, otpVerifyPage } from './otp-page.js'
import { generateQRSvg } from './qr-svg.js'

const MAX_BODY_BYTES = 1024 * 1024 // auth payloads are tiny; bound the read

/** One gateway instance bound to a listen address and an upstream target. */
export class LoginGateway {
  /**
   * @param {object} options
   * @param {string} options.listenHost - external bind host (usually 0.0.0.0)
   * @param {number} options.listenPort - external port (usually the original web port)
   * @param {string} options.upstreamHost - internal dsh webserver host (127.0.0.1)
   * @param {number} options.upstreamPort - internal dsh webserver port
   * @param {object} [options.policy] - password strength and lockout policy
   *   (resolved plugin config: minPasswordLength, requireMixedCase,
   *   maxLoginFailures, lockMinutes).
   */
  constructor({ listenHost, listenPort, upstreamHost, upstreamPort, policy = {}, otp = {} }) {
    this.listenHost = listenHost
    this.listenPort = listenPort
    this.upstreamHost = upstreamHost
    this.upstreamPort = upstreamPort
    this.policy = policy
    this.otp = otp
    this.sessions = new SessionStore()
    /** Failed-login tracker: client address -> { count, lockedUntil }. Public
     * only so tests can simulate lock expiry; not part of the API. */
    this.attempts = new Map()
    /** Global auth rate-limit window: { windowStart, count, notified }. */
    this.globalAuth = null
    /** OTP-verify rate-limit windows: client address -> { windowStart, count, notified }. */
    this.otpWindows = new Map()
    /**
     * Security-event sink, set by the plugin: fires on lockouts and global
     * rate-limit exhaustion with a JSON-safe payload ({kind, ...}). The
     * plugin logs it and emits it as a Cordis event.
     * @type {(payload: object) => void | undefined}
     */
    this.onSecurityEvent = undefined
    this.server = http.createServer((req, res) => this.#handleHttp(req, res))
    this.server.on('upgrade', (req, socket, head) => this.#handleUpgrade(req, socket, head))
    this.server.on('error', (err) => { this.onError?.(err) })
  }

  /** Bind and listen. Rejects (fail loud) when the port is taken. */
  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.listenPort, this.listenHost, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
  }

  /** Close the listener (and current connections); awaited by the plugin teardown. */
  close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections()
    })
  }

  /** Host:port of the bound socket, for diagnostics. */
  address() {
    return this.server.address()
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async #handleHttp(req, res) {
    try {
      await this.#route(req, res)
    } catch (err) {
      this.onError?.(err)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('internal error')
      } else {
        res.destroy()
      }
    }
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async #route(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname

    // Auth API + login page are served directly by the gateway.
    if (req.method === 'GET' && pathname === '/login') {
      return this.#serveLoginPage(req, res)
    }
    if (req.method === 'POST' && pathname === '/login/setup') {
      return this.#handleSetup(req, res)
    }
    if (req.method === 'POST' && pathname === '/login/auth') {
      return this.#handleAuth(req, res)
    }
    if (req.method === 'POST' && pathname === '/login/change') {
      return this.#handleChange(req, res)
    }
    if (req.method === 'POST' && pathname === '/login/logout') {
      return this.#handleLogout(req, res)
    }

    // Settings API — under a plugin-specific prefix: dsh reserves /api/* for
    // its own RPC namespace (dsh-client-connection), so a bare /api/settings
    // could shadow a future internal method. Read-only: the plugin config is
    // boot-time composition (bundle/profile patches), not a runtime surface.
    if (req.method === 'GET' && pathname === '/login-api/settings') {
      return this.#handleGetSettings(req, res)
    }

    // OTP routes
    if (req.method === 'GET' && pathname === '/otp/setup') {
      return this.#serveOTPSetupPage(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/enable') {
      return this.#handleOTPEnable(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify-setup') {
      return this.#handleOTPVerifySetup(req, res)
    }
    if (req.method === 'GET' && pathname === '/otp/verify') {
      return this.#serveOTPVerifyPage(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify') {
      return this.#handleOTPVerify(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify-backup') {
      return this.#handleOTPVerifyBackup(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/disable') {
      return this.#handleOTPDisable(req, res)
    }

    // Everything else: the auth gate, then transparent forwarding.
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      if (pathname.startsWith('/api')) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }))
      } else {
        res.writeHead(302, { location: '/login' })
        res.end()
      }
      return
    }

    // Check if OTP verification is required but not completed
    const otpEnabled = this.#otpActive()
    if (otpEnabled && !this.sessions.isOTPVerified(token)) {
      // Redirect to OTP verification page
      if (pathname.startsWith('/api')) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'otp-required' }))
      } else {
        res.writeHead(302, { location: '/otp/verify' })
        res.end()
      }
      return
    }

    this.#forward(req, res)
  }

  /** GET /login — render setup / login / change-password page by state. */
  #serveLoginPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    const otpEnabled = this.#otpActive()
    // A session counts as "logged in" for the change-password page only when
    // it is fully verified; an unverified session (OTP active) sees the auth
    // form instead, since it cannot perform management actions yet.
    const verified = this.sessions.isValid(token) && !(otpEnabled && !this.sessions.isOTPVerified(token))
    const mode = !hasPassword() ? 'setup'
      : verified ? 'change'
        : 'auth'
    const html = loginPageHtml({ mode, otpEnabled, digits: this.otp.otpDigits || 6 })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /** POST /login/setup — first-run password creation (refused once set). */
  async #handleSetup(req, res) {
    if (hasPassword()) {
      return this.#json(res, 409, { ok: false, error: 'already-setup' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { password } = body
    if (typeof password !== 'string' || password.length === 0) {
      return this.#json(res, 400, { ok: false, error: 'password-required' })
    }
    const strength = validatePasswordStrength(password, this.policy)
    if (!strength.ok) {
      return this.#json(res, 400, { ok: false, error: strength.reason })
    }
    await setPassword(password)
    const token = this.sessions.issue()
    this.#json(res, 200, { ok: true }, sessionCookie(token))
  }

  /**
   * POST /login/auth — verify password, mint a session. Three rate layers:
   * 1. a GLOBAL per-minute attempt budget (defends against multi-IP
   *    hammering of the scrypt cost, which per-IP counters cannot);
   * 2. per-client-address lockout after `maxLoginFailures` for `lockMinutes`;
   * 3. async scrypt on the libuv pool, so a flood never blocks the event
   *    loop (the gateway keeps serving authenticated traffic).
   */
  async #handleAuth(req, res) {
    const now = Date.now()
    if (!this.#globalAuthAllowed(now)) {
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { password, otp } = body
    const key = req.socket.remoteAddress ?? 'unknown'
    const maxFailures = this.policy.maxLoginFailures ?? 5
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000

    let entry = this.attempts.get(key)
    if (entry !== undefined) {
      if (entry.lockedUntil > now) {
        // Locked: refuse even the correct password until the window passes.
        const retryAfter = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000))
        return this.#json(res, 429, { ok: false, error: 'too-many-attempts', retryAfterSeconds: retryAfter })
      }
      // Only an entry that HAD locked (lockedUntil > 0) is expired here; a
      // fresh counter (0) must survive to keep counting failures.
      if (entry.lockedUntil > 0 && entry.lockedUntil <= now) this.attempts.delete(key)
    }

    if (typeof password !== 'string' || !await verifyPassword(password)) {
      // One uniform 401: never reveal whether a password exists or which part failed.
      entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0 }
      entry.count += 1
      if (entry.count >= maxFailures) {
        entry.lockedUntil = now + lockMs
        entry.count = 0 // recount after the window passes
        this.attempts.set(key, entry)
        // Security event: one alert per lockout (subsequent attempts inside
        // the lock window are refused by the branch above, not re-notified).
        this.onSecurityEvent?.({
          kind: 'lockout',
          sourceAddress: key,
          maxFailures,
          lockedUntil: entry.lockedUntil,
        })
        return this.#json(res, 429, {
          ok: false, error: 'too-many-attempts', retryAfterSeconds: Math.ceil(lockMs / 1000),
        })
      }
      this.attempts.set(key, entry)
      return this.#json(res, 401, { ok: false, error: 'invalid-password' })
    }
    this.attempts.delete(key) // success clears the failure counter

    // Check if OTP is enabled and required
    const otpEnabled = this.#otpActive()
    const otpRequired = this.otp.otpRequired || otpEnabled

    if (otpRequired && otpEnabled) {
      // OTP is required, verify the OTP code
      if (typeof otp !== 'string' || otp.length !== (this.otp.otpDigits || 6)) {
        return this.#json(res, 400, { ok: false, error: 'otp-required' })
      }
      // A correct password with a wrong OTP never hits the lockout counter
      // above, so cap OTP guesses per address with the OTP budget too.
      if (!this.#otpVerifyAllowed(key, now)) {
        return this.#json(res, 429, { ok: false, error: 'rate-limited' })
      }

      const secret = getOTPSecret()
      if (!secret) {
        return this.#json(res, 500, { ok: false, error: 'otp-secret-missing' })
      }

      if (!this.#verifyOtp(secret, otp, key)) {
        return this.#json(res, 401, { ok: false, error: 'invalid-otp' })
      }

      // Both password and OTP verified - issue session as fully verified
      const token = this.sessions.issue()
      this.sessions.markOTPVerified(token)
      return this.#json(res, 200, { ok: true }, sessionCookie(token))
    }

    const token = this.sessions.issue()
    this.#json(res, 200, { ok: true }, sessionCookie(token))
  }

  /**
   * Global sliding-minute auth budget: caps total /login/auth attempts across
   * ALL source addresses, so rotating IPs cannot saturate the scrypt cost.
   * Emits a `global-rate-limit` security event once per window when the
   * budget is exhausted (consumers get one alert per burst, not per request).
   * @returns whether the attempt is inside the budget.
   */
  #globalAuthAllowed(now) {
    const limit = this.policy.maxGlobalAuthAttemptsPerMinute ?? 60
    const windowMs = 60 * 1000
    const state = this.globalAuth ?? { windowStart: now, count: 0, notified: false }
    if (now - state.windowStart >= windowMs) {
      state.windowStart = now
      state.count = 0
      state.notified = false
    }
    state.count += 1
    this.globalAuth = state
    if (state.count > limit && !state.notified) {
      state.notified = true
      this.onSecurityEvent?.({ kind: 'global-rate-limit', limit, windowSeconds: 60 })
    }
    return state.count <= limit
  }

  /**
   * Per-client-address sliding-window budget for OTP verification attempts
   * (/otp/verify, /otp/verify-backup, /otp/verify-setup, the OTP re-auth
   * inside /otp/disable, and the OTP step of /login/auth). Three layers:
   * 1. the SHARED global per-minute budget (same one /login/auth uses, so a
   *    multi-IP flood across login + OTP endpoints is bounded as a whole);
   * 2. the per-address LOCKOUT shared with login failures — a locked address
   *    is refused here and by /login/auth alike;
   * 3. this per-address window (maxOtpAttemptsPerMinute) as the primary cap.
   * Emits one `otp-rate-limit` security event per exhausted window.
   * @returns whether the attempt is inside the budget.
   */
  #otpVerifyAllowed(address, now) {
    if (!this.#globalAuthAllowed(now)) return false
    const lock = this.attempts.get(address)
    if (lock !== undefined && lock.lockedUntil > now) return false
    const limit = this.policy.maxOtpAttemptsPerMinute ?? 10
    const windowMs = 60 * 1000
    let state = this.otpWindows.get(address)
    if (state === undefined || now - state.windowStart >= windowMs) {
      state = { windowStart: now, count: 0, notified: false }
    }
    state.count += 1
    this.otpWindows.set(address, state)
    if (state.count > limit && !state.notified) {
      state.notified = true
      this.onSecurityEvent?.({
        kind: 'otp-rate-limit',
        sourceAddress: address,
        limit,
        windowSeconds: Math.ceil(windowMs / 1000),
      })
    }
    return state.count <= limit
  }

  /**
   * Record a failed OTP verification for the client address, counting toward
   * the SAME per-address lockout as login failures (maxLoginFailures /
   * lockMinutes). Once the threshold is reached the address is locked for
   * both OTP verification and /login/auth.
   */
  #recordOtpFailure(address, now) {
    const maxFailures = this.policy.maxLoginFailures ?? 5
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000
    const entry = this.attempts.get(address) ?? { count: 0, lockedUntil: 0 }
    entry.count += 1
    if (entry.count >= maxFailures) {
      entry.lockedUntil = now + lockMs
      entry.count = 0 // recount after the lock window passes
      this.onSecurityEvent?.({
        kind: 'lockout',
        sourceAddress: address,
        maxFailures,
        lockedUntil: entry.lockedUntil,
      })
    }
    this.attempts.set(address, entry)
  }

  /**
   * Whether 2FA is configured AND active: feature enabled in config, a stored
   * secret exists, and the record says enabled.
   */
  #otpActive() {
    return this.otp.otpEnabled && hasOTP() && getOTPStatus().enabled
  }

  /**
   * Verify a TOTP code against the persisted secret with replay protection:
   * failures count into the per-address lockout, success advances the
   * lastCounter watermark.
   * @returns {boolean} whether the code is valid and not replayed.
   */
  #verifyOtp(secret, otp, address) {
    const result = verifyTOTP(secret, otp, {
      window: this.otp.otpWindow || 1,
      digits: this.otp.otpDigits || 6,
      period: this.otp.otpPeriod || 30,
      lastCounter: getLastCounter(),
    })
    if (!result.valid) {
      this.#recordOtpFailure(address, Date.now())
      return false
    }
    setLastCounter(result.counter)
    return true
  }

  /**
   * Resolve the session token for a request that requires a FULLY
   * authenticated session — password AND, when 2FA is active, completed OTP
   * verification. Unverified sessions (OTP became active after their login)
   * may only use the OTP verification endpoints themselves (/otp/verify,
   * /otp/verify-backup and the verify page); everything that reads or mutates
   * security state (settings, OTP management, password change) is gated here,
   * so a half-authenticated session cannot modify config or take over the
   * setup flow.
   * @returns {string|undefined} the token when allowed; otherwise responds 401 and returns undefined.
   */
  #verifiedTokenOr401(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      this.#json(res, 401, { ok: false, error: 'unauthenticated' })
      return undefined
    }
    if (this.#otpActive() && !this.sessions.isOTPVerified(token)) {
      this.#json(res, 401, { ok: false, error: 'otp-required' })
      return undefined
    }
    return token
  }

  /** POST /login/change — verify old password, set new one, revoke every session. */
  async #handleChange(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { oldPassword, newPassword } = body
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string'
      || newPassword.length === 0) {
      return this.#json(res, 400, { ok: false, error: 'bad-payload' })
    }
    if (!await verifyPassword(oldPassword)) {
      return this.#json(res, 401, { ok: false, error: 'invalid-password' })
    }
    const strength = validatePasswordStrength(newPassword, this.policy)
    if (!strength.ok) {
      return this.#json(res, 400, { ok: false, error: strength.reason })
    }
    await setPassword(newPassword)
    this.sessions.revokeAll()
    // All sessions die, including the caller's — the client shows a re-login prompt.
    this.#json(res, 200, { ok: true }, expiredCookie())
  }

  /** POST /login/logout — drop the caller's session. */
  #handleLogout(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    this.sessions.revoke(token)
    this.#json(res, 200, { ok: true }, expiredCookie())
  }

  // ── Settings API ─────────────────────────────────────────────────────

  /** GET /login-api/settings — return current plugin configuration. */
  #handleGetSettings(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return

    const otpStatus = getOTPStatus()
    this.#json(res, 200, {
      ok: true,
      config: {
        'dsh-password-gate': {
          ...this.otp,
          otpEnabled: this.#otpActive(),
          otpStatus,
        },
      },
    })
  }

  // ── OTP routes ────────────────────────────────────────────────────────

  /** GET /otp/setup — render OTP setup page. */
  #serveOTPSetupPage(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return

    if (!this.otp.otpEnabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    if (this.#otpActive()) {
      return this.#json(res, 409, { ok: false, error: 'otp-already-enabled' })
    }

    // Generate temporary secret for setup (will be confirmed on verification)
    const tempSecret = generateSecret()
    const uri = generateOTPAuthURI(tempSecret, {
      issuer: this.otp.otpIssuer || 'dsh-password-gate',
      account: 'dsh-user',
    })

    // Store temp secret in session for verification
    this.sessions.setTempOTP(token, tempSecret)

    const html = otpSetupPage({
      uri,
      secret: tempSecret,
      backupCodes: [], // Will be generated on successful setup
      digits: this.otp.otpDigits || 6,
    })

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /**
   * POST /otp/enable — prepare OTP setup: generate the secret, build the QR
   * code, and stage the secret on the session. Nothing is persisted yet; the
   * actual enable happens in /otp/verify-setup after the code is confirmed,
   * so the stored secret always matches the one the user scanned.
   */
  async #handleOTPEnable(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return

    if (!this.otp.otpEnabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    if (this.#otpActive()) {
      return this.#json(res, 409, { ok: false, error: 'otp-already-enabled' })
    }

    const secret = generateSecret()
    const uri = generateOTPAuthURI(secret, {
      issuer: this.otp.otpIssuer || 'dsh-password-gate',
      account: 'dsh-user',
    })

    // Generate QR code as SVG data URL
    const svgUrl = generateQRSvg(uri, 256)

    // Stage the secret for confirmation via /otp/verify-setup
    this.sessions.setTempOTP(token, secret)

    this.#json(res, 200, {
      ok: true,
      secret,
      uri,
      svgUrl,
    })
  }

  /** POST /otp/verify-setup — verify OTP setup (confirm secret). */
  async #handleOTPVerifySetup(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return

    if (!this.otp.otpEnabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    // Cap setup-code guessing per client address.
    if (!this.#otpVerifyAllowed(req.socket.remoteAddress ?? 'unknown', Date.now())) {
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }

    const body = await this.#readJson(req, res)
    if (body === undefined) return

    const { otp } = body
    if (typeof otp !== 'string' || otp.length !== (this.otp.otpDigits || 6)) {
      return this.#json(res, 400, { ok: false, error: 'invalid-otp' })
    }

    // Get temp secret from session
    const tempSecret = this.sessions.getTempOTP(token)
    if (!tempSecret) {
      return this.#json(res, 400, { ok: false, error: 'setup-expired' })
    }

    // Verify OTP (temp secret is one-shot per session; no replay watermark)
    const { valid } = verifyTOTP(tempSecret, otp, {
      window: this.otp.otpWindow || 1,
      digits: this.otp.otpDigits || 6,
      period: this.otp.otpPeriod || 30,
    })

    if (!valid) {
      this.#recordOtpFailure(req.socket.remoteAddress ?? 'unknown', Date.now())
      return this.#json(res, 401, { ok: false, error: 'invalid-otp' })
    }

    // Enable OTP with the verified secret, so the stored secret matches the
    // one the user scanned in the QR code.
    const result = await enableOTP({
      secret: tempSecret,
      algorithm: 'SHA1',
      digits: this.otp.otpDigits || 6,
      period: this.otp.otpPeriod || 30,
      backupCodeCount: this.otp.backupCodeCount || 10,
      backupCodeLength: this.otp.backupCodeLength || 8,
    })

    // Clear temp secret and mark session as verified
    this.sessions.clearTempOTP(token)
    this.sessions.markOTPVerified(token)

    this.#json(res, 200, {
      ok: true,
      backupCodes: result.backupCodes,
    })
  }

  /** GET /otp/verify — render OTP verification page. */
  #serveOTPVerifyPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      return this.#json(res, 401, { ok: false, error: 'unauthenticated' })
    }

    if (!hasOTP() || !getOTPStatus().enabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    const otpStatus = getOTPStatus()
    const html = otpVerifyPage({
      hasBackupCodes: otpStatus.backupCodesCount > 0,
      digits: this.otp.otpDigits || 6,
    })

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /** POST /otp/verify — verify OTP code during login. */
  async #handleOTPVerify(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      return this.#json(res, 401, { ok: false, error: 'unauthenticated' })
    }

    if (!hasOTP() || !getOTPStatus().enabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    // Cap OTP guessing per client address (brute-forcing the TOTP code).
    if (!this.#otpVerifyAllowed(req.socket.remoteAddress ?? 'unknown', Date.now())) {
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }

    const body = await this.#readJson(req, res)
    if (body === undefined) return

    const { otp } = body
    if (typeof otp !== 'string' || otp.length !== (this.otp.otpDigits || 6)) {
      return this.#json(res, 400, { ok: false, error: 'invalid-otp' })
    }

    const secret = getOTPSecret()
    if (!secret) {
      return this.#json(res, 500, { ok: false, error: 'otp-secret-missing' })
    }

    if (!this.#verifyOtp(secret, otp, req.socket.remoteAddress ?? 'unknown')) {
      return this.#json(res, 401, { ok: false, error: 'invalid-otp' })
    }

    // OTP verified, mark session as OTP-verified
    this.sessions.markOTPVerified(token)

    this.#json(res, 200, { ok: true })
  }

  /** POST /otp/verify-backup — verify backup code during login. */
  async #handleOTPVerifyBackup(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      return this.#json(res, 401, { ok: false, error: 'unauthenticated' })
    }

    if (!hasOTP() || !getOTPStatus().enabled) {
      return this.#json(res, 400, { ok: false, error: 'otp-not-enabled' })
    }

    // Cap backup-code guessing per client address.
    if (!this.#otpVerifyAllowed(req.socket.remoteAddress ?? 'unknown', Date.now())) {
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }

    const body = await this.#readJson(req, res)
    if (body === undefined) return

    const { code } = body
    if (typeof code !== 'string' || code.length === 0) {
      return this.#json(res, 400, { ok: false, error: 'invalid-backup-code' })
    }

    const valid = await verifyAndUseBackupCode(code)
    if (!valid) {
      this.#recordOtpFailure(req.socket.remoteAddress ?? 'unknown', Date.now())
      return this.#json(res, 401, { ok: false, error: 'invalid-backup-code' })
    }

    // Backup code verified, mark session as OTP-verified
    this.sessions.markOTPVerified(token)

    this.#json(res, 200, { ok: true })
  }

  /**
   * POST /otp/disable — disable OTP.
   *
   * Security: when 2FA is active, the session alone is NOT enough to disable
   * it — the caller must re-authenticate with the current TOTP code or an
   * unused backup code, otherwise an attacker with a hijacked session could
   * silently turn 2FA off.
   */
  async #handleOTPDisable(req, res) {
    const token = this.#verifiedTokenOr401(req, res)
    if (token === undefined) return

    // Read body if present (optional for settings panel)
    let password, otp, backupCode
    const contentType = req.headers['content-type'] || ''
    if (contentType.includes('application/json')) {
      const body = await this.#readJson(req, res)
      if (body === undefined) return
      password = body.password
      otp = body.otp
      backupCode = body.backupCode
    }

    // If password provided, verify it
    if (typeof password === 'string') {
      if (!await verifyPassword(password)) {
        return this.#json(res, 401, { ok: false, error: 'invalid-password' })
      }
    }

    // If OTP is enabled, disabling requires re-authentication with the
    // second factor: a valid TOTP code or an unused backup code.
    if (this.#otpActive()) {
      const secret = getOTPSecret()
      if (!secret) {
        return this.#json(res, 500, { ok: false, error: 'otp-secret-missing' })
      }

      // Cap TOTP/backup guessing per client address.
      if (!this.#otpVerifyAllowed(req.socket.remoteAddress ?? 'unknown', Date.now())) {
        return this.#json(res, 429, { ok: false, error: 'rate-limited' })
      }

      const hasOtp = typeof otp === 'string' && otp.length > 0
      const hasBackupCode = typeof backupCode === 'string' && backupCode.length > 0
      if (!hasOtp && !hasBackupCode) {
        return this.#json(res, 400, { ok: false, error: 'otp-required' })
      }

      if (hasOtp) {
        if (otp.length !== (this.otp.otpDigits || 6)) {
          return this.#json(res, 400, { ok: false, error: 'invalid-otp' })
        }
        if (!this.#verifyOtp(secret, otp, req.socket.remoteAddress ?? 'unknown')) {
          return this.#json(res, 401, { ok: false, error: 'invalid-otp' })
        }
      } else {
        const valid = await verifyAndUseBackupCode(backupCode)
        if (!valid) {
          this.#recordOtpFailure(req.socket.remoteAddress ?? 'unknown', Date.now())
          return this.#json(res, 401, { ok: false, error: 'invalid-backup-code' })
        }
      }
    }

    disableOTP()
    this.#json(res, 200, { ok: true })
  }

  // ── helpers ───────────────────────────────────────────────────────────

  /** Read and parse a bounded JSON body; responds 400 and returns undefined on failure. */
  #readJson(req, res) {
    return new Promise((resolve) => {
      const chunks = []
      let size = 0
      let done = false
      req.on('data', (chunk) => {
        if (done) return
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          done = true
          this.#json(res, 413, { ok: false, error: 'payload-too-large' })
          req.destroy()
          resolve(undefined)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (done) return
        done = true
        let parsed
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          this.#json(res, 400, { ok: false, error: 'invalid-json' })
          resolve(undefined)
          return
        }
        resolve(parsed)
      })
      req.on('error', () => {
        if (!done) {
          done = true
          this.#json(res, 400, { ok: false, error: 'bad-request' })
          resolve(undefined)
        }
      })
    })
  }

  /** JSON response with an optional Set-Cookie header. */
  #json(res, status, payload, setCookie) {
    const headers = { 'content-type': 'application/json; charset=utf-8' }
    if (setCookie !== undefined) headers['set-cookie'] = setCookie
    res.writeHead(status, headers)
    res.end(JSON.stringify(payload))
  }

  // ── forwarding ────────────────────────────────────────────────────────

  /**
   * Transparent HTTP forward. Host and Origin are REWRITTEN to the loopback
   * upstream before forwarding: dsh's /api browser-trust fence derives its
   * LAN trusted-host list from the webserver's bind (0.0.0.0), but the login
   * design pins the webserver to 127.0.0.1, so an external Host (LAN IP)
   * would be 403'd inside. Rewriting is safe because the gateway's own
   * cookie gate (HttpOnly + SameSite=Strict) has taken over the fence's job:
   * cross-site and DNS-rebinding requests carry no session cookie and are
   * refused before they reach the upstream.
   */
  #forward(req, res) {
    const headers = { ...req.headers }
    delete headers.connection
    delete headers['proxy-connection']
    rewriteLoopbackHeaders(headers, this.upstreamHost, this.upstreamPort)
    const forwardPath = normalizeForwardPath(req.url)
    if (forwardPath === null) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    const proxyReq = http.request({
      host: this.upstreamHost,
      port: this.upstreamPort,
      path: forwardPath,
      method: req.method,
      headers,
    }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      upRes.pipe(res)
    })
    proxyReq.on('error', (err) => {
      this.onError?.(err)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad gateway: upstream unavailable')
      } else {
        res.destroy()
      }
    })
    res.on('close', () => proxyReq.destroy())
    req.pipe(proxyReq)
  }

  /**
   * WebSocket upgrade forward (Node's standard proxy pattern): the client's
   * upgrade request is replayed to the upstream; on its 101 the response head
   * is written back to the client socket and both sockets are piped.
   * Unauthenticated upgrades are rejected outright — the event stream never
   * starts. Host/Origin are rewritten like regular forwards (the fence
   * checks them identically on upgrades).
   */
  #handleUpgrade(req, socket, head) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      socket.destroy()
      return
    }
    // WebSocket upgrades must satisfy the same OTP gate as forwarded HTTP:
    // an unverified session must not reach the upstream event stream.
    const otpActive = this.#otpActive()
    if (otpActive && !this.sessions.isOTPVerified(token)) {
      socket.destroy()
      return
    }
    const headers = { ...req.headers } // connection/upgrade headers must survive here
    rewriteLoopbackHeaders(headers, this.upstreamHost, this.upstreamPort)
    const forwardPath = normalizeForwardPath(req.url)
    if (forwardPath === null) {
      socket.destroy()
      return
    }
    const proxyReq = http.request({
      host: this.upstreamHost,
      port: this.upstreamPort,
      path: forwardPath,
      method: req.method,
      headers,
    })
    socket.on('error', () => proxyReq.destroy())
    proxyReq.on('error', (err) => {
      this.onError?.(err)
      socket.destroy()
    })
    proxyReq.on('upgrade', (upRes, upSocket, upHead) => {
      const headLines = [
        `HTTP/${upRes.httpVersion} ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? ''}`,
        ...Object.entries(upRes.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
      ]
      socket.write(`${headLines.join('\r\n')}\r\n\r\n`)
      if (upHead.length > 0) socket.write(upHead)
      upSocket.on('error', () => socket.destroy())
      socket.on('error', () => upSocket.destroy())
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    if (head.length > 0) proxyReq.write(head)
    proxyReq.end()
  }
}

/** Create a gateway from plugin config with defaults; validates the numbers. */
export function createGateway(config) {
  const listenHost = config?.listenHost ?? '0.0.0.0'
  const listenPort = config?.listenPort ?? 3080
  const upstreamHost = config?.upstreamHost ?? '127.0.0.1'
  const upstreamPort = config?.upstreamPort ?? 3081
  for (const [name, value] of [['listenPort', listenPort], ['upstreamPort', upstreamPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`dsh-password-gate: ${name} must be an integer port (got ${JSON.stringify(value)})`)
    }
  }
  const policy = {
    minPasswordLength: config?.minPasswordLength ?? 8,
    requireMixedCase: config?.requireMixedCase ?? true,
    requireSpecial: config?.requireSpecial ?? true,
    maxLoginFailures: config?.maxLoginFailures ?? 5,
    lockMinutes: config?.lockMinutes ?? 5,
    maxGlobalAuthAttemptsPerMinute: config?.maxGlobalAuthAttemptsPerMinute ?? 60,
    maxOtpAttemptsPerMinute: config?.maxOtpAttemptsPerMinute ?? 10,
  }
  const otp = {
    otpEnabled: config?.otpEnabled ?? false,
    otpRequired: config?.otpRequired ?? false,
    otpIssuer: config?.otpIssuer ?? 'dsh-password-gate',
    otpPeriod: config?.otpPeriod ?? 30,
    otpDigits: config?.otpDigits ?? 6,
    otpWindow: config?.otpWindow ?? 1,
    backupCodeCount: config?.backupCodeCount ?? 10,
    backupCodeLength: config?.backupCodeLength ?? 8,
  }
  return new LoginGateway({ listenHost, listenPort, upstreamHost, upstreamPort, policy, otp })
}

/**
 * Normalize a request-target into origin-form for forwarding. RFC 9112 allows
 * clients to send an ABSOLUTE-form target ("GET http://evil/x HTTP/1.1");
 * passing that verbatim to http.request would confuse the upstream about the
 * destination. Returns `pathname + search` for both forms (hash dropped),
 * or null when the target is unparsable.
 * @param rawUrl - the raw request target from req.url.
 */
function normalizeForwardPath(rawUrl) {
  try {
    const url = new URL(rawUrl ?? '/', 'http://internal')
    return url.pathname + url.search
  } catch {
    return null
  }
}

/**
 * Rewrite Host (and Origin, when present) to the loopback upstream authority,
 * so dsh's internal /api trust fence sees a loopback request regardless of
 * the external address the browser used. See #forward for the security
 * rationale.
 * @param headers - mutable outgoing header object.
 * @param upstreamHost - loopback upstream host (127.0.0.1).
 * @param upstreamPort - internal webserver port.
 */
function rewriteLoopbackHeaders(headers, upstreamHost, upstreamPort) {
  const authority = `${upstreamHost}:${upstreamPort}`
  headers.host = authority
  if (headers.origin !== undefined) {
    headers.origin = `http://${authority}`
  }
}

/**
 * Non-loopback IPv4 literals of this machine, for the URL line. A display
 * helper only — the dsh trust fence samples its own LAN snapshot.
 */
export function lanAddresses() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address)
    }
  }
  return out
}
