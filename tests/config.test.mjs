/**
 * Config schema tests: Standard Schema v1 contract — defaults filled on
 * success, precise issues on failure, so the Loader fails loud.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/config.js'

const validate = (value) => Config['~standard'].validate(value)

test('schema shape is Standard Schema v1', () => {
  assert.equal(Config['~standard'].version, 1)
  assert.equal(typeof Config['~standard'].validate, 'function')
})

test('undefined/null config gets defaults', () => {
  assert.deepEqual(validate(undefined), {
    value: {
      basePath: '/',
      listenHost: '0.0.0.0', listenPort: 3080, upstreamHost: '127.0.0.1', upstreamPort: 3081,
      minPasswordLength: 8, requireMixedCase: true, requireSpecial: true, maxLoginFailures: 5, lockMinutes: 5, maxGlobalAuthAttemptsPerMinute: 60, maxOtpAttemptsPerMinute: 10,
      otpIssuer: 'dsh-auth-gateway', otpPeriod: 30, otpDigits: 6, otpWindow: 1, backupCodeCount: 10, backupCodeLength: 8,
      updateCheck: false,
      cookieSecure: 'auto',
    },
  })
  assert.deepEqual(validate(null), validate(undefined))
})

test('partial config keeps defaults for omitted fields', () => {
  const result = validate({ listenPort: 4000 })
  assert.deepEqual(result, {
    value: {
      basePath: '/',
      listenHost: '0.0.0.0', listenPort: 4000, upstreamHost: '127.0.0.1', upstreamPort: 3081,
      minPasswordLength: 8, requireMixedCase: true, requireSpecial: true, maxLoginFailures: 5, lockMinutes: 5, maxGlobalAuthAttemptsPerMinute: 60, maxOtpAttemptsPerMinute: 10,
      otpIssuer: 'dsh-auth-gateway', otpPeriod: 30, otpDigits: 6, otpWindow: 1, backupCodeCount: 10, backupCodeLength: 8,
      updateCheck: false,
      cookieSecure: 'auto',
    },
  })
})

test('unknown configuration fields are rejected', () => {
  const result = validate({ otpEnabled: true })
  assert.ok(result.issues)
  assert.equal(result.issues[0].path[0], 'otpEnabled')
})

test('updateCheck must be a boolean and is OFF by default', () => {
  assert.equal(validate({ updateCheck: true }).value.updateCheck, true)
  assert.equal(validate({ updateCheck: false }).value.updateCheck, false)
  // Default off is the privacy contract: a fresh install makes no outbound
  // request until someone asks for one (the panel's button, or this switch).
  assert.equal(validate({}).value.updateCheck, false, 'the automatic check is off by default')
  for (const bad of ['true', 0, 1, null]) {
    const result = validate({ updateCheck: bad })
    assert.ok(result.issues, `updateCheck ${String(bad)} must be rejected`)
    assert.equal(result.issues[0].path[0], 'updateCheck')
  }
})

test('cookieSecure is three-state: auto (default), true, false', () => {
  // Default is 'auto' — byte-for-byte today's plain-HTTP behavior, with the
  // Secure attribute arming itself once the connection is TLS (see
  // lib/auth.js requestIsSecure).
  assert.equal(validate({}).value.cookieSecure, 'auto')
  assert.equal(validate({ cookieSecure: 'auto' }).value.cookieSecure, 'auto')
  assert.equal(validate({ cookieSecure: true }).value.cookieSecure, true)
  assert.equal(validate({ cookieSecure: false }).value.cookieSecure, false)
  // Lookalikes and null are rejected, not coerced: a typo must not silently
  // pin the attribute either way.
  for (const bad of ['true', 'false', 'on', 'https', 1, 0, null]) {
    const result = validate({ cookieSecure: bad })
    assert.ok(result.issues, `cookieSecure ${String(bad)} must be rejected`)
    assert.equal(result.issues[0].path[0], 'cookieSecure')
  }
})

test('invalid ports are rejected with a path', () => {
  for (const bad of [0, 65536, -1, '3080', 30.5, NaN]) {
    const result = validate({ listenPort: bad })
    assert.ok(result.issues, `listenPort ${String(bad)} must fail`)
    assert.equal(result.issues[0].path[0], 'listenPort')
    assert.ok(result.issues[0].message.includes('port'))
  }
})

test('invalid hosts are rejected', () => {
  for (const bad of ['', 42, null]) {
    const result = validate({ upstreamHost: bad })
    assert.ok(result.issues, `upstreamHost ${String(bad)} must fail`)
    assert.equal(result.issues[0].path[0], 'upstreamHost')
  }
})

test('non-object config is rejected', () => {
  for (const bad of ['x', 1, [], true]) {
    const result = validate(bad)
    assert.ok(result.issues, `${JSON.stringify(bad)} must fail`)
  }
})

test('policy fields are validated', () => {
  assert.deepEqual(validate({ minPasswordLength: 12 }).value.minPasswordLength, 12)
  assert.ok(validate({ minPasswordLength: 3 }).issues, 'min 4')
  assert.ok(validate({ minPasswordLength: '8' }).issues, 'must be integer')
  assert.equal(validate({ requireMixedCase: false }).value.requireMixedCase, false)
  assert.ok(validate({ requireMixedCase: 'yes' }).issues)
  assert.equal(validate({ requireSpecial: false }).value.requireSpecial, false)
  assert.ok(validate({ requireSpecial: 'yes' }).issues)
  assert.equal(validate({ maxLoginFailures: 3 }).value.maxLoginFailures, 3)
  assert.ok(validate({ maxLoginFailures: 0 }).issues)
  assert.equal(validate({ lockMinutes: 10 }).value.lockMinutes, 10)
  assert.ok(validate({ lockMinutes: 0 }).issues)
})

test('OTP fields are validated', () => {
  // otpIssuer
  assert.equal(validate({ otpIssuer: 'my-app' }).value.otpIssuer, 'my-app')
  assert.ok(validate({ otpIssuer: '' }).issues)
  assert.ok(validate({ otpIssuer: 123 }).issues)
  assert.equal(validate({ otpPeriod: 60 }).value.otpPeriod, 60)
  assert.ok(validate({ otpPeriod: 5 }).issues, 'min 10')
  assert.ok(validate({ otpPeriod: 150 }).issues, 'max 120')
  assert.ok(validate({ otpPeriod: '30' }).issues, 'must be integer')
  
  // otpDigits
  assert.equal(validate({ otpDigits: 8 }).value.otpDigits, 8)
  assert.ok(validate({ otpDigits: 3 }).issues, 'min 4')
  assert.ok(validate({ otpDigits: 11 }).issues, 'max 10')
  assert.ok(validate({ otpDigits: '6' }).issues, 'must be integer')
  
  // otpWindow
  assert.equal(validate({ otpWindow: 2 }).value.otpWindow, 2)
  assert.ok(validate({ otpWindow: -1 }).issues, 'min 0')
  assert.ok(validate({ otpWindow: 6 }).issues, 'max 5')
  assert.ok(validate({ otpWindow: '1' }).issues, 'must be integer')
  
  // backupCodeCount
  assert.equal(validate({ backupCodeCount: 15 }).value.backupCodeCount, 15)
  assert.ok(validate({ backupCodeCount: 4 }).issues, 'min 5')
  assert.ok(validate({ backupCodeCount: 21 }).issues, 'max 20')
  assert.ok(validate({ backupCodeCount: '10' }).issues, 'must be integer')
  
  // backupCodeLength
  assert.equal(validate({ backupCodeLength: 10 }).value.backupCodeLength, 10)
  assert.ok(validate({ backupCodeLength: 5 }).issues, 'min 6')
  assert.ok(validate({ backupCodeLength: 13 }).issues, 'max 12')
  assert.ok(validate({ backupCodeLength: '8' }).issues, 'must be integer')
})

test('schema defaults match createGateway defaults (no silent divergence)', async () => {
  // The gateway is always constructed from schema-validated config in
  // production, so createGateway's `?? fallback` values are dead code unless
  // they agree with the schema defaults. Guard the whole surface.
  const { createGateway } = await import('../lib/gateway.js')
  const schema = validate(undefined).value
  const gw = createGateway(undefined)
  const policyKeys = [
    'minPasswordLength', 'requireMixedCase', 'requireSpecial',
    'maxLoginFailures', 'lockMinutes',
    'maxGlobalAuthAttemptsPerMinute', 'maxOtpAttemptsPerMinute',
  ]
  const otpKeys = [
    'otpIssuer', 'otpPeriod', 'otpDigits', 'otpWindow', 'backupCodeCount', 'backupCodeLength',
  ]
  for (const key of policyKeys) {
    assert.equal(schema[key], gw.policy[key], `policy default mismatch: ${key}`)
  }
  for (const key of otpKeys) {
    assert.equal(schema[key], gw.otp[key], `otp default mismatch: ${key}`)
  }
})

test('basePath accepts normal sub-paths and rejects breakout characters', () => {
  for (const good of ['/', '/dsh', '/dsh/v2', '/a-b_c.d~e', '/api/x']) {
    const result = validate({ basePath: good })
    assert.ok(result.value, `basePath ${good} must be accepted`)
    assert.equal(result.value.basePath, good)
  }
  // Quotes/angle brackets could break out of embedded page scripts or hrefs;
  // whitespace and `//` break routing or redirect targets.
  for (const bad of ['/a<b>c', '/a"b', '/a\\b', '/a b', '//evil.com', '/dsh//x', '/../x', '/x/..']) {
    const result = validate({ basePath: bad })
    assert.ok(result.issues, `basePath ${JSON.stringify(bad)} must be rejected`)
  }
  for (const bad of ['dsh', '', 'http://x', 'x/']) {
    const result = validate({ basePath: bad })
    assert.ok(result.issues, `basePath ${JSON.stringify(bad)} must be rejected`)
  }
})
