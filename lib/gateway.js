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
  constructor({ listenHost, listenPort, upstreamHost, upstreamPort, policy = {} }) {
    this.listenHost = listenHost
    this.listenPort = listenPort
    this.upstreamHost = upstreamHost
    this.upstreamPort = upstreamPort
    this.policy = policy
    this.sessions = new SessionStore()
    /** Failed-login tracker: client address -> { count, lockedUntil }. Public
     * only so tests can simulate lock expiry; not part of the API. */
    this.attempts = new Map()
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
    if (req.method === 'GET' && pathname === '/login/status') {
      return this.#serveStatus(req, res)
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
    this.#forward(req, res)
  }

  /** GET /login — render setup / login / change-password page by state. */
  #serveLoginPage(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    const mode = !hasPassword() ? 'setup'
      : this.sessions.isValid(token) ? 'change'
        : 'auth'
    const html = loginPageHtml({ mode })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(html)
  }

  /**
   * GET /login/status — JSON state probe for the SPA-injected password
   * shortcut. Reveals only what the /login page already implies: whether a
   * password is set and whether THIS request carries a valid session.
   */
  #serveStatus(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    this.#json(res, 200, {
      ok: true,
      setup: hasPassword(),
      authenticated: this.sessions.isValid(token),
    })
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
    setPassword(password)
    const token = this.sessions.issue()
    this.#json(res, 200, { ok: true }, sessionCookie(token))
  }

  /** POST /login/auth — verify password, mint a session. Locked out after
   * `maxLoginFailures` failures per client address for `lockMinutes`. */
  async #handleAuth(req, res) {
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { password } = body
    const key = req.socket.remoteAddress ?? 'unknown'
    const maxFailures = this.policy.maxLoginFailures ?? 5
    const lockMs = (this.policy.lockMinutes ?? 5) * 60 * 1000
    const now = Date.now()

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

    if (typeof password !== 'string' || !verifyPassword(password)) {
      // One uniform 401: never reveal whether a password exists or which part failed.
      entry = this.attempts.get(key) ?? { count: 0, lockedUntil: 0 }
      entry.count += 1
      if (entry.count >= maxFailures) {
        entry.lockedUntil = now + lockMs
        entry.count = 0 // recount after the window passes
        this.attempts.set(key, entry)
        return this.#json(res, 429, {
          ok: false, error: 'too-many-attempts', retryAfterSeconds: Math.ceil(lockMs / 1000),
        })
      }
      this.attempts.set(key, entry)
      return this.#json(res, 401, { ok: false, error: 'invalid-password' })
    }
    this.attempts.delete(key) // success clears the failure counter
    const token = this.sessions.issue()
    this.#json(res, 200, { ok: true }, sessionCookie(token))
  }

  /** POST /login/change — verify old password, set new one, revoke every session. */
  async #handleChange(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!this.sessions.isValid(token)) {
      return this.#json(res, 401, { ok: false, error: 'unauthenticated' })
    }
    const body = await this.#readJson(req, res)
    if (body === undefined) return
    const { oldPassword, newPassword } = body
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string'
      || newPassword.length === 0) {
      return this.#json(res, 400, { ok: false, error: 'bad-payload' })
    }
    if (!verifyPassword(oldPassword)) {
      return this.#json(res, 401, { ok: false, error: 'invalid-password' })
    }
    const strength = validatePasswordStrength(newPassword, this.policy)
    if (!strength.ok) {
      return this.#json(res, 400, { ok: false, error: strength.reason })
    }
    setPassword(newPassword)
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
    const proxyReq = http.request({
      host: this.upstreamHost,
      port: this.upstreamPort,
      path: req.url,
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
    const headers = { ...req.headers } // connection/upgrade headers must survive here
    rewriteLoopbackHeaders(headers, this.upstreamHost, this.upstreamPort)
    const proxyReq = http.request({
      host: this.upstreamHost,
      port: this.upstreamPort,
      path: req.url,
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
    maxLoginFailures: config?.maxLoginFailures ?? 5,
    lockMinutes: config?.lockMinutes ?? 5,
  }
  return new LoginGateway({ listenHost, listenPort, upstreamHost, upstreamPort, policy })
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
