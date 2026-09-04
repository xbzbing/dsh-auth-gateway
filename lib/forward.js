/**
 * Forwarding plumbing for the login gateway: transparent HTTP forwarding and
 * WebSocket upgrade piping, extracted from gateway.js so the auth gate and
 * the transport layer stay separate concerns.
 *
 * Host and Origin are REWRITTEN to the loopback upstream before forwarding:
 * dsh's /api browser-trust fence derives its LAN trusted-host list from the
 * webserver's bind (0.0.0.0), but the login design pins the webserver to
 * 127.0.0.1, so an external Host (LAN IP) would be 403'd inside. Rewriting is
 * safe because the gateway's own cookie gate (HttpOnly + SameSite=Strict) has
 * taken over the fence's job: cross-site and DNS-rebinding requests carry no
 * session cookie and are refused before they reach the upstream.
 *
 * dsh ≥ 0.1.2 additionally arms browser auth ON the upstream itself (see
 * lib/upstream-auth.js): forwarded requests carry a minted upstream cookie
 * alongside the rewrite, or the upstream answers 401 before any gate matters.
 *
 * Pure node:http, zero dependencies.
 */

import http from 'node:http'
import os from 'node:os'
import { createUpstreamCookieMinter } from './upstream-auth.js'

/**
 * Build a forwarder bound to one upstream target.
 * @param {object} options
 * @param {string} options.upstreamHost - internal dsh webserver host (127.0.0.1).
 * @param {number} options.upstreamPort - internal dsh webserver port.
 * @param {() => (Buffer | undefined)} [options.upstreamSecretReader] - sync
 *   source of the upstream browser-auth signing secret (cached by the plugin
 *   entry over ctx.credentials; absent/undefined → verbatim forwarding).
 * @param {(err: Error) => void} [options.onError] - diagnostics sink.
 */
