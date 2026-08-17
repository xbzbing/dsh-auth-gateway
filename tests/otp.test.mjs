/**
 * OTP (TOTP) tests.
 *
 * Covers: TOTP generation/verification, base32 encoding, backup codes,
 * OTP store operations, and OTP gateway routes.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateOTPAuthURI,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../lib/totp.js'
import {
  enableOTP,
  disableOTP,
  getOTPStatus,
  getOTPSecret,
  verifyAndUseBackupCode,
  hasOTP,
} from '../lib/otp-store.js'
import { LoginGateway } from '../lib/gateway.js'
import { hasPassword } from '../lib/store.js'

// ── TOTP algorithm tests ────────────────────────────────────────────────

test('base32 encode/decode round-trip', () => {
  const original = Buffer.from('Hello, World!')
  const encoded = base32Encode(original)
  const decoded = base32Decode(encoded)
  assert.deepEqual(decoded, original)
})

test('generateSecret produces valid base32', () => {
  const secret = generateSecret()
  assert.equal(typeof secret, 'string')
  assert.ok(secret.length > 0)
  // Should be valid base32
  const decoded = base32Decode(secret)
  assert.ok(decoded.length > 0)
})

test('generateTOTP produces 6-digit code', () => {
  const secret = generateSecret()
  const code = generateTOTP(secret)
  assert.equal(typeof code, 'string')
  assert.equal(code.length, 6)
  assert.ok(/^\d{6}$/.test(code))
})

test('verifyTOTP rejects replayed counters', () => {
  const secret = generateSecret()
  const code = generateTOTP(secret)
  const ok = verifyTOTP(secret, code, { lastCounter: null })
  assert.ok(ok.valid)
  assert.equal(typeof ok.counter, 'number')

  // Same code, same time step → replay, rejected by the watermark.
  const replay = verifyTOTP(secret, code, { lastCounter: ok.counter })
  assert.ok(!replay.valid)

  // A code from the next time step is still accepted and advances the watermark.
  const next = generateTOTP(secret, { timestamp: Date.now() + 30000 })
  const nextOk = verifyTOTP(secret, next, { lastCounter: ok.counter })
  assert.ok(nextOk.valid)
  assert.ok(nextOk.counter > ok.counter)
})

test('verifyTOTP accepts valid code', () => {
  const secret = generateSecret()
  const code = generateTOTP(secret)
  const result = verifyTOTP(secret, code)
  assert.ok(result.valid)
  assert.equal(result.delta, 0)
})

test('verifyTOTP rejects invalid code', () => {
  const secret = generateSecret()
  const result = verifyTOTP(secret, '000000')
  assert.ok(!result.valid)
  assert.equal(result.delta, null)
})

test('verifyTOTP with window tolerance', () => {
  const secret = generateSecret()
  const now = Date.now()
  // Generate code for previous time step
  const previousCode = generateTOTP(secret, { timestamp: now - 30000 })
  // Verify with window=1 should accept previous code
  const result = verifyTOTP(secret, previousCode, { window: 1, timestamp: now })
  assert.ok(result.valid)
  assert.equal(result.delta, -1)
})

test('generateOTPAuthURI creates valid URI', () => {
  const secret = generateSecret()
  const uri = generateOTPAuthURI(secret, {
    issuer: 'test-issuer',
    account: 'test@example.com',
  })
  assert.ok(uri.startsWith('otpauth://totp/'))
  assert.ok(uri.includes('secret=' + secret))
  assert.ok(uri.includes('issuer=test-issuer'))
})

test('generateBackupCodes produces correct count', () => {
  const codes = generateBackupCodes(5, 8)
  assert.equal(codes.length, 5)
  for (const code of codes) {
    assert.ok(code.includes('-'))
    assert.equal(code.length, 9) // XXXX-XXXX
  }
})

test('hashBackupCode and verifyBackupCode round-trip', async () => {
  const code = 'ABCD-1234'
  const { hash, salt } = await hashBackupCode(code)
  assert.ok(typeof hash === 'string')
  assert.ok(typeof salt === 'string')
  
  const valid = await verifyBackupCode(code, hash, salt)
  assert.ok(valid)
  
  const invalid = await verifyBackupCode('WRNG-5678', hash, salt)
  assert.ok(!invalid)
})

// ── OTP store tests ─────────────────────────────────────────────────────

let home

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-password-gate-otp-test-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

test('hasOTP returns false initially', () => {
  assert.ok(!hasOTP())
})

test('enableOTP creates secret and backup codes', async () => {
  const result = await enableOTP({
    backupCodeCount: 5,
    backupCodeLength: 8,
  })
  assert.ok(typeof result.secret === 'string')
  assert.equal(result.backupCodes.length, 5)
  assert.ok(hasOTP())
})

test('getOTPStatus returns correct status', async () => {
  await enableOTP()
  const status = getOTPStatus()
  assert.ok(status.enabled)
  assert.equal(status.algorithm, 'SHA1')
  assert.equal(status.digits, 6)
  assert.equal(status.period, 30)
})

test('getOTPSecret returns secret when enabled', async () => {
  await enableOTP()
  const secret = getOTPSecret()
  assert.ok(typeof secret === 'string')
})

test('disableOTP clears OTP data', async () => {
  await enableOTP()
  assert.ok(hasOTP())
  
  disableOTP()
  assert.ok(!hasOTP())
  assert.equal(getOTPSecret(), null)
})

test('verifyAndUseBackupCode works correctly', async () => {
  const { backupCodes } = await enableOTP({ backupCodeCount: 3 })
  const firstCode = backupCodes[0]
  
  const valid = await verifyAndUseBackupCode(firstCode)
  assert.ok(valid)
  
  // Same code should not work twice
  const secondTry = await verifyAndUseBackupCode(firstCode)
  assert.ok(!secondTry)
})

// ── Gateway OTP route tests ─────────────────────────────────────────────

let gateway, gatewayPort

async function startGateway(policy, otpConfig) {
  gateway = new LoginGateway({
    listenHost: '127.0.0.1',
    listenPort: 0,
    upstreamHost: '127.0.0.1',
    upstreamPort: 9999, // Dummy port, not used in these tests
    policy,
    otp: otpConfig || {},
  })
  await gateway.start()
  gatewayPort = gateway.address().port
}

async function stopGateway() {
  await gateway.close()
}

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

/** Set up the initial password and return an authenticated session cookie. */
async function loginCookie() {
  await request('/login/setup', { method: 'POST', body: { password: 'Test1234!' } })
  const login = await request('/login/auth', { method: 'POST', body: { password: 'Test1234!' } })
  const setCookie = login.headers['set-cookie']
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]
}

