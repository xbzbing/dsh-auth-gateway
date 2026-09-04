/**
 * Upstream browser-auth cookie tests: record validation (same criteria as
 * dsh's storedSecret over the official `client-connection/browser-session`
 * record), cookie minting shape, rotation re-mint, and the end-to-end
 * gateway→upstream hop — HTTP and WebSocket — against a fake
 * dsh-0.1.2-style upstream that 401s every request lacking the
 * authority-bound signed cookie. The secret source is stubbed per test via
 * `upstreamSecretReader` (in production index.js backs it with
 * ctx.credentials.readRecord through a 60s cache).
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractSessionSecret, createUpstreamCookieMinter } from '../lib/upstream-auth.js'
import { LoginGateway } from '../lib/gateway.js'
import { setPassword } from '../lib/store.js'

const b64u = (input) => Buffer.from(input).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** The official record shape dsh persists for its browser-session grant. */
function sessionRecord(secret) {
  return { kind: 'grant', payload: { version: 1, secret: b64u(secret) } }
}

// ── record validation (mirrors dsh's storedSecret acceptance criteria) ──

test('extractSessionSecret: accepts the grant record and yields the 32-byte secret', () => {
  const secret = randomBytes(32)
  assert.deepEqual(extractSessionSecret(sessionRecord(secret)), secret)
})

test('extractSessionSecret: rejects wrong kind, version, length or encoding', () => {
  const secret = randomBytes(32)
  assert.equal(extractSessionSecret(undefined), undefined)
  assert.equal(extractSessionSecret({ payload: sessionRecord(secret).payload }), undefined, 'kind must be grant')
  assert.equal(
    extractSessionSecret({ kind: 'api-key', payload: sessionRecord(secret).payload }),
    undefined,
    'kind must be grant',
  )
  assert.equal(
    extractSessionSecret({ kind: 'grant', payload: { version: 2, secret: b64u(secret) } }),
    undefined,
    'payload version must be 1',
  )
  assert.equal(
    extractSessionSecret({ kind: 'grant', payload: { version: 1, secret: b64u(randomBytes(16)) } }),
    undefined,
    'secret must be 32 bytes',
  )
  assert.equal(
    extractSessionSecret({ kind: 'grant', payload: { version: 1, secret: 'not base64url!' } }),
    undefined,
    'secret must be base64url',
  )
  assert.equal(
    extractSessionSecret({ kind: 'grant', payload: { version: 1 } }),
    undefined,
    'secret must be present',
  )
})

// ── cookie minting ──────────────────────────────────────────────────────

test('minter produces the cookie shape dsh validates, bound to the authority', () => {
  const secret = randomBytes(32)
  const authority = '127.0.0.1:45678'
  const header = createUpstreamCookieMinter(authority, () => secret).cookieHeader()
  assert.match(header, /^dsh-auth-[A-Za-z0-9_-]+=/)
  assert.equal(
    header.slice(0, header.indexOf('=')),
    'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()),
  )

  const value = header.slice(header.indexOf('=') + 1)
  const [version, body, signature] = value.split('.')
  assert.equal(version, 'v1')
  assert.equal(signature, b64u(createHmac('sha256', secret).update(body).digest()))
  const payload = JSON.parse(Buffer.from(
    body.replaceAll('-', '+').replaceAll('_', '/'), 'base64',
  ).toString('utf8'))
  assert.equal(payload.version, 1)
  assert.equal(payload.authority, authority)
  assert.ok(payload.expiresAt > payload.issuedAt)
})

test('minter without a secret source yields undefined (dsh ≤ 0.1.1 degrade)', () => {
  assert.equal(createUpstreamCookieMinter('127.0.0.1:1').cookieHeader(), undefined)
  assert.equal(createUpstreamCookieMinter('127.0.0.1:1', () => undefined).cookieHeader(), undefined)
})

test('minter re-mints as soon as the upstream secret rotates, not at TTL lapse', () => {
  const secretA = randomBytes(32)
  const secretB = randomBytes(32)
  let live = secretA
  const minter = createUpstreamCookieMinter('127.0.0.1:45678', () => live)
  const first = minter.cookieHeader()
  assert.equal(minter.cookieHeader(), first, 'stable secret must reuse the live cookie')

  // dsh-side rotation: the reader picks up the new secret (index.js refreshes
  // its cache within 60s; here instantly). The next request must already
  // carry a cookie signed with the NEW secret.
  live = secretB
  const second = minter.cookieHeader()
  assert.notEqual(second, first)
  const [, body, signature] = second.slice(second.indexOf('=') + 1).split('.')
  assert.equal(signature, b64u(createHmac('sha256', secretB).update(body).digest()),
    're-minted cookie must validate against the new secret')

  // Secret rotated back: re-mint again (fingerprint tracks the live secret,
  // not "the previous one").
  live = secretA
  const third = minter.cookieHeader()
  assert.notEqual(third, second)
  const [, bodyA, signatureA] = third.slice(third.indexOf('=') + 1).split('.')
  assert.equal(signatureA, b64u(createHmac('sha256', secretA).update(bodyA).digest()))
})

