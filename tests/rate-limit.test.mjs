/**
 * Anti-brute-force rate limiter tests (lib/rate-limit.js).
 *
 * The limiter was extracted verbatim out of LoginGateway, so these cover the
 * three layers directly instead of only through the HTTP flow: the global
 * per-minute budget, the per-address lockout shared by login / OTP / password
 * change, the per-address OTP window, the map-bounding prune(), and the
 * alert-once-per-window contract of the security-event sink.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../lib/rate-limit.js'

const T0 = new Date(2025, 7, 20, 10, 0, 0).getTime()
const MINUTE = 60 * 1000

function setup(policy = {}) {
  const events = []
  const limiter = createRateLimiter(policy, (payload) => events.push(payload))
  return { limiter, events }
}

// ── layer 1: global per-minute budget ──────────────────────────────────

test('global budget allows exactly the limit, then refuses and alerts once per window', () => {
  const { limiter, events } = setup({ maxGlobalAuthAttemptsPerMinute: 3 })

  assert.equal(limiter.globalAuthAllowed(T0), true)
  assert.equal(limiter.globalAuthAllowed(T0), true)
  assert.equal(limiter.globalAuthAllowed(T0), true)
  assert.equal(events.length, 0, 'inside the budget emits nothing')

  // The refusal is reported once, not once per request.
  assert.equal(limiter.globalAuthAllowed(T0), false)
  assert.equal(limiter.globalAuthAllowed(T0), false)
  assert.equal(limiter.globalAuthAllowed(T0), false)
  assert.equal(events.length, 1, 'one alert per exhausted window')
  assert.deepEqual(events[0], { kind: 'global-rate-limit', limit: 3, windowSeconds: 60 })
})

test('global window rolls over after a minute and can alert again', () => {
  const { limiter, events } = setup({ maxGlobalAuthAttemptsPerMinute: 1 })

  assert.equal(limiter.globalAuthAllowed(T0), true)
  assert.equal(limiter.globalAuthAllowed(T0), false)
  assert.equal(events.length, 1)

  const later = T0 + MINUTE
  assert.equal(limiter.globalAuthAllowed(later), true, 'a fresh window admits attempts again')
  assert.equal(limiter.globalAuthAllowed(later), false)
  assert.equal(events.length, 2, 'the notified flag resets with the window')
  assert.equal(limiter.globalAuth.windowStart, later)
})

// ── layer 2: shared per-address lockout ────────────────────────────────

test('maxLoginFailures trips a lockout once and reports the lock window', () => {
  const { limiter, events } = setup({ maxLoginFailures: 3, lockMinutes: 2 })

  limiter.recordFailure('10.0.0.1', T0)
  limiter.recordFailure('10.0.0.1', T0)
  assert.equal(events.length, 0, 'below the threshold nothing is reported')

  limiter.recordFailure('10.0.0.1', T0)
  assert.deepEqual(events, [{
    kind: 'lockout',
    sourceAddress: '10.0.0.1',
    maxFailures: 3,
    lockedUntil: T0 + 2 * MINUTE,
  }])

  const entry = limiter.attempts.get('10.0.0.1')
  assert.equal(entry.lockedUntil, T0 + 2 * MINUTE)
  assert.equal(entry.count, 0, 'the counter restarts so the next window recounts')
})

test('the lockout is shared: a locked address is refused by the OTP layer too', () => {
  const { limiter } = setup({ maxLoginFailures: 1, lockMinutes: 5, maxOtpAttemptsPerMinute: 10 })

  limiter.recordFailure('10.0.0.2', T0)
  assert.equal(limiter.otpVerifyAllowed('10.0.0.2', T0), false,
    'the same lockout gates OTP verification')

  // Past the lock window the entry stops refusing on its own: prune() only
  // sweeps maps past the size threshold, so a small map keeps the entry.
  assert.equal(limiter.otpVerifyAllowed('10.0.0.2', T0 + 6 * MINUTE), true)
})

test('a later successful login clearing the map frees the address (gateway behaviour)', () => {
  const { limiter } = setup({ maxLoginFailures: 5, lockMinutes: 5 })
  limiter.recordFailure('10.0.0.3', T0)
  assert.equal(limiter.attempts.get('10.0.0.3').count, 1)
  limiter.attempts.delete('10.0.0.3') // what /login/auth does on success
  assert.equal(limiter.attempts.has('10.0.0.3'), false)
})

// ── layer 3: per-address OTP window ────────────────────────────────────

test('OTP window caps per-address attempts and alerts once per address', () => {
  const { limiter, events } = setup({ maxOtpAttemptsPerMinute: 2, maxGlobalAuthAttemptsPerMinute: 1000 })

  assert.equal(limiter.otpVerifyAllowed('a', T0), true)
  assert.equal(limiter.otpVerifyAllowed('a', T0), true)
  assert.equal(limiter.otpVerifyAllowed('a', T0), false)
  assert.equal(limiter.otpVerifyAllowed('a', T0), false)
  assert.equal(events.length, 1)
  assert.deepEqual(events[0], {
    kind: 'otp-rate-limit', sourceAddress: 'a', limit: 2, windowSeconds: 60,
  })

  // The window is per address: exhausting 'a' does not starve 'b'.
  assert.equal(limiter.otpVerifyAllowed('b', T0), true)
  assert.equal(events.length, 1, 'a different address is not alerted for')
})

test('OTP window rolls over after a minute and admits attempts again', () => {
  const { limiter } = setup({ maxOtpAttemptsPerMinute: 1, maxGlobalAuthAttemptsPerMinute: 1000 })
  assert.equal(limiter.otpVerifyAllowed('a', T0), true)
  assert.equal(limiter.otpVerifyAllowed('a', T0), false)
  assert.equal(limiter.otpVerifyAllowed('a', T0 + MINUTE), true)
})

test('the OTP layer consumes the shared global budget', () => {
  const { limiter, events } = setup({ maxGlobalAuthAttemptsPerMinute: 2, maxOtpAttemptsPerMinute: 100 })

  assert.equal(limiter.otpVerifyAllowed('a', T0), true)
  assert.equal(limiter.otpVerifyAllowed('a', T0), true)
  assert.equal(limiter.otpVerifyAllowed('a', T0), false, 'the global budget runs out first')
  assert.equal(events.some((e) => e.kind === 'global-rate-limit'), true)
})

// ── prune(): bounded maps ──────────────────────────────────────────────

test('prune drops expired locks and idle counters once the map grows past the threshold', () => {
  const { limiter } = setup({ lockMinutes: 5 })
  // Past twice the lock window, which is the idle-cutoff prune() uses.
  const idle = T0 - 11 * MINUTE

  for (let i = 0; i < 1100; i++) {
    limiter.attempts.set(`stale-${i}`, { count: 1, lockedUntil: 0, updatedAt: idle })
  }
  for (let i = 0; i < 1100; i++) {
    limiter.attempts.set(`locked-${i}`, { count: 0, lockedUntil: T0 - 1000, updatedAt: T0 - 1000 })
  }
  limiter.attempts.set('live-counter', { count: 2, lockedUntil: 0, updatedAt: T0 })
  limiter.attempts.set('live-lock', { count: 0, lockedUntil: T0 + MINUTE, updatedAt: T0 })

  limiter.prune(T0)

  assert.equal(limiter.attempts.has('stale-0'), false, 'idle counters are swept')
  assert.equal(limiter.attempts.has('locked-0'), false, 'expired locks are swept')
  assert.equal(limiter.attempts.get('live-counter').count, 2, 'an active counter survives')
  assert.equal(limiter.attempts.get('live-lock').lockedUntil, T0 + MINUTE, 'a live lock survives')
  assert.equal(limiter.attempts.size, 2)
})

test('prune drops rolled-over OTP windows once the map grows past the threshold', () => {
  const { limiter } = setup({})
  for (let i = 0; i < 1100; i++) {
    limiter.otpWindows.set(`old-${i}`, { windowStart: T0 - 2 * MINUTE, count: 1, notified: false })
  }
  limiter.otpWindows.set('current', { windowStart: T0, count: 1, notified: false })

  limiter.prune(T0)

  assert.equal(limiter.otpWindows.has('old-0'), false)
  assert.equal(limiter.otpWindows.has('current'), true)
  assert.equal(limiter.otpWindows.size, 1)
})

test('prune is a no-op below the size threshold', () => {
  const { limiter } = setup({ lockMinutes: 5 })
  limiter.attempts.set('stale', { count: 1, lockedUntil: 0, updatedAt: T0 - 60 * MINUTE })
  limiter.prune(T0)
  assert.equal(limiter.attempts.has('stale'), true, 'small maps are left alone (amortized O(1))')
})

// ── policy handling ────────────────────────────────────────────────────

test('policy is read once at construction: a later mutation has no effect', () => {
  const policy = { maxLoginFailures: 2, lockMinutes: 1 }
  const events = []
  const limiter = createRateLimiter(policy, (payload) => events.push(payload))

  policy.maxLoginFailures = 100 // must NOT change the limiter

  limiter.recordFailure('a', T0)
  limiter.recordFailure('a', T0)
  assert.equal(events.filter((e) => e.kind === 'lockout').length, 1,
    'the limit snapshotted at construction still trips after two failures')
})

test('missing policy fields fall back to the documented defaults', () => {
  const { limiter, events } = setup({})

  for (let i = 0; i < 4; i++) limiter.recordFailure('a', T0)
  assert.equal(limiter.attempts.get('a').lockedUntil, 0, '4 failures is below the default threshold of 5')

  limiter.recordFailure('a', T0)
  assert.equal(limiter.attempts.get('a').lockedUntil, T0 + 5 * MINUTE,
    'the 5th trips the default 5-minute lock')
  assert.equal(events.filter((e) => e.kind === 'lockout').length, 1)
})
