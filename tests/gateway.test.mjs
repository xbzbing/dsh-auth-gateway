/**
 * Gateway tests against a fake upstream dsh webserver.
 *
 * Covers: initial-password onboarding flow, auth gate on /api and page paths,
 * transparent forwarding with Host/Origin rewritten to the loopback upstream
 * (LAN access must pass the internal trust fence), WebSocket upgrade
 * rejection/forward, password change revoking all sessions, logout, and the
 * 30-day expiry.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LoginGateway } from '../lib/gateway.js'
import { SESSION_TTL_SECONDS } from '../lib/auth.js'
import { setPassword, verifyPassword, isInitialPassword } from '../lib/store.js'
import { generateTOTP } from '../lib/totp.js'
import { createUpdateChecker } from '../lib/update-check.js'

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

async function startGateway(policy, cookieSecure, cookieSecureOverride, cookieSecureOverrideStore) {
  home = mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-test-'))
  process.env.DSH_HOME = home
  gateway = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort,
    ...(policy !== undefined ? { policy } : {}),
    ...(cookieSecure !== undefined ? { cookieSecure } : {}),
    ...(cookieSecureOverride !== undefined ? { cookieSecureOverride } : {}),
    ...(cookieSecureOverrideStore !== undefined ? { cookieSecureOverrideStore } : {}),
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

/** All Set-Cookie values joined into one string for attribute assertions. */
function rawSetCookie(headers) {
  const raw = headers['set-cookie']
  if (raw === undefined) return ''
  return (Array.isArray(raw) ? raw : [raw]).join('; ')
}

/**
 * Preset a non-initial password and log in through /login/auth, returning the
 * session cookie. Mirrors the steady-state flow: the auto-generated initial
 * password exists only on a fresh install, and tests that exercise normal
 * operation use a personal (non-initial) credential.
 */
