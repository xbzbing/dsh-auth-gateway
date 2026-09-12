/**
 * Update-check tests: the registry lookup is the plugin's only outbound
 * request, so its failure and caching behaviour is contract, not detail —
 * it must never throw into the request path, never retry-storm a broken
 * network, and never claim "up to date" when it could not tell.
 *
 * The fetch implementation and the clock are injected, so these tests never
 * touch the network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateChecker } from '../lib/update-check.js'

/** A fetch stub recording its calls; `respond` decides each outcome. */
function stubFetch(respond) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    return respond(calls.length)
  }
  impl.calls = calls
  return impl
}

/** Minimal Response stand-in. */
function ok(body) {
  return { ok: true, status: 200, json: async () => body }
}

function makeClock(start = 1_700_000_000_000) {
  let current = start
  return { now: () => current, advance: (ms) => { current += ms } }
}

test('reports an available update when the registry is ahead', async () => {
  const fetchImpl = stubFetch(() => ok({ version: '0.7.0' }))
  const checker = createUpdateChecker({ current: '0.6.0', fetchImpl })
  const status = await checker.status()
  assert.equal(status.enabled, true)
  assert.equal(status.latest, '0.7.0')
  assert.equal(status.updateAvailable, true)
  assert.equal(status.error, null)
  assert.equal(typeof status.checkedAt, 'string')
  assert.equal(Number.isNaN(Date.parse(status.checkedAt)), false)
})

test('reports up to date when the registry matches or trails', async () => {
  for (const remote of ['0.6.0', '0.5.0']) {
    const checker = createUpdateChecker({ current: '0.6.0', fetchImpl: stubFetch(() => ok({ version: remote })) })
    const status = await checker.status()
    assert.equal(status.updateAvailable, false, `${remote} vs 0.6.0 must not be an update`)
  }
})

test('a prerelease installation is not told the older release is an update', async () => {
  // 0.7.0-rc.1 runs ahead of the published 0.6.0 stable: no update.
  const checker = createUpdateChecker({
    current: '0.7.0-rc.1',
    fetchImpl: stubFetch(() => ok({ version: '0.6.0' })),
  })
  assert.equal((await checker.status()).updateAvailable, false)
})

test('an unparsable version yields null (cannot tell), never false', async () => {
  const unknownCurrent = createUpdateChecker({
    current: 'unknown',
    fetchImpl: stubFetch(() => ok({ version: '0.7.0' })),
  })
  assert.equal((await unknownCurrent.status()).updateAvailable, null)

  const unknownRemote = createUpdateChecker({
    current: '0.6.0',
    fetchImpl: stubFetch(() => ok({ version: 'not-a-version' })),
  })
  const status = await unknownRemote.status()
  assert.equal(status.updateAvailable, null)
  assert.equal(status.latest, null)
  assert.equal(status.error, 'invalid-response')
})

test('disabled makes no request at all', async () => {
  const fetchImpl = stubFetch(() => ok({ version: '9.9.9' }))
  const checker = createUpdateChecker({ current: '0.6.0', enabled: false, fetchImpl })
  const status = await checker.status()
  assert.equal(status.enabled, false)
  assert.equal(status.updateAvailable, null)
  assert.equal(status.latest, null)
  assert.equal(fetchImpl.calls.length, 0, 'a disabled check must never reach the network')
})

test('a successful result is cached for the TTL', async () => {
  const clock = makeClock()
  const fetchImpl = stubFetch(() => ok({ version: '0.7.0' }))
  const checker = createUpdateChecker({ current: '0.6.0', fetchImpl, now: clock.now, ttlMs: 1000 })

  const first = await checker.status()
  assert.equal(first.updateAvailable, true)
  assert.equal(fetchImpl.calls.length, 1)

  clock.advance(999)
  const second = await checker.status()
  assert.equal(fetchImpl.calls.length, 1, 'a fresh cache entry must not refetch')
  assert.deepEqual(second, first)

  clock.advance(2) // past the TTL
  await checker.status()
  assert.equal(fetchImpl.calls.length, 2, 'a stale entry must refetch')
})

