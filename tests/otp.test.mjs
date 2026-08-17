/**
 * OTP (TOTP) tests.
 *
 * Covers: TOTP generation/verification, base32 encoding, backup codes,
 * OTP store operations, and OTP gateway routes.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
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
import { loginPageHtml } from '../lib/login-page.js'
import { otpSetupPage, otpVerifyPage } from '../lib/otp-page.js'
import {
  enableOTP,
  disableOTP,
  getOTPStatus,
  getOTPSecret,
  getLastCounter,
  setLastCounter,
  verifyAndUseBackupCode,
  hasOTP,
} from '../lib/otp-store.js'
import { LoginGateway } from '../lib/gateway.js'
import { setPassword } from '../lib/store.js'

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
  home = mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-otp-test-'))
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

test('corrupt otp.json fails loud instead of silently disabling 2FA', async () => {
  const dir = join(home, 'auth-gate')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, 'otp.json'), '{not json', { mode: 0o600 })

  // Every read path must throw (fail loud, like password.json) — a silent
  // `enabled: false` would let the next login skip 2FA entirely.
  assert.throws(() => getOTPStatus(), /cannot read .*otp\.json/)
  assert.throws(() => getOTPSecret(), /cannot read/)
  assert.throws(() => getLastCounter(), /cannot read/)
  assert.throws(() => setLastCounter(123), /cannot read/)
  await assert.rejects(verifyAndUseBackupCode('x'), /cannot read/)
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

/** Set a non-initial password and return an authenticated session cookie. */
async function loginCookie() {
  await setPassword('Test1234!')
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

test('OTP setup page is served without any config switch', async () => {
  // Enabling 2FA is a user action — no otpEnabled deployment switch is
  // required anymore: a verified session may start the binding flow.
  await startGateway({}, { otpEnabled: false })

  const cookie = await loginCookie()

  const res = await request('/otp/setup', { cookie })
  assert.equal(res.status, 200)
  assert.ok(res.body.includes('id="qr"'), 'setup page must render the QR code')
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

test('login accepts a backup code when 2FA is active (lost authenticator)', async () => {
  await startGateway({}, { otpEnabled: true })
  await setPassword('Test1234!')
  const { backupCodes } = await enableOTP({ backupCodeCount: 3 })

  // No code at all → the server demands one of otp|backupCode.
  const noCode = await request('/login/auth', { method: 'POST', body: { password: 'Test1234!' } })
  assert.equal(noCode.status, 400)
  assert.equal(JSON.parse(noCode.body).error, 'otp-required')

  // Wrong backup code → 401, nothing consumed.
  const wrong = await request('/login/auth', {
    method: 'POST', body: { password: 'Test1234!', backupCode: 'WRONGCODE' },
  })
  assert.equal(wrong.status, 401)
  assert.equal(JSON.parse(wrong.body).error, 'invalid-backup-code')

  // Valid backup code → 200 + session, fully verified in one step.
  const good = await request('/login/auth', {
    method: 'POST', body: { password: 'Test1234!', backupCode: backupCodes[0] },
  })
  assert.equal(good.status, 200)
  const setCookie = good.headers['set-cookie']
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]
  const settings = await request('/login-api/settings', { cookie })
  assert.equal(settings.status, 200, 'backup-code session must be fully verified (no /otp/verify hop)')

  // Backup codes are single-use: the same code must not log in twice.
  const replay = await request('/login/auth', {
    method: 'POST', body: { password: 'Test1234!', backupCode: backupCodes[0] },
  })
  assert.equal(replay.status, 401)
  assert.equal(JSON.parse(replay.body).error, 'invalid-backup-code')

  // The TOTP path still works alongside the backup path.
  const totpLogin = await request('/login/auth', {
    method: 'POST', body: { password: 'Test1234!', otp: generateTOTP(getOTPSecret()) },
  })
  assert.equal(totpLogin.status, 200)
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

  // Config read must be blocked for the unverified session. (The config is
  // boot-time composition — there is no write endpoint at all.)
  let res = await request('/login-api/settings', { cookie })
  assert.equal(res.status, 401)
  assert.equal(JSON.parse(res.body).error, 'otp-required')

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

test('enabling OTP via the HTTP flow revokes every session and requires re-login', async () => {
  await startGateway({}, { otpEnabled: false }) // no config switch needed
  const cookie = await loginCookie()

  // Full HTTP binding flow: enable stages a secret, verify-setup activates it.
  const enable = await request('/otp/enable', { method: 'POST', cookie })
  assert.equal(enable.status, 200)
  const secret = JSON.parse(enable.body).secret
  const code = generateTOTP(secret)
  const verify = await request('/otp/verify-setup', {
    method: 'POST', cookie, body: { otp: code },
  })
  assert.equal(verify.status, 200)
  const vBody = JSON.parse(verify.body)
  assert.equal(vBody.sessionRevoked, true, 'response must flag the session revocation')
  assert.ok(vBody.backupCodes.length > 0, 'backup codes are returned for saving')

  // Every pre-2FA session is gone, including the one that enabled OTP.
  const after = await request('/login-api/settings', { cookie })
  assert.equal(after.status, 401)
  assert.equal(JSON.parse(after.body).error, 'unauthenticated')

  // Password alone no longer logs in; a backup code does, fully verified.
  const passwordOnly = await request('/login/auth', { method: 'POST', body: { password: 'Test1234!' } })
  assert.equal(passwordOnly.status, 400)
  assert.equal(JSON.parse(passwordOnly.body).error, 'otp-required')
  const backupLogin = await request('/login/auth', {
    method: 'POST', body: { password: 'Test1234!', backupCode: vBody.backupCodes[0] },
  })
  assert.equal(backupLogin.status, 200)
  const newCookie = (Array.isArray(backupLogin.headers['set-cookie'])
    ? backupLogin.headers['set-cookie'][0] : backupLogin.headers['set-cookie']).split(';')[0]
  const settings = await request('/login-api/settings', { cookie: newCookie })
  assert.equal(settings.status, 200, 'backup-code session must be fully verified')
  await stopGateway()
})

test('OTP pages honour the configured otpDigits', () => {
  // Login page: input pattern/maxlength and the wire() validation follow digits.
  const login = loginPageHtml({ mode: 'auth', otpEnabled: true, digits: 8 })
  assert.ok(login.includes('pattern="[0-9]{8}"'), 'login input pattern must use digits')
  assert.ok(login.includes('maxlength="8"'), 'login input maxlength must use digits')
  assert.ok(login.includes('otpDigits: 8'), 'wire() must receive the configured digits')

  // Setup page: same for the standalone setup flow.
  const setup = otpSetupPage({ uri: 'otpauth://totp/t:u', secret: 'SECRET', backupCodes: [], digits: 8 })
  assert.ok(setup.includes('pattern="[0-9]{8}"'), 'setup input pattern must use digits')
  assert.ok(setup.includes('otp.length !== 8'), 'setup validation must use digits')

  // Verify page: same for the login-time verification flow.
  const verify = otpVerifyPage({ hasBackupCodes: false, digits: 8 })
  assert.ok(verify.includes('pattern="[0-9]{8}"'), 'verify input pattern must use digits')
  assert.ok(verify.includes('otp.length !== 8'), 'verify validation must use digits')
  assert.ok(verify.includes('请输入认证器应用显示的 8 位验证码。'), 'verify subtitle must interpolate digits')
  assert.ok(!verify.includes('${digits}'), 'verify subtitle must not leak the literal placeholder')

  // Defaults stay 6.
  assert.ok(loginPageHtml({ mode: 'auth', otpEnabled: true }).includes('pattern="[0-9]{6}"'))
  assert.ok(otpVerifyPage().includes('pattern="[0-9]{6}"'))
})
