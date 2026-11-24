/**
 * Provider-mode upstream authentication (dsh >= 0.2.3, docs/zh/adr/0001).
 *
 * Unit: the per-process credential, header stripping, registry detection,
 * and the child-plugin registration (against a fake ctx shaped like the
 * Cordis calls the module makes). Integration: a LoginGateway built with an
 * `upstreamCredential` forwards gate-passed HTTP and WebSocket traffic with
 * the provider header and no minted cookie, never lets a browser-supplied
 * header through, and never attaches it to anonymous forwards.
 */

import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GATEWAY_CREDENTIAL_HEADER,
  PROVIDER_PLUGIN_NAME,
  createGatewayCredential,
  hasAuthenticationRegistry,
  registerGatewayProvider,
  stripGatewayCredential,
} from '../lib/upstream-provider.js'
import { LoginGateway } from '../lib/gateway.js'
import { setPassword } from '../lib/store.js'

// ── unit ────────────────────────────────────────────────────────────────

test('credential: attach sets the header; matches accepts only that exact value', () => {
  const credential = createGatewayCredential()
  const headers = {}
  credential.attach(headers)
  const value = headers[GATEWAY_CREDENTIAL_HEADER]
  assert.equal(typeof value, 'string')
  assert.ok(value.length >= 43, '32 random bytes, base64url')
  assert.equal(credential.matches(headers), true, 'node:http header object')
  assert.equal(credential.matches(new Headers({ [GATEWAY_CREDENTIAL_HEADER]: value })), true, 'Fetch Headers')
  for (const bad of [{}, { [GATEWAY_CREDENTIAL_HEADER]: value + 'x' }, { [GATEWAY_CREDENTIAL_HEADER]: value.slice(1) },
    { [GATEWAY_CREDENTIAL_HEADER]: [value] }, { [GATEWAY_CREDENTIAL_HEADER]: `${value}, ${value}` }, null, undefined, 'str']) {
    assert.equal(credential.matches(bad), false, JSON.stringify(bad))
  }
  assert.equal(createGatewayCredential().matches(headers), false, 'every process gets a fresh credential')
})

test('stripGatewayCredential removes a browser-supplied copy only', () => {
  const headers = { [GATEWAY_CREDENTIAL_HEADER]: 'forged', cookie: 'a=b' }
  stripGatewayCredential(headers)
  assert.deepEqual(headers, { cookie: 'a=b' })
})

test('hasAuthenticationRegistry: true only when the registry exposes register()', () => {
  assert.equal(hasAuthenticationRegistry({ get: () => ({ register() {} }) }), true)
  assert.equal(hasAuthenticationRegistry({ get: () => undefined }), false, 'dsh <= 0.2.2')
  assert.equal(hasAuthenticationRegistry({ get: () => ({}) }), false)
  assert.equal(hasAuthenticationRegistry({ get: () => { throw new Error('x') } }), false)
})

/** Fake gateway ctx: `plugin()` runs the child apply against a scope holding both services. */
function fakeCtx({ throwOnRegister = false, deferApply = false } = {}) {
  const state = { providers: [], peers: [], plugin: undefined, run: undefined, disposeScope: undefined }
  // Scope-owned effects: ConnectionAuthentication.register resolves
  // `this.ctx` to the CALLING scope (Cordis service tracker), so a real
  // registration is withdrawn when that scope unloads. Mirror it here so
  // disposeScope() models the child-scope lifecycle instead of only
  // collecting the plugin definition.
  const scopeEffects = []
  const scope = {
    connection: {
      createPeer(options) {
        const peer = { options, signal: new AbortController().signal }
        state.peers.push(peer)
        return peer
      },
    },
    'connection.authentication': {
      register(provider) {
        if (throwOnRegister) throw new Error('registry disposed')
        state.providers.push(provider)
        const withdraw = () => {
          const index = state.providers.indexOf(provider)
          if (index >= 0) state.providers.splice(index, 1)
        }
        scopeEffects.push(withdraw)
        return async () => { withdraw() }
      },
    },
  }
  state.disposeScope = async () => {
    for (const dispose of scopeEffects.splice(0).reverse()) await dispose()
  }
  const ctx = {
    plugin(def) {
      state.plugin = def
      state.run = () => { try { def.apply(scope) } catch { /* surfaced through the promise */ } }
      if (!deferApply) state.run()
    },
  }
  return { ctx, state }
}

test('registerGatewayProvider: a child plugin injecting both services owns the provider and an owner Peer', async () => {
  const { ctx, state } = fakeCtx()
  const credential = createGatewayCredential()
  assert.equal(await registerGatewayProvider(ctx, credential), true)
  assert.equal(state.plugin.name, PROVIDER_PLUGIN_NAME)
  assert.deepEqual(state.plugin.inject, ['connection', 'connection.authentication'])
  assert.equal(state.peers.length, 1)
  assert.deepEqual(state.peers[0].options, { principal: { kind: 'owner' } })
  const [provider] = state.providers
  const headers = {}
  credential.attach(headers)
  assert.equal(provider.authenticate({ headers }), state.peers[0])
  assert.equal(provider.authenticate({ headers: {} }), undefined, 'other requests fall through to the next provider')
  assert.equal(provider.authenticate({}), undefined)
})

