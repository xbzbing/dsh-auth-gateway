/**
 * Password strength policy tests.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePasswordStrength } from '../lib/policy.js'

const ok = (pw) => assert.deepEqual(validatePasswordStrength(pw), { ok: true })
const bad = (pw, reason) => assert.deepEqual(validatePasswordStrength(pw), { ok: false, reason })

test('default policy: 8+ chars with both cases', () => {
  ok('Aa123456')
  ok('LongEnough1X')
  bad('short', 'password-too-short')
  bad('Aa12345', 'password-too-short') // 7 chars
  bad('abcdefgh', 'password-needs-case') // no upper
  bad('ABCDEFGH', 'password-needs-case') // no lower
  bad('alllower1', 'password-needs-case')
  bad(undefined, 'password-too-short')
  bad(null, 'password-too-short')
  bad('', 'password-too-short')
})

test('custom minLength', () => {
  const policy = { minPasswordLength: 4 }
  assert.deepEqual(validatePasswordStrength('Aa12', policy), { ok: true })
  assert.deepEqual(validatePasswordStrength('Aa1', policy), { ok: false, reason: 'password-too-short' })
})

test('mixed-case requirement can be disabled', () => {
  const policy = { requireMixedCase: false }
  assert.deepEqual(validatePasswordStrength('alllower123', policy), { ok: true })
  assert.deepEqual(validatePasswordStrength('ALLUPPER123', policy), { ok: true })
})
