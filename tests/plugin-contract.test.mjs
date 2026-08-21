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

test('authenticated LAN bootstrap patches connection before service publication', async () => {
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

    const polyfillAt = transformed.indexOf('crypto.randomUUID')
    const loaderAt = transformed.indexOf('window.__ModuleLoader__=')
    const trustAt = transformed.indexOf('__dshAuthGatewayTrustedLoopbackBootstrap__')
    const preloadAt = transformed.indexOf(preload)
    assert.ok(polyfillAt !== -1, 'the existing randomUUID polyfill is retained')
    assert.ok(polyfillAt < loaderAt, 'the randomUUID polyfill remains first in head')
    assert.ok(loaderAt < trustAt, 'trusted bootstrap runs after the queue loader exists')
    assert.ok(trustAt < preloadAt, 'trusted bootstrap runs before parser-preloaded bundles')
    assert.ok(transformed.includes('__dshAuthGatewayBasePath__'),
      'the transform publishes the gateway basePath global for the client panel')

    const inlineScripts = [...transformed.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
    assert.equal(inlineScripts.length, 3, 'polyfill, loader, and trust scripts are inline')

    const browserErrors = []
    const sandbox = {
      console: { error: (...args) => browserErrors.push(args.join(' ')) },
    }
    sandbox.window = sandbox
    sandbox.globalThis = sandbox
    vm.createContext(sandbox)
    vm.runInContext(inlineScripts[1], sandbox)
    vm.runInContext(inlineScripts[2], sandbox)

    const loader = sandbox.__ModuleLoader__
    const factoryOwner = {}
    const applyOwner = {}
    const config = { marker: 'config' }
    const extra = { marker: 'extra' }
    let factoryThis
    let factoryRequire
    let applyThis
    let applyArgs
    let publication

    const originalFactory = function (require) {
      factoryThis = this
      factoryRequire = require
      return {
        inject: [],
        apply: function () {
          applyThis = this
          applyArgs = [...arguments]
          const [ctx] = arguments
          const handle = { isLoopback: false }
          const provided = ctx.provide('connection', handle)
          return { provided, handle }
        },
      }
    }
    const queued = {
      id: '@deepseek-ai/dsh-client-connection',
      factory: originalFactory,
      untouched: 'kept',
    }
    loader.load(queued)
    assert.notEqual(queued.factory, originalFactory, 'queue registration factory is wrapped')
    assert.equal(queued.untouched, 'kept', 'other registration fields are preserved')

    const live = loader.create()
    assert.equal(live.length, 1)
    assert.equal(live[0], queued)

    const requireToken = () => {}
    const connectionExports = queued.factory.call(factoryOwner, requireToken)
    assert.equal(factoryThis, factoryOwner, 'factory this is preserved')
    assert.equal(factoryRequire, requireToken, 'factory arguments are preserved')
    assert.deepEqual(connectionExports.inject, [], 'non-apply exports are preserved')

    const originalProvide = function (service, value) {
      publication = {
        thisValue: this,
        service,
        descriptor: Object.getOwnPropertyDescriptor(value, 'isLoopback'),
      }
      return 'provided'
    }
    const clientContext = { provide: originalProvide }
    const result = connectionExports.apply.call(applyOwner, clientContext, config, extra)
    assert.equal(applyThis, applyOwner, 'apply this is preserved')
    assert.deepEqual(applyArgs, [clientContext, config, extra], 'apply arguments are preserved')
    assert.equal(result.provided, 'provided', 'apply return value is preserved')
    assert.equal(result.handle.isLoopback, true)
    assert.deepEqual(publication.descriptor, {
      value: true,
      writable: true,
      enumerable: true,
      configurable: true,
    }, 'connection is trusted before original ctx.provide observes it')
    assert.equal(publication.thisValue, clientContext, 'ctx.provide this is preserved')
    assert.equal(publication.service, 'connection')
    assert.equal(clientContext.provide, originalProvide, 'ctx.provide is restored after success')

    const otherFactory = () => ({ apply() {} })
    const other = { id: 'unrelated-client-plugin', factory: otherFactory }
    loader.load(other)
    assert.equal(live.at(-1), other)
    assert.equal(other.factory, otherFactory, 'non-target registrations are untouched')

    const liveLoad = loader.load
    vm.runInContext(inlineScripts[2], sandbox)
    assert.equal(loader.load, liveLoad, 'repeated bootstrap does not wrap the live loader again')
    assert.deepEqual(browserErrors, [])

    const thrown = new Error('connection apply failed')
    const throwingRegistration = {
      id: '@deepseek-ai/dsh-client-connection/client',
      factory: () => ({
        apply(ctx) {
          ctx.provide('connection', { isLoopback: false })
          throw thrown
        },
      }),
    }
    loader.load(throwingRegistration)
    const throwingExports = throwingRegistration.factory()
    const throwingContext = { provide: originalProvide }
    assert.throws(() => throwingExports.apply(throwingContext), (error) => error === thrown)
    assert.equal(throwingContext.provide, originalProvide, 'ctx.provide is restored after throw')

    const noLoaderHtml = '<html><head><title>compatibility change</title></head></html>'
    const fallback1 = capture.transform(noLoaderHtml)
    const fallback2 = capture.transform(noLoaderHtml)
    assert.ok(fallback1.includes('crypto.randomUUID'), 'polyfill survives a loader compatibility mismatch')
    assert.equal(fallback1, fallback2)
    assert.equal(capture.warnings.length, 1, 'missing loader marker warns only once')
    assert.match(capture.warnings[0], /module bootstrap not found/)
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
