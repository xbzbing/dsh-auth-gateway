/**
 * Client bundle contract test: executes the built client bundle
 * (client/index.js, generated from client/src/index.jsx by `npm run build:client`)
 * under a mock of dsh's client loader, and asserts the contract dsh relies on:
 *
 *   - the bundle is a window.__ModuleLoader__.load({ id, factory }) registration
 *   - the factory returns { apply, inject } (plugin client contract)
 *   - inject declares only services apply() actually uses ('slots')
 *   - apply() registers the "认证设置" settings.section slot with an inject
 *     face delivering the gateway `api` to the component props
 *   - apply() registers the plugins.detail.section guide, which renders only
 *     on this plugin's own detail pages
 *   - the component takes no ctx prop (ctx belongs to the apply world only)
 *   - react and slots stay external requires (not inlined)
 *
 * This guards against the bundle drifting out of contract (e.g. after a
 * hand-edit or a bad build).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')
const source = readFileSync(new URL('../client/src/index.jsx', import.meta.url), 'utf8')

function loadBundle() {
  let handoff = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (h) => { handoff = h },
      },
    },
    location: { hostname: '127.0.0.1' },
    require: (spec) => {
      if (spec === 'react') return { useState: () => [], useEffect: () => {}, Fragment: 'fragment' }
      if (spec === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' }
      if (spec === '@deepseek-ai/dsh-client-ui-slots') return {}
      throw new Error('unexpected require: ' + spec)
    },
    Object,
    Symbol,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  assert.ok(handoff, 'bundle must call window.__ModuleLoader__.load')
  return handoff
}

test('client bundle registers with the dsh loader and exports the plugin contract', () => {
  const handoff = loadBundle()
  assert.equal(handoff.id, 'dsh-auth-gateway')
  const mod = handoff.factory(requireStub)
  assert.equal(typeof mod.apply, 'function', 'client exports must include apply')
  assert.ok(Array.isArray(mod.inject), 'client exports must include inject')
})

test('inject declares only services apply() actually uses', () => {
  const handoff = loadBundle()
  const mod = handoff.factory(requireStub)
  // Spread into a host-realm array: the VM realm's Array prototype differs,
  // which trips deepStrictEqual's prototype check.
  assert.deepEqual([...mod.inject], ['slots', 'locale', 'connection'])
})

test('LAN trust installs a permanent getter on the connection handle (official seam only)', () => {
  const handoff = loadBundle()
  const mod = handoff.factory(requireStub)
  const seen = []
  const connection = { isLoopback: false }
  const ctx = {
    slots: {
      inject: () => {},
      register: () => ({}),
    },
    locale: {
      register: () => {},
      bind: () => (key) => '[' + key + ']',
    },
    get connection() { seen.push('get'); return connection },
  }
  // Simulate the LAN case: hostname is not loopback in this VM realm? The
  // sandbox pins 127.0.0.1, so use a dedicated LAN-flavoured sandbox below.
  let handoff2 = null
  const lanSandbox = {
    window: { __ModuleLoader__: { load: (h) => { handoff2 = h } } },
    location: { hostname: '172.19.0.1' },
    require: (spec) => requireStub(spec),
    Object,
    Symbol,
    console,
  }
  vm.createContext(lanSandbox)
  vm.runInContext(code, lanSandbox)
  const mod2 = handoff2.factory((spec) => requireStub(spec))
  mod2.apply({
    slots: ctx.slots,
    locale: ctx.locale,
    connection,
  })
  assert.equal(seen.length, 0, 'the host-realm probe stays untouched')
  assert.equal(connection.isLoopback, true, 'LAN hostname must yield a trusted getter')
  const descriptor = Object.getOwnPropertyDescriptor(connection, 'isLoopback')
  assert.equal(typeof descriptor.get, 'function', 'isLoopback must be installed as a getter')
  assert.equal(descriptor.get(), true)

  // Loopback access must be a no-op: hostname detection already reports true.
  const plainConnection = { isLoopback: false }
  let handoff3 = null
  const loopSandbox = {
    window: { __ModuleLoader__: { load: (h) => { handoff3 = h } } },
    location: { hostname: '127.0.0.1' },
    require: (spec) => requireStub(spec),
    Object,
    Symbol,
    console,
  }
  vm.createContext(loopSandbox)
  vm.runInContext(code, loopSandbox)
  const mod3 = handoff3.factory((spec) => requireStub(spec))
  mod3.apply({ slots: ctx.slots, locale: ctx.locale, connection: plainConnection })
  assert.equal(plainConnection.isLoopback, false, 'loopback pages keep dsh native state')

  // A missing connection service must not break the panel registration.
  let registered = false
  mod.apply({
    slots: {
      inject: (name, fn) => { fn(); registered = true },
      register: () => ({}),
    },
    locale: { register: () => {}, bind: () => () => '' },
  })
  assert.ok(registered, 'panel still registers without a connection service')
})

test('client apply() registers dictionaries and the settings.section slot', () => {
  const handoff = loadBundle()
  const mod = handoff.factory(requireStub)
  const bySlot = {}
  let currentSlot = null
  let registeredNs = null
  let registeredDicts = null
  const effects = []
  const ctx = {
    effect: (fn, name) => { effects.push({ fn, name }) },
    slots: {
      inject: (name, fn) => { currentSlot = name; try { return fn() } finally { currentSlot = null } },
      register: (def, component) => { bySlot[currentSlot] = { def, component }; return { ...def } },
    },
    locale: {
      register: (ns, dicts) => { registeredNs = ns; registeredDicts = dicts },
      bind: () => (key) => '[' + key + ']',
    },
  }
  mod.apply(ctx)
  assert.ok(bySlot['settings.section'], 'settings.section must be registered')
  const registered = bySlot['settings.section'].def
  const registeredComponent = bySlot['settings.section'].component
  assert.equal(registered.id, 'user-settings')
  assert.equal(registered.locale, 'dsh-auth-gateway', 'slot must declare its locale namespace')

  // Highest official section in dsh 0.1.7 is agent-presets at 20 (source:
  // packages/client/ui-*/src/client/index.ts — account -10, general 0,
  // models 10, plugins 15, agent-presets 20); a third-party section must
  // sort strictly above every shipped one.
  assert.ok(registered.order > 20,
    `settings.section order must sort after official sections, got ${registered.order}`)

  // The registration follows the standard settings.section seam only —
  // no DOM probing, no style injection (the shell renders its own icon).
  assert.ok(!source.includes('MutationObserver'), 'no MutationObserver in the client source')
  assert.ok(!source.includes('NAV_MARKER'), 'no nav-marker DOM patching in the client source')

  // Dictionaries: own namespace, zh source of truth, en key set complete.
  assert.equal(registeredNs, 'dsh-auth-gateway')
  const zhKeys = Object.keys(registeredDicts.zh).sort()
  const enKeys = Object.keys(registeredDicts.en).sort()
  assert.deepEqual(enKeys, zhKeys, 'en dictionary must cover every zh key')

  // The label thunk goes through the bound translator (follows the locale).
  assert.equal(registered.label(), '[nav]')

  // The registration must not declare a locale namespace that is never
  // installed: slots render the `t` seat only for declared locales, and an
  // uninstalled namespace fails loud at render time.
  assert.equal(registered.locale, 'dsh-auth-gateway', 'no uninstalled locale namespace')

  // The inject face must deliver the gateway API to the component props.
  assert.equal(typeof registered.inject, 'function', 'inject face must be a function')
  const props = registered.inject()
  assert.ok(props.api, 'component props must include the api object')
  for (const method of ['getSettings', 'getVersion', 'checkForUpdates', 'enableOtp', 'verifyOtpSetup', 'disableOtp', 'changePassword', 'logout']) {
    assert.equal(typeof props.api[method], 'function', `api.${method} must be a function`)
  }
  assert.equal(typeof registeredComponent, 'function', 'register must receive the component')
})

