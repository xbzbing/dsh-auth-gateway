/**
 * dsh-auth-gateway — Cordis plugin entry.
 *
 * Provides a password login gateway in front of the dsh web server. The
 * gateway owns the external port; every HTTP request and WebSocket upgrade
 * passes its auth gate before being forwarded verbatim to the internal dsh
 * webserver (whose bundle patch moves it to a loopback-only port).
 *
 * See docs/zh/DEVELOPMENT.md for the architecture and docs/zh/SECURITY.md for
 * the security model.
 */

import { createGateway, lanAddresses } from './lib/gateway.js'
import { Config } from './lib/config.js'
import { AuditLogWriter } from './lib/audit-log.js'
import { hasPassword, setPassword, generateInitialPassword } from './lib/store.js'
import { buildLanTrustScript } from './lib/lan-trust-script.js'
import { createCachedSecretReader } from './lib/upstream-auth.js'

export const name = 'dsh-auth-gateway'

export { Config }

/**
 * The gateway needs the real web server running (its port is the upstream).
 * `credentials` is the official record service: on dsh ≥ 0.1.2 the internal
 * webserver enforces BrowserAuth, and its signing secret lives in the
 * `client-connection/browser-session` record — the same record dsh's own
 * BrowserAuth reads and writes through this service.
 */
export const inject = ['webServer', 'credentials']

/** The credential record dsh persists its upstream browser-session secret in. */
const UPSTREAM_RECORD_KEY = 'client-connection/browser-session'

/**
 * Build the upstream browser-auth secret source (see
 * createCachedSecretReader in lib/upstream-auth.js for the caching and
 * retry semantics). `secret` is the synchronous reader handed down to the
 * forwarder; `warm` is awaited before the gateway listens so the first
 * forwarded request can never race ahead of the cache. On dsh ≤ 0.1.1 the
 * record service lacks readRecord → undefined source → verbatim forwarding,
 * byte-for-byte the pre-0.1.2 behavior.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function upstreamSecretReader(ctx) {
  if (typeof ctx.credentials?.readRecord !== 'function') {
    return { secret: () => undefined, warm: () => Promise.resolve() }
  }
  return createCachedSecretReader({
    key: UPSTREAM_RECORD_KEY,
    readRecord: (key) => ctx.credentials.readRecord(key),
    onError: (err) => {
      // Transient read failure: keep the last known secret so forwarding
      // keeps working; a truly revoked secret surfaces as upstream 401s
      // (visible) rather than a silent gateway-side refusal.
      ctx.logger.warn('[dsh-auth-gateway] 读取 upstream browser-session 密钥失败: %s',
        err instanceof Error ? err.message : String(err))
    },
  })
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] - plugin config from the composition
 */
