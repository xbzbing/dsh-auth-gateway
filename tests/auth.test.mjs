/**
 * lib/auth.js function-level tests: the Secure-attribute decision and the
 * cookie factories.
 *
 * The gateway integration tests (tests/gateway.test.mjs) cover the Secure
 * attribute through real HTTP requests; this file pins the decision function
 * itself — every branch of requestIsSecure, plus the cookie attribute
 * composition — so a future gateway transport (e.g. the gateway terminating
 * TLS itself) cannot change the outcome unnoticed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  requestIsSecure,
  sessionCookie,
  expiredCookie,
  tokenFromCookieHeader,
  SESSION_TTL_SECONDS,
} from '../lib/auth.js'

test('requestIsSecure: a TLS socket marks the request secure', () => {
  // What node:https hands an https.createServer handler (the gateway does
  // not terminate TLS today, but auto mode must follow it when it does).
  assert.equal(requestIsSecure({ socket: { encrypted: true }, headers: {} }), true)
  assert.equal(requestIsSecure({ socket: { encrypted: false }, headers: {} }), false)
})

test('requestIsSecure: X-Forwarded-Proto https marks the request secure', () => {
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }), true)
  // Case and whitespace around the value are tolerated (proxies differ).
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': ' HTTPS ' } }), true)
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }), false)
  // A multi-hop list is read at the first (closest-proxy) entry.
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': 'https, http' } }), true)
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': 'http, https' } }), false)
  // Duplicate headers can arrive as an array; the first entry governs.
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': ['https', 'http'] } }), true)
})

test('requestIsSecure: absent or malformed input is never secure', () => {
  assert.equal(requestIsSecure({ socket: {}, headers: {} }), false)
  assert.equal(requestIsSecure({ headers: {} }), false)
  assert.equal(requestIsSecure(undefined), false)
  assert.equal(requestIsSecure({ socket: undefined, headers: undefined }), false)
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': '' } }), false)
  assert.equal(requestIsSecure({ socket: {}, headers: { 'x-forwarded-proto': 42 } }), false)
})

test('sessionCookie: baseline attributes, Secure only when asked', () => {
  const plain = sessionCookie('tok')
  assert.ok(plain.startsWith('dsh_auth=tok; Path=/; HttpOnly; SameSite=Strict'))
  assert.ok(plain.includes(`Max-Age=${SESSION_TTL_SECONDS}`))
  assert.ok(!plain.includes('Secure'), 'default must stay byte-for-byte the legacy cookie')
  const secure = sessionCookie('tok', true)
  assert.ok(secure.includes('; Secure'), 'the boolean must append the Secure attribute')
  assert.equal(sessionCookie('tok', false), plain)
})

test('expiredCookie: clearing cookie mirrors the Secure decision', () => {
  assert.ok(expiredCookie().includes('Max-Age=0'))
  assert.ok(!expiredCookie().includes('Secure'))
  assert.ok(expiredCookie(true).includes('; Secure'),
    'the clearing cookie must carry the same attribute the session cookie was set with')
})

test('tokenFromCookieHeader: only the dsh_auth value, tolerant of neighbours', () => {
  assert.equal(tokenFromCookieHeader('other=1; dsh_auth=abc; x=y'), 'abc')
  assert.equal(tokenFromCookieHeader('dsh_auth='), undefined)
  assert.equal(tokenFromCookieHeader(undefined), undefined)
})