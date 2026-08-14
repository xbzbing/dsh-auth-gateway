/**
 * Gateway tests against a fake upstream dsh webserver.
 *
 * Covers: first-run setup flow, auth gate on /api and page paths, transparent
 * forwarding with Host/Origin rewritten to the loopback upstream (LAN access
 * must pass the internal trust fence), WebSocket upgrade rejection/forward,
 * password change revoking all sessions, logout, and the 30-day expiry.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LoginGateway } from '../lib/gateway.js'
import { SESSION_TTL_SECONDS } from '../lib/auth.js'
import { hasPassword } from '../lib/store.js'

// ── fake upstream ───────────────────────────────────────────────────────

let upstream, upstreamPort, seenRequests, upgradedSockets

function startUpstream() {
  seenRequests = []
  upgradedSockets = []
  upstream = http.createServer((req, res) => {
    seenRequests.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, method: req.method })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ echo: req.url, host: req.headers.host }))
  })
  upstream.on('upgrade', (req, socket) => {
    upgradedSockets.push({ url: req.url, host: req.headers.host, origin: req.headers.origin })
    // Minimal 101 handshake so the client-side handshake completes.
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.end()
  })
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      upstreamPort = upstream.address().port
      resolve()
    })
  })
}

function closeUpstream() {
  return new Promise((resolve) => {
    upstream.closeAllConnections()
    upstream.close(() => resolve())
  })
}

// ── gateway under test ──────────────────────────────────────────────────

let gateway, gatewayPort, home

async function startGateway() {
  home = mkdtempSync(join(tmpdir(), 'dsh-password-gate-test-'))
  process.env.DSH_HOME = home
  gateway = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
  })
  await gateway.start()
  gatewayPort = gateway.address().port
}

async function stopGateway() {
  await gateway.close()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
}

// ── http helpers ────────────────────────────────────────────────────────

/** Raw request; resolves {status, headers, body}. Redirects not followed. */
function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: gatewayPort,
      path,
      method,
      headers: {
        host: 'test-host:3080',
        ...(cookie !== undefined ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
}

/** Extract the dsh_auth cookie value from a set-cookie response header. */
function cookieValue(headers) {
  const raw = headers['set-cookie']
  if (raw === undefined) return undefined
  const list = Array.isArray(raw) ? raw : [raw]
  const hit = list.find((c) => c.startsWith('dsh_auth='))
  return hit?.split(';')[0]
}

/** WebSocket-style upgrade attempt; resolves 'upgraded' | 'rejected'. */
function tryUpgrade(path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: gatewayPort,
      path,
      method: 'GET',
      headers: {
        host: 'test-host:3080',
        connection: 'Upgrade',
        upgrade: 'websocket',
        ...(cookie !== undefined ? { cookie } : {}),
      },
    })
    req.on('upgrade', () => resolve('upgraded'))
    req.on('response', (res) => resolve(`http-${res.statusCode}`))
    req.on('error', () => resolve('rejected'))
    req.end()
  })
}

// ── tests ───────────────────────────────────────────────────────────────

before(async () => { await startUpstream() })
after(async () => { await closeUpstream() })
beforeEach(async () => { await startGateway() })
afterEach(async () => { await stopGateway() })

test('unauthenticated: /api answers 401 json', async () => {
  const res = await request('/api/session.list', { method: 'POST', body: {} })
  assert.equal(res.status, 401)
  assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'unauthenticated' })
  assert.equal(seenRequests.length, 0, 'upstream must never see the request')
})

test('unauthenticated: page paths redirect to /login', async () => {
  const res = await request('/')
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/login')
  const res2 = await request('/plugins/whatever.js')
  assert.equal(res2.status, 302)
  assert.equal(seenRequests.length, 0)
})

test('first run: /login renders the setup page; setup mints a session', async () => {
  const page = await request('/login')
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('设置密码'))

  const setup = await request('/login/setup', { method: 'POST', body: { password: 'HuntEr2Pass' } })
  assert.equal(setup.status, 200)
  const cookie = cookieValue(setup.headers)
  assert.ok(cookie, 'setup must set a session cookie')
  const rawSetCookie = (Array.isArray(setup.headers['set-cookie'])
    ? setup.headers['set-cookie'] : [setup.headers['set-cookie']]).join('; ')
  assert.ok(rawSetCookie.includes('HttpOnly'))
  assert.ok(rawSetCookie.includes('SameSite=Strict'))

  // Now authenticated: the request is forwarded; Host/Origin are rewritten to
  // the loopback upstream so the internal trust fence accepts any external
  // address (LAN IP included).
  const fwd = await request('/api/session.list', { method: 'POST', body: {}, cookie })
  assert.equal(fwd.status, 200)
  assert.equal(seenRequests.length, 1)
  assert.equal(seenRequests[0].host, `127.0.0.1:${upstreamPort}`, 'Host must be rewritten to the loopback upstream')
  assert.deepEqual(JSON.parse(fwd.body), { echo: '/api/session.list', host: `127.0.0.1:${upstreamPort}` })
})

