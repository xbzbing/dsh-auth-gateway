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
      listenHost: '0.0.0.0', listenPort: 3080, upstreamHost: '127.0.0.1', upstreamPort: 3081,
      minPasswordLength: 8, requireMixedCase: true, requireSpecial: true, maxLoginFailures: 5, lockMinutes: 5, maxGlobalAuthAttemptsPerMinute: 60,
    },
  })
  assert.deepEqual(validate(null), validate(undefined))
})

test('partial config keeps defaults for omitted fields', () => {
  const result = validate({ listenPort: 4000 })
  assert.deepEqual(result, {
    value: {
      listenHost: '0.0.0.0', listenPort: 4000, upstreamHost: '127.0.0.1', upstreamPort: 3081,
      minPasswordLength: 8, requireMixedCase: true, requireSpecial: true, maxLoginFailures: 5, lockMinutes: 5, maxGlobalAuthAttemptsPerMinute: 60,
    },
  })
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
