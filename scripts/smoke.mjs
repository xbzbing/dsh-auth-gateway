/**
 * Smoke harness: load the plugin's apply() with a mock Cordis ctx against a
 * fake upstream dsh web server, so scripts/verify.sh can run end-to-end
 * without a real dsh installation.
 *
 *   node scripts/smoke.mjs          # serves 127.0.0.1:3180 -> fake upstream :3181
 *
 * Ports are deliberately NOT 3080/3081 (a real dsh web may be running).
 *
 * CREDENTIAL ISOLATION: the mock runs the REAL apply(), whose store writes
 * under $DSH_HOME/auth-gateway/. Without isolation a smoke run would mint an
 * initial password INTO A REAL deployment's home (first run) or let
 * verify.sh's /login/change rewrite a real password. An ambient DSH_HOME
 * (e.g. exported by a parent dsh process) is NOT trusted — only the
 * dedicated SMOKE_DSH_HOME variable opts into a specific sandbox. Otherwise
 * a temp home is created here, printed on startup and removed on exit.
 */

import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const UPSTREAM_PORT = 3181
const LISTEN_PORT = 3180

// Only an EXPLICIT SMOKE_DSH_HOME is respected; a merely ambient DSH_HOME is
// overridden so the smoke can never touch a real deployment's credentials.
const SMOKE_HOME_ENV = 'SMOKE_DSH_HOME'
const ambientHome = process.env.DSH_HOME
const ownedHome = process.env[SMOKE_HOME_ENV] === undefined
const dshHome = ownedHome
  ? mkdtempSync(join(tmpdir(), 'dsh-auth-gateway-smoke-'))
  : process.env[SMOKE_HOME_ENV]
process.env.DSH_HOME = dshHome
if (ownedHome) {
  console.log(`smoke DSH_HOME: ${dshHome}（临时目录，退出时清理）${ambientHome !== undefined ? `；已隔离环境中的 DSH_HOME=${ambientHome}` : ''}`)
} else {
  console.log(`smoke DSH_HOME: ${dshHome}（SMOKE_DSH_HOME 指定的沙箱）`)
}

// Fake upstream: any page 200, any /api 200 json, no upgrade handling. The
// captured tapIndex transform runs on the index page, like the real server.
let indexTransform
const upstream = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(indexTransform ? indexTransform('<h1>fake dsh web</h1>') : '<h1>fake dsh web</h1>')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{"ok":true}')
})
await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve))

// Mock Cordis ctx: enough of the surface apply() touches. `credentials`
// mirrors the injected official service; returning undefined (no
// browser-session record) exercises the verbatim-forwarding degrade path.
const disposers = []
const ctx = {
  webServer: {
    host: '127.0.0.1',
    port: UPSTREAM_PORT,
    tapIndex: (fn) => { indexTransform = fn },
  },
  credentials: {
    readRecord: async (key) => undefined,
  },
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
  for (const disposer of disposers.reverse()) {
    if (typeof disposer === 'function') await disposer()
  }
  await new Promise((resolve) => upstream.close(resolve))
  if (ownedHome) rmSync(dshHome, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1 << 30) // keep alive
