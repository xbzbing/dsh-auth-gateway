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
  assert.ok(plugin.inject.includes('settings'), 'settings must be injected (page language source)')
  // Connection orders the gateway after it, so the upstream-auth mode is
  // settled at apply time (docs/zh/adr/0001). The registry itself must NOT be
  // a hard inject: dsh <= 0.2.2 never provides it and the gateway would
  // never start there.
  assert.ok(plugin.inject.includes('connection'), 'connection must be injected')
  assert.ok(!plugin.inject.includes('connection.authentication'), 'the 0.2.3-only registry must stay optional')
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

test('gateway pages follow the settings service locale through the plugin wiring', async () => {
  // No Accept-Language header: only a correct index.js → localePreference →
  // page-render chain can produce the English page.
  const capture = await captureIndexTransform({}, {
    describe: () => [{ ns: 'locale', value: { preference: 'en' } }],
  })
  try {
    const res = await fetch(`http://127.0.0.1:${capture.listenPort}/login`)
    const body = await res.text()
    assert.equal(res.status, 200)
    assert.ok(body.includes('Sign in'), 'settings-service preference must reach page rendering')
    assert.ok(!body.includes('请输入访问密码'), 'preference: en must override the zh fallback')
  } finally {
    await capture.cleanup()
  }
})

test('the console URL line prefers an operator-declared --public-url', async () => {
  // The bundle patch forwards ctx.webStartup.publicUrl to web-app, which feeds
  // the same value into its runtime context and DSH_WEB_URL. The gateway's own
  // line must agree with them, or the console and the agent disagree about
  // where this deployment lives.
  const logged = []
  const capture = await captureIndexTransform({}, { describe: () => [] },
    { webStartup: { publicUrl: 'https://dsh.example.com/dsh/' }, logSink: logged })
  try {
    assert.ok(logged.some((line) => line.includes('https://dsh.example.com/dsh/')),
      `the declared public URL must be printed, got: ${logged.join(' | ')}`)
    assert.ok(!logged.some((line) => line.startsWith('dsh web: http://127.0.0.1:')),
      'the loopback URL must not be printed when a public URL is declared')
  } finally {
    await capture.cleanup()
  }
})

test('the console URL line falls back to the loopback address without --public-url', async () => {
  const logged = []
  const capture = await captureIndexTransform({}, { describe: () => [] }, { logSink: logged })
  try {
    assert.ok(logged.some((line) => line.startsWith(`dsh web: http://127.0.0.1:${capture.listenPort}`)),
      `the loopback URL must be printed, got: ${logged.join(' | ')}`)
  } finally {
    await capture.cleanup()
  }
})

test('dsh >= 0.2.3: a present registry selects provider mode and never reads the dsh secret', async () => {
  const providers = []
  const capture = await captureIndexTransform({}, { describe: () => [] }, {
    registry: { register: (provider) => { providers.push(provider); return async () => {} } },
  })
  try {
    assert.equal(capture.children.length, 1, 'the provider is registered from one child plugin')
    assert.deepEqual(capture.children[0].inject, ['connection', 'connection.authentication'])
    assert.equal(providers.length, 1)
    assert.ok(!capture.readKeys.includes('client-connection/browser-session'),
      `provider mode must not read the dsh browser-session secret, read: ${capture.readKeys.join(', ')}`)
    assert.ok(capture.infos.some((line) => line.includes('官方认证提供者')), capture.infos.join(' | '))
  } finally {
    await capture.cleanup()
  }
})

test('dsh <= 0.2.2: no registry keeps the cookie-minting fallback', async () => {
  const capture = await captureIndexTransform()
  try {
    assert.equal(capture.children.length, 0, 'no provider child plugin without the registry')
    assert.ok(capture.readKeys.includes('client-connection/browser-session'),
      'the fallback warms the browser-session secret cache')
    assert.ok(capture.infos.some((line) => line.includes('回退路径')), capture.infos.join(' | '))
  } finally {
    await capture.cleanup()
  }
})

async function captureIndexTransform(extraConfig = {}, settings = { describe: () => [] }, { webStartup, logSink, registry } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-contract-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await setPassword('GoodPass1')

  const taps = []
  const disposers = []
  const warnings = []
  const infos = []
  const readKeys = []
  const children = []
  // Services a real Cordis Context resolves through get(); the plugin reads
  // webStartup that way (the patch row declares inject: [webStartup]), and
  // probes the dsh >= 0.2.3 `connection.authentication` registry the same way.
  const services = {
    settings,
    ...webStartup === undefined ? {} : { webStartup },
    ...registry === undefined ? {} : { 'connection.authentication': registry },
  }
  const ctx = {
    get: (name) => services[name],
    webServer: {
      host: '127.0.0.1',
      tapIndex(transform) {
        taps.push(transform)
        return () => {}
      },
    },
    // The official record service (upstream browser-session secret + the
    // cookieSecure panel override). An empty store exercises the mint path
    // with no secret known.
    credentials: {
      readRecord: async (key) => { readKeys.push(key); return undefined },
      modifyRecord: async () => {},
      deleteRecord: async () => {},
    },
    // The official settings service; tests pass one exposing a locale
    // preference to exercise the page-language wiring end to end.
    settings,
    logger: {
      warn(format, ...args) {
        warnings.push([format, ...args].join(' '))
      },
      info(format, ...args) {
        infos.push([format, ...args].join(' '))
      },
    },
    emit() {},
    // Child plugins (the provider registration): run apply against a scope
    // holding the injected services, as Cordis does once they are available.
    plugin(def) {
      children.push(def)
      def.apply({
        connection: { createPeer: (options) => ({ options, signal: new AbortController().signal }) },
        'connection.authentication': registry,
      })
    },
    effect(factory) {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
  }

  const listenPort = await availablePort()
  const originalLog = console.log
  // Quiet by default; a caller that wants the startup lines passes logSink.
  console.log = logSink === undefined ? () => {} : (...args) => { logSink.push(args.join(' ')) }
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
  return { transform: taps[0], warnings, infos, readKeys, children, listenPort, cleanup }

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
