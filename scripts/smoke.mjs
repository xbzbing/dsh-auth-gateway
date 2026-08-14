/**
 * Smoke harness: load the plugin's apply() with a mock Cordis ctx against a
 * fake upstream dsh web server, so scripts/verify.sh can run end-to-end
 * without a real dsh installation.
 *
 *   node scripts/smoke.mjs          # serves 127.0.0.1:3180 -> fake upstream :3181
 *
 * Ports are deliberately NOT 3080/3081 (a real dsh web may be running).
 */

import http from 'node:http'
import { apply } from '../index.js'

const UPSTREAM_PORT = 3181
const LISTEN_PORT = 3180

// Fake upstream: any page 200, any /api 200 json, no upgrade handling.
const upstream = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<h1>fake dsh web</h1>')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{"ok":true}')
})
await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

// Mock Cordis ctx: enough of the surface apply() touches.
const disposers = []
const ctx = {
  webServer: { host: '127.0.0.1', port: UPSTREAM_PORT },
  logger: {
    info: (...a) => console.log('[info]', ...a),
    warn: (...a) => console.log('[warn]', ...a),
  },
  effect: (factory) => {
    const disposer = factory()
    disposers.push(disposer)
    return () => {}
  },
}

await apply(ctx, {
  listenHost: '127.0.0.1',
  listenPort: LISTEN_PORT,
  upstreamHost: '127.0.0.1',
  upstreamPort: UPSTREAM_PORT,
})
console.log(`gateway up on http://127.0.0.1:${LISTEN_PORT} -> http://127.0.0.1:${UPSTREAM_PORT}`)

async function shutdown() {
  for (const disposer of disposers.reverse()) await disposer()
  await new Promise((resolve) => upstream.close(resolve))
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1 << 30) // keep alive