export async function apply(ctx, config) {
  const upstream = upstreamSecretReader(ctx)
  // Populate the upstream browser-auth secret cache BEFORE the gateway
  // listens: the first forwarded request must never race ahead of the read
  // (fire-and-forget warm-up could cost one visible upstream 401). A failed
  // or absent read still resolves — no secret means verbatim forwarding.
  await upstream.warm()
  const gateway = createGateway(config, { upstreamSecretReader: upstream.secret })

  // Browser-side compatibility for authenticated pages. The randomUUID
  // polyfill can run at the start of <head>; it also publishes the gateway's
  // basePath ('' for root) as a global so the client settings panel builds
  // API paths and redirects that survive sub-path (reverse-proxy) deployments.
  // The LAN trust fix lives in the CLIENT plugin (client/src/index.jsx): it
  // marks connection.isLoopback through the official inject seam at apply
  // time — no module-loader surgery, so coexisting plugins (better-sidebar
  // and friends) keep their activation semantics untouched.
  const randomUUIDScript = '<script>'
    + 'window.__dshAuthGatewayBasePath__=' + JSON.stringify(gateway.basePath) + ';'
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

  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    const withPolyfill = html.replace('<head>', `<head>${randomUUIDScript}`)
    // The LAN trust script must run AFTER the loader bootstrap has defined
    // `window.__ModuleLoader__` (queue mode) but before any bundle registers.
    // dsh's index defines it inline (window.__ModuleLoader__={...}); insert
    // right after that script tag, falling back to the end of <head>.
    const marker = 'window.__ModuleLoader__='
    const loaderStart = withPolyfill.indexOf(marker)
    const loaderEnd = loaderStart === -1 ? -1 : withPolyfill.indexOf('</script>', loaderStart)
    if (loaderStart === -1 || loaderEnd === -1) {
      // No recognizable loader bootstrap — still inject at <head> end so the
      // polyfill works; the LAN trust guard degrades silently.
      return withPolyfill.replace('</head>', `${buildLanTrustScript()}</head>`)
    }
    const insertAt = loaderEnd + '</script>'.length
    return withPolyfill.slice(0, insertAt) + buildLanTrustScript() + withPolyfill.slice(insertAt)
  }), 'dsh-auth-gateway: randomUUID + basePath global + LAN trust bootstrap')

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

  // Durable audit trail. ctx.logger is buffer-only in the current dsh runtime
  // (its built-in exporter keeps the last 1000 records in memory), so auth
  // events and brute-force alerts are additionally appended as JSONL to
  // $DSH_HOME/auth-gate/audit.log — the persistent, greppable record. Daily
  // rotation, 90-day retention; write failures degrade to a warn line and
  // never touch the auth flow (see lib/audit-log.js).
  const auditLog = new AuditLogWriter({
    onError: (err) => {
      const suppressed = err.suppressed > 0 ? `（已抑制 ${err.suppressed} 条重复告警）` : ''
      ctx.logger.warn('[dsh-auth-gateway] 审计日志写入失败%s: %s', suppressed, err.message)
    },
    onRecover: () => {
      ctx.logger.info('[dsh-auth-gateway] 审计日志写入已恢复')
    },
  })
  auditLog.open()

  // Brute-force alerts, through dsh's official channels only: a Host log
  // line plus a Cordis event (`dsh-auth-gateway/brute-force`) any plugin
  // can listen to. No DOM/UI poking — surfacing this in the GUI would be a
  // client-plugin slot registration (out of scope for the host-only plugin).
  gateway.onSecurityEvent = (payload) => {
    ctx.logger.warn('[dsh-auth-gateway] 疑似暴力破解: %s', JSON.stringify(payload))
    ctx.emit('dsh-auth-gateway/brute-force', payload)
    // Same alert lands in the file trail. sourceAddress is absent for the
    // process-wide `global-rate-limit` event; the writer omits undefined
    // fields, so the line carries only what the payload had.
    auditLog.append({
      kind: payload.kind,
      ip: payload.sourceAddress,
      limit: payload.limit,
      windowSeconds: payload.windowSeconds,
      maxFailures: payload.maxFailures,
      lockedUntil: payload.lockedUntil,
    })
  }

  // Auth audit: login success/failure, logout and password change go to the
  // host log at info level and to the audit.log file sink. Payloads carry
  // only {kind, ip, reason?} — never credentials, OTP codes or session tokens.
  gateway.onAuthEvent = (payload) => {
    const { kind, ip, reason } = payload
    const detail = reason === undefined ? '' : ` reason=${reason}`
    const label = {
      'login-success': '登录成功',
      'login-failed': '登录失败',
      'logout': '登出',
      'password-change': '修改密码成功',
      'password-change-failed': '修改密码失败',
      'otp-disabled': '禁用 OTP 成功',
      'otp-disable-failed': '禁用 OTP 失败',
    }[kind] ?? kind
    ctx.logger.info('[dsh-auth-gateway] %s ip=%s%s', label, ip, detail)
    auditLog.append(payload)
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
    // Graceful shutdown drains in-flight audit writes; a hard crash can
    // still lose the single line that was being written.
    await auditLog.flush()
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
