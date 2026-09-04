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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import vm from 'node:vm'
import * as mod from '../index.js'
import { setPassword } from '../lib/store.js'

test('module satisfies the Cordis plugin contract', () => {
  // Loader normalize step (vendor/loader/src/index.ts): prefer default export.
  const plugin = mod.default ?? mod
  assert.equal(typeof plugin.apply, 'function', 'plugin must have an apply function')
  assert.equal(plugin.name, 'dsh-auth-gateway')
  assert.ok(Array.isArray(plugin.inject), 'inject must be declared')
  assert.ok(plugin.inject.includes('webServer'), 'webServer must be injected')
  assert.ok(plugin.inject.includes('credentials'), 'credentials must be injected (upstream browser-auth secret source)')
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

test('index transform injects self-contained globals and the minimal LAN trust bootstrap', async () => {
  const capture = await captureIndexTransform()
  try {
    const loaderScript = `<script>(() => {
const pendingQueue = []
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(){
    const live = []
    this.mode = "live"
    this.load = (registration) => { live.push(registration) }
    for (const registration of pendingQueue.splice(0)) this.load(registration)
    return live
  }
}
})()</script>`
    const preload = '<script src="/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=test"></script>'
    const html = `<!doctype html><html><head>${loaderScript}${preload}</head><body></body></html>`
    const transformed = capture.transform(html)

    // The transform must keep the randomUUID polyfill and basePath global.
    assert.ok(transformed.includes('crypto.randomUUID'), 'the randomUUID polyfill is retained')
    assert.ok(transformed.includes('__dshAuthGatewayBasePath__'),
      'the transform publishes the gateway basePath global for the client panel')

    // LAN trust bootstrap: exactly one additional inline script. It may wrap
    // the module loader ONLY to intercept the connection registration; it
    // must not break the polyfill ordering or add further scripts.
    const before = (html.match(/<script>/g) || []).length
    const after = (transformed.match(/<script>/g) || []).length
    assert.equal(after, before + 2,
      'exactly two injected inline scripts: polyfill + LAN trust bootstrap')
    assert.ok(transformed.includes('__dshAuthGatewayTrustedLoopbackBootstrap__'),
      'the LAN trust bootstrap is present')
    assert.equal(transformed.indexOf('crypto.randomUUID') < transformed.indexOf(preload),
      true, 'the polyfill still lands before parser-preloaded bundles')
    // The LAN trust bootstrap must sit AFTER the loader definition so
    // `window.__ModuleLoader__` exists in queue mode when it runs.
    assert.ok(transformed.indexOf('__dshAuthGatewayTrustedLoopbackBootstrap__') > transformed.indexOf('window.__ModuleLoader__='),
      'the LAN trust bootstrap runs after the loader bootstrap')

    // A loader-less page still gets the polyfill, identically every time.
    const noLoaderHtml = '<html><head><title>x</title></head><body></body></html>'
    assert.equal(capture.transform(noLoaderHtml), capture.transform(noLoaderHtml))
  } finally {
    await capture.cleanup()
  }
})

test('index transform publishes the configured basePath for sub-path deployments', async () => {
  const capture = await captureIndexTransform({ basePath: '/dsh' })
  try {
    const html = '<!doctype html><html><head><title>x</title></head><body></body></html>'
    const transformed = capture.transform(html)
    assert.ok(transformed.includes('window.__dshAuthGatewayBasePath__="/dsh"'),
      'the basePath global must carry the configured sub-path prefix')
  } finally {
    await capture.cleanup()
  }
})

async function captureIndexTransform(extraConfig = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-contract-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await setPassword('GoodPass1')

  const taps = []
  const disposers = []
  const warnings = []
  const ctx = {
    webServer: {
      host: '127.0.0.1',
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
    },
    logger: {
      warn(format, ...args) {
        warnings.push([format, ...args].join(' '))
      },
      info() {},
    },
    emit() {},
    effect(factory) {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
  }

  const listenPort = await availablePort()
  const originalLog = console.log
  console.log = () => {}
  try {
    await mod.apply(ctx, {
      listenHost: '127.0.0.1',
      listenPort,
      upstreamHost: '127.0.0.1',
      upstreamPort: 9,
      ...extraConfig,
    })
  } catch (error) {
    await cleanup()
    throw error
  } finally {
    console.log = originalLog
  }

  assert.equal(taps.length, 1, 'plugin installs exactly one index transform')
  return { transform: taps[0], warnings, cleanup }

  async function cleanup() {
    for (const dispose of disposers.reverse()) {
      if (typeof dispose === 'function') await dispose()
    }
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function pluginConfig(raw) {
  const plugin = mod.default ?? mod
  const result = plugin.Config['~standard'].validate(raw)
  return result.value
}
