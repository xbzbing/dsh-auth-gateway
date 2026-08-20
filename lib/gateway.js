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
import { hasPassword, setPassword, verifyPassword, isInitialPassword, generateInitialPassword } from './store.js'
import { validatePasswordStrength } from './policy.js'
import { loginPageHtml } from './login-page.js'
import { onboardingPageHtml, onboardingPasswordPageHtml } from './onboarding-page.js'
import { hasOTP, getOTPStatus, getOTPSecret, getLastCounter, setLastCounter, verifyAndUseBackupCode } from './otp-store.js'
import { OTPCryptoError } from './otp-crypto.js'
import { verifyTOTP } from './totp.js'
import { createOTPRoutes } from './gateway-otp.js'
import { pageLocale, localePreference } from './locale.js'

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
  constructor({ listenHost, listenPort, upstreamHost, upstreamPort, basePath = '/', policy = {}, otp = {} }) {
    this.listenHost = listenHost
    this.listenPort = listenPort
    this.upstreamHost = upstreamHost
    this.upstreamPort = upstreamPort
    // Normalize: '/' → '' (empty), '/dsh' → '/dsh', '/dsh/' → '/dsh'
    // Concatenation uses this.basePath + '/path', so root produces '/path' naturally
    const stripped = basePath.replace(/^\/+|\/+$/g, '')
    this.basePath = stripped === '' ? '' : '/' + stripped
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
    /**
     * Auth-audit sink, set by the plugin: fires on login success/failure,
     * logout and password change with a JSON-safe payload
     * ({kind, ip, reason?}). Never includes credentials or tokens.
     * @type {(payload: object) => void | undefined}
     */
    this.onAuthEvent = undefined
    // OTP routes live in gateway-otp.js; the private helpers they need are
    // bound here (a separate module cannot call #-private methods).
    this.otpRoutes = createOTPRoutes(this, {
      json: (res, status, body, cookie) => this.#json(res, status, body, cookie),
      readJson: (req, res) => this.#readJson(req, res),
      verifiedTokenOr401: (req, res) => this.#verifiedTokenOr401(req, res),
      otpVerifyAllowed: (address, now) => this.#otpVerifyAllowed(address, now),
      recordOtpFailure: (address, now) => this.#recordOtpFailure(address, now),
      verifyOtp: (secret, code, address) => this.#verifyOtp(secret, code, address),
      otpActive: () => this.#otpActive(),
      localeFor: (req) => this.#pageLocale(req),
    })
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
        // A classified OTP crypto error must never degrade into a bare
        // text/plain 500 — surface it as JSON so clients get an actionable code.
        if (err instanceof OTPCryptoError) {
          this.#json(res, err.status, { ok: false, error: err.code, message: err.message })
          return
        }
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('internal error')
      } else {
        res.destroy()
      }
    }
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async #route(req, res) {
    const rawPathname = new URL(req.url ?? '/', 'http://x').pathname
    // Strip basePath prefix so internal route matching stays root-relative.
    // Boundary check: only strip when the remainder starts with '/' (or is empty),
    // so '/dsh2/foo' is NOT treated as basePath '/dsh' + '/2/foo'.
    const pathname = (this.basePath !== '' && rawPathname.startsWith(this.basePath)
      && (rawPathname.length === this.basePath.length || rawPathname[this.basePath.length] === '/'))
      ? rawPathname.slice(this.basePath.length) || '/'
      : rawPathname

    // Auth API + login page are served directly by the gateway.
    if (req.method === 'GET' && pathname === '/login') {
      return this.#serveLoginPage(req, res)
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

    // OTP routes (handlers in gateway-otp.js)
    if (req.method === 'GET' && pathname === '/otp/setup') {
      return this.otpRoutes.serveSetupPage(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/enable') {
      return this.otpRoutes.handleEnable(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify-setup') {
      return this.otpRoutes.handleVerifySetup(req, res)
    }
    if (req.method === 'GET' && pathname === '/otp/verify') {
      return this.otpRoutes.serveVerifyPage(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify') {
      return this.otpRoutes.handleVerify(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/verify-backup') {
      return this.otpRoutes.handleVerifyBackup(req, res)
    }
    if (req.method === 'POST' && pathname === '/otp/disable') {
      return this.otpRoutes.handleDisable(req, res)
    }
    if (req.method === 'GET' && pathname === '/onboarding') {
      return this.#serveOnboardingPage(req, res)
    }
    if (req.method === 'GET' && pathname === '/onboarding/password') {
      return this.#serveOnboardingPasswordPage(req, res)
    }

    // PWA 公开源与静态资产：manifest/favicon/assets 由浏览器作为页面子资源加载，
    // 均不含敏感信息，必须放行（不携带会话 cookie 的场景同样适用）。
    if (req.method === 'GET' && (
      pathname === '/manifest.webmanifest' ||
      pathname === '/favicon.svg' ||
      pathname.startsWith('/assets/')
    )) {
      return this.#forward(req, res)
    }

    // Everything else: the auth gate, then transparent forwarding.
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      if (pathname.startsWith('/api')) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }))
      } else {
        res.writeHead(302, { location: this.basePath + '/login' })
        res.end()
      }
      return
    }

    // Sessions logged in with the auto-generated initial password owe the
    // onboarding step (set a personal password): everything is blocked
    // except the onboarding flow itself.
    if (this.sessions.isNeedsOnboarding(token)) {
      if (pathname.startsWith('/api')) {
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'onboarding-required' }))
      } else {
        res.writeHead(302, { location: this.basePath + '/onboarding' })
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
        res.writeHead(302, { location: this.basePath + '/otp/verify' })
        res.end()
      }
      return
    }

    this.#forward(req, res)
  }

  /**
   * Gateway page language: the dsh user preference wins, Accept-Language
   * fills in for fresh installs, zh is the fallback (see lib/locale.js).
   * Re-resolved on every render so a preference change applies without a
   * restart.
   */
  #pageLocale(req) {
    return pageLocale(localePreference(), req.headers['accept-language'])
  }

  /**
   * GET /onboarding — step 1 of the first-run flow: optional OTP binding.
   * Binding OTP revokes every session (the user lands back at /login and
   * re-enters onboarding with 2FA active), so step 1 only makes sense while
   * 2FA is NOT active yet — otherwise jump straight to the password step.
   */
  #serveOnboardingPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      res.writeHead(302, { location: this.basePath + '/login' })
      res.end()
      return
    }
    if (this.#otpActive()) {
      res.writeHead(302, { location: this.basePath + '/onboarding/password' })
      res.end()
      return
    }
    const html = onboardingPageHtml({
      locale: this.#pageLocale(req),
      basePath: this.basePath,
    })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /** GET /onboarding/password — step 2: set the personal password (mandatory). */
  #serveOnboardingPasswordPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      res.writeHead(302, { location: this.basePath + '/login' })
      res.end()
      return
    }
    const html = onboardingPasswordPageHtml({
      locale: this.#pageLocale(req),
      basePath: this.basePath,
    })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /** GET /login — render login or change-password page by state. */
  #serveLoginPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    const otpEnabled = this.#otpActive()
    // A session counts as "logged in" for the change-password page only when
    // it is fully verified; an unverified session (OTP active) sees the auth
    // form instead, since it cannot perform management actions yet.
    const verified = this.sessions.isValid(token) && !(otpEnabled && !this.sessions.isOTPVerified(token))
    const mode = verified ? 'change' : 'auth'
    const html = loginPageHtml({
      mode, otpEnabled, digits: this.otp.otpDigits || 6,
      otpRequired: this.otp.otpRequired ?? false,
      locale: this.#pageLocale(req),
      basePath: this.basePath,
    })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
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
    this.#pruneRateState(now)
    const authIp = req.socket.remoteAddress ?? 'unknown'
    if (!this.#globalAuthAllowed(now)) {
      this.#authEvent('login-failed', authIp, 'rate-limited')
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { password, otp, backupCode } = body
    const key = req.socket.remoteAddress ?? 'unknown'
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000

    let entry = this.attempts.get(key)
    if (entry !== undefined) {
      if (entry.lockedUntil > now) {
        // Locked: refuse even the correct password until the window passes.
        const retryAfter = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000))
        this.#authEvent('login-failed', authIp, 'too-many-attempts')
        return this.#json(res, 429, { ok: false, error: 'too-many-attempts', retryAfterSeconds: retryAfter })
      }
      // Only an entry that HAD locked (lockedUntil > 0) is expired here; a
      // fresh counter (0) must survive to keep counting failures.
      if (entry.lockedUntil > 0 && entry.lockedUntil <= now) this.attempts.delete(key)
    }

    if (typeof password !== 'string' || !await verifyPassword(password)) {
      // One uniform 401: never reveal whether a password exists or which part failed.
      this.#recordFailure(key, now)
      entry = this.attempts.get(key)
      if (entry.lockedUntil > now) {
        // Security event is emitted by #recordFailure (once per lockout).
        this.#authEvent('login-failed', authIp, 'too-many-attempts')
        return this.#json(res, 429, {
          ok: false, error: 'too-many-attempts',
          retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
        })
      }
      this.#authEvent('login-failed', authIp, 'invalid-credentials')
      return this.#json(res, 401, { ok: false, error: 'invalid-credentials' })
    }
    this.attempts.delete(key) // success clears the failure counter

    // Check if OTP is enabled and required
    const otpEnabled = this.#otpActive()
    const otpRequired = this.otp.otpRequired || otpEnabled

    if (otpRequired && otpEnabled) {
      // 2FA gate at login: a TOTP code OR a single-use backup code. The
      // backup path is what makes a lost authenticator recoverable — the
      // only other backup entry (/otp/verify) requires an existing session,
      // which a locked-out user can never obtain.
      const hasOtp = typeof otp === 'string' && otp.length === (this.otp.otpDigits || 6)
      const hasBackup = typeof backupCode === 'string' && backupCode.length > 0
      if (!hasOtp && !hasBackup) {
        this.#authEvent('login-failed', authIp, 'otp-required')
        return this.#json(res, 400, { ok: false, error: 'otp-required' })
      }
      // A correct password with a wrong code never hits the lockout counter
      // above, so cap code guesses per address with the OTP budget too.
      if (!this.#otpVerifyAllowed(key, now)) {
        this.#authEvent('login-failed', authIp, 'rate-limited')
        return this.#json(res, 429, { ok: false, error: 'rate-limited' })
      }

      if (hasBackup) {
        const valid = await verifyAndUseBackupCode(backupCode)
        if (!valid) {
          this.#recordFailure(key, now)
          this.#authEvent('login-failed', authIp, 'invalid-backup-code')
          return this.#json(res, 401, { ok: false, error: 'invalid-credentials' })
        }
      } else {
        let secret
        try {
          secret = getOTPSecret()
        } catch (err) {
          if (err instanceof OTPCryptoError) {
            this.#authEvent('login-failed', authIp, err.code)
            return this.#json(res, err.status, { ok: false, error: err.code, message: err.message })
          }
          throw err
        }
        if (!secret) {
          this.#authEvent('login-failed', authIp, 'otp-secret-missing')
          return this.#json(res, 500, { ok: false, error: 'otp-secret-missing' })
        }
        if (!this.#verifyOtp(secret, otp, key)) {
          this.#authEvent('login-failed', authIp, 'invalid-otp')
          return this.#json(res, 401, { ok: false, error: 'invalid-credentials' })
        }
      }

      // Both password and 2FA verified - issue session as fully verified
      const token = this.sessions.issue()
      this.sessions.markOTPVerified(token)
      if (await isInitialPassword()) this.sessions.markNeedsOnboarding(token)
      this.#authEvent('login-success', authIp, 'otp')
      return this.#json(res, 200, { ok: true }, sessionCookie(token))
    }

    const token = this.sessions.issue()
    // A session logged in with the auto-generated initial password must
    // complete onboarding before anything else.
    if (await isInitialPassword()) this.sessions.markNeedsOnboarding(token)
    this.#authEvent('login-success', authIp, 'password')
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
    this.#pruneRateState(now)
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
   * Count one failed credential attempt for the client address toward the
   * SHARED per-address lockout (maxLoginFailures / lockMinutes). Used by
   * password login, OTP/backup-code verification, and password change — a
   * held session must not allow unlimited old-password guessing either.
   * Emits one `lockout` security event when the threshold trips (subsequent
   * attempts inside the lock window are refused before reaching here, so no
   * repeat notifications).
   */
  #recordFailure(address, now) {
    const maxFailures = this.policy.maxLoginFailures ?? 5
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000
    const entry = this.attempts.get(address) ?? { count: 0, lockedUntil: 0, updatedAt: 0 }
    entry.count += 1
    entry.updatedAt = now
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
   * Record a failed OTP verification for the client address, counting toward
   * the SAME per-address lockout as login failures (maxLoginFailures /
   * lockMinutes). Once the threshold is reached the address is locked for
   * both OTP verification and /login/auth.
   */
  #recordOtpFailure(address, now) {
    this.#recordFailure(address, now)
  }

  /**
   * Bound the per-address rate maps. A distributed brute force rotating IPs
   * would otherwise grow `attempts`/`otpWindows` without limit for the
   * process lifetime. Sweep only when a map is large (amortized O(1) per
   * request), and drop only entries whose state is already irrelevant:
   * expired locks, counters idle for more than twice the lock window, and
   * OTP windows that have fully rolled over.
   */
  #pruneRateState(now) {
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000
    const staleMs = lockMs * 2
    const windowMs = 60 * 1000
    if (this.attempts.size > 1024) {
      for (const [key, e] of this.attempts) {
        const expiredLock = e.lockedUntil > 0 && e.lockedUntil <= now
        const idleCounter = e.lockedUntil === 0 && now - e.updatedAt > staleMs
        if (expiredLock || idleCounter) this.attempts.delete(key)
      }
    }
    if (this.otpWindows.size > 1024) {
      for (const [key, w] of this.otpWindows) {
        if (now - w.windowStart > windowMs) this.otpWindows.delete(key)
      }
    }
  }

  /**
   * Whether 2FA is configured AND active: feature enabled in config, a stored
   * secret exists, and the record says enabled.
   */
  #otpActive() {
    // 2FA is active once the user has bound and verified an authenticator —
    // enabling it is a user action (settings panel / onboarding), no
    // deployment switch is required.
    return hasOTP() && getOTPStatus().enabled
  }

  /**
   * Verify a TOTP code against the persisted secret with replay protection:
   * failures count into the per-address lockout, success advances the
   * lastCounter watermark.
   * @returns {boolean} whether the code is valid and not replayed.
   */
  #verifyOtp(secret, otp, address) {
    const period = this.otp.otpPeriod || 30
    const result = verifyTOTP(secret, otp, {
      window: this.otp.otpWindow || 1,
      digits: this.otp.otpDigits || 6,
      period,
      lastCounter: getLastCounter(),
    })
    if (!result.valid) {
      this.#recordOtpFailure(address, Date.now())
      return false
    }
    // Clamp the replay watermark to the current time step. A code from a
    // *future* step (clock skew, or just inside the acceptance window) is still
    // accepted for login, but we must NOT advance `lastCounter` past "now":
    // doing so would permanently reject the genuinely-current and next steps as
    // replays until wall-clock time catches up, locking the user out of TOTP.
    const currentStep = Math.floor(Date.now() / 1000 / period)
    setLastCounter(Math.min(result.counter, currentStep))
    return true
  }

  /**
   * Resolve the session token for a request that requires a FULLY
   * authenticated session — password AND, when 2FA is active, completed OTP
   * verification. Unverified sessions (OTP became active after their login)
   * may only use the OTP verification endpoints themselves (/otp/verify,
   * /otp/verify-backup and the verify page); everything that reads or mutates
   * security state (settings, OTP management, password change) is gated here,
   * so a half-authenticated session cannot modify config or take over an
   * account.
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
    const changeIp = req.socket.remoteAddress ?? 'unknown'
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string'
      || newPassword.length === 0) {
      this.#authEvent('password-change-failed', changeIp, 'bad-payload')
      return this.#json(res, 400, { ok: false, error: 'bad-payload' })
    }
    if (!await verifyPassword(oldPassword)) {
      // Wrong old password counts toward the same per-address lockout as
      // login failures: a held session must not enable unlimited guessing.
      const key = req.socket.remoteAddress ?? 'unknown'
      this.#recordFailure(key, Date.now())
      const entry = this.attempts.get(key)
      if (entry.lockedUntil > Date.now()) {
        this.#authEvent('password-change-failed', changeIp, 'too-many-attempts')
        return this.#json(res, 429, {
          ok: false, error: 'too-many-attempts',
          retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 1000)),
        })
      }
      this.#authEvent('password-change-failed', changeIp, 'invalid-password')
      return this.#json(res, 401, { ok: false, error: 'invalid-password' })
    }
    const strength = validatePasswordStrength(newPassword, this.policy)
    if (!strength.ok) {
      this.#authEvent('password-change-failed', changeIp, strength.reason)
      return this.#json(res, 400, { ok: false, error: strength.reason })
    }
    await setPassword(newPassword)
    this.sessions.revokeAll()
    this.#authEvent('password-change', changeIp)
    // All sessions die, including the caller's — the client shows a re-login prompt.
    this.#json(res, 200, { ok: true }, expiredCookie())
  }

  /** POST /login/logout — drop the caller's session. */
  #handleLogout(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    this.sessions.revoke(token)
    this.#authEvent('logout', req.socket.remoteAddress ?? 'unknown')
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
        'dsh-auth-gateway': {
          ...this.otp,
          otpEnabled: this.#otpActive(),
          otpStatus,
        },
      },
    })
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

  /**
   * Emit an auth-audit event to the plugin sink. Never carries credentials,
   * tokens or secrets — only the event kind, client address and a reason
   * code. The plugin maps this onto its logger.
   */
  #authEvent(kind, ip, reason) {
    if (typeof this.onAuthEvent !== 'function') return
    const payload = { kind, ip }
    if (reason !== undefined) payload.reason = reason
    this.onAuthEvent(payload)
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
  /**
   * Strip basePath prefix from a raw URL for upstream forwarding.
   * When basePath is '/dsh' and req.url is '/dsh/assets/foo.js',
   * returns '/assets/foo.js'. For root basePath, returns as-is.
   */
  #stripBasePath(rawUrl) {
    if (this.basePath === '') return rawUrl
    try {
      const url = new URL(rawUrl ?? '/', 'http://internal')
      // Boundary check: only strip when the remainder starts with '/' (or is empty),
      // so '/dsh2/foo.js' is NOT treated as basePath '/dsh' + '/2/foo.js'.
      if (url.pathname.startsWith(this.basePath)
        && (url.pathname.length === this.basePath.length || url.pathname[this.basePath.length] === '/')) {
        url.pathname = url.pathname.slice(this.basePath.length) || '/'
        return url.pathname + url.search
      }
    } catch { /* fall through */ }
    return rawUrl
  }

  #forward(req, res) {
    const headers = { ...req.headers }
    delete headers.connection
    delete headers['proxy-connection']
    rewriteLoopbackHeaders(headers, this.upstreamHost, this.upstreamPort)
    const forwardPath = normalizeForwardPath(this.#stripBasePath(req.url))
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
    // Same gate as #route: a session that owes onboarding must not reach the
    // upstream event stream either — "nothing usable before a personal
    // password is set" applies to WebSocket data just as it does to HTTP.
    if (this.sessions.isNeedsOnboarding(token)) {
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
    const forwardPath = normalizeForwardPath(this.#stripBasePath(req.url))
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
  const basePath = config?.basePath ?? '/'
  for (const [name, value] of [['listenPort', listenPort], ['upstreamPort', upstreamPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`dsh-auth-gateway: ${name} must be an integer port (got ${JSON.stringify(value)})`)
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
    otpIssuer: config?.otpIssuer ?? 'dsh-auth-gateway',
    otpPeriod: config?.otpPeriod ?? 30,
    otpDigits: config?.otpDigits ?? 6,
    otpWindow: config?.otpWindow ?? 1,
    backupCodeCount: config?.backupCodeCount ?? 10,
    backupCodeLength: config?.backupCodeLength ?? 8,
  }
  return new LoginGateway({ listenHost, listenPort, upstreamHost, upstreamPort, basePath, policy, otp })
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