async function login(password = 'GoodPass1') {
  await setPassword(password)
  const res = await request('/login/auth', { method: 'POST', body: { password } })
  assert.equal(res.status, 200)
  return cookieValue(res.headers)
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

test('fresh install: /login renders the login page; /login/auth answers uniformly', async () => {
  // No password record exists yet. There is no setup page anymore: /login
  // always renders the auth form, and the first credential comes from the
  // harness-side auto-generated initial password (covered next).
  const page = await request('/login')
  assert.equal(page.status, 200)
  assert.ok(page.body.includes('请输入访问密码'))
  assert.ok(!page.body.includes('设置密码'), 'the legacy setup form must be gone')

  // One uniform 401: nothing reveals whether a password exists yet.
  const res = await request('/login/auth', { method: 'POST', body: { password: 'whatever1' } })
  assert.equal(res.status, 401)
  assert.equal(cookieValue(res.headers), undefined)
})

test('initial password: onboarding gate blocks everything until changed', async () => {
  // Fresh install: the harness generates the initial password and stores it
  // flagged `initial` (index.js first-run block); simulate that record here.
  const initial = 'Init1al!pw'
  await setPassword(initial, { initial: true })

  const page = await request('/login')
  assert.ok(page.body.includes('请输入访问密码'))

  // Logging in with the initial password mints a session that owes onboarding.
  const loginRes = await request('/login/auth', { method: 'POST', body: { password: initial } })
  assert.equal(loginRes.status, 200)
  const cookie = cookieValue(loginRes.headers)
  assert.ok(cookie, 'login must set a session cookie')
  const rawSetCookie = (Array.isArray(loginRes.headers['set-cookie'])
    ? loginRes.headers['set-cookie'] : [loginRes.headers['set-cookie']]).join('; ')
  assert.ok(rawSetCookie.includes('HttpOnly'))
  assert.ok(rawSetCookie.includes('SameSite=Strict'))

  // Everything except the onboarding flow itself is blocked.
  const api = await request('/api/session.list', { method: 'POST', body: {}, cookie })
  assert.equal(api.status, 401)
  assert.deepEqual(JSON.parse(api.body), { ok: false, error: 'onboarding-required' })
  const root = await request('/', { cookie })
  assert.equal(root.status, 302)
  assert.equal(root.headers.location, '/onboarding')
  assert.equal(seenRequests.length, 0, 'upstream must never see pre-onboarding traffic')

  // Step 1 (optional OTP binding) is served; step 2 (password) is a
  // separate page, both inside the onboarding flow.
  const onboarding = await request('/onboarding', { cookie })
  assert.equal(onboarding.status, 200)
  assert.ok(onboarding.body.includes('绑定 OTP 双因素认证'), 'step 1: optional OTP binding')
  const step2 = await request('/onboarding/password', { cookie })
  assert.equal(step2.status, 200)
  assert.ok(step2.body.includes('设置你的访问密码'), 'step 2: mandatory password')

  // Set a personal password: the initial flag clears and every session dies.
  const change = await request('/login/change', {
    method: 'POST', body: { oldPassword: initial, newPassword: 'Personal1' }, cookie,
  })
  assert.equal(change.status, 200)
  assert.equal(await isInitialPassword(), false)
  const oldCookie = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(oldCookie.status, 401, 'pre-onboarding session must be revoked')

  // Re-login with the personal password: no onboarding gate, and the request
  // is forwarded with Host/Origin rewritten to the loopback upstream so the
  // internal trust fence accepts any external address (LAN IP included).
  const re = await request('/login/auth', { method: 'POST', body: { password: 'Personal1' } })
  assert.equal(re.status, 200)
  const cookie2 = cookieValue(re.headers)
  const fwd = await request('/api/session.list', { method: 'POST', body: {}, cookie: cookie2 })
  assert.equal(fwd.status, 200)
  assert.equal(seenRequests.length, 1)
  assert.equal(seenRequests[0].host, `127.0.0.1:${upstreamPort}`, 'Host must be rewritten to the loopback upstream')
  assert.deepEqual(JSON.parse(fwd.body), { echo: '/api/session.list', host: `127.0.0.1:${upstreamPort}` })
})

test('onboarding without a session redirects to /login', async () => {
  const res = await request('/onboarding')
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/login')
})

test('cookieSecure auto: plain HTTP stays byte-for-byte the old cookie', async () => {
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  const raw = rawSetCookie(res.headers)
  assert.ok(raw.includes('HttpOnly') && raw.includes('SameSite=Strict'), 'baseline attributes must stay')
  assert.ok(!raw.includes('Secure'),
    'auto mode on a plain-HTTP request must not set Secure — the browser would then refuse to send the cookie back')
})

test('cookieSecure auto: X-Forwarded-Proto https arms Secure', async () => {
  await setPassword('GoodPass1')
  // What a TLS-terminating reverse proxy forwards. The gateway itself is on a
  // plain socket; the browser's link is HTTPS, so the attribute must be set.
  const res = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass1' },
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(res.status, 200)
  assert.ok(rawSetCookie(res.headers).includes('Secure'),
    'a proxy-declared https request must get the Secure attribute')

  // A multi-hop list is read at the first (closest-proxy) entry, and the
  // attribute must survive on the clearing cookie too — a logout over https
  // has to match what login set.
  const cookie = cookieValue(res.headers)
  const logout = await request('/login/logout', {
    method: 'POST', body: {}, cookie,
    headers: { 'x-forwarded-proto': 'https, http' },
  })
  assert.equal(logout.status, 200)
  const cleared = rawSetCookie(logout.headers)
  assert.ok(cleared.includes('Max-Age=0') && cleared.includes('Secure'),
    'the clearing cookie must carry the same Secure attribute')
})

test('cookieSecure true pins Secure on plain HTTP (loud failure, not a silent downgrade)', async () => {
  await stopGateway()
  await startGateway(undefined, true)
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  assert.ok(rawSetCookie(res.headers).includes('Secure'),
    'forced mode must set Secure even without proxy headers — the deployment opted into HTTPS-only')
})

test('cookieSecure false never sets Secure, even behind a proxy header', async () => {
  await stopGateway()
  await startGateway(undefined, false)
  await setPassword('GoodPass1')
  const res = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass1' },
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(res.status, 200)
  assert.ok(!rawSetCookie(res.headers).includes('Secure'),
    'an explicit false must win over transport detection')
})

test('cookieSecure auto: password-change clearing cookie carries Secure over a TLS proxy', async () => {
  await setPassword('GoodPass1')
  const login = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass1' },
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(login.status, 200)
  const cookie = cookieValue(login.headers)
  const change = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'GoodPass1', newPassword: 'NewPass1!' }, cookie,
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(change.status, 200)
  const cleared = rawSetCookie(change.headers)
  assert.ok(cleared.includes('Max-Age=0') && cleared.includes('Secure'),
    'the post-change clearing cookie must match the Secure session cookie')
})

test('cookieSecure true on plain HTTP warns through the config-warning sink', async () => {
  await stopGateway()
  await startGateway(undefined, true)
  const warnings = []
  gateway.onConfigWarning = (err) => warnings.push(err instanceof Error ? err.message : String(err))
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  assert.equal(warnings.length, 1, 'forced cookieSecure on a non-TLS login must warn once')
  assert.ok(warnings[0].includes('cookieSecure'), 'warning must name the misconfiguration')

  // The same forced policy over a proxy-declared HTTPS link is the intended
  // deployment: no warning.
  await stopGateway()
  await startGateway(undefined, true)
  gateway.onConfigWarning = (err) => warnings.push(err instanceof Error ? err.message : String(err))
  await setPassword('GoodPass1')
  const tls = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass1' },
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(tls.status, 200)
  assert.equal(warnings.length, 1, 'a TLS link must not warn')
})

