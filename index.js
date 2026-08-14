/**
 * dsh-password-gate — Cordis plugin entry.
 *
 * Provides a password login gateway in front of the dsh web server. The
 * gateway owns the external port; every HTTP request and WebSocket upgrade
 * passes its auth gate before being forwarded verbatim to the internal dsh
 * webserver (whose bundle patch moves it to a loopback-only port).
 *
 * See PROPOSAL.md for the design and deployment.
 */

import { createGateway, lanAddresses } from './lib/gateway.js'
import { Config } from './lib/config.js'

export const name = 'dsh-password-gate'

export { Config }

/** The gateway needs the real web server running (its port is the upstream). */
export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - plugin config from the composition
 */
export async function apply(ctx, config) {
  const gateway = createGateway(config)

  // Browser-side injections into every index.html response:
  //   1. crypto.randomUUID polyfill — the API exists only in secure contexts
  //      (HTTPS or localhost); the gateway is meant to be reached over plain
  //      HTTP on a LAN IP, where dsh's frontend would crash on it. A small
  //      polyfill over getRandomValues (always available) restores it.
  //   2. Floating "change password" shortcut — authenticated SPA pages get a
  //      corner button that opens the change-password form, so users are not
  //      left typing /login by hand. Probes GET /login/status (same-origin,
  //      carries the session cookie); never shows on /login itself.
  const injectedScript = '<script>'
    + 'if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {'
    + 'crypto.randomUUID = function () {'
    + 'var b = crypto.getRandomValues(new Uint8Array(16));'
    + 'b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;'
    + 'var h = "";'
    + 'for (var i = 0; i < 16; i++) h += (i === 4 || i === 6 || i === 8 || i === 10 ? "-" : "") + b[i].toString(16).padStart(2, "0");'
    + 'return h;'
    + '};'
    + '}'
    + '(function () {'
    + 'if (location.pathname === "/login") return;'
    + 'fetch("/login/status", { headers: { accept: "application/json" } })'
    + '.then(function (r) { return r.json(); })'
    + '.then(function (s) {'
    + 'if (!s || !s.authenticated) return;'
    + 'var btn = document.createElement("button");'
    + 'btn.id = "dsh-password-gate-shortcut";'
    + 'btn.textContent = "修改密码";'
    + 'btn.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483000;'
    + 'padding:9px 16px;font-size:13px;color:#fff;background:#4d6bfe;border:0;border-radius:8px;'
    + 'cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);";'
    + 'btn.addEventListener("click", function () { location.href = "/login"; });'
    + 'document.body.appendChild(btn);'
    + '})'
    + '.catch(function () {});'
    + '})();'
    + '</script>'
  ctx.effect(() => ctx.webServer.tapIndex((html) => html.replace(
    '<head>',
    `<head>${injectedScript}`,
  )), 'dsh-password-gate: index injections (randomUUID polyfill + password shortcut)')

  // Safety net: the whole design assumes the internal webserver is loopback-only.
  // The bundle patch enforces it, but a manual composition may forget.
  if (ctx.webServer.host !== '127.0.0.1') {
    ctx.logger.warn(
      '[dsh-password-gate] webServer is listening on %s; the internal port stays reachable '
      + 'outside this machine. The bundle patch sets host 127.0.0.1 — verify your composition.',
      ctx.webServer.host,
    )
  }

  gateway.onError = (err) => {
    ctx.logger.warn('[dsh-password-gate] %s', err instanceof Error ? err.message : String(err))
  }

  // Fail loud on a taken port (misconfiguration), like the webserver does.
  await gateway.start()

  ctx.effect(() => async () => {
    await gateway.close()
  }, 'dsh-password-gate: gateway listen')

  // The real URL line. dsh's own line prints the INTERNAL webserver address
  // (loopback-only by design), which would mislead; this one names the
  // gateway — the address everyone should open. LAN hints only when the
  // gateway actually listens on all interfaces.
  const lan = lanAddresses()
  const lanHint = gateway.listenHost === '0.0.0.0' && lan.length > 0
    ? ` (LAN: http://${lan[0]}:${gateway.listenPort})`
    : ''
  console.log(`dsh web: http://127.0.0.1:${gateway.listenPort}${lanHint}`)
  ctx.logger.info('[dsh-password-gate] gateway listening on http://%s:%s -> http://%s:%s',
    gateway.listenHost, gateway.listenPort, gateway.upstreamHost, gateway.upstreamPort)
}

export default { name, inject, apply, Config }
