/**
 * Upstream browser-auth cookie tests: secret scraping from
 * $DSH_HOME/.credentials.yaml, cookie minting shape, and the end-to-end
 * gateway→upstream hop against a fake dsh-0.1.2-style upstream that 401s
 * every request lacking the authority-bound signed cookie.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBrowserSessionSecret, createUpstreamCookieMinter } from '../lib/upstream-auth.js'
import { LoginGateway } from '../lib/gateway.js'
import { setPassword } from '../lib/store.js'

const b64u = (input) => Buffer.from(input).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Render a credentials.yaml the way dsh's yaml emitter writes it. */
function writeCredentials(home, secretB64u) {
  writeFileSync(join(home, '.credentials.yaml'), [
    'version: 1',
    'refs:',
    '  SOME_API_KEY: placeholder',
    'records:',
    "  client-connection/browser-session:",
    '    kind: grant',
    '    payload:',
    '      version: 1',
    `      secret: ${secretB64u}`,
    '',
  ].join('\n'))
}

// ── secret scraping ─────────────────────────────────────────────────────

test('readBrowserSessionSecret: extracts the 32-byte secret', () => {
  const home = mkdtempSync(join(tmpdir(), 'agw-secret-'))
  try {
    const secret = randomBytes(32)
    writeCredentials(home, b64u(secret))
    assert.deepEqual(readBrowserSessionSecret(home), secret)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('readBrowserSessionSecret: missing file or record yields undefined', () => {
  const home = mkdtempSync(join(tmpdir(), 'agw-secret-'))
  try {
    assert.equal(readBrowserSessionSecret(home), undefined)
    writeCredentials(home, 'too-short')
    assert.equal(readBrowserSessionSecret(home), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// ── cookie minting ──────────────────────────────────────────────────────

test('minter produces the cookie shape dsh validates, bound to the authority', () => {
  const home = mkdtempSync(join(tmpdir(), 'agw-secret-'))
  try {
    const secret = randomBytes(32)
    writeCredentials(home, b64u(secret))
    const authority = '127.0.0.1:45678'
    const header = createUpstreamCookieMinter(authority, home).cookieHeader()
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
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('minter without a known secret yields undefined (dsh ≤ 0.1.1 degrade)', () => {
  const home = mkdtempSync(join(tmpdir(), 'agw-secret-'))
  try {
    assert.equal(createUpstreamCookieMinter('127.0.0.1:1', home).cookieHeader(), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// ── end-to-end: gateway forwards through a 401-ing upstream ─────────────

let upstream, upstreamPort, gateway, gatewayPort, home, upstreamSecret

/** Fake dsh 0.1.2 upstream: 401 unless the request carries a valid cookie. */
function startUpstream() {
  upstreamSecret = randomBytes(32)
  upstream = http.createServer((req, res) => {
    const authority = `127.0.0.1:${upstreamPort}`
    const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest())
    const segment = (req.headers.cookie ?? '').split(';')
      .map((s) => s.trim()).find((s) => s.startsWith(name + '='))
    if (segment === undefined) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    const [version, body, signature] = segment.slice(name.length + 1).split('.')
    const expected = createHmac('sha256', upstreamSecret).update(body).digest()
    const payload = JSON.parse(Buffer.from(
      body.replaceAll('-', '+').replaceAll('_', '/'), 'base64',
    ).toString('utf8'))
    if (version !== 'v1'
      || signature !== b64u(expected)
      || payload.authority !== authority
      || payload.expiresAt <= Date.now()) {
      res.writeHead(401)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ echo: req.url }))
  })
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      upstreamPort = upstream.address().port
      resolve()
    })
  })
}

function request(path, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path, method: 'GET',
      headers: {
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
  // The gateway's own password store and the upstream secret live side by
  // side under DSH_HOME, exactly as on a real deployment.
  await setPassword('TestPassword1!', {})
  writeCredentials(home, b64u(upstreamSecret))
  gateway = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
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

test('authenticated forward passes the upstream browser-auth gate', async () => {
  // Log in through the real endpoint to obtain a gateway session cookie.
  const loginRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path: '/login/auth', method: 'POST',
      headers: { host: 'test-host:3080', 'content-type': 'application/json' },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ password: 'TestPassword1!' }))
  })
  assert.equal(loginRes.status, 200)
  const setCookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('agw-session='))
    ?? loginRes.headers['set-cookie'][0]
  const sessionCookie = setCookie.split(';')[0]

  const page = await request('/', { cookie: sessionCookie })
  assert.equal(page.status, 200)
  assert.equal(JSON.parse(page.body).echo, '/')
})

test('forward degrades to verbatim when no secret is on disk (dsh ≤ 0.1.1 upstream)', async () => {
  rmSync(join(home, '.credentials.yaml'), { force: true })
  const loginRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path: '/login/auth', method: 'POST',
      headers: { host: 'test-host:3080', 'content-type': 'application/json' },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ password: 'TestPassword1!' }))
  })
  const setCookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('agw-session='))
    ?? loginRes.headers['set-cookie'][0]
  const sessionCookie = setCookie.split(';')[0]
  // The fake upstream 401s without the minted cookie — a pre-0.1.2 upstream
  // would 200; either way the gateway itself must not error.
  const page = await request('/', { cookie: sessionCookie })
  assert.ok(page.status === 200 || page.status === 401)
})