test('settings API reports the cookie Secure policy for the panel card', async () => {
  const cookie = await login()
  const res = await request('/login-api/settings', { cookie })
  assert.equal(res.status, 200)
  const cfg = JSON.parse(res.body).config['dsh-auth-gateway']
  assert.equal(cfg.cookieSecure, 'auto', 'the resolved policy must be readable by the panel')
  assert.equal(cfg.cookieSecureSource, 'deployment', 'without an override the composition owns the policy')
})

/** In-memory stand-in for the plugin's credential-record store (index.js). */
function memoryOverrideStore(initial = null) {
  let stored = initial
  return {
    read: async () => stored,
    write: async (mode) => { stored = mode },
    clear: async () => { stored = null },
  }
}

test('cookieSecure panel override: set through the API, effective immediately', async () => {
  const store = memoryOverrideStore()
  await stopGateway()
  await startGateway(undefined, undefined, null, store)
  const cookie = await login()

  // Unauthenticated writes are refused like every safety-state change.
  const anon = await request('/login-api/cookie-secure', { method: 'POST', body: { mode: 'auto' } })
  assert.equal(anon.status, 401)

  // Panel writes false: the next login must NOT arm Secure even behind a
  // proxy-declared https link (the override beats the transport).
  const audit = []
  gateway.onAuthEvent = (e) => audit.push(e)
  const set = await request('/login-api/cookie-secure', { method: 'POST', body: { mode: false }, cookie })
  assert.equal(set.status, 200)
  const setBody = JSON.parse(set.body)
  assert.equal(setBody.cookieSecure, false)
  assert.equal(setBody.cookieSecureSource, 'panel')
  assert.equal(await store.read(), false, 'the override must be persisted through the store')
  assert.ok(audit.some((e) => e.kind === 'cookie-secure-change'), 'the change must be audited')

  await setPassword('GoodPass2')
  const login2 = await request('/login/auth', {
    method: 'POST', body: { password: 'GoodPass2' },
    headers: { 'x-forwarded-proto': 'https' },
  })
  assert.equal(login2.status, 200)
  assert.ok(!rawSetCookie(login2.headers).includes('Secure'),
    'the panel override false must win over the proxy https header')
  const cookie2 = cookieValue(login2.headers)

  // The settings card shows the panel source + effective mode.
  const settings = await request('/login-api/settings', { cookie: cookie2 })
  const cfg = JSON.parse(settings.body).config['dsh-auth-gateway']
  assert.equal(cfg.cookieSecure, false)
  assert.equal(cfg.cookieSecureSource, 'panel')

  // Lookalike modes are rejected, not coerced.
  const bad = await request('/login-api/cookie-secure', { method: 'POST', body: { mode: 'yes' }, cookie: cookie2 })
  assert.equal(bad.status, 400)
  assert.equal(JSON.parse(bad.body).error, 'invalid-mode')

  // Reset drops the override: the deployment config (auto) rules again.
  const reset = await request('/login-api/cookie-secure', { method: 'POST', body: { reset: true }, cookie: cookie2 })
  assert.equal(reset.status, 200)
  assert.equal(JSON.parse(reset.body).cookieSecureSource, 'deployment')
  assert.equal(await store.read(), null, 'the record must be cleared')
  const settings2 = await request('/login-api/settings', { cookie: cookie2 })
  assert.equal(JSON.parse(settings2.body).config['dsh-auth-gateway'].cookieSecureSource, 'deployment')
  assert.ok(audit.some((e) => e.kind === 'cookie-secure-change' && e.reason === 'reset'),
    'the reset must be audited too')
})

test('cookieSecure boot override (panel record) rules from the first login', async () => {
  await stopGateway()
  await startGateway(undefined, undefined, true) // as if the record held true at apply
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  assert.ok(rawSetCookie(res.headers).includes('Secure'),
    'the persisted panel override must arm Secure from the very first login')
  const cookie = cookieValue(res.headers)
  const settings = await request('/login-api/settings', { cookie })
  const cfg = JSON.parse(settings.body).config['dsh-auth-gateway']
  assert.equal(cfg.cookieSecure, true)
  assert.equal(cfg.cookieSecureSource, 'panel')
})

test('cookieSecure panel write without a record store answers storage-unavailable', async () => {
  // Default startGateway carries no override store (dsh ≤ 0.1.1 surface).
  const cookie = await login()
  const res = await request('/login-api/cookie-secure', { method: 'POST', body: { mode: 'auto' }, cookie })
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error, 'storage-unavailable')
})

