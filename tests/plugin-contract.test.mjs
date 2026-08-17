/**
 * Cordis plugin contract test: reproduces what the vendored loader actually
 * does with a plugin module, so the package cannot silently drift out of
 * contract:
 *
 *   - loader normalize: exports.default ?? exports (vendor/loader normalize)
 *   - plugin object: apply function, name, inject, Config (vendor/cordis
 *     registry.ts / fiber.ts resolveConfig: Config['~standard'].validate)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as mod from '../index.js'

test('module satisfies the Cordis plugin contract', () => {
  // Loader normalize step (vendor/loader/src/index.ts): prefer default export.
  const plugin = mod.default ?? mod
  assert.equal(typeof plugin.apply, 'function', 'plugin must have an apply function')
  assert.equal(plugin.name, 'dsh-auth-gateway')
  assert.ok(Array.isArray(plugin.inject), 'inject must be declared')
  assert.ok(plugin.inject.includes('webServer'), 'webServer must be injected')
  assert.equal(plugin.Config['~standard'].version, 1, 'Config must be a Standard Schema v1 validator')
})

test('named exports mirror the default export', () => {
  assert.equal(mod.name, 'dsh-auth-gateway')
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  assert.equal(mod.Config, mod.default.Config)
})

test('resolveConfig step validates before apply (fiber semantics)', () => {
  const config = pluginConfig({ listenPort: 4321 })
  assert.equal(config.listenPort, 4321)
  assert.equal(config.listenHost, '0.0.0.0', 'defaults must be filled')
  const bad = pluginConfig({ listenPort: 99999 })
  assert.equal(bad, undefined, 'invalid config must be rejected')
})

function pluginConfig(raw) {
  const plugin = mod.default ?? mod
  const result = plugin.Config['~standard'].validate(raw)
  return result.value
}
