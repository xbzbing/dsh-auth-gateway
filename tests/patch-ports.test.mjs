/**
 * Bundle patch port-expression tests.
 *
 * Reads the real cordis.patch.yml, extracts every `!!js` expression, and
 * evaluates it against a mock loader ctx — the same shape the vendored
 * include/loader uses (`!!js` expressions are evaluated against the entry's
 * activation context, where declared injects are live). This anchors the
 * patch's port derivation to the gateway code: `dsh web --port N` must yield
 * gateway=N, upstream=N+1, webserver=N+1.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/**
 * Extract `key: !!js expr` pairs from the real patch (expression order in the
 * file is not a contract; keys are), then evaluate each against a mock ctx.
 */
function evalPatch(webStartupPort, extra = {}) {
  const ctx = {
    webStartup: webStartupPort === undefined
      ? { trustedHosts: [] }
      : { port: webStartupPort, trustedHosts: [] },
    ...extra,
  }
  const pairs = new Map()
  for (const line of patch.split('\n')) {
    const m = /^(\s*)([\w-]+):\s*!!js\s+(.+)$/.exec(line)
    if (m) pairs.set(m[2], m[3])
  }
  const exprOf = (key) => {
    const expr = pairs.get(key)
    assert.ok(expr !== undefined, `patch must carry a !!js expression for ${key}`)
    // eslint-disable-next-line no-new-func
    return new Function('ctx', `return (${expr})`)(ctx)
  }
  return exprOf
}

test('default (no --port): gateway 3080, internal 3081', () => {
  const e = evalPatch(undefined)
  assert.equal(e('port'), 3081) // webserver row
  assert.equal(e('listenPort'), 3080)
  assert.equal(e('upstreamPort'), 3081)
  assert.equal(e('listenPort'), e('upstreamPort') - 1, 'gateway port must be internal minus one')
})

test('--port 8080: gateway 8080, internal 8081', () => {
  const e = evalPatch(8080)
  assert.equal(e('port'), 8081)
  assert.equal(e('listenPort'), 8080)
  assert.equal(e('upstreamPort'), 8081)
})

test('--port 4000: gateway 4000, internal 4001', () => {
  const e = evalPatch(4000)
  assert.equal(e('port'), 4001)
  assert.equal(e('listenPort'), 4000)
  assert.equal(e('upstreamPort'), 4001)
})

test('--port 65534: internal 65535 stays valid', () => {
  const e = evalPatch(65534)
  assert.equal(e('port'), 65535)
  assert.equal(e('upstreamPort'), 65535)
})

test('--port 65535 would break (internal 65536): config schema must reject it', async () => {
  const e = evalPatch(65535)
  assert.equal(e('port'), 65536)
  const { Config } = await import('../lib/config.js')
  const result = Config['~standard'].validate({ upstreamPort: e('upstreamPort') })
  assert.ok(result.issues, 'upstreamPort 65536 must fail the config schema')
})

test('web-runtime row: printUrl off, trustedHosts flows through webStartup', () => {
  const patchLines = patch.split('\n')
  const webRuntime = patchLines.indexOf('- id: web-runtime')
  assert.ok(webRuntime !== -1, 'patch must carry the web-runtime row')
  const block = patchLines.slice(webRuntime, patchLines.indexOf('- insert:'))
  assert.ok(block.join('\n').includes('printUrl: false'), 'misleading internal URL line must be off')
  assert.ok(block.join('\n').includes('surfaceContext: true'))
  // trustedHosts expression must read ctx.webStartup (--trusted-host survives).
  const e = evalPatch(8080, { webStartup: { port: 8080, trustedHosts: ['lan.example:8080'] } })
  assert.deepEqual(e('trustedHosts'), ['lan.example:8080'])
})
