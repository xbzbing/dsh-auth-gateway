/**
 * dsh-auth-gateway — Cordis plugin entry.
 *
 * Provides a password login gateway in front of the dsh web server. The
 * gateway owns the external port; every HTTP request and WebSocket upgrade
 * passes its auth gate before being forwarded verbatim to the internal dsh
 * webserver (whose bundle patch moves it to a loopback-only port).
 *
 * See docs/DEVELOPMENT.md for the architecture and docs/SECURITY.md for
 * the security model.
 */

import { createGateway, lanAddresses } from './lib/gateway.js'
import { Config } from './lib/config.js'
import { hasPassword, setPassword, generateInitialPassword } from './lib/store.js'

export const name = 'dsh-auth-gateway'

export { Config }

/** The gateway needs the real web server running (its port is the upstream). */
export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - plugin config from the composition
 */
export async function apply(ctx, config) {
  const gateway = createGateway(config)

  // Browser-side compatibility for authenticated LAN pages. The randomUUID
  // polyfill can run at the start of <head>. The trusted-loopback bootstrap
  // must run later: after dsh creates its queue-mode __ModuleLoader__, but
  // before parser-preloaded client bundles register their factories.
  const randomUUIDScript = '<script>'
    + 'if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {'
    + 'crypto.randomUUID = function () {'
    + 'var b = crypto.getRandomValues(new Uint8Array(16));'
    + 'b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;'
    + 'var h = "";'
    + 'for (var i = 0; i < 16; i++) h += (i === 4 || i === 6 || i === 8 || i === 10 ? "-" : "") + b[i].toString(16).padStart(2, "0");'
    + 'return h;'
    + '};'
    + '}'
    + '</script>'
  const trustedLoopbackScript = `<script>(() => {
  const targetId = "@deepseek-ai/dsh-client-connection"
  const loader = globalThis.__ModuleLoader__
  const bootstrapKey = "__dshAuthGatewayTrustedLoopbackBootstrap__"
  if (loader && loader[bootstrapKey] === true) return
  if (!loader || loader.mode !== "queue" || typeof loader.load !== "function" || typeof loader.create !== "function") {
    console.error("dsh-auth-gateway: incompatible __ModuleLoader__ bootstrap; authenticated LAN settings remain unavailable")
    return
  }
  Object.defineProperty(loader, bootstrapKey, { value: true, configurable: false, enumerable: false })

  const wrappedFactories = new WeakSet()
  const wrappedApplies = new WeakSet()
  const wrappedLoads = new WeakSet()

  const wrapRegistration = (registration) => {
    if (!registration || (registration.id !== targetId && registration.id !== targetId + "/client")) return registration
    const originalFactory = registration.factory
    if (typeof originalFactory !== "function" || wrappedFactories.has(originalFactory)) return registration

    const wrappedFactory = function () {
      const moduleExports = originalFactory.apply(this, arguments)
      if (!moduleExports || typeof moduleExports.apply !== "function" || wrappedApplies.has(moduleExports.apply)) return moduleExports
      const originalApply = moduleExports.apply
      const wrappedApply = function (ctx) {
        const originalProvide = ctx.provide
        ctx.provide = function (service, value) {
          if (service === "connection") {
            Object.defineProperty(value, "isLoopback", {
              value: true,
              writable: true,
              configurable: true,
              enumerable: true,
            })
          }
          return originalProvide.apply(this, arguments)
        }
        try {
          return originalApply.apply(this, arguments)
        } finally {
          ctx.provide = originalProvide
        }
      }
      wrappedApplies.add(originalApply)
      wrappedApplies.add(wrappedApply)
      moduleExports.apply = wrappedApply
      return moduleExports
    }
    wrappedFactories.add(originalFactory)
    wrappedFactories.add(wrappedFactory)
    registration.factory = wrappedFactory
    return registration
  }

  const wrapLoad = () => {
    const originalLoad = loader.load
    if (wrappedLoads.has(originalLoad)) return
    const wrappedLoad = function (registration) {
      return originalLoad.call(this, wrapRegistration(registration))
    }
    wrappedLoads.add(wrappedLoad)
    loader.load = wrappedLoad
  }

  wrapLoad()
  const originalCreate = loader.create
  loader.create = function () {
    try {
      return originalCreate.apply(this, arguments)
    } finally {
      wrapLoad()
    }
  }
})()</script>`

  let warnedMissingLoader = false
  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    const withRandomUUID = html.replace('<head>', `<head>${randomUUIDScript}`)
    const loaderMarker = 'window.__ModuleLoader__='
    const loaderStart = withRandomUUID.indexOf(loaderMarker)
    const loaderEnd = loaderStart === -1 ? -1 : withRandomUUID.indexOf('</script>', loaderStart)
    if (loaderStart === -1 || loaderEnd === -1) {
      if (!warnedMissingLoader) {
        warnedMissingLoader = true
        ctx.logger.warn(
          '[dsh-auth-gateway] dsh client module bootstrap not found; '
          + 'authenticated LAN settings compatibility was not installed',
        )
      }
      return withRandomUUID
    }
    const insertAt = loaderEnd + '</script>'.length
    return withRandomUUID.slice(0, insertAt)
      + trustedLoopbackScript
      + withRandomUUID.slice(insertAt)
  }), 'dsh-auth-gateway: authenticated LAN browser compatibility')

  // Safety net: the whole design assumes the internal webserver is loopback-only.
  // The bundle patch enforces it, but a manual composition may forget.
  if (ctx.webServer.host !== '127.0.0.1') {
    ctx.logger.warn(
      '[dsh-auth-gateway] webServer is listening on %s; the internal port stays reachable '
      + 'outside this machine. The bundle patch sets host 127.0.0.1 — verify your composition.',
      ctx.webServer.host,
    )
  }

  gateway.onError = (err) => {
    ctx.logger.warn('[dsh-auth-gateway] %s', err instanceof Error ? err.message : String(err))
  }

  // Brute-force alerts, through dsh's official channels only: a Host log
  // line plus a Cordis event (`dsh-auth-gateway/brute-force`) any plugin
  // can listen to. No DOM/UI poking — surfacing this in the GUI would be a
  // client-plugin slot registration (out of scope for the host-only plugin).
  gateway.onSecurityEvent = (payload) => {
    ctx.logger.warn('[dsh-auth-gateway] 疑似暴力破解: %s', JSON.stringify(payload))
    ctx.emit('dsh-auth-gateway/brute-force', payload)
  }

  // Fail loud on a taken port (misconfiguration), like the webserver does.
  await gateway.start()

  // First run: mint an auto-generated initial password BEFORE the gateway
  // serves anything. The plaintext is printed once to the console (this
  // machine — the local trust model); the stored record is scrypt-hashed
  // with an `initial` marker, and any session logged in with it is forced
  // through /onboarding until the user sets a personal password.
  if (!hasPassword()) {
    const initial = generateInitialPassword()
    await setPassword(initial, { initial: true })
    // Bilingual notice: the full Chinese block first, then the full English
    // block, split by a dashed line — the same credential either way (a
    // single `initial` value). The host console cannot know the browser's
    // language reliably, so both are shown.
    console.log('')
    console.log('============================================================')
    console.log('  dsh-auth-gateway: 首次部署初始密码')
    console.log(`  初始密码: ${initial}`)
    console.log('  请使用该密码登录；登录后将引导你设置新的访问密码。')
    console.log('  （初始密码为一次性凭据，设置新密码后自动失效）')
    console.log('  初次登录可在引导页绑定 OTP，或稍后在「认证设置」面板中绑定。')
    console.log('------------------------------------------------------------')
    console.log('  dsh-auth-gateway: first-run initial password')
    console.log(`  Initial password: ${initial}`)
    console.log('  Log in with it; you will be guided to set your own access password.')
    console.log('  (One-time credential — invalidated once you set a new password)')
    console.log('  You can bind OTP on the onboarding page, or later from the Auth Settings panel.')
    console.log('============================================================')
    console.log('')
  }

  ctx.effect(() => async () => {
    await gateway.close()
  }, 'dsh-auth-gateway: gateway listen')

  // The real URL line. dsh's own line prints the INTERNAL webserver address
  // (loopback-only by design), which would mislead; this one names the
  // gateway — the address everyone should open. LAN hints only when the
  // gateway actually listens on all interfaces.
  const lan = lanAddresses()
  const lanHint = gateway.listenHost === '0.0.0.0' && lan.length > 0
    ? ` (LAN: http://${lan[0]}:${gateway.listenPort})`
    : ''
  console.log(`dsh web: http://127.0.0.1:${gateway.listenPort}${lanHint}`)
  ctx.logger.info('[dsh-auth-gateway] gateway listening on http://%s:%s -> http://%s:%s',
    gateway.listenHost, gateway.listenPort, gateway.upstreamHost, gateway.upstreamPort)

  // Log OTP configuration
  if (config?.otpEnabled) {
    ctx.logger.info('[dsh-auth-gateway] OTP enabled (required: %s)', config.otpRequired ? 'yes' : 'no')
  }
}

export default { name, inject, apply, Config }