test('registerGatewayProvider: resolves false on timeout and rejects when registration throws', async () => {
  const deferred = fakeCtx({ deferApply: true })
  assert.equal(await registerGatewayProvider(deferred.ctx, createGatewayCredential(), { timeoutMs: 20 }), false)
  deferred.state.run()
  assert.equal(deferred.state.providers.length, 1,
    'a registration landing after the timeout still completes — the caller has already failed startup')
  const failing = fakeCtx({ throwOnRegister: true })
  await assert.rejects(registerGatewayProvider(failing.ctx, createGatewayCredential()), /registry disposed/)
})

test('registerGatewayProvider: the provider belongs to the child scope — dispose withdraws it', async () => {
  const { ctx, state } = fakeCtx()
  const credential = createGatewayCredential()
  assert.equal(await registerGatewayProvider(ctx, credential), true)
  const headers = {}
  credential.attach(headers)
  const [provider] = state.providers
  assert.equal(provider.authenticate({ headers }), state.peers[0], 'while the child scope lives, the Peer answers')
  await state.disposeScope()
  assert.equal(state.providers.length, 0, 'child-scope unload withdraws the registration (ADR-0001)')
  // ConnectionAuthentication.authenticate only reaches providers still in the
  // registry's set — model that iteration: nothing live answers anymore.
  const admitted = state.providers.map((entry) => entry.authenticate({ headers })).find((peer) => peer !== undefined)
  assert.equal(admitted, undefined, 'a withdrawn provider no longer returns a Peer')
})

// ── integration: LoginGateway in provider mode ─────────────────────────

let upstream, upstreamPort, seen, gateway, gatewayPort, home
const credential = createGatewayCredential()

before(async () => {
  upstream = http.createServer((req, res) => {
    const admitted = credential.matches(req.headers)
    seen.push({ url: req.url, admitted, header: req.headers[GATEWAY_CREDENTIAL_HEADER], cookie: req.headers.cookie })
    res.writeHead(admitted ? 200 : 401, { 'content-type': 'text/plain' })
    res.end(admitted ? 'ok' : 'unauthorized')
  })
  upstream.on('upgrade', (req, socket) => {
    const admitted = credential.matches(req.headers)
    seen.push({ url: req.url, admitted, upgrade: true })
    socket.end(admitted
      ? 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
      : 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  upstreamPort = upstream.address().port
})

after(async () => {
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
})

beforeEach(async () => {
  seen = []
  home = mkdtempSync(join(tmpdir(), 'agw-provider-'))
  process.env.DSH_HOME = home
  gateway = new LoginGateway({
    listenHost: '127.0.0.1', listenPort: 0, upstreamHost: '127.0.0.1', upstreamPort,
    upstreamCredential: credential,
    // Provider mode must never consult the cookie path.
    upstreamSecretReader: () => { throw new Error('secret read in provider mode') },
  })
  await gateway.start()
  gatewayPort = gateway.address().port
})

afterEach(async () => {
  await gateway.close()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path, method,
      headers: { host: 'test-host:3080', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

async function login() {
  await setPassword('GoodPass1')
  const res = await request('/login/auth', { method: 'POST', body: { password: 'GoodPass1' } })
  assert.equal(res.status, 200)
  const cookies = [res.headers['set-cookie'] ?? []].flat()
  return (cookies.find((c) => c.startsWith('agw-session=')) ?? cookies[0]).split(';')[0]
}

test('provider mode: a gate-passed forward carries the provider header and no minted cookie', async () => {
  const cookie = await login()
  const page = await request('/', { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.equal(seen.at(-1).admitted, true)
  assert.ok(!/dsh-auth-/.test(seen.at(-1).cookie ?? ''), 'no dsh-format cookie is minted')
})

test('provider mode: a forged header is replaced on gated forwards and dropped on anonymous ones', async () => {
  const cookie = await login()
  await request('/api/x', { headers: { cookie, [GATEWAY_CREDENTIAL_HEADER]: 'forged' } })
  assert.equal(seen.at(-1).admitted, true, 'the real credential replaces the forged one')
  for (const path of ['/favicon.svg', '/oauth/callback?code=a&state=b']) {
    await request(path, { headers: { [GATEWAY_CREDENTIAL_HEADER]: 'forged' } })
    assert.equal(seen.at(-1).header, undefined, `${path}: anonymous forwards carry no credential at all`)
  }
  const anonymous = await request('/api/x', { headers: { [GATEWAY_CREDENTIAL_HEADER]: 'forged' } })
  assert.equal(anonymous.status, 401, 'the gateway gate still refuses anonymous /api')
})

test('provider mode: WebSocket upgrades carry the credential after the gate', async () => {
  const cookie = await login()
  const result = await new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port: gatewayPort, path: '/api/socket', method: 'GET',
      headers: { host: 'test-host:3080', connection: 'Upgrade', upgrade: 'websocket', cookie, [GATEWAY_CREDENTIAL_HEADER]: 'forged' },
    })
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve('upgraded') })
    req.on('response', (res) => { res.resume(); resolve(`http-${res.statusCode}`) })
    req.on('error', () => resolve('rejected'))
    req.end()
  })
  assert.equal(result, 'upgraded')
  assert.equal(seen.at(-1).upgrade, true)
  assert.equal(seen.at(-1).admitted, true)
})
