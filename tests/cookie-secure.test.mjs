/**
 * Cookie Secure status-card derivation (client/src/cookie-secure.js).
 *
 * The card is a security statement shown to the operator, so every state is
 * pinned here: the card must not claim "Secure 生效" on a plain-HTTP link
 * (where the browser would refuse the cookie) and must not stay silent when a
 * deployment pinned `true` behind plain HTTP (where logins break).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookieSecureState, cookieSecureEffective } from '../client/src/cookie-secure.js'

test('auto mode follows the browser protocol', () => {
  assert.equal(cookieSecureState('auto', 'https:'), 'auto-https')
  assert.equal(cookieSecureState('auto', 'http:'), 'auto-http')
})

test('pinned true reports an effective state only over HTTPS', () => {
  assert.equal(cookieSecureState(true, 'https:'), 'forced-https')
  // Plain HTTP + forced Secure: the browser refuses to store the cookie, so
  // the card must warn rather than claim protection.
  assert.equal(cookieSecureState(true, 'http:'), 'forced-http')
})

test('pinned false reports off regardless of protocol', () => {
  assert.equal(cookieSecureState(false, 'https:'), 'off')
  assert.equal(cookieSecureState(false, 'http:'), 'off')
})

test('unknown or missing policy normalizes to auto', () => {
  for (const mode of [undefined, null, 'true', 'on', 1, {}]) {
    assert.equal(cookieSecureState(mode, 'https:'), 'auto-https', `mode ${String(mode)} must fall back to auto`)
    assert.equal(cookieSecureState(mode, 'http:'), 'auto-http', `mode ${String(mode)} must fall back to auto`)
  }
})

test('effectiveness maps exactly the two HTTPS states', () => {
  assert.equal(cookieSecureEffective('auto-https'), true)
  assert.equal(cookieSecureEffective('forced-https'), true)
  for (const state of ['auto-http', 'forced-http', 'off', '']) {
    assert.equal(cookieSecureEffective(state), false, `${state} must not claim Secure is effective`)
  }
})