test('LAN access: external Host/Origin are rewritten, request passes the fence', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  // What a browser on the LAN sends: Host and Origin name the machine's LAN
  // address. The upstream (the dsh trust fence) must see the loopback form.
  const res = await request('/api/llm.providers', {
    method: 'POST', body: {}, cookie,
    headers: {
      host: '192.168.31.100:8002',
      origin: 'http://192.168.31.100:8002',
      'sec-fetch-site': 'same-origin',
    },
  })
  assert.equal(res.status, 200)
  assert.equal(seenRequests.at(-1).host, `127.0.0.1:${upstreamPort}`)
})

test('setup refused once a password exists', async () => {
  await request('/login/setup', { method: 'POST', body: { password: 'FirstPass1' } })
  const again = await request('/login/setup', { method: 'POST', body: { password: 'SecondPass2' } })
  assert.equal(again.status, 409)
  assert.equal(again.body, '{"ok":false,"error":"already-setup"}')
})

test('login: wrong password 401 (uniform), right password works', async () => {
  await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const wrong = await request('/login/auth', { method: 'POST', body: { password: 'nope' } })
  assert.equal(wrong.status, 401)
  const right = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(right.status, 200)
  const cookie = cookieValue(right.headers)
  const fwd = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(fwd.status, 200)
})

test('after login the login page shows the change-password form', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const page = await request('/login', { cookie })
  assert.ok(page.body.includes('修改密码'))
  const anon = await request('/login')
  assert.ok(anon.body.includes('请输入访问密码'))
})

test('change password revokes every session; old cookie dies', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'OldPass1' } })
  const cookie = cookieValue(setup.headers)

  const change = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'OldPass1', newPassword: 'NewPass2' }, cookie,
  })
  assert.equal(change.status, 200)

  const oldCookie = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(oldCookie.status, 401, 'old session must be revoked')

  // The new password works; the old one does not.
  const bad = await request('/login/auth', { method: 'POST', body: { password: 'OldPass1' } })
  assert.equal(bad.status, 401)
  const good = await request('/login/auth', { method: 'POST', body: { password: 'NewPass2' } })
  assert.equal(good.status, 200)
})

test('change password requires the old password', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'OldPass1' } })
  const cookie = cookieValue(setup.headers)
  const bad = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'wrong', newPassword: 'x' }, cookie,
  })
  assert.equal(bad.status, 401)
})

test('logout revokes the session', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const out = await request('/login/logout', { method: 'POST', body: {}, cookie })
  assert.equal(out.status, 200)
  const after = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(after.status, 401)
})

test('session expiry: token older than the TTL is refused', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const token = cookie.split('=')[1]
  // Rewind the clock by hand (the store lazy-expires on check).
  const session = [...gateway.sessions.sessions.entries()].find(([, s]) => s.expiresAt > 0)
  assert.ok(session)
  session[1].expiresAt = Date.now() - 1
  assert.equal(SESSION_TTL_SECONDS > 0, true)
  const res = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(res.status, 401)
  assert.equal(gateway.sessions.sessions.has(token), false, 'expired token must be dropped')
})

test('websocket: unauthenticated upgrade rejected, authenticated forwarded', async () => {
  const outcome = await tryUpgrade('/api/events.mux')
  assert.equal(outcome, 'rejected')
  assert.equal(upgradedSockets.length, 0)

  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const outcome2 = await tryUpgrade('/api/events.mux', cookie)
  assert.equal(outcome2, 'upgraded')
  assert.deepEqual(upgradedSockets, [{ url: '/api/events.mux', host: `127.0.0.1:${upstreamPort}`, origin: undefined }])
})

