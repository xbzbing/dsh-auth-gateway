/**
 * basePath tests: sub-path deployment for reverse-proxy scenarios.
 *
 * Covers: route stripping, 302 redirects, forwarding, config validation,
 * and data.next in OTP onboarding.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { LoginGateway } from '../lib/gateway.js'
import { setPassword } from '../lib/store.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── helpers ─────────────────────────────────────────────────────────────

let upstream, upstreamPort, seenRequests

function startUpstream() {
  seenRequests = []
  upstream = http.createServer((req, res) => {
    seenRequests.push({ url: req.url, method: req.method, headers: req.headers })
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  return new Promise((resolve) => {
    upstream.listen(0, '127.0.0.1', () => {
      upstreamPort = upstream.address().port
      resolve()
    })
  })
}

function stopUpstream() {
  return new Promise((resolve) => upstream.close(() => resolve()))
}

async function fetch(port, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

// ── setup ───────────────────────────────────────────────────────────────

let tmpDir, gw

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bp-test-'))
  writeFileSync(join(tmpDir, 'password.json'), '{}')
  process.env.DSH_HOME = tmpDir
  await startUpstream()
  gw = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
    basePath: '/dsh',
  })
  await gw.start()
})

after(async () => {
  await gw.close()
  await stopUpstream()
  rmSync(tmpDir, { recursive: true, force: true })
})

// ── config validation ───────────────────────────────────────────────────

test('path kind: basePath must start with /', async () => {
  const { Config } = await import('../lib/config.js')
  const v = Config['~standard'].validate
  assert.ok(v({ basePath: '/dsh' }).value, '/dsh accepted')
  assert.ok(v({ basePath: '/' }).value, '/ accepted')
  assert.ok(v({ basePath: '../secret' }).issues, '../.. rejected')
  assert.ok(v({ basePath: '' }).issues, 'empty rejected')
  assert.ok(v({ basePath: 'dsh' }).issues, 'no leading / rejected')
})

// ── route stripping ─────────────────────────────────────────────────────

test('basePath route strip: /dsh/login renders login page', async () => {
  const res = await fetch(gw.address().port, '/dsh/login')
  assert.equal(res.status, 200)
  assert.ok(res.body.includes('登录') || res.body.includes('Sign in'), 'login page rendered')
})

test('basePath route strip: /dsh/login/auth matches auth endpoint', async () => {
  const res = await fetch(gw.address().port, '/dsh/login/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  })
  assert.equal(res.status, 401)
})

test('basePath route strip: /login (without prefix) also works (fallback)', async () => {
  const res = await fetch(gw.address().port, '/login')
  assert.equal(res.status, 200)
})

test('basePath boundary: /dsh2/foo is NOT stripped (prefix must end at a path segment)', async () => {
  // Regression: startsWith('/dsh') without a boundary check would turn
  // '/dsh2/foo' into '/2/foo'. Unauthenticated it must 302 to /dsh/login
  // (i.e. treated as a non-gateway path, not corrupted into '/2/foo').
  const res = await fetch(gw.address().port, '/dsh2/foo')
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/dsh/login')
})

// ── 302 redirects ───────────────────────────────────────────────────────

test('basePath redirect: unauthenticated /dsh/ → 302 to /dsh/login', async () => {
  const res = await fetch(gw.address().port, '/dsh/')
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/dsh/login')
})

test('PWA metadata and static assets are served without authentication', async () => {
  // Browsers fetch <link rel="manifest"> with no credentials — the gateway
  // must not redirect them to /login.
  const manifest = await fetch(gw.address().port, '/manifest.webmanifest')
  assert.equal(manifest.status, 200)
  const favicon = await fetch(gw.address().port, '/favicon.svg')
  assert.equal(favicon.status, 200)
  // Static assets (/assets/*) are also served without authentication
  const asset = await fetch(gw.address().port, '/assets/index-abc123.js')
  assert.equal(asset.status, 200)
})

test('basePath redirect: unauthenticated /dsh/api/test → 401 json', async () => {
  const res = await fetch(gw.address().port, '/dsh/api/test', { method: 'POST' })
  assert.equal(res.status, 401)
})

// ── forwarding ──────────────────────────────────────────────────────────

test('basePath forward: upstream receives path without basePath prefix', async () => {
  // Login to get a session
  await setPassword('GoodPass1')
  const authRes = await fetch(gw.address().port, '/dsh/login/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'GoodPass1' }),
  })
  assert.equal(authRes.status, 200, 'auth succeeded: ' + authRes.body)
  const sc = authRes.headers['set-cookie']
  const cookie = Array.isArray(sc) ? sc[0] : sc

  seenRequests.length = 0
  await fetch(gw.address().port, '/dsh/some/path', { headers: { cookie } })
  assert.ok(seenRequests.length > 0, 'upstream received a request')
  const req = seenRequests[seenRequests.length - 1]
  assert.equal(req.url, '/some/path', 'basePath stripped: got ' + req.url)
})

// ── data.next in OTP onboarding ─────────────────────────────────────────

test('data.next includes basePath: otp-page renders correct button text', async () => {
  const { otpSetupPage } = await import('../lib/otp-page.js')
  const html = otpSetupPage({
    uri: 'otpauth://totp/test',
    secret: 'JBSWY3DPEHPK3PXP',
    backupCodes: [],
    digits: 6,
    locale: 'zh',
    basePath: '/dsh',
  })
  // The comparison should use __basePath, not hardcoded '/onboarding/password'
  assert.ok(html.includes("__basePath + '/onboarding/password'"), 'button text comparison uses __basePath')
})

test('data.next root basePath: otp-page renders correct comparison', async () => {
  const { otpSetupPage } = await import('../lib/otp-page.js')
  const html = otpSetupPage({
    uri: 'otpauth://totp/test',
    secret: 'JBSWY3DPEHPK3PXP',
    backupCodes: [],
    digits: 6,
    locale: 'zh',
    basePath: '/',
  })
  // Root basePath: __basePath is '', so comparison is '' + '/onboarding/password' = '/onboarding/password'
  assert.ok(html.includes("__basePath + '/onboarding/password'"), 'same pattern for root basePath')
})

test('all gateway pages inject a defined __basePath (no undefined concatenation)', async () => {
  // Regression: onboarding-page.js once called page(locale, script)(title, sub, fields, basePath)
  // with basePath in the pageScript slot — the real __basePath slot got `undefined`,
  // producing `undefined/login/change` in the browser. Verify every page renders a
  // JSON-encoded basePath (never the bare token `undefined`).
  const { onboardingPageHtml, onboardingPasswordPageHtml } = await import('../lib/onboarding-page.js')
  const { otpSetupPage, otpVerifyPage } = await import('../lib/otp-page.js')
  const { loginPageHtml } = await import('../lib/login-page.js')

  const pages = [
    ['onboarding step1', onboardingPageHtml({ locale: 'zh', basePath: '/dsh' })],
    ['onboarding step2', onboardingPasswordPageHtml({ locale: 'zh', basePath: '/dsh' })],
    ['otp setup', otpSetupPage({ uri: 'x', secret: 'S', backupCodes: [], basePath: '/dsh' })],
    ['otp verify', otpVerifyPage({ basePath: '/dsh' })],
    ['login', loginPageHtml({ mode: 'auth', basePath: '/dsh' })],
  ]
  for (const [name, html] of pages) {
    assert.ok(html.includes('const __basePath = "/dsh"'), `${name}: __basePath defined as "/dsh"`)
    assert.ok(!html.includes('const __basePath = undefined'), `${name}: __basePath must not be undefined`)
  }
  // Root basePath renders empty string
  const rootHtml = loginPageHtml({ mode: 'auth', basePath: '/' })
  assert.ok(rootHtml.includes('const __basePath = ""'), 'root basePath renders empty string')
})

// ── auth audit events ───────────────────────────────────────────────────

test('auth audit: login success/failure, logout and password change emit events', async () => {
  const events = []
  gw.onAuthEvent = (p) => events.push(p)
  await setPassword('GoodPass1')

  // Login failure
  await fetch(gw.address().port, '/dsh/login/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-pass' }),
  })
  const fail = events.find((e) => e.kind === 'login-failed')
  assert.ok(fail, 'login-failed event emitted')
  assert.equal(fail.reason, 'invalid-credentials')
  assert.ok(fail.ip, 'ip recorded')

  // Login success (password only)
  events.length = 0
  const auth = await fetch(gw.address().port, '/dsh/login/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'GoodPass1' }),
  })
  assert.equal(auth.status, 200)
  const ok = events.find((e) => e.kind === 'login-success')
  assert.ok(ok, 'login-success event emitted')
  const sc = auth.headers['set-cookie']
  const cookie = Array.isArray(sc) ? sc[0] : sc

  // Logout
  events.length = 0
  await fetch(gw.address().port, '/dsh/login/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: '{}',
  })
  const logout = events.find((e) => e.kind === 'logout')
  assert.ok(logout, 'logout event emitted')

  // Password change: need a fresh session (logout revoked the old one)
  events.length = 0
  const auth2 = await fetch(gw.address().port, '/dsh/login/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'GoodPass1' }),
  })
  const cookie2 = (Array.isArray(auth2.headers['set-cookie']) ? auth2.headers['set-cookie'][0] : auth2.headers['set-cookie'])
  const change = await fetch(gw.address().port, '/dsh/login/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie2 },
    body: JSON.stringify({ oldPassword: 'GoodPass1', newPassword: 'NewPass123!' }),
  })
  assert.equal(change.status, 200)
  const pw = events.find((e) => e.kind === 'password-change')
  assert.ok(pw, 'password-change event emitted')

  // Events never carry credentials
  for (const e of events) {
    const raw = JSON.stringify(e)
    assert.ok(!raw.includes('GoodPass1') && !raw.includes('NewPass123'), 'no credentials in audit payload')
  }
})
