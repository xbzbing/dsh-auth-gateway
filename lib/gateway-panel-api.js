/**
 * Settings-panel API for the login gateway: the authenticated operator
 * surface behind `/login-api/*`.
 *
 * Extracted from lib/gateway.js the same way lib/gateway-otp.js was, and for
 * the same reason — the gateway file must stay reviewable (it crossed 1000
 * lines as this surface grew). The four handlers share one concern: what a
 * signed-in operator may read (the plugin config snapshot, the running
 * version and update state) plus the ONE field they may write at runtime
 * (`cookieSecure`, persisted through the plugin's credential record).
 *
 * A module of plain functions bound to the gateway's public state and the
 * private helpers it cannot reach directly. `createPanelApi(gateway, priv,
 * state)` returns the route handlers plus the effective-policy readers the
 * gateway's own cookie minting consults.
 */

import { getOTPStatus } from './otp-store.js'
import { tokenFromCookieHeader } from './auth.js'

/**
 * @param {object} gateway - the LoginGateway instance (public state:
 *   `sessions`, `otp`, `cookieSecure`, `versionInfo`, `updateChecker`,
 *   `updateCheckAuto`, `onError`). Values are read live, never snapshotted —
 *   `onError` is wired by the plugin AFTER construction.
 * @param {object} priv - the gateway's private helpers, bound in the
 *   constructor: `json`, `readJson`, `verifiedTokenOr401`, `authEvent`,
 *   `otpActive`.
 * @param {object} [state]
 * @param {'auto'|true|false|null} [state.cookieSecureOverride] - panel-owned
 *   Secure policy read from the credential record at plugin start (null =
 *   none; the composition value rules).
 * @param {{read: Function, write: (mode: 'auto'|true|false) => Promise<void>, clear: () => Promise<void>}} [state.cookieSecureOverrideStore] -
 *   persistence half of the override, wired by the plugin entry
 *   (ctx.credentials record 'dsh-auth-gateway/cookie-secure'); absent → the
 *   POST route answers storage-unavailable and the panel stays read-only.
 * @returns {{cookieSecureMode: () => ('auto'|true|false), cookieSecureSource: () => ('deployment'|'panel'), serveSettings: Function, serveSessionProbe: Function, handleSetCookieSecure: Function, handleGetVersion: Function}}
 */
