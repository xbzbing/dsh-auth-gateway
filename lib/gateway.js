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
import { URL } from 'node:url'
import { SessionStore, sessionCookie, expiredCookie, tokenFromCookieHeader, requestIsSecure } from './auth.js'
import { hasPassword, setPassword, verifyPassword, isInitialPassword, generateInitialPassword } from './store.js'
import { validatePasswordStrength } from './policy.js'
import { loginPageHtml } from './login-page.js'
import { onboardingPageHtml, onboardingPasswordPageHtml } from './onboarding-page.js'
import { hasOTP, getOTPStatus, getOTPSecret, getLastCounter, setLastCounter, verifyAndUseBackupCode } from './otp-store.js'
import { OTPCryptoError } from './otp-crypto.js'
import { verifyTOTP } from './totp.js'
import { createOTPRoutes } from './gateway-otp.js'
import { createPanelApi } from './gateway-panel-api.js'
import { pageLocale, localePreference } from './locale.js'
import { createForwarder, normalizeForwardPath, lanAddresses } from './forward.js'
import { createRateLimiter } from './rate-limit.js'

export { lanAddresses }

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
   * @param {'auto'|boolean} [options.cookieSecure] - whether session cookies
   *   carry Secure: 'auto' follows each request's transport (TLS socket or
   *   X-Forwarded-Proto: https), true/false pin the attribute (config
   *   `cookieSecure`; default 'auto').
   * @param {'auto'|true|false|null} [options.cookieSecureOverride] - panel-owned
   *   Secure policy (credential record read at plugin start; null = none).
   *   Owned by gateway-panel-api.js, which also persists it via
   *   `cookieSecureOverrideStore`.
   * @param {() => (Buffer | undefined)} [options.upstreamSecretReader] - sync
   *   source of the upstream browser-auth signing secret (wired by the
   *   plugin entry from ctx.credentials; absent → verbatim forwarding).
   * @param {{version: string, repository: string}} [options.versionInfo] -
   *   running plugin identity, shown in the settings panel (lib/version.js).
   * @param {object} [options.updateChecker] - new-version checker
   *   (lib/update-check.js); absent → the panel reports no update state and
   *   no outbound request is ever made.
   * @param {boolean} [options.updateCheckAuto] - whether opening the panel
   *   may itself trigger a check (`updateCheck` config; default false). The
   *   panel's explicit `?refresh=1` action works either way.
   */
  constructor({ listenHost, listenPort, upstreamHost, upstreamPort, basePath = '/', policy = {}, otp = {}, cookieSecure = 'auto', cookieSecureOverride, cookieSecureOverrideStore, upstreamSecretReader, versionInfo, updateChecker, updateCheckAuto = false }) {
    this.listenHost = listenHost
    this.listenPort = listenPort
    this.upstreamHost = upstreamHost
    this.upstreamPort = upstreamPort
    // Cookie Secure policy: the composition value ('auto' | true | false)
    // normalized like the plugin Config validator does — only the booleans
    // pin, everything else auto-follows.
    this.cookieSecure = cookieSecure === true || cookieSecure === false ? cookieSecure : 'auto'
    // Normalize: '/' → '' (empty), '/dsh' → '/dsh', '/dsh/' → '/dsh'
    // Concatenation uses this.basePath + '/path', so root produces '/path' naturally
    const stripped = basePath.replace(/^\/+|\/+$/g, '')
    this.basePath = stripped === '' ? '' : '/' + stripped
    this.policy = policy
    this.otp = otp
    // Plugin identity for the settings panel. Defaults keep a gateway built
    // without them (tests, embedders) serving a well-formed response.
    this.versionInfo = {
      version: versionInfo?.version ?? 'unknown',
      repository: versionInfo?.repository ?? '',
    }
    this.updateChecker = updateChecker ?? null
    this.updateCheckAuto = updateCheckAuto === true
    this.sessions = new SessionStore()
    // Anti-brute-force state machine (lib/rate-limit.js). The maps stay
    // reachable under the historical names — public only so tests can
    // simulate lock expiry and window rollover; not part of the API.
    this.rateLimit = createRateLimiter(policy, (payload) => this.onSecurityEvent?.(payload))
    this.attempts = this.rateLimit.attempts
    this.otpWindows = this.rateLimit.otpWindows
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
    /**
     * Config-warning sink, set by the plugin: fires when the deployment
     * config and the live connection contradict each other (forced
     * cookieSecure over a plain-HTTP link). The plugin prints it to the
     * console — ctx.logger alone stays in the in-memory buffer.
     * @type {(warning: Error) => void | undefined}
     */
    this.onConfigWarning = undefined
    // OTP routes live in gateway-otp.js; the private helpers they need are
    // bound here (a separate module cannot call #-private methods).
    this.otpRoutes = createOTPRoutes(this, {
      json: (res, status, body, cookie) => this.#json(res, status, body, cookie),
      readJson: (req, res) => this.#readJson(req, res),
      verifiedTokenOr401: (req, res) => this.#verifiedTokenOr401(req, res),
      otpVerifyAllowed: (address, now) => this.rateLimit.otpVerifyAllowed(address, now),
      recordOtpFailure: (address, now) => this.rateLimit.recordFailure(address, now),
      recordFailure: (address, now) => this.rateLimit.recordFailure(address, now),
      verifyOtp: (secret, code, address) => this.#verifyOtp(secret, code, address),
      otpActive: () => this.#otpActive(),
      localeFor: (req) => this.#pageLocale(req),
      authEvent: (kind, ip, reason) => this.#authEvent(kind, ip, reason),
      secureCookie: (req) => this.#secureCookie(req),
    })
    // Panel API lives in gateway-panel-api.js; the private helpers it needs
    // are bound here (a separate module cannot call #-private methods). It
    // also OWNS the cookieSecure runtime override (panel-written, persisted
    // through the plugin's credential record) — the cookie minting below
    // consults it for the effective policy.
    this.panelApi = createPanelApi(this, {
      json: (res, status, body, cookie) => this.#json(res, status, body, cookie),
      readJson: (req, res) => this.#readJson(req, res),
      verifiedTokenOr401: (req, res) => this.#verifiedTokenOr401(req, res),
      authEvent: (kind, ip, reason) => this.#authEvent(kind, ip, reason),
      otpActive: () => this.#otpActive(),
    }, { cookieSecureOverride, cookieSecureOverrideStore })
    this.forwarder = createForwarder({
      upstreamHost,
      upstreamPort,
      upstreamSecretReader,
      onError: (err) => { this.onError?.(err) },
    })
    this.server = http.createServer((req, res) => this.#handleHttp(req, res))
    this.server.on('upgrade', (req, socket, head) => this.#handleUpgrade(req, socket, head))
    this.server.on('error', (err) => { this.onError?.(err) })
  }

  /** Set once the "handshake lost its Upgrade header" warning has been
   *  emitted, so a retrying client cannot flood the log; see #handleHttp. */
  #mangledUpgradeWarned = false

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

  /** Global auth rate-limit window (read-only view of the limiter's state;
   *  tests mutate its fields to roll the window over). */
  get globalAuth() {
    return this.rateLimit.globalAuth
  }

  // ── HTTP ──────────────────────────────────────────────────────────────

  /**
   * One-shot operator warning for a WebSocket handshake whose `Upgrade`
   * header was stripped in transit (see #handleHttp). Logged at most once per
   * gateway instance: the client retries its mux socket on a backoff, and a
   * per-attempt warn would flood dsh's ring-buffer log.
   */
  #warnMangledUpgrade() {
    if (this.#mangledUpgradeWarned) return
    this.#mangledUpgradeWarned = true
    this.onError?.(new Error(
      'WebSocket 握手缺少 Upgrade 头——前面的反向代理没有转发 Upgrade/Connection，'
      + '握手被降级成普通 HTTP GET。请在该 location 上配置 '
      + 'proxy_http_version 1.1 + proxy_set_header Upgrade $http_upgrade + '
      + 'proxy_set_header Connection $connection_upgrade；'
      + '详见 docs/zh|en/NGINX-DEPLOYMENT.md 与 docs/zh|en/TROUBLESHOOTING.md 第 7 节',
    ))
  }

  /** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
  async #handleHttp(req, res) {
    // A WebSocket handshake that arrives WITHOUT `Upgrade` is not a WebSocket
    // any more: Node never fires the server's 'upgrade' event, so the request
    // would fall through to the ordinary HTTP path and be forwarded as a plain
    // GET — the upstream answers 404 and the browser only reports an opaque
    // "WebSocket connection failed". The one thing that strips those headers
    // in practice is an edge proxy that does not forward `Upgrade`/
    // `Connection` on this location (see docs/*/NGINX-DEPLOYMENT.md). Say so
    // once, loudly, instead of leaving the operator to guess.
    if (req.headers.upgrade === undefined && req.headers['sec-websocket-key'] !== undefined) {
      this.#warnMangledUpgrade()
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
      res.end('websocket upgrade headers missing: the reverse proxy in front of this '
        + 'gateway did not forward Upgrade/Connection for this path\n')
      return
    }
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
    // could shadow a future internal method. Reads are read-only (the plugin
    // config is boot-time composition); the ONE runtime-tunable field —
    // cookieSecure — has its own POST route below, persisted through the
    // plugin's credential record (see index.js).
    if (req.method === 'GET' && pathname === '/login-api/settings') {
      return this.panelApi.serveSettings(req, res)
    }
    // Session probe for the login page's post-login self-check (see
    // buildScript in lib/login-page.js): 200 whenever the presented cookie
    // names a LIVE session — onboarding sessions included, because the only
    // question is "did the cookie take?". A 401 after a successful login
    // means the browser refused to keep the Set-Cookie (the plain-HTTP
    // entry colliding with an HTTPS entry's Secure cookie), and the login
    // page says so instead of looping back to /login.
    if (req.method === 'GET' && pathname === '/login-api/session') {
      return this.panelApi.serveSessionProbe(req, res)
    }
    if (req.method === 'POST' && pathname === '/login-api/cookie-secure') {
      return this.panelApi.handleSetCookieSecure(req, res)
    }

    // Version / update notice for the settings panel. Same plugin-specific
    // prefix and the same session gate as /login-api/settings: the panel is
    // only reachable behind authentication, so this exposes nothing a
    // logged-out visitor can read. The response always carries the running
    // version and repository; `update` is the cached registry verdict (see
    // lib/update-check.js) and is disabled rather than failing when the
    // check is off or the registry is unreachable.
    if (req.method === 'GET' && pathname === '/login-api/version') {
      return this.panelApi.handleGetVersion(req, res)
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
    // 这些请求发生在认证门之前，因此显式不携带铸出的 upstream cookie：
    // 匿名请求不该运输全权 bearer（upstream 对这些路径本就向匿名浏览器
    // 直接出静态文件，此处属纵深防御）。
    if (req.method === 'GET' && (
      pathname === '/manifest.webmanifest' ||
      pathname === '/favicon.svg' ||
      pathname.startsWith('/assets/')
    )) {
      return this.#forward(req, res, { upstreamAuth: false })
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
    this.rateLimit.prune(now)
    const authIp = req.socket.remoteAddress ?? 'unknown'
    if (!this.rateLimit.globalAuthAllowed(now)) {
      this.#authEvent('login-failed', authIp, 'rate-limited')
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { password, otp, backupCode } = body
    const key = req.socket.remoteAddress ?? 'unknown'

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
      this.rateLimit.recordFailure(key, now)
      entry = this.attempts.get(key)
      if (entry.lockedUntil > now) {
        // Security event is emitted by the rate limiter (once per lockout).
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
      if (!this.rateLimit.otpVerifyAllowed(key, now)) {
        this.#authEvent('login-failed', authIp, 'rate-limited')
        return this.#json(res, 429, { ok: false, error: 'rate-limited' })
      }

      if (hasBackup) {
        const valid = await verifyAndUseBackupCode(backupCode)
        if (!valid) {
          this.rateLimit.recordFailure(key, now)
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
      return this.#json(res, 200, { ok: true }, sessionCookie(token, this.#secureCookieOrWarn(req)))
    }

    const token = this.sessions.issue()
    // A session logged in with the auto-generated initial password must
    // complete onboarding before anything else.
    if (await isInitialPassword()) this.sessions.markNeedsOnboarding(token)
    this.#authEvent('login-success', authIp, 'password')
    this.#json(res, 200, { ok: true }, sessionCookie(token, this.#secureCookieOrWarn(req)))
  }

  /**
   * Anti-brute-force state (global budget, per-address lockout, OTP
   * verification window) lives in the rate limiter — lib/rate-limit.js.
   * Every layer is shared: login failures, OTP/backup-code verification and
   * password change all count toward the same per-address lockout.
   */

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
      this.rateLimit.recordFailure(address, Date.now())
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
    const changeIp = req.socket.remoteAddress ?? 'unknown'
    if (!this.rateLimit.globalAuthAllowed(Date.now())) {
      this.#authEvent('password-change-failed', changeIp, 'rate-limited')
      return this.#json(res, 429, { ok: false, error: 'rate-limited' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { oldPassword, newPassword } = body
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string'
      || newPassword.length === 0) {
      this.#authEvent('password-change-failed', changeIp, 'bad-payload')
      return this.#json(res, 400, { ok: false, error: 'bad-payload' })
    }
    if (!await verifyPassword(oldPassword)) {
      // Wrong old password counts toward the same per-address lockout as
      // login failures: a held session must not enable unlimited guessing.
      const key = req.socket.remoteAddress ?? 'unknown'
      this.rateLimit.recordFailure(key, Date.now())
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
    this.#json(res, 200, { ok: true }, expiredCookie(this.#secureCookie(req)))
  }

  /** POST /login/logout — drop the caller's session. */
  #handleLogout(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    const valid = this.sessions.isValid(token)
    if (valid) {
      this.sessions.revoke(token)
      this.#authEvent('logout', req.socket.remoteAddress ?? 'unknown')
    }
    this.#json(res, 200, { ok: true }, expiredCookie(this.#secureCookie(req)))
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
   * Whether THIS response's session cookie gets the Secure attribute:
   * pinned true/false by the effective policy (panel override or the
   * composition value — see gateway-panel-api.js), else auto-followed from
   * the request's transport (see lib/auth.js requestIsSecure).
   */
  #secureCookie(req) {
    const mode = this.panelApi.cookieSecureMode()
    if (mode === true) return true
    if (mode === false) return false
    return requestIsSecure(req)
  }

  /**
   * Like #secureCookie, but warns through the config-warning sink when a
   * FORCED policy is about to be voided: on a plain-HTTP link the browser
   * refuses to store the Secure cookie, so a login that just succeeded
   * cannot actually hold a session — the most confusing failure of this
   * feature, and on a headless LAN box the panel card that explains it is
   * unlikely to be open. The warning fires at the session-minting call
   * sites only (clearing cookies need no such signal). The plugin wires
   * this sink to a console warning, because ctx.logger alone stays in the
   * in-memory buffer (see index.js).
   * @returns {boolean} the Secure decision, as #secureCookie would give it.
   */
  #secureCookieOrWarn(req) {
    const secure = this.#secureCookie(req)
    // The warning keys off the LINK, not the decision: forced mode always
    // answers secure=true (that is exactly why plain-HTTP browsers refuse
    // the cookie and the login cannot hold a session).
    if (this.panelApi.cookieSecureMode() === true && !requestIsSecure(req)) {
      this.onConfigWarning?.(new Error(
        'dsh-auth-gateway: cookieSecure 已强制开启（true），但当前连接不是 TLS——'
        + '浏览器将拒绝保存 Secure Cookie，刚完成的登录不会生效。'
        + '请为网关前置 TLS（反向代理需透传 X-Forwarded-Proto: https），或把 cookieSecure 改回 auto。',
      ))
    }
    return secure
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

  /**
   * Transparent HTTP forward: strip the basePath prefix, normalize the
   * request-target to origin form, then hand off to the forwarder (which
   * rewrites Host/Origin to the loopback upstream — see lib/forward.js for
   * the security rationale).
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {object} [opts]
   * @param {boolean} [opts.upstreamAuth=true] - gate-passed forwards carry
   *   the minted upstream browser-auth cookie; pass false on the pre-gate
   *   public-asset branch so an anonymous request never transports the
   *   fully-privileged bearer (defense in depth, see lib/forward.js).
   */
  #forward(req, res, { upstreamAuth = true } = {}) {
    const forwardPath = normalizeForwardPath(this.#stripBasePath(req.url))
    if (forwardPath === null) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    this.forwarder.forward(req, res, forwardPath, { upstreamAuth })
  }

  /**
   * WebSocket upgrade forward. Unauthenticated upgrades are rejected
   * outright — the event stream never starts. The transport plumbing lives
   * in the forwarder; this method owns only the gates.
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
    const forwardPath = normalizeForwardPath(this.#stripBasePath(req.url))
    if (forwardPath === null) {
      socket.destroy()
      return
    }
    this.forwarder.upgrade(req, socket, head, forwardPath)
  }
}

/**
 * Create a gateway from plugin config with defaults; validates the numbers.
 * @param {object} [config] - resolved plugin config.
 * @param {object} [runtime] - non-config runtime wiring from the plugin
 *   entry (kept out of config, which is user-facing schema-validated).
 * @param {() => (Buffer | undefined)} [runtime.upstreamSecretReader] - sync
 *   source of the upstream browser-auth signing secret.
 * @param {{version: string, repository: string}} [runtime.versionInfo] -
 *   running plugin identity (lib/version.js).
 * @param {object} [runtime.updateChecker] - new-version checker
 *   (lib/update-check.js); absent → no outbound request is ever made.
 * @param {boolean} [runtime.updateCheckAuto] - allow the automatic check
 *   (the `updateCheck` config; the panel's manual button works regardless).
 */
export function createGateway(config, { upstreamSecretReader, versionInfo, updateChecker, updateCheckAuto, cookieSecureOverride, cookieSecureOverrideStore } = {}) {
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
  return new LoginGateway({ listenHost, listenPort, upstreamHost, upstreamPort, basePath, policy, otp, cookieSecure: config?.cookieSecure ?? 'auto', cookieSecureOverride, cookieSecureOverrideStore, upstreamSecretReader, versionInfo, updateChecker, updateCheckAuto })
}