test('minter re-mints after the TTL lapses and drops the cookie when the record disappears', () => {
  const secret = randomBytes(32)
  let now = 1_000_000
  let live = secret
  const realNow = Date.now
  Date.now = () => now
  try {
    const minter = createUpstreamCookieMinter('127.0.0.1:45678', () => live)
    const first = minter.cookieHeader()
    assert.equal(minter.cookieHeader(), first, 'within TTL: reuse')

    now += 24 * 60 * 60 * 1000 + 1
    const second = minter.cookieHeader()
    assert.notEqual(second, first, 'past TTL: re-mint (same secret)')

    // Record revoked (dsh global revocation): stop attaching entirely and
    // forget the live cookie.
    live = undefined
    assert.equal(minter.cookieHeader(), undefined)
  } finally {
    Date.now = realNow
  }
})

// ── end-to-end: gateway forwards through a 401-ing upstream ─────────────

let upstream, upstreamPort, seenRequests, gateway, gatewayPort, home
let upstreamSecret        // mutable: the fake upstream always validates against this
let secretKnown = false   // whether the gateway's reader has a record to hand out

/**
 * Fake dsh 0.1.2 upstream: 401 unless the request carries a valid
 * authority-bound cookie (same checks as dsh's isAuthenticated — signature,
 * authority from the Host header, time window). Also accepts WebSocket
 * upgrades with the same rule. Every request records whether it carried
 * the dsh-auth- cookie, so tests can assert who transported the bearer.
 */
function startUpstream() {
  upstreamSecret = randomBytes(32)
  seenRequests = []
  const authorityOf = (headers) => {
    if (headers.host === undefined) return undefined
    try { return new URL(`http://${headers.host}`).host } catch { return undefined }
  }
  const decode = (headers) => {
    const authority = authorityOf(headers)
    if (authority === undefined) return undefined
    const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest())
    const segment = (headers.cookie ?? '').split(';')
      .map((s) => s.trim()).find((s) => s.startsWith(name + '='))
    if (segment === undefined) return undefined
    const [version, body, signature] = segment.slice(name.length + 1).split('.')
    const expected = b64u(createHmac('sha256', upstreamSecret).update(body).digest())
    if (version !== 'v1' || signature !== expected) return undefined
    const payload = JSON.parse(Buffer.from(
      body.replaceAll('-', '+').replaceAll('_', '/'), 'base64',
    ).toString('utf8'))
    if (payload.authority !== authority || payload.expiresAt <= Date.now()) return undefined
    return { authority, payload }
  }
  upstream = http.createServer((req, res) => {
    const cookie = decode(req.headers)
    seenRequests.push({ url: req.url, upstreamCookie: cookie !== undefined })
    // dsh 0.1.2 serves the PWA public assets to anonymous browsers by design;
    // only the index fallback and /api demand the browser-auth cookie.
    const isPublicAsset = req.method === 'GET' && (
      req.url === '/manifest.webmanifest'
      || req.url === '/favicon.svg'
      || req.url.startsWith('/assets/')
    )
    if (cookie === undefined && !isPublicAsset) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ echo: req.url }))
  })
  upstream.on('upgrade', (req, socket) => {
    const cookie = decode(req.headers)
    seenRequests.push({ url: req.url, upgrade: true, upstreamCookie: cookie !== undefined })
    if (cookie === undefined) {
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n'
        + 'dsh web authentication required; reopen the URL printed by dsh web.\n',
      )
      socket.destroy()
      return
    }
    // Minimal 101 handshake so the client-side handshake completes (same
    // pattern as gateway.test.mjs: write then end — a lingering upgrade
    // socket would keep afterEach's gateway.close() from settling).
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'upgrade: websocket\r\nconnection: Upgrade\r\n'
      + 'sec-websocket-accept: test-accept\r\n'
      + '\r\n',
    )
    socket.end(`events for ${req.url}`)
  })
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      upstreamPort = upstream.address().port
      resolve()
    })
  })
}

function request(path, { cookie, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path, method,
      headers: {
        // Non-loopback Host on purpose: the gateway must rewrite it to the
        // loopback authority BEFORE the cookie is minted for it — this makes
        // the rewrite→mint identity part of the assertion (a direct client
        // could not produce a cookie the upstream accepts).
        host: 'test-host:3080',
        ...(cookie !== undefined ? { cookie } : {}),
      },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** WebSocket-style upgrade attempt; resolves 'upgraded' | 'rejected'. */
function tryUpgrade(path, cookie) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path, method: 'GET',
      headers: {
        host: 'test-host:3080',
        connection: 'Upgrade',
        upgrade: 'websocket',
        ...(cookie !== undefined ? { cookie } : {}),
      },
    })
    req.on('upgrade', (res, socket, head) => {
      // The upstream's payload bytes (fused with the handshake) arrive as
      // the `head` argument of the client-side upgrade event.
      resolve({ result: 'upgraded', body: head.toString('utf8') })
    })
    req.on('response', (res) => resolve({ result: `http-${res.statusCode}` }))
    req.on('error', () => resolve({ result: 'rejected' }))
    req.end()
  })
}