test('detail-page guidance renders only on this plugin\'s own pages', () => {
  // The plugin detail page contributes a guide to Settings -> Authentication
  // Settings through the official plugins.detail.section slot. The entry must
  // render on this plugin's bundle and row pages and stay off every other
  // subject (official plugins list their own pages through `item`).
  const handoff = loadBundle()
  const mod = handoff.factory(requireStub)
  const bySlot = {}
  let currentSlot = null
  mod.apply({
    effect: () => {},
    slots: {
      inject: (name, fn) => { currentSlot = name; try { return fn() } finally { currentSlot = null } },
      register: (def, component) => { bySlot[currentSlot] = { def, component }; return { ...def } },
    },
    locale: { register: () => {}, bind: () => (key) => '[' + key + ']' },
  })
  const guide = bySlot['plugins.detail.section']
  assert.ok(guide, 'plugins.detail.section must be registered')
  assert.equal(guide.def.locale, 'dsh-auth-gateway', 'guide declares the locale namespace for the t seat')
  const render = guide.component
  assert.ok(render({ subject: { kind: 'bundle', pkg: { name: 'dsh-auth-gateway' } } }) !== null,
    'renders on our bundle detail page')
  assert.ok(render({
    subject: { kind: 'row', pkg: { name: 'dsh-auth-gateway' }, row: { rowId: 'dsh-auth-gateway', moduleName: 'dsh-auth-gateway' } },
  }) !== null, 'renders on our row detail page')
  assert.equal(render({ subject: { kind: 'bundle', pkg: { name: 'other-plugin' } } }), null,
    'never renders on another plugin\'s page')
  assert.equal(render({ subject: { kind: 'item', id: 'settings-general' } }), null,
    'never renders on official plugin pages')
})

