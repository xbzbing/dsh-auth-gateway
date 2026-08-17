/**
 * Client bundle contract test: executes the built client bundle
 * (client/index.js, generated from client/src/index.jsx by `npm run build:client`)
 * under a mock of dsh's client loader, and asserts the contract dsh relies on:
 *
 *   - the bundle is a window.__ModuleLoader__.load({ id, factory }) registration
 *   - the factory returns { apply, inject } (plugin client contract)
 *   - apply() registers the "用户设置" settings.section slot
 *
 * This guards against the bundle drifting out of contract (e.g. after a
 * hand-edit or a bad build).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client/index.js', import.meta.url), 'utf8')

function loadBundle() {
  let handoff = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (h) => { handoff = h },
      },
    },
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
  assert.equal(handoff.id, 'dsh-password-gate')
  const mod = handoff.factory((spec) => {
    const r = requireStub(spec)
    if (r === undefined) throw new Error('unexpected require: ' + spec)
    return r
  })
  assert.equal(typeof mod.apply, 'function', 'client exports must include apply')
  assert.ok(Array.isArray(mod.inject), 'client exports must include inject')
})

test('client apply() registers the user-settings section slot', () => {
  const handoff = loadBundle()
  const mod = handoff.factory(requireStub)
  let slotName = null
  let registered = null
  const ctx = {
    slots: {
      inject: (name, fn) => { slotName = name; registered = fn() },
      register: (def) => ({ ...def }),
    },
  }
  mod.apply(ctx)
  assert.equal(slotName, 'settings.section')
  assert.equal(registered.id, 'user-settings')
  assert.equal(registered.label(), '用户设置')
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