test('LAN access: external Host/Origin are rewritten, request passes the fence', async () => {
  const cookie = await login()
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

test('gateway pages follow the dsh preference, then Accept-Language, then zh', async () => {
  // 1. dsh user preference wins over the request header.
  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: en\n')
  const prefEn = await request('/login', { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } })
  assert.ok(prefEn.body.includes('Sign in'), 'preference: en renders English')
  assert.ok(!prefEn.body.includes('请输入访问密码'))

  // 2. No preference: the browser language decides.
  rmSync(join(home, 'settings.yaml'))
  const headerEn = await request('/login', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
  assert.ok(headerEn.body.includes('Sign in'), 'Accept-Language en renders English')
  const headerZh = await request('/login', { headers: { 'accept-language': 'zh-CN,zh;q=0.9' } })
  assert.ok(headerZh.body.includes('请输入访问密码'), 'Accept-Language zh renders Chinese')

  // 3. No header: zh fallback.
  const fallback = await request('/login')
  assert.ok(fallback.body.includes('请输入访问密码'), 'no signal -> zh')
})

test('onboarding and change-password pages follow the same language resolution', async () => {
  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: en\n')
  await setPassword('GoodPass1', { initial: true })
  const loginRes = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  const cookie = cookieValue(loginRes.headers)

  // Step 1 (OTP binding, auto-started) and step 2 (password) are separate
  // pages now.
  const step1 = await request('/onboarding', { cookie })
  assert.ok(step1.body.includes('Bind a TOTP authenticator'), 'onboarding step 1 follows preference')
  assert.ok(step1.body.includes('Verify & enable'), 'step 1 shows the binding flow')
  assert.ok(step1.body.includes('/onboarding/password'), 'step 1 links to the password step')

  const step2 = await request('/onboarding/password', { cookie })
  assert.ok(step2.body.includes('Set your access password'), 'onboarding step 2 follows preference')

  const change = await request('/login', { cookie })
  assert.ok(change.body.includes('Change password'), 'change form follows preference')
})

test('binding OTP mid-onboarding does not revoke the session; the password step finishes and revokes once', async () => {
  // This test binds OTP on a fresh gateway — stop the beforeEach gateway
  // first, or the leaked listener keeps the test file's event loop busy and
  // the file-level test never completes. startGateway takes the policy only
  // (2FA is a user action since 0.3.0; no config switch).
  await stopGateway()
  await startGateway({})
  await setPassword('Init1al!pw', { initial: true })
  const loginRes = await request('/login/auth', { method: 'POST', body: { password: 'Init1al!pw' } })
  const cookie = cookieValue(loginRes.headers)
  assert.ok(cookie)

  // Full HTTP binding flow while the session still owes onboarding.
  const enable = await request('/otp/enable', { method: 'POST', cookie })
  assert.equal(enable.status, 200)
  const secret = JSON.parse(enable.body).secret
  const code = generateTOTP(secret)
  const verify = await request('/otp/verify-setup', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(verify.status, 200)
  const vBody = JSON.parse(verify.body)
  assert.equal(vBody.sessionRevoked, false, 'onboarding session must NOT be revoked by binding')
  assert.equal(vBody.next, '/onboarding/password', 'response points back into onboarding')
  assert.ok(vBody.backupCodes.length > 0)
  // The onboarding branch must NOT clear the cookie either — otherwise the
  // browser loses the session on the way to the password step.
  const verifyCookies = Array.isArray(verify.headers['set-cookie']) ? verify.headers['set-cookie'] : []
  assert.equal(verifyCookies.some((c) => c.startsWith('dsh_auth=')), false,
    'onboarding verify-setup must not expire the session cookie')

  // The session survives and reaches the password step.
  const step2 = await request('/onboarding/password', { cookie })
  assert.equal(step2.status, 200)

  // Finishing the password step revokes everything (single revocation point).
  const change = await request('/login/change', {
    method: 'POST', cookie,
    body: { oldPassword: 'Init1al!pw', newPassword: 'Personal1' },
  })
  assert.equal(change.status, 200)
  const after = await request('/login-api/settings', { cookie })
  assert.equal(after.status, 401, 'session revoked after the password step')
})

test('change-password attempts consume the global auth budget across source addresses', async () => {
  await gateway.close()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  await startGateway({ maxGlobalAuthAttemptsPerMinute: 2, maxLoginFailures: 100 })
  await setPassword('GoodPass1')
  const cookie = await login()

  const first = await request('/login/change', {
    method: 'POST', cookie,
    body: { oldPassword: 'wrong', newPassword: 'NewPass123!' },
  })
  const second = await request('/login/change', {
    method: 'POST', cookie,
    body: { oldPassword: 'wrong', newPassword: 'NewPass123!' },
  })
  assert.equal(first.status, 401)
  assert.equal(second.status, 429)
  assert.equal(JSON.parse(second.body).error, 'rate-limited')
})

test('version API: session-gated, reports identity and the update verdict', async () => {
  // Unauthenticated callers learn nothing — same gate as /login-api/settings.
  const anonymous = await request('/login-api/version')
  assert.equal(anonymous.status, 401)
  assert.equal(JSON.parse(anonymous.body).error, 'unauthenticated')

  const cookie = await login()

  // The harness gateway is built without versionInfo/updateChecker: it must
  // still answer with a well-formed body, and must claim nothing.
  const bare = await request('/login-api/version', { cookie })
  assert.equal(bare.status, 200)
  const bareBody = JSON.parse(bare.body)
  assert.equal(bareBody.ok, true)
  assert.equal(bareBody.version, 'unknown')
  assert.deepEqual(bareBody.update, {
    latest: null, updateAvailable: null, checkedAt: null, error: null,
  })

  // Wire identity and a checker into the SAME instance (a second gateway
  // would carry its own SessionStore and reject this cookie).
  let fetches = 0
  const countingFetch = async () => {
    fetches++
    return { ok: true, status: 200, json: async () => ({ version: '0.7.0' }) }
  }
  gateway.versionInfo = { version: '0.6.0', repository: 'https://github.com/xbzbing/dsh-auth-gateway' }
  gateway.updateChecker = createUpdateChecker({ current: '0.6.0', fetchImpl: countingFetch })

  // DEFAULT-OFF is the contract: with updateCheckAuto unset, opening the panel
  // must NOT reach the registry — it reports only what is already known, and
  // here nothing is known yet.
  assert.equal(gateway.updateCheckAuto, false)
  const passive = await request('/login-api/version', { cookie })
  assert.equal(passive.status, 200)
  const passiveBody = JSON.parse(passive.body)
  assert.equal(passiveBody.version, '0.6.0')
  assert.equal(passiveBody.repository, 'https://github.com/xbzbing/dsh-auth-gateway')
  assert.deepEqual(passiveBody.update, {
    latest: null, updateAvailable: null, checkedAt: null, error: null,
  })
  assert.equal(fetches, 0, 'a panel load must not contact the registry by default')

  // ?refresh=1 is the panel's explicit button: that click is what makes the
  // request, and it works even though automatic checks are off.
  const refreshed = await request('/login-api/version?refresh=1', { cookie })
  assert.equal(refreshed.status, 200)
  const refreshedBody = JSON.parse(refreshed.body)
  assert.equal(fetches, 1, 'the explicit action performs exactly one request')
  assert.equal(refreshedBody.update.updateAvailable, true)
  assert.equal(refreshedBody.update.latest, '0.7.0')
  assert.equal(refreshedBody.update.error, null)

  // The verdict is now cached, so a later passive load reports it for free.
  const cached = await request('/login-api/version', { cookie })
  assert.equal(JSON.parse(cached.body).update.updateAvailable, true)
  assert.equal(fetches, 1, 'a cached verdict needs no new request')

  // With automatic checks enabled, a plain load may check on its own.
  gateway.updateCheckAuto = true
  gateway.updateChecker = createUpdateChecker({ current: '0.6.0', fetchImpl: countingFetch })
  const auto = await request('/login-api/version', { cookie })
  assert.equal(auto.status, 200)
  assert.equal(JSON.parse(auto.body).update.updateAvailable, true)
  assert.equal(fetches, 2, 'the automatic check reaches the registry when enabled')

  // A checker that throws must not take the endpoint down with it.
  gateway.updateChecker = { check: async () => { throw new Error('registry exploded') } }
  const resilient = await request('/login-api/version?refresh=1', { cookie })
  assert.equal(resilient.status, 200)
  const resilientBody = JSON.parse(resilient.body)
  assert.equal(resilientBody.version, '0.6.0')
  assert.equal(resilientBody.update.updateAvailable, null, 'a failed check claims nothing')
})

test('the legacy /login/setup endpoint is gone', async () => {
  await setPassword('GoodPass1')
  // The setup route no longer exists: an unauthenticated request to it is
  // just redirected to /login like any unknown page path, never forwarded,
  // and it cannot mint a session or change the stored password.
  const res = await request('/login/setup', { method: 'POST', body: { password: 'SecondPass2' } })
  assert.equal(res.status, 302)
  assert.equal(res.headers.location, '/login')
  assert.equal(seenRequests.filter((r) => r.url === '/login/setup').length, 0, 'upstream must never see /login/setup')
  assert.equal(await verifyPassword('GoodPass1'), true, 'stored password must be untouched')
  assert.equal(await verifyPassword('SecondPass2'), false)
})

test('login: wrong password 401 (uniform), right password works', async () => {
  await setPassword('GoodPass1')
  const wrong = await request('/login/auth', { method: 'POST', body: { password: 'nope' } })
  assert.equal(wrong.status, 401)
  const right = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(right.status, 200)
  const cookie = cookieValue(right.headers)
  const fwd = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(fwd.status, 200)
})

test('after login the login page shows the change-password form', async () => {
  const cookie = await login()
  const page = await request('/login', { cookie })
  assert.ok(page.body.includes('修改密码'))
  const anon = await request('/login')
  assert.ok(anon.body.includes('请输入访问密码'))
})

test('change password revokes every session; old cookie dies', async () => {
  const cookie = await login('OldPass1')

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
  const cookie = await login('OldPass1')
  const bad = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'wrong', newPassword: 'x' }, cookie,
  })
  assert.equal(bad.status, 401)
})