test('a failure is cached too, so a blocked registry is not hammered', async () => {
  const clock = makeClock()
  const fetchImpl = stubFetch(() => { throw new Error('ENOTFOUND registry.npmjs.org') })
  const checker = createUpdateChecker({ current: '0.6.0', fetchImpl, now: clock.now, failureTtlMs: 500 })

  const status = await checker.status()
  assert.equal(status.error, 'network')
  assert.equal(status.latest, null)
  assert.equal(status.updateAvailable, null)

  clock.advance(499)
  await checker.status()
  assert.equal(fetchImpl.calls.length, 1, 'a cached failure must not be retried immediately')
  clock.advance(2)
  await checker.status()
  assert.equal(fetchImpl.calls.length, 2, 'the failure cache expires')
})

test('HTTP errors, timeouts and malformed bodies become error codes', async () => {
  const cases = [
    [() => ({ ok: false, status: 503, json: async () => ({}) }), 'http-503'],
    [() => { const err = new Error('timed out'); err.name = 'TimeoutError'; throw err }, 'timeout'],
    [() => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }), 'invalid-response'],
    [() => ({ ok: true, status: 200, json: async () => ({}) }), 'invalid-response'],
  ]
  for (const [respond, expected] of cases) {
    const checker = createUpdateChecker({ current: '0.6.0', fetchImpl: stubFetch(respond) })
    const status = await checker.status()
    assert.equal(status.error, expected)
    assert.equal(status.updateAvailable, null, `${expected} must not become a verdict`)
  }
})

test('concurrent callers share one in-flight request', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const calls = []
  const fetchImpl = async () => {
    calls.push(1)
    await gate
    return ok({ version: '0.7.0' })
  }
  const checker = createUpdateChecker({ current: '0.6.0', fetchImpl })
  const pending = [checker.status(), checker.status(), checker.status()]
  release()
  const results = await Promise.all(pending)
  assert.equal(calls.length, 1, 'three concurrent callers must produce one request')
  for (const result of results) assert.equal(result.updateAvailable, true)
})

test('status() never rejects, whatever fetch does', async () => {
  const nasty = [
    () => { throw new Error('boom') },
    () => null,
    () => undefined,
    () => ({ ok: true, status: 200, json: async () => null }),
  ]
  for (const respond of nasty) {
    const checker = createUpdateChecker({ current: '0.6.0', fetchImpl: stubFetch(respond) })
    const status = await checker.status() // must resolve, not reject
    assert.equal(status.enabled, true)
    assert.equal(status.updateAvailable, null)
    assert.equal(typeof status.error, 'string')
  }
})

test('the result sink fires once per check and cannot break the check', async () => {
  const seen = []
  const fetchImpl = stubFetch(() => ok({ version: '0.7.0' }))
  const checker = createUpdateChecker({
    current: '0.6.0',
    fetchImpl,
    onResult: (snapshot) => {
      seen.push(snapshot.latest)
      throw new Error('sink exploded')
    },
  })
  const status = await checker.status()
  assert.equal(status.updateAvailable, true, 'a throwing sink must not break the result')
  assert.deepEqual(seen, ['0.7.0'])

  await checker.status() // served from cache: no second sink call
  assert.deepEqual(seen, ['0.7.0'])
})

test('the registry URL defaults to the public npm registry for the package', async () => {
  const fetchImpl = stubFetch(() => ok({ version: '0.7.0' }))
  await createUpdateChecker({ current: '0.6.0', fetchImpl }).status()
  assert.equal(fetchImpl.calls[0].url, 'https://registry.npmjs.org/dsh-auth-gateway/latest')
  assert.equal(fetchImpl.calls[0].options.headers.accept, 'application/json')
  assert.ok(fetchImpl.calls[0].options.signal, 'the request must carry a timeout signal')
})

test('a missing fetch implementation degrades to disabled', async () => {
  // `null` (not `undefined`): an omitted option falls back to globalThis.fetch
  // by design, so only a genuinely absent implementation reaches this guard.
  // The test must not accidentally exercise the real network.
  const checker = createUpdateChecker({ current: '0.6.0', fetchImpl: null })
  const status = await checker.status()
  assert.equal(status.enabled, false)
  assert.equal(status.error, null)
})