/** Preset a personal password and log in through /login/auth (steady state). */
async function login() {
  const password = 'GoodPass1'
  await setPassword(password)
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path: '/login/auth', method: 'POST',
      headers: { host: 'test-host:3080', 'content-type': 'application/json' },
    }, (res) => {
      res.resume()
      res.on('end', () => {
        assert.equal(res.statusCode, 200)
        const setCookie = (res.headers['set-cookie'] ?? [])
          .find((c) => c.startsWith('agw-session=')) ?? res.headers['set-cookie']?.[0]
        resolve(setCookie.split(';')[0])
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify({ password }))
  })
}

before(async () => {
  await startUpstream()
})

after(() => {
  upstream.closeAllConnections()
  upstream.close()
})

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'agw-e2e-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'auth-gateway'), { recursive: true })
  upstreamSecret = randomBytes(32)
  secretKnown = false
  seenRequests = []
  gateway = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
    // Mirrors index.js: sync reads from the live secret; rotation is picked
    // up by re-reading the mutable on the next request.
    upstreamSecretReader: () => (secretKnown ? upstreamSecret : undefined),
  })
  await gateway.start()
  gatewayPort = gateway.address().port
})

afterEach(async () => {
  await gateway.close()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

test('unauthenticated browser still gets the gateway 302, never reaches upstream', async () => {
  const res = await request('/')
  assert.equal(res.status, 302)
})

test('authenticated forward passes the upstream browser-auth gate (HTTP)', async () => {
  secretKnown = true
  const sessionCookie = await login()
  const page = await request('/', { cookie: sessionCookie })
  assert.equal(page.status, 200)
  assert.equal(JSON.parse(page.body).echo, '/')
  assert.equal(seenRequests.at(-1)?.upstreamCookie, true, 'upstream must have seen the minted cookie')
})

test('secret rotation is followed on the very next forwarded request', async () => {
  secretKnown = true
  const sessionCookie = await login()
  assert.equal((await request('/', { cookie: sessionCookie })).status, 200)

  // dsh-side rotation: the record now carries a fresh secret.
  upstreamSecret = randomBytes(32)
  const after = await request('/', { cookie: sessionCookie })
  assert.equal(after.status, 200, 're-mint must follow the rotation immediately')
  assert.equal(JSON.parse(after.body).echo, '/')
})

test('forward degrades to verbatim when no secret is known (dsh ≤ 0.1.1 upstream)', async () => {
  secretKnown = false
  const sessionCookie = await login()
  // The fake upstream is deterministic: the forward still happens (transport
  // unchanged), the upstream just refuses it with its exact 401 body —
  // the gateway itself must not error or alter the response.
  const page = await request('/', { cookie: sessionCookie })
  assert.equal(page.status, 401)
  assert.equal(page.body, 'dsh web authentication required; reopen the URL printed by dsh web.\n')
})

test('WebSocket upgrade forwards the minted cookie and passes the upstream gate', async () => {
  secretKnown = true
  const sessionCookie = await login()
  const ws = await tryUpgrade('/api/events', sessionCookie)
  assert.equal(ws.result, 'upgraded')
  assert.match(ws.body, /^events for \/api\/events$/, 'event stream must actually flow')
  const record = seenRequests.find((r) => r.upgrade)
  assert.equal(record?.upstreamCookie, true, 'the upgrade must transport the minted cookie')
})

test('unauthenticated upgrade is destroyed by the gateway before any forwarding', async () => {
  secretKnown = true
  const ws = await tryUpgrade('/api/events')
  assert.equal(ws.result, 'rejected')
  assert.equal(seenRequests.some((r) => r.upgrade), false, 'nothing may reach the upstream')
})

test('pre-gate public assets forward WITHOUT the minted upstream cookie', async () => {
  secretKnown = true
  const sessionCookie = await login()
  // Even with a valid session, /manifest.webmanifest is served by the
  // pre-gate branch: it must reach the upstream without the bearer.
  const res = await request('/manifest.webmanifest', { cookie: sessionCookie })
  assert.equal(res.status, 200)
  const record = seenRequests.at(-1)
  assert.equal(record?.url, '/manifest.webmanifest')
  assert.equal(record?.upstreamCookie, false, 'anonymous-surface requests must not carry the bearer')
})