test('logout revokes the session', async () => {
  const cookie = await login()
  const out = await request('/login/logout', { method: 'POST', body: {}, cookie })
  assert.equal(out.status, 200)
  const after = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(after.status, 401)
})

test('session expiry: token older than the TTL is refused', async () => {
  const cookie = await login()
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
  const outcome = await tryUpgrade('/api/remote.mux')
  assert.equal(outcome, 'rejected')
  assert.equal(upgradedSockets.length, 0)

  const cookie = await login()
  const outcome2 = await tryUpgrade('/api/remote.mux', cookie)
  assert.equal(outcome2, 'upgraded')
  assert.deepEqual(upgradedSockets, [{ url: '/api/remote.mux', host: `127.0.0.1:${upstreamPort}`, origin: undefined }])
})

test('websocket: a session owing onboarding is rejected even with a valid cookie', async () => {
  // Regression: the upgrade path must apply the same onboarding gate as
  // #route — the event stream is data, and "nothing usable before a personal
  // password is set" covers WebSocket channels too.
  const initial = 'Init1al!pw'
  await setPassword(initial, { initial: true })
  const loginRes = await request('/login/auth', { method: 'POST', body: { password: initial } })
  const cookie = cookieValue(loginRes.headers)
  assert.ok(cookie)
  const before = upgradedSockets.length
  const outcome = await tryUpgrade('/api/remote.mux', cookie)
  assert.equal(outcome, 'rejected')
  assert.equal(upgradedSockets.length, before, 'onboarding session must never reach the upstream socket')
})

