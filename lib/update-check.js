/**
 * "Is there a newer release?" — the only outbound request this plugin makes.
 *
 * The gateway asks the public npm registry for the package's `latest` tag and
 * compares it with the running version. Design constraints, in order:
 *
 *   1. NEVER automatically. Nothing here runs on its own: a request happens
 *      only because the settings panel's "check for updates" button asked for
 *      one, or because the operator opted into the automatic check
 *      (`updateCheck: true`, default off). A fresh install makes no outbound
 *      request at all.
 *   2. NEVER on the critical path. The settings panel issues its own request
 *      and renders without it; the auth flow never touches this module. A
 *      registry that is slow, unreachable or blocked (common on a VPS behind
 *      an egress firewall) degrades to "unknown", never to a failed login or
 *      a broken panel.
 *   3. NEVER a retry storm. Results — successes AND failures — are cached in
 *      memory: a success for `ttlMs` (6h), a failure for `failureTtlMs`
 *      (15min). Concurrent callers share one in-flight request, and even an
 *      explicit re-check honours a short floor so a double-click cannot turn
 *      into a request flood.
 *   4. NEVER a guess. An unparsable current or remote version yields
 *      `updateAvailable: null` ("cannot tell"), not `false`.
 *   5. NEVER a stale claim. `lastKnown()` reports a cached result only while
 *      it is still within its TTL; past that the panel shows no verdict
 *      rather than an outdated one.
 *
 * `check()` and `lastKnown()` never throw and never reject: every failure path
 * becomes an `error` code in the returned snapshot.
 */

import { PACKAGE_NAME, compareVersions, parseVersion } from './version.js'

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_FAILURE_TTL_MS = 15 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 3000
const DEFAULT_FORCE_MIN_INTERVAL_MS = 5000

/** The "no result" snapshot: never checked, nothing claimed. */
function emptySnapshot() {
  return { latest: null, updateAvailable: null, checkedAt: null, error: null }
}

/**
 * @param {object} [options]
 * @param {string} [options.current] - running version (lib/version.js)
 * @param {string} [options.packageName] - package queried on the registry
 * @param {string} [options.registryUrl] - override the registry endpoint
 * @param {Function} [options.fetchImpl] - injectable fetch (tests)
 * @param {() => number} [options.now] - injectable clock (tests)
 * @param {number} [options.ttlMs] - success cache lifetime
 * @param {number} [options.failureTtlMs] - failure cache lifetime
 * @param {number} [options.timeoutMs] - per-request timeout (0 disables)
 * @param {number} [options.forceMinIntervalMs] - floor between forced checks
 * @param {(snapshot: object) => void} [options.onResult] - sink for logging;
 *   swallows its own errors so a bad sink cannot break the check
 */
export function createUpdateChecker({
  current,
  packageName = PACKAGE_NAME,
  registryUrl,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  failureTtlMs = DEFAULT_FAILURE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  forceMinIntervalMs = DEFAULT_FORCE_MIN_INTERVAL_MS,
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
      latest: entry.latest,
      updateAvailable: comparison === null ? null : comparison === 1,
      checkedAt: new Date(entry.checkedAt).toISOString(),
      error: entry.error,
    }
  }

  /** Whether a cached result is still within its TTL. */
  function fresh() {
    return cache !== null && cache.expiresAt > now()
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

  /** Perform one request, cache the outcome and hand it to the sink. */
  async function run() {
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
  }

  return {
    /**
     * The last result, WITHOUT touching the network — used when automatic
     * checks are off. Reports nothing once the cached verdict has expired, so
     * the panel never presents an outdated "up to date".
     * @returns {{latest: string | null, updateAvailable: boolean | null,
     *   checkedAt: string | null, error: string | null}}
     */
    lastKnown() {
      return fresh() ? snapshot(cache) : emptySnapshot()
    },

    /**
     * The update state, consulting the cache and requesting when stale.
     * @param {{force?: boolean}} [options] - `force` backs the panel's
     *   explicit "check now" action: it bypasses the TTL (but still honours a
     *   short floor and any in-flight request).
     * @returns {Promise<{latest: string | null, updateAvailable: boolean | null,
     *   checkedAt: string | null, error: string | null}>}
     */
    async check({ force = false } = {}) {
      if (typeof fetchImpl !== 'function') return emptySnapshot()
      if (!force && fresh()) return snapshot(cache)
      // A forced re-check still respects a short floor: a double-click, or a
      // held-down button, must not become a request flood against the registry.
      if (force && cache !== null && now() - cache.checkedAt < forceMinIntervalMs) {
        return snapshot(cache)
      }
      if (inFlight === null) {
        inFlight = run().finally(() => { inFlight = null })
      }
      return inFlight
    },
  }
}