export function createForwarder({ upstreamHost, upstreamPort, upstreamSecretReader, onError }) {
  const upstreamCookie = createUpstreamCookieMinter(`${upstreamHost}:${upstreamPort}`, upstreamSecretReader)

  /**
   * Attach the minted upstream browser-auth cookie to outgoing headers.
   * The browser's own Cookie header describes the gateway session upstream
   * does not know; the minted cookie is appended (not replacing — a future
   * upstream that reads other cookies keeps them). No-op when no secret is
   * known (dsh ≤ 0.1.1: no upstream auth to satisfy).
   * @param headers - mutable outgoing header object.
   */
  function attachUpstreamAuth(headers) {
    const minted = upstreamCookie.cookieHeader()
    if (minted === undefined) return
    headers.cookie = headers.cookie === undefined
      ? minted
      : `${headers.cookie}; ${minted}`
  }

  /**
   * Transparent HTTP forward. Callers pass an origin-form path (already
   * basePath-stripped); headers are copied verbatim except hop-by-hop ones,
   * with Host/Origin rewritten to the loopback authority.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} forwardPath - origin-form request target for the upstream.
   * @param {object} [opts]
   * @param {boolean} [opts.upstreamAuth=true] - attach the minted upstream
   *   browser-auth cookie. Only gate-passed forwards should carry this
   *   fully-privileged bearer; the pre-gate public-asset branch passes
   *   false (defense in depth — the upstream serves those statically to
   *   anonymous browsers anyway).
   */
  function forward(req, res, forwardPath, { upstreamAuth = true } = {}) {
    const headers = { ...req.headers }
    delete headers.connection
    delete headers['proxy-connection']
    rewriteLoopbackHeaders(headers, upstreamHost, upstreamPort)
    if (upstreamAuth) attachUpstreamAuth(headers)
    const proxyReq = http.request({
      host: upstreamHost,
      port: upstreamPort,
      path: forwardPath,
      method: req.method,
      headers,
    }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers)
      upRes.pipe(res)
    })
    proxyReq.on('error', (err) => {
      onError?.(err)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad gateway: upstream unavailable')
      } else {
        res.destroy()
      }
    })
    res.on('close', () => proxyReq.destroy())
    req.pipe(proxyReq)
  }

  /**
   * WebSocket upgrade forward (Node's standard proxy pattern): the client's
   * upgrade request is replayed to the upstream; on its 101 the response head
   * is written back to the client socket and both sockets are piped.
   * Connection/upgrade headers must survive here (unlike regular forwards).
   * The fence checks Host/Origin identically on upgrades, so they are
   * rewritten like regular forwards.
   * @param {http.IncomingMessage} req
   * @param {import('node:stream').Duplex} socket
   * @param {Buffer} head
   * @param {string} forwardPath - origin-form request target for the upstream.
   */
  function upgrade(req, socket, head, forwardPath) {
    const headers = { ...req.headers } // connection/upgrade headers must survive here
    rewriteLoopbackHeaders(headers, upstreamHost, upstreamPort)
    attachUpstreamAuth(headers)
    const proxyReq = http.request({
      host: upstreamHost,
      port: upstreamPort,
      path: forwardPath,
      method: req.method,
      headers,
    })
    socket.on('error', () => proxyReq.destroy())
    proxyReq.on('error', (err) => {
      onError?.(err)
      socket.destroy()
    })
    proxyReq.on('response', (upRes) => {
      // Non-101 answer (e.g. 404 for an unknown endpoint): relay the status
      // line so the client sees the failure instead of a hung socket, then
      // tear both sides down — there is nothing to pipe for an upgrade that
      // was refused.
      const headLines = [
        `HTTP/${upRes.httpVersion} ${upRes.statusCode ?? 502} ${upRes.statusMessage ?? ''}`,
        ...Object.entries(upRes.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
      ]
      socket.write(`${headLines.join('\r\n')}\r\n\r\n`)
      socket.destroy()
      proxyReq.destroy()
    })
    proxyReq.on('upgrade', (upRes, upSocket, upHead) => {
      const headLines = [
        `HTTP/${upRes.httpVersion} ${upRes.statusCode ?? 101} ${upRes.statusMessage ?? ''}`,
        ...Object.entries(upRes.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
      ]
      socket.write(`${headLines.join('\r\n')}\r\n\r\n`)
      if (upHead.length > 0) socket.write(upHead)
      upSocket.on('error', () => socket.destroy())
      socket.on('error', () => upSocket.destroy())
      upSocket.pipe(socket)
      socket.pipe(upSocket)
    })
    if (head.length > 0) proxyReq.write(head)
    proxyReq.end()
  }

  return { forward, upgrade }
}

/**
 * Normalize a request-target into origin-form for forwarding. RFC 9112 allows
 * clients to send an ABSOLUTE-form target ("GET http://evil/x HTTP/1.1");
 * passing that verbatim to http.request would confuse the upstream about the
 * destination. Returns `pathname + search` for both forms (hash dropped),
 * or null when the target is unparsable.
 * @param rawUrl - the raw request target from req.url.
 */
export function normalizeForwardPath(rawUrl) {
  try {
    const url = new URL(rawUrl ?? '/', 'http://internal')
    return url.pathname + url.search
  } catch {
    return null
  }
}

/**
 * Rewrite Host (and Origin, when present) to the loopback upstream authority,
 * so dsh's internal /api trust fence sees a loopback request regardless of
 * the external address the browser used. See the module docblock for the
 * security rationale.
 * @param headers - mutable outgoing header object.
 * @param upstreamHost - loopback upstream host (127.0.0.1).
 * @param upstreamPort - internal webserver port.
 */
function rewriteLoopbackHeaders(headers, upstreamHost, upstreamPort) {
  const authority = `${upstreamHost}:${upstreamPort}`
  headers.host = authority
  if (headers.origin !== undefined) {
    headers.origin = `http://${authority}`
  }
}

/**
 * Non-loopback IPv4 literals of this machine, for the URL line. A display
 * helper only — the dsh trust fence samples its own LAN snapshot.
 */
export function lanAddresses() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address)
    }
  }
  return out
}