test('a WebSocket handshake that lost its Upgrade header is refused with a diagnosis', async () => {
  // Root cause of the "登录成功但页面提示连接失败" outage: an edge proxy that
  // does not forward Upgrade/Connection turns the handshake into a plain GET.
  // Node then never fires the server's 'upgrade' event, and without this guard
  // the request would be proxied upstream as an ordinary GET and answered 404,
  // leaving the browser with an opaque "WebSocket connection failed".
  const cookie = await login()
  const warnings = []
  gateway.onError = (err) => warnings.push(err)
  const mangled = {
    // What survives a stripping proxy: the key/version, but no Upgrade.
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
    connection: 'close',
  }

  const before = seenRequests.length
  const upgradesBefore = upgradedSockets.length
  const res = await request('/api/remote.mux', { cookie, headers: mangled })
  assert.equal(res.status, 426)
  assert.match(res.body, /Upgrade/)
  assert.equal(seenRequests.length, before, 'the mangled handshake must not be proxied upstream')
  assert.equal(upgradedSockets.length, upgradesBefore, 'and it must never become an upgrade')
  assert.equal(warnings.length, 1, 'the operator gets one actionable warning')
  assert.match(warnings[0].message, /Upgrade\/Connection/)

  // The mux client backs off and retries: the warning must not repeat per
  // attempt (dsh's ring-buffer log keeps only the last 1000 records), but the
  // request is still refused.
  const again = await request('/api/remote.mux', { cookie, headers: mangled })
  assert.equal(again.status, 426)
  assert.equal(warnings.length, 1, 'warned once per gateway instance')
})

test('bad gateway: upstream down answers 502, not a crash', async () => {
  await closeUpstream()
  try {
    const cookie = await login()
    const res = await request('/api/x', { method: 'POST', body: {}, cookie })
    assert.equal(res.status, 502)
    // Auth endpoints still work while upstream is down.
    const out = await request('/login/logout', { method: 'POST', body: {}, cookie })
    assert.equal(out.status, 200)
  } finally {
    await startUpstream()
  }
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
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
})

// ── password strength + lockout policy ───────────────────────────────────

