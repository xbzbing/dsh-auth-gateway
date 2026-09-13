/**
 * Forwarder response-relay tests: the gateway relays upstream responses with
 * hop-by-hop headers stripped (RFC 9110 §7.6.1), while WebSocket upgrades
 * keep their handshake headers. Regression coverage for the intermittent
 * empty 400 behind a reverse proxy: dsh's Node webserver answers every
 * upstream request with `connection: keep-alive`; relayed verbatim while the
 * client had sent `Connection: close` (nginx's map for non-upgrade requests),
 * the contradiction made nginx reuse a parser-finalized socket and the
 * gateway rejected the next request with `HPE_CLOSED_CONNECTION: Data after
 * \`Connection: close\``. Unit tests target stripResponseHopByHop; an
 * end-to-end test drives createForwarder with a fake upstream and asserts
 * the client-facing response headers and body.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createForwarder, stripResponseHopByHop } from '../lib/forward.js'

// ── unit: stripResponseHopByHop ─────────────────────────────────────────

test('stripResponseHopByHop: removes the canonical hop-by-hop set and Connection-named tokens', () => {
  const headers = {
    connection: 'keep-alive, x-hop-one',
    'keep-alive': 'timeout=5',
    'x-hop-one': 'secret',
    te: 'trailers',
    trailer: 'x-custom',
    upgrade: 'websocket',
    'proxy-authenticate': 'Basic',
    'proxy-authorization': 'Basic xyz',
    'transfer-encoding': 'chunked',
    'content-length': '42',
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    vary: 'Accept-Encoding',
    'x-end-to-end': 'kept',
    date: 'Sat, 01 Jan 2026 00:00:00 GMT',
  }
  stripResponseHopByHop(headers)
  assert.deepEqual(headers, {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    vary: 'Accept-Encoding',
    'x-end-to-end': 'kept',
    date: 'Sat, 01 Jan 2026 00:00:00 GMT',
  })
})

test('stripResponseHopByHop: tolerates missing, empty, non-string or mixed-case connection values', () => {
  assert.doesNotThrow(() => stripResponseHopByHop({}))
  assert.doesNotThrow(() => stripResponseHopByHop({ connection: 42 }))
  const empty = { connection: '' }
  stripResponseHopByHop(empty)
  assert.deepEqual(empty, {})
  // tokens are lowercased and matched against (lowercase) header names
  const mixed = { connection: 'X-UPGRADE', 'x-upgrade': '1' }
  stripResponseHopByHop(mixed)
  assert.deepEqual(mixed, {})
})

// ── integration: createForwarder response relay ─────────────────────────

test('forward: relays the upstream response with hop-by-hop headers stripped (regression: nginx empty 400)', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      connection: 'keep-alive, x-hop-one',
      'keep-alive': 'timeout=5',
      'x-hop-one': 'must-not-leak',
      te: 'trailers',
      upgrade: 'h2c',
      'x-end-to-end': 'kept',
    })
    res.end('{"ok":true}')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => upstream.close())

  const forwarder = createForwarder({
    upstreamHost: '127.0.0.1',
    upstreamPort: upstream.address().port,
  })
  const gateway = http.createServer((req, res) => forwarder.forward(req, res, req.url))
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
  t.after(() => gateway.close())

  // The nginx map shape for non-upgrade requests: Connection: close.
  const res = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: gateway.address().port,
      path: '/api/test',
      method: 'GET',
      headers: { connection: 'close' },
    }, (r) => {
      let body = ''
      r.on('data', (c) => { body += c })
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })

  assert.equal(res.status, 200)
  assert.equal(res.body, '{"ok":true}')
  // Hop-by-hop headers must not reach the client — the core regression:
  // relayed `connection: keep-alive` made nginx reuse a close-finalized
  // socket and the next request on it got an empty 400. Node decides
  // connection semantics solely from the client's own `Connection: close`
  // and answers "close" — never the upstream's leaked keep-alive.
  assert.equal(res.headers.connection, 'close')
  for (const name of ['keep-alive', 'te', 'upgrade', 'x-hop-one', 'trailer', 'content-length']) {
    assert.equal(res.headers[name], undefined, `${name} must not be relayed to the client`)
  }
  // Node re-frames the body for this hop (chunked) instead of copying the
  // upstream's framing.
  assert.equal(res.headers['transfer-encoding'], 'chunked')
  // End-to-end headers survive.
  assert.equal(res.headers['content-type'], 'application/json')
  assert.equal(res.headers['content-encoding'], 'gzip')
  assert.equal(res.headers['x-end-to-end'], 'kept')
})