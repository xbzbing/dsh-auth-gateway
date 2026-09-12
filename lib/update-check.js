/**
 * "Is there a newer release?" — the only outbound request this plugin makes.
 *
 * The gateway asks the public npm registry for the package's `latest` tag and
 * compares it with the running version. Design constraints, in order:
 *
 *   1. NEVER on the critical path. The settings panel issues its own request
 *      and renders without it; the auth flow never touches this module. A
 *      registry that is slow, unreachable or blocked (common on a VPS behind
 *      an egress firewall) degrades to "unknown", never to a failed login or
 *      a broken panel.
 *   2. NEVER a retry storm. Results — successes AND failures — are cached in
 *      memory: a success for `ttlMs` (6h), a failure for `failureTtlMs`
 *      (15min). Concurrent callers share one in-flight request.
 *   3. NEVER a guess. An unparsable current or remote version yields
 *      `updateAvailable: null` ("cannot tell"), not `false`.
 *   4. NEVER phone home silently. The request is opt-out via the `updateCheck`
 *      config field, and its existence is documented in SECURITY.md.
 *
 * `status()` never throws and never rejects: every failure path becomes an
 * `error` code in the returned snapshot.
 */

import { PACKAGE_NAME, compareVersions, parseVersion } from './version.js'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_FAILURE_TTL_MS = 15 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 3000

/** The "checking is off / unavailable" snapshot. */
function idleSnapshot() {
  return { enabled: false, latest: null, updateAvailable: null, checkedAt: null, error: null }
}

/**
 * @param {object} [options]
 * @param {string} [options.current] - running version (lib/version.js)
 * @param {boolean} [options.enabled] - false disables all network access
 * @param {string} [options.packageName] - package queried on the registry
 * @param {string} [options.registryUrl] - override the registry endpoint
 * @param {Function} [options.fetchImpl] - injectable fetch (tests)
 * @param {() => number} [options.now] - injectable clock (tests)
 * @param {number} [options.ttlMs] - success cache lifetime
 * @param {number} [options.failureTtlMs] - failure cache lifetime
 * @param {number} [options.timeoutMs] - per-request timeout (0 disables)
 * @param {(snapshot: object) => void} [options.onResult] - sink for logging;
 *   swallows its own errors so a bad sink cannot break the check
 */
export function createUpdateChecker({
  current,
  enabled = true,
  packageName = PACKAGE_NAME,
  registryUrl,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  failureTtlMs = DEFAULT_FAILURE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onResult,
} = {}) {
  const url = registryUrl ?? `https://registry.npmjs.org/${packageName}/latest`

  /** @type {{latest: string | null, error: string | null, checkedAt: number, expiresAt: number} | null} */
  let cache = null
  /** @type {Promise<object> | null} */
  let inFlight = null

  function snapshot(entry) {
    const comparison = entry.latest === null ? null : compareVersions(entry.latest, current)
    return {
      enabled: true,
      latest: entry.latest,
      updateAvailable: comparison === null ? null : comparison === 1,
      checkedAt: new Date(entry.checkedAt).toISOString(),
      error: entry.error,
    }
  }

  /** A single registry request; resolves to `{latest, error}` and never rejects. */
  async function fetchLatest() {
    try {
      const options = { headers: { accept: 'application/json' } }
      if (timeoutMs > 0 && typeof AbortSignal !== 'undefined'
        && typeof AbortSignal.timeout === 'function') {
        options.signal = AbortSignal.timeout(timeoutMs)
      }
      const response = await fetchImpl(url, options)
      if (response?.ok !== true) {
        return { latest: null, error: `http-${response?.status ?? 'unknown'}` }
      }
      // A body that is absent, not JSON, or JSON without a usable version is
      // the registry's problem, not a network failure — report it as such so
      // the two are distinguishable in the logs.
      let body
      try {
        body = await response.json()
      } catch {
        return { latest: null, error: 'invalid-response' }
      }
      const latest = body?.version
      if (typeof latest !== 'string' || parseVersion(latest) === null) {
        return { latest: null, error: 'invalid-response' }
      }
      return { latest, error: null }
    } catch (err) {
      return { latest: null, error: err?.name === 'TimeoutError' ? 'timeout' : 'network' }
    }
  }

  return {
    enabled,
    /**
     * Current update state, consulting the cache and refreshing when stale.
     * @returns {Promise<{enabled: boolean, latest: string | null,
     *   updateAvailable: boolean | null, checkedAt: string | null,
     *   error: string | null}>}
     */
    async status() {
      if (!enabled || typeof fetchImpl !== 'function') return idleSnapshot()
      if (cache !== null && cache.expiresAt > now()) return snapshot(cache)
      if (inFlight === null) {
        inFlight = (async () => {
          const outcome = await fetchLatest()
          const checkedAt = now()
          cache = {
            latest: outcome.latest,
            error: outcome.error,
            checkedAt,
            expiresAt: checkedAt + (outcome.error === null ? ttlMs : failureTtlMs),
          }
          const result = snapshot(cache)
          try {
            onResult?.(result)
          } catch {
            // A logging sink must never break the panel's update check.
          }
          return result
        })().finally(() => { inFlight = null })
      }
      return inFlight
    },
  }
}