test('onboarding change rejects weak passwords and keeps the initial flag', async () => {
  const initial = 'Init1al!pw'
  await setPassword(initial, { initial: true })
  const loginRes = await request('/login/auth', { method: 'POST', body: { password: initial } })
  const cookie = cookieValue(loginRes.headers)
  for (const [pw, reason] of [
    ['short1A', 'password-too-short'],
    ['abcdefgh', 'password-too-simple'],
    ['ABCDEFGH', 'password-too-simple'],
  ]) {
    const res = await request('/login/change', {
      method: 'POST', body: { oldPassword: initial, newPassword: pw }, cookie,
    })
    assert.equal(res.status, 400, `${pw} must be rejected`)
    assert.equal(JSON.parse(res.body).error, reason)
  }
  // A failed onboarding change leaves the initial credential intact: the
  // flag is untouched and the session still owes onboarding.
  assert.equal(await isInitialPassword(), true)
  const gate = await request('/api/x', { method: 'POST', body: {}, cookie })
  assert.equal(gate.status, 401)
  assert.deepEqual(JSON.parse(gate.body), { ok: false, error: 'onboarding-required' })
})

test('change rejects weak new passwords', async () => {
  const cookie = await login()
  const res = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'GoodPass1', newPassword: 'weak' }, cookie,
  })
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.body).error, 'password-too-short')
})