test('component takes no ctx prop and never fetches directly', () => {
  // ctx belongs to the apply world only — the component signature must be
  // { api, t } (props from the slot inject face + the locale seat), and fetch
  // calls may only live inside apply()'s api factory, never in the component
  // body.
  assert.ok(source.includes('function UserSettingsPanel({ api, t })'),
    'component must receive props (api) and the locale seat (t)')
  assert.ok(!source.includes('function UserSettingsPanel({ ctx })'),
    'component must not receive ctx')
  assert.ok(source.includes("const inject = ['slots', 'locale', 'connection']"), 'inject must declare slots, locale and connection')
  // The settings key the panel reads must match the gateway's
  // /login-api/settings response key (lib/gateway.js #handleGetSettings) —
  // a rename miss here silently shows OTP as disabled.
  assert.ok(source.includes("config?.['dsh-auth-gateway']"),
    'panel must read the dsh-auth-gateway config key')
  // The cookie-Secure card reads the policy field the gateway resolves into
  // that same response (#handleGetSettings `cookieSecure`); a rename on one
  // side would silently show the card as auto forever.
  assert.ok(source.includes('cfg.cookieSecure'),
    'panel must read the cookieSecure policy from the settings response')
  assert.ok(source.includes('cfg.cookieSecureSource'),
    'panel must read where the cookieSecure policy comes from (deployment vs panel)')
  // The gateway's transport-truth field rides at the TOP level of the
  // /login-api/settings response (lib/gateway-panel-api.js `requestSecure`),
  // not inside the config block — a read from cfg would always be undefined.
  assert.ok(source.includes('data.requestSecure'),
    'panel must read the gateway transport signal from the TOP level of the settings response')
  // All panel API calls and redirects must go through the basePath global
  // injected by index.js — root-absolute paths would break sub-path
  // (reverse-proxy) deployments.
  assert.ok(source.includes('__dshAuthGatewayBasePath__'),
    'panel must derive its API base from the injected basePath global')
})

test('panel api factory exposes the cookie-secure write methods', () => {
  // Regression: the Save / Restore buttons once called api.setCookieSecure /
  // api.resetCookieSecure while the api factory did not define them — clicks
  // failed silently as "网络错误，未保存", and build:check could not catch it
  // because the built bundle reproduced the same missing methods. Pin both
  // the source factory and the built bundle.
  assert.ok(source.includes('setCookieSecure: async'), 'api must expose setCookieSecure')
  assert.ok(source.includes('resetCookieSecure: async'), 'api must expose resetCookieSecure')
  assert.ok(code.includes('setCookieSecure'), 'built bundle must include setCookieSecure')
  assert.ok(code.includes('resetCookieSecure'), 'built bundle must include resetCookieSecure')
})

test('client bundle keeps react and slots as external requires (not inlined)', () => {
  for (const spec of ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-slots']) {
    assert.ok(code.includes(`require("${spec}")`), `bundle must require ${spec}`)
  }
})

function requireStub(spec) {
  if (spec === 'react') return { useState: () => [], useEffect: () => {}, Fragment: 'fragment' }
  if (spec === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' }
  if (spec === '@deepseek-ai/dsh-client-ui-slots') return {}
  return undefined
}