test('bad gateway: upstream down answers 502, not a crash', async () => {
  await closeUpstream()
  try {
    const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
    const cookie = cookieValue(setup.headers)
    const res = await request('/api/x', { method: 'POST', body: {}, cookie })
    assert.equal(res.status, 502)
    // Auth endpoints still work while upstream is down.
    const out = await request('/login/logout', { method: 'POST', body: {}, cookie })
    assert.equal(out.status, 200)
  } finally {
    await startUpstream()
  }
})

test('GET /login/status reports setup and authentication state', async () => {
  // Fresh deployment: no password, not authenticated.
  const fresh = await request('/login/status')
  assert.equal(fresh.status, 200)
  assert.deepEqual(JSON.parse(fresh.body), { ok: true, setup: false, authenticated: false })

  // After setup the request that set it up is authenticated.
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const authed = await request('/login/status', { cookie })
  assert.deepEqual(JSON.parse(authed.body), { ok: true, setup: true, authenticated: true })

  // An anonymous request on the configured deployment: setup true, not authed.
  const anon = await request('/login/status')
  assert.deepEqual(JSON.parse(anon.body), { ok: true, setup: true, authenticated: false })
})

test('malformed json body answers 400', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path: '/login/auth', method: 'POST',
      headers: { host: 'test-host:3080', 'content-type': 'application/json' },
    }, (r) => {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.write('{not json')
    req.end()
  })
  assert.equal(res.status, 400)
})

test('duplicate mount: a second gateway on the same port fails loud', async () => {
  // A duplicate plugin row mounts the plugin twice; the second gateway cannot
  // bind the port the first one owns, and start() must reject (the loader
  // turns that into a loud boot failure) instead of silently half-working.
  const second = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: gatewayPort, // same port the active gateway owns
    upstreamHost: '127.0.0.1',
    upstreamPort,
  })
  await assert.rejects(second.start(), /EADDRINUSE/)
  // The first gateway keeps serving unaffected.
  const res = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
})

// ── password strength + lockout policy ───────────────────────────────────

test('setup rejects weak passwords with a stable reason', async () => {
  for (const [pw, reason] of [
    ['short1A', 'password-too-short'],
    ['abcdefgh', 'password-too-simple'],
    ['ABCDEFGH', 'password-too-simple'],
  ]) {
    const res = await request('/login/setup', { method: 'POST', body: { password: pw } })
    assert.equal(res.status, 400, `${pw} must be rejected`)
    assert.equal(JSON.parse(res.body).error, reason)
  }
  assert.equal(hasPassword(), false, 'no password may be stored by weak attempts')
})

test('change rejects weak new passwords', async () => {
  const setup = await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(setup.headers)
  const res = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'GoodPass1', newPassword: 'weak' }, cookie,
  })
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error, 'password-too-short')
})

test('login locks out after maxLoginFailures for lockMinutes', async () => {
  await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  // 1-4 wrong attempts: 401, still unlocked.
  for (let i = 0; i < 4; i += 1) {
    const res = await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
    assert.equal(res.status, 401)
  }
  // 5th wrong attempt: locks immediately with 429 + retry window.
  const fifth = await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
  assert.equal(fifth.status, 429)
  const fifthBody = JSON.parse(fifth.body)
  assert.equal(fifthBody.error, 'too-many-attempts')
  assert.ok(fifthBody.retryAfterSeconds > 0)
  // Locked: even the CORRECT password is refused.
  const duringLock = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(duringLock.status, 429)
  // Simulate the window passing: the entry resets and login works again.
  for (const [key, entry] of gateway.attempts) entry.lockedUntil = Date.now() - 1
  const after = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(after.status, 200)
})

test('successful login resets the failure counter', async () => {
  await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  for (let i = 0; i < 3; i += 1) {
    await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
  }
  const okLogin = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(okLogin.status, 200)
  // Counter cleared: three more wrong attempts must NOT lock (4+4 < 5 would
  // lock if the counter had not been reset after success).
  for (let i = 0; i < 3; i += 1) {
    const res = await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
    assert.equal(res.status, 401)
  }
  const stillFree = await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
  assert.equal(stillFree.status, 401)
})

test('lockout keys on the socket address and ignores x-forwarded-for', async () => {
  await request('/login/setup', { method: 'POST', body: { password: 'GoodPass1' } })
  for (let i = 0; i < 5; i += 1) {
    await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
  }
  // Forged forwarding headers must not reset the counter or bypass the lock.
  const spoofed = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass1' },
    headers: { 'x-forwarded-for': '10.0.0.9' },
  })
  assert.equal(spoofed.status, 429)
})