/** Complete OTP verification for a session so it is fully authenticated. */
async function verifySession(cookie) {
  const code = generateTOTP(getOTPSecret())
  const res = await request('/otp/verify', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(res.status, 200)
}

test('OTP setup page returns 401 when not authenticated', async () => {
  await startGateway({}, { otpEnabled: true })
  const res = await request('/otp/setup')
  assert.equal(res.status, 401)
  await stopGateway()
})

test('OTP setup page returns 400 when OTP not enabled', async () => {
  await startGateway({}, { otpEnabled: false })

  const cookie = await loginCookie()

  // Try to access OTP setup
  const res = await request('/otp/setup', { cookie })
  assert.equal(res.status, 400)
  await stopGateway()
})

test('OTP verify page returns 401 when not authenticated', async () => {
  await startGateway({}, { otpEnabled: true })
  const res = await request('/otp/verify')
  assert.equal(res.status, 401)
  await stopGateway()
})

test('OTP verify returns 400 when OTP not enabled', async () => {
  await startGateway({}, { otpEnabled: false })

  const cookie = await loginCookie()

  // Try to verify OTP
  const res = await request('/otp/verify', { method: 'POST', body: { otp: '123456' }, cookie })
  assert.equal(res.status, 400)
  await stopGateway()
})

test('OTP enable returns 401 when not authenticated', async () => {
  await startGateway({}, { otpEnabled: true })
  const res = await request('/otp/enable', { method: 'POST', body: {} })
  assert.equal(res.status, 401)
  await stopGateway()
})

test('OTP disable returns 401 when not authenticated', async () => {
  await startGateway({}, { otpEnabled: true })
  const res = await request('/otp/disable', { method: 'POST', body: { password: 'test' } })
  assert.equal(res.status, 401)
  await stopGateway()
})

test('OTP disable requires a second-factor credential when OTP is enabled', async () => {
  await startGateway({}, { otpEnabled: true })
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })
  await verifySession(cookie)
  assert.ok(getOTPStatus().enabled)

  // No credential at all → rejected, OTP stays enabled
  const noCred = await request('/otp/disable', { method: 'POST', cookie })
  assert.equal(noCred.status, 400)
  assert.equal(JSON.parse(noCred.body).error, 'otp-required')
  assert.ok(getOTPStatus().enabled)

  // Wrong TOTP code → rejected, OTP stays enabled
  const wrong = await request('/otp/disable', { method: 'POST', cookie, body: { otp: '000000' } })
  assert.equal(wrong.status, 401)
  assert.ok(getOTPStatus().enabled)

  await stopGateway()
})

test('OTP disable succeeds with a valid TOTP code', async () => {
  await startGateway({}, { otpEnabled: true })
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })
  await verifySession(cookie)

  // verifySession already consumed the current time step; use the NEXT step's
  // code so it is not rejected as a replay of the same counter.
  const code = generateTOTP(getOTPSecret(), { timestamp: Date.now() + 30000 })
  const res = await request('/otp/disable', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(res.status, 200)
  assert.ok(!getOTPStatus().enabled)
  await stopGateway()
})

