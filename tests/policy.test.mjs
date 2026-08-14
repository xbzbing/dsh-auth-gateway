/**
 * Password strength policy tests.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePasswordStrength } from '../lib/policy.js'

const ok = (pw) => assert.deepEqual(validatePasswordStrength(pw), { ok: true })
const bad = (pw, reason) => assert.deepEqual(validatePasswordStrength(pw), { ok: false, reason })

test('default policy: 8+ chars and (mixed case OR special char)', () => {
  ok('Aa123456') // mixed case
  ok('LongEnough1X') // mixed case
  ok('alllower!234') // special char, no mixed case
  ok('ALLUPPER@567') // special char, no mixed case
  bad('short', 'password-too-short')
  bad('Aa12345', 'password-too-short') // 7 chars
  bad('abcdefgh', 'password-too-simple') // neither mixed nor special
  bad('ABCDEFGH', 'password-too-simple')
  bad('alllower1', 'password-too-simple') // digits only do not count
  bad(undefined, 'password-too-short')
  bad(null, 'password-too-short')
  bad('', 'password-too-short')
})

test('custom minLength', () => {
  const policy = { minPasswordLength: 4 }
  assert.deepEqual(validatePasswordStrength('Aa12', policy), { ok: true })
  assert.deepEqual(validatePasswordStrength('Aa1', policy), { ok: false, reason: 'password-too-short' })
})

test('requireMixedCase only: special chars do not satisfy it', () => {
  const policy = { requireMixedCase: true, requireSpecial: false }
  assert.deepEqual(validatePasswordStrength('MixedCase1', policy), { ok: true })
  assert.deepEqual(validatePasswordStrength('alllower!!', policy), { ok: false, reason: 'password-too-simple' })
  assert.deepEqual(validatePasswordStrength('ALLUPPER!!', policy), { ok: false, reason: 'password-too-simple' })
})

test('requireSpecial only: mixed case does not satisfy it', () => {
  const policy = { requireMixedCase: false, requireSpecial: true }
  assert.deepEqual(validatePasswordStrength('pass!!word', policy), { ok: true })
  assert.deepEqual(validatePasswordStrength('MixedCase1', policy), { ok: false, reason: 'password-too-simple' })
})

test('both requirements can be disabled entirely', () => {
  const policy = { requireMixedCase: false, requireSpecial: false }
  assert.deepEqual(validatePasswordStrength('anypassword', policy), { ok: true })
})
