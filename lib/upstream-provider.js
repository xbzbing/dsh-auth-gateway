/**
 * Upstream authentication through dsh's official provider registry
 * (dsh >= 0.2.3-alpha.1, see docs/zh/adr/0001-official-authentication-provider.md).
 *
 * Connection exposes `connection.authentication`: webserver admission asks
 * every registered provider in order and admits the first Peer returned. The
 * gateway registers one provider that recognizes a per-process random
 * credential carried in a request header. The forwarder attaches that header
 * only to requests that already passed the password/OTP gate, so dsh admits
 * them as the gateway's own owner Peer — no dsh secret is read and no
 * dsh-format cookie is minted.
 *
 * On dsh <= 0.2.2 the registry does not exist; index.js then keeps the
 * cookie-minting path in lib/upstream-auth.js. One path is chosen at startup.
 *
 * Pure node:crypto, zero dependencies. Never logs the credential.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Request header carrying the gateway credential on the loopback hop (lowercase: node:http header keys). */
export const GATEWAY_CREDENTIAL_HEADER = 'x-dsh-auth-gateway-credential'

/** Name of the child plugin owning the provider registration and the Peer. */
export const PROVIDER_PLUGIN_NAME = 'dsh-auth-gateway/authentication'

/**
 * Delete any browser-supplied gateway credential header. Every forward calls
 * this before (optionally) attaching the real one, so a client can never
 * smuggle a value of its own to the upstream.
 * @param {Record<string, unknown>} headers - mutable outgoing header object.
 */
export function stripGatewayCredential(headers) {
  delete headers[GATEWAY_CREDENTIAL_HEADER]
}

/**
 * Create the per-process credential.
 * @returns {{ attach: (headers: Record<string, unknown>) => void, matches: (headers: unknown) => boolean }}
 *   `attach` sets the header on an outgoing forward; `matches` is the
 *   provider's constant-time check over node:http or Fetch headers.
 */
export function createGatewayCredential() {
  const value = randomBytes(32).toString('base64url')
  const expected = Buffer.from(value, 'utf8')
  return {
    attach(headers) {
      headers[GATEWAY_CREDENTIAL_HEADER] = value
    },
    matches(headers) {
      if (typeof headers !== 'object' || headers === null) return false
      const raw = typeof (/** @type {any} */ (headers)).get === 'function'
        ? /** @type {any} */ (headers).get(GATEWAY_CREDENTIAL_HEADER)
        : /** @type {Record<string, unknown>} */ (headers)[GATEWAY_CREDENTIAL_HEADER]
      if (typeof raw !== 'string') return false
      const actual = Buffer.from(raw, 'utf8')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },
  }
}

/**
 * Whether the running dsh offers the provider registry. Uses `ctx.get`, which
 * reads a service without an inject requirement; the plugin injects
 * `connection`, and on dsh >= 0.2.3 Connection only exists once its registry
 * does, so the answer is settled by the time `apply` runs.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @returns {boolean}
 */
export function hasAuthenticationRegistry(ctx) {
  try {
    const registry = /** @type {{ register?: unknown } | undefined} */ (ctx.get('connection.authentication'))
    return typeof registry?.register === 'function'
  } catch {
    return false
  }
}

/**
 * Register the gateway provider from a child plugin that injects both
 * services, so the registration and the Peer belong to that child scope and
 * are withdrawn when the gateway unloads (register() ties the registration
 * to the calling scope through Cordis's service tracker — see
 * ConnectionAuthentication.register in dsh-client-connection).
 * @param {import('@deepseek-ai/cordis').Context} ctx - the gateway plugin context.
 * @param {{ matches: (headers: unknown) => boolean }} credential
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - give up waiting after this long.
 * @returns {Promise<boolean>} true once registered; false on timeout —
 *   index.js then FAILS STARTUP rather than running a gateway whose every
 *   forward is 401'd upstream (a late registration can no longer help,
 *   because the child scope is torn down with the failed apply).
 */
export function registerGatewayProvider(ctx, credential, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { resolve(false) }, timeoutMs)
    timer.unref?.()
    ctx.plugin({
      name: PROVIDER_PLUGIN_NAME,
      inject: ['connection', 'connection.authentication'],
      /** @param {import('@deepseek-ai/cordis').Context} scope */
      apply(scope) {
        try {
          const peer = scope.connection.createPeer({ principal: { kind: 'owner' } })
          scope['connection.authentication'].register({
            authenticate: (request) => (credential.matches(request?.headers) ? peer : undefined),
          })
        } catch (error) {
          clearTimeout(timer)
          // The promise already carries the failure; rethrowing would make
          // Cordis log the same error a second time (child-fiber error plus
          // the rejected registration).
          reject(error)
          return
        }
        clearTimeout(timer)
        resolve(true)
      },
    })
  })
}