test('OTP disable succeeds with an unused backup code', async () => {
  await startGateway({}, { otpEnabled: true })
  const cookie = await loginCookie()
  const { backupCodes } = await enableOTP({ backupCodeCount: 3 })
  await verifySession(cookie)

  const res = await request('/otp/disable', { method: 'POST', cookie, body: { backupCode: backupCodes[0] } })
  assert.equal(res.status, 200)
  assert.ok(!getOTPStatus().enabled)
  await stopGateway()
})

test('OTP verification is rate-limited per client address', async () => {
  await startGateway({ maxOtpAttemptsPerMinute: 3 }, { otpEnabled: true })
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })

  // 3 attempts inside the budget → ordinary failures
  for (let i = 0; i < 3; i++) {
    const res = await request('/otp/verify', { method: 'POST', cookie, body: { otp: '000000' } })
    assert.equal(res.status, 401)
  }
  // 4th attempt in the same window → throttled
  const blocked = await request('/otp/verify', { method: 'POST', cookie, body: { otp: '000000' } })
  assert.equal(blocked.status, 429)
  assert.equal(JSON.parse(blocked.body).error, 'rate-limited')
  await stopGateway()
})

test('OTP verification shares the global attempt budget', async () => {
  await startGateway({ maxGlobalAuthAttemptsPerMinute: 5, maxOtpAttemptsPerMinute: 100 }, { otpEnabled: true })
  const cookie = await loginCookie() // consumes 1 of the global budget
  await enableOTP({ backupCodeCount: 3 })

  // Budget left: 4 (login took 1). All 4 are consumed by OTP attempts.
  for (let i = 0; i < 4; i++) {
    const res = await request('/otp/verify', { method: 'POST', cookie, body: { otp: '000000' } })
    assert.equal(res.status, 401, `attempt ${i + 1} inside global budget`)
  }
  // The 5th OTP attempt exceeds the shared global window → throttled
  const blocked = await request('/otp/verify', { method: 'POST', cookie, body: { otp: '000000' } })
  assert.equal(blocked.status, 429)
  await stopGateway()
})

test('OTP failures lock the client address like login failures', async () => {
  await startGateway({ maxLoginFailures: 3, lockMinutes: 5, maxOtpAttemptsPerMinute: 100 }, { otpEnabled: true })
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })

  for (let i = 0; i < 3; i++) {
    const res = await request('/otp/verify', { method: 'POST', cookie, body: { otp: '000000' } })
    assert.equal(res.status, 401, `failure ${i + 1}`)
  }
  // Address is now locked: even the correct code is refused.
  const code = generateTOTP(getOTPSecret())
  const locked = await request('/otp/verify', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(locked.status, 429)
  await stopGateway()
})

test('a TOTP code cannot be replayed within its time window', async () => {
  await startGateway({}, { otpEnabled: true })
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })

  const code = generateTOTP(getOTPSecret())
  const first = await request('/otp/verify', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(first.status, 200)
  // Same code, same time step → replay rejected.
  const second = await request('/otp/verify', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(second.status, 401)
  await stopGateway()
})

test('unverified sessions cannot modify config or manage OTP when 2FA is active', async () => {
  await startGateway({}, { otpEnabled: true })
  // Login happens BEFORE OTP is enabled → the session is not OTP-verified.
  const cookie = await loginCookie()
  await enableOTP({ backupCodeCount: 3 })
  assert.ok(getOTPStatus().enabled)

  // Config read/write must be blocked for the unverified session.
  let res = await request('/login-api/settings', { cookie })
  assert.equal(res.status, 401)
  assert.equal(JSON.parse(res.body).error, 'otp-required')
  res = await request('/login-api/settings', { method: 'POST', cookie, body: { 'dsh-password-gate': { otpEnabled: false } } })
  assert.equal(res.status, 401)
  assert.ok(getOTPStatus().enabled, 'OTP must stay enabled — config was not modified')

  // OTP management endpoints must be blocked.
  res = await request('/otp/setup', { cookie })
  assert.equal(res.status, 401)
  res = await request('/otp/enable', { method: 'POST', cookie })
  assert.equal(res.status, 401)
  res = await request('/otp/disable', { method: 'POST', cookie, body: { otp: '000000' } })
  assert.equal(res.status, 401)

  // Password change must be blocked (prevents revoke-all lockout).
  res = await request('/login/change', { method: 'POST', cookie, body: { oldPassword: 'Test1234!', newPassword: 'NewPass123!', confirm: 'NewPass123!' } })
  assert.equal(res.status, 401)

  // But the verification endpoint stays reachable — that is how the session
  // becomes fully authenticated.
  const code = generateTOTP(getOTPSecret())
  res = await request('/otp/verify', { method: 'POST', cookie, body: { otp: code } })
  assert.equal(res.status, 200)

  // After verification the same session regains management access.
  res = await request('/login-api/settings', { cookie })
  assert.equal(res.status, 200)
  await stopGateway()
})