export function createPanelApi(gateway, priv, { cookieSecureOverride, cookieSecureOverrideStore } = {}) {
  const { json, readJson, verifiedTokenOr401, authEvent, otpActive } = priv

  // Runtime override persisted through the plugin credential record (the
  // settings panel is the writer). null = no override; 'auto'/true/false =
  // panel-owned value, takes precedence over the composition value.
  // Named panelOverride (not `override`) to stay clear of the TS class
  // member keyword of the same spelling.
  let panelOverride = cookieSecureOverride === true || cookieSecureOverride === false || cookieSecureOverride === 'auto'
    ? cookieSecureOverride
    : null

  /** Effective Secure policy: the panel override when one exists, else the composition value. */
  const cookieSecureMode = () => (panelOverride === null ? gateway.cookieSecure : panelOverride)

  /** Where the effective policy comes from, for the panel card. */
  const cookieSecureSource = () => (panelOverride === null ? 'deployment' : 'panel')

  /** GET /login-api/settings — return current plugin configuration. */
  function serveSettings(req, res) {
    const token = verifiedTokenOr401(req, res)
    if (token === undefined) return

    const otpStatus = getOTPStatus()
    json(res, 200, {
      ok: true,
      config: {
        'dsh-auth-gateway': {
          ...gateway.otp,
          otpEnabled: otpActive(),
          otpStatus,
          // Effective Cookie Secure policy for the panel card: the resolved
          // mode ('auto' | true | false) plus where it comes from
          // ('deployment' = bundle/profile patch, 'panel' = runtime override
          // persisted through the credential record).
          cookieSecure: cookieSecureMode(),
          cookieSecureSource: cookieSecureSource(),
        },
      },
    })
  }

  /** GET /login-api/session — does the presented cookie name a live session?
   * Answers 200 for onboarding sessions too (they are live, and the probe's
   * only job is verifying the cookie took). Exposes nothing beyond "this
   * cookie is valid", which the login page itself could learn from the
   * redirect target anyway. */
  function serveSessionProbe(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (token === undefined || !gateway.sessions.isValid(token)) {
      return json(res, 401, { ok: false, error: 'unauthenticated' })
    }
    json(res, 200, { ok: true })
  }

  /**
   * POST /login-api/cookie-secure — the settings panel's ONE runtime-tunable
   * field: override (or reset) the cookie Secure policy. Only a fully
   * verified session may write; every change is audited like the other
   * security-state transitions (password, OTP). Persistence goes through the
   * credential record ("dsh-auth-gateway/cookie-secure") so the override
   * survives restarts and beats the composition until reset.
   * Body: `{ mode: 'auto'|true|false }` or `{ reset: true }` (drop the
   * override, back to the deployment config).
   */
  async function handleSetCookieSecure(req, res) {
    const token = verifiedTokenOr401(req, res)
    if (token === undefined) return
    const changeIp = req.socket.remoteAddress ?? 'unknown'
    // Shared global auth budget (login, password change): a verified session
    // must not be able to hammer the record store either.
    if (!gateway.rateLimit.globalAuthAllowed(Date.now())) {
      authEvent('cookie-secure-change-failed', changeIp, 'rate-limited')
      return json(res, 429, { ok: false, error: 'rate-limited' })
    }

    if (cookieSecureOverrideStore === undefined) {
      return json(res, 400, { ok: false, error: 'storage-unavailable' })
    }

    const body = await readJson(req, res)
    if (body === undefined) return

    let mode
    let reset
    // Only `reset: true` means "drop the override"; `reset: false` is
    // treated like an absent flag, so the body must then carry a valid
    // mode — `{reset:false}` alone is an invalid request (400 below).
    if (body !== null && typeof body === 'object' && body.reset === true) {
      mode = undefined
      reset = true
    } else {
      mode = body?.mode
      reset = false
      // Same three-state rule as the config validator: lookalikes are
      // rejected, never coerced.
      if (mode !== 'auto' && mode !== true && mode !== false) {
        return json(res, 400, { ok: false, error: 'invalid-mode' })
      }
    }

    try {
      if (reset) {
        await cookieSecureOverrideStore.clear()
        panelOverride = null
        authEvent('cookie-secure-change', changeIp, 'reset')
        return json(res, 200, {
          ok: true,
          cookieSecure: cookieSecureMode(),
          cookieSecureSource: 'deployment',
        })
      }
      // Persist first, then flip the live decision: a failed write must not
      // leave a memory-only override that silently disagrees with the next
      // boot.
      await cookieSecureOverrideStore.write(mode)
      panelOverride = mode
      authEvent('cookie-secure-change', changeIp, String(mode))
      return json(res, 200, {
        ok: true,
        cookieSecure: mode,
        cookieSecureSource: 'panel',
      })
    } catch (err) {
      // The panel only reports the generic code; the console line is what
      // makes a failing record store (disk, permissions, service) debuggable.
      gateway.onError?.(err)
      return json(res, 500, { ok: false, error: 'storage-failed' })
    }
  }

  /**
   * GET /login-api/version — running version, repository link and the
   * new-version state for the settings panel.
   *
   * The registry is contacted only when someone asked for it:
   *   - `?refresh=1` is the panel's explicit "check now" button. A click by a
   *     signed-in user is consent for that one outbound request, so it works
   *     whatever `updateCheck` is set to.
   *   - otherwise, a request happens only if the operator enabled the
   *     automatic check (`updateCheck: true`); with it off (the default) this
   *     reports the last known result instead of reaching out.
   *
   * The lookup must never be able to break the response: `check()` is
   * contracted never to throw (lib/update-check.js), and the catch here is the
   * second line of defence — a panel that cannot hear about a new release
   * still shows the version and the link.
   */
  async function handleGetVersion(req, res) {
    const token = verifiedTokenOr401(req, res)
    if (token === undefined) return

    const refresh = new URL(req.url ?? '/', 'http://x').searchParams.get('refresh') === '1'
    let update = { latest: null, updateAvailable: null, checkedAt: null, error: null }
    if (gateway.updateChecker !== null) {
      try {
        if (refresh) update = await gateway.updateChecker.check({ force: true })
        else if (gateway.updateCheckAuto) update = await gateway.updateChecker.check()
        else update = gateway.updateChecker.lastKnown()
      } catch (err) {
        gateway.onError?.(err)
      }
    }
    json(res, 200, {
      ok: true,
      version: gateway.versionInfo.version,
      repository: gateway.versionInfo.repository,
      update,
    })
  }

  return {
    cookieSecureMode,
    cookieSecureSource,
    serveSettings,
    serveSessionProbe,
    handleSetCookieSecure,
    handleGetVersion,
  }
}