test('login locks out after maxLoginFailures for lockMinutes', async () => {
  await setPassword('GoodPass1')
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
  await setPassword('GoodPass1')
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
  await setPassword('GoodPass1')
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

test('rate maps prune stale entries instead of growing without bound', async () => {
  // A distributed brute force rotating IPs would otherwise grow the
  // per-address maps for the whole process lifetime. Seed enough stale
  // entries to cross the sweep threshold, then trigger a sweep via login.
  const stale = { count: 1, lockedUntil: 0, updatedAt: Date.now() - 2 * 60 * 60 * 1000 }
  for (let i = 0; i < 1100; i += 1) gateway.attempts.set(`10.0.0.${i}`, { ...stale })
  for (let i = 0; i < 1100; i += 1) {
    gateway.otpWindows.set(`10.1.0.${i}`, { windowStart: Date.now() - 120 * 1000, count: 1, notified: false })
  }
  assert.ok(gateway.attempts.size > 1024 && gateway.otpWindows.size > 1024, 'seeded maps must exceed the threshold')

  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  assert.ok(gateway.attempts.size <= 1024, `stale attempts pruned, got ${gateway.attempts.size}`)
  assert.ok(gateway.otpWindows.size <= 1024, `stale OTP windows pruned, got ${gateway.otpWindows.size}`)
})

test('change-password failures count toward the address lockout', async () => {
  const cookie = await login('OldPass1')
  for (let i = 0; i < 4; i += 1) {
    const res = await request('/login/change', {
      method: 'POST', body: { oldPassword: 'wrong', newPassword: 'NewPass2' }, cookie,
    })
    assert.equal(res.status, 401, `wrong old password #${i + 1}`)
  }
  // The 5th wrong old-password trips the SHARED lockout.
  const fifth = await request('/login/change', {
    method: 'POST', body: { oldPassword: 'wrong', newPassword: 'NewPass2' }, cookie,
  })
  assert.equal(fifth.status, 429)
  assert.equal(JSON.parse(fifth.body).error, 'too-many-attempts')
  // The lock is shared with /login/auth from the same address.
  const duringLock = await request('/login/auth', { method: 'POST', body: { password: 'OldPass1' } })
  assert.equal(duringLock.status, 429)
})

// ── security review regressions ──────────────────────────────────────────

test('dns-rebinding / cross-site requests without a session cookie are refused at the gateway', async () => {
  // Contract: the gateway's Host/Origin rewrite means the INTERNAL trust
  // fence no longer guards DNS rebinding — that duty moved to the gateway's
  // cookie gate. An unauthenticated request claiming an attacker origin must
  // never reach the upstream, whatever Host/Origin/sec-fetch-site it sends.
  await setPassword('GoodPass1')
  const rebindingHeaders = {
    host: 'evil.example:8002',
    origin: 'http://evil.example',
    'sec-fetch-site': 'cross-site',
  }
  const api = await request('/api/session.list', {
    method: 'POST', body: {}, headers: rebindingHeaders,
  })
  assert.equal(api.status, 401, 'rebinding /api must be refused without a session')
  const page = await request('/', { headers: rebindingHeaders })
  assert.equal(page.status, 302, 'rebinding page must redirect to login')
  assert.equal(seenRequests.length, 0, 'upstream must never see unauthenticated rebinding traffic')
})

test('forged session cookie does not pass the gate (cookie is the only credential)', async () => {
  await setPassword('GoodPass1')
  const res = await request('/api/session.list', {
    method: 'POST', body: {},
    cookie: 'dsh_auth=forged-token-that-is-not-in-the-table',
    headers: { host: '192.168.31.100:8002', origin: 'http://192.168.31.100:8002' },
  })
  assert.equal(res.status, 401)
  assert.equal(seenRequests.length, 0)
})

test('absolute-form request targets are normalized before forwarding', async () => {
  const cookie = await login()
  const res = await request('http://evil.example:8002/api/abs?x=1#frag', {
    method: 'POST', body: {}, cookie,
  })
  assert.equal(res.status, 200)
  assert.equal(seenRequests.at(-1).url, '/api/abs?x=1', 'absolute target must become origin-form, hash dropped')
  // Unparsable-per-HTTP target: an authenticated request is forwarded with
  // its origin-form pathname (the upstream webserver answers 400 on the bad
  // escape); the gateway must not crash or fabricate a destination.
  const token = cookie.split('=')[1]
  const bad = await new Promise((resolve, reject) => {
    const sock = net.connect(gatewayPort, '127.0.0.1', () => {
      sock.write(`GET /%%%bad HTTP/1.1\r\nHost: x\r\nCookie: dsh_auth=${token}\r\nConnection: close\r\n\r\n`)
    })
    let data = ''
    sock.on('data', (c) => { data += c })
    sock.on('close', () => resolve(data.split(' ')[1] ?? '0'))
    sock.on('error', reject)
  })
  assert.ok(bad.startsWith('2') || bad.startsWith('4'), `gateway must answer, got ${bad}`)
  assert.equal(seenRequests.at(-1).url, '/%%%bad', 'origin-form pathname forwarded verbatim')
})

test('global auth rate limit caps total attempts across all sources', async () => {
  await stopGateway()
  try {
    await startGateway({ maxGlobalAuthAttemptsPerMinute: 3 })
    await setPassword('GoodPass1')
    // Three attempts are inside the budget.
    for (let i = 0; i < 3; i += 1) {
      const res = await request('/login/auth', { method: 'POST', body: { password: 'nope' } })
      assert.ok([401, 200].includes(res.status), `attempt ${i + 1} must be served`)
    }
    // The fourth attempt in the same minute is capped globally.
    const capped = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
    assert.equal(capped.status, 429)
    assert.equal(JSON.parse(capped.body).error, 'rate-limited')
    // The window rolls over: a fresh minute serves attempts again.
    gateway.globalAuth.windowStart = Date.now() - 61 * 1000
    const after = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
    assert.equal(after.status, 200)
  } finally {
    await stopGateway()
  }
})

test('scrypt runs off the event loop: login requests do not serialize a CPU-bound hash', async () => {
  // Regression for the scryptSync CPU-DoS: verifyPassword must be async
  // (libuv pool). We assert the handler awaits it by issuing two concurrent
  // logins and expecting both to complete (a synchronous hash would still
  // complete, so this is a structural check via the API contract: the store
  // functions return promises).
  const store = await import('../lib/store.js')
  assert.ok(store.verifyPassword('x') instanceof Promise, 'verifyPassword must be async')
  assert.ok(store.setPassword('x') instanceof Promise, 'setPassword must be async')
})

test('brute-force lockout emits one lockout security event', async () => {
  const events = []
  gateway.onSecurityEvent = (p) => events.push(p)
  await setPassword('GoodPass1')
  for (let i = 0; i < 5; i += 1) {
    await request('/login/auth', { method: 'POST', body: { password: 'wrong' } })
  }
  assert.equal(events.length, 1, 'exactly one lockout alert per lockout')
  assert.equal(events[0].kind, 'lockout')
  assert.equal(events[0].sourceAddress, '127.0.0.1')
  assert.equal(events[0].maxFailures, 5)
  assert.ok(events[0].lockedUntil > Date.now())
  // Attempts inside the lock window do not re-notify.
  await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(events.length, 1)
})

test('global rate limit emits once per exhausted window', async () => {
  await stopGateway()
  try {
    await startGateway({ maxGlobalAuthAttemptsPerMinute: 3 })
    const events = []
    gateway.onSecurityEvent = (p) => events.push(p)
    await setPassword('GoodPass1')
    for (let i = 0; i < 5; i += 1) {
      await request('/login/auth', { method: 'POST', body: { password: 'nope' } })
    }
    const rateEvents = events.filter((e) => e.kind === 'global-rate-limit')
    assert.equal(rateEvents.length, 1, 'one alert per window, not per request')
    assert.equal(rateEvents[0].limit, 3)
    assert.equal(rateEvents[0].windowSeconds, 60)
    // A fresh window resets the alert flag (first 3 attempts are inside the
    // new budget; the 4th exhausts it and alerts again).
    gateway.globalAuth.windowStart = Date.now() - 61 * 1000
    for (let i = 0; i < 4; i += 1) {
      await request('/login/auth', { method: 'POST', body: { password: 'nope' } })
    }
    const afterRoll = events.filter((e) => e.kind === 'global-rate-limit')
    assert.equal(afterRoll.length, 2, 'new window alerts again')
  } finally {
    await stopGateway()
  }
})
