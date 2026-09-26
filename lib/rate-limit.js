/**
 * Anti-brute-force rate state for one gateway instance.
 *
 * Three layers, all keyed by the resolved policy (see lib/gateway.js):
 *   1. a GLOBAL per-minute attempt budget (defends against multi-IP
 *      hammering of the scrypt cost, which per-IP counters cannot);
 *   2. a per-client-address lockout after `maxLoginFailures` for
 *      `lockMinutes`, SHARED by login failures, OTP/backup-code
 *      verification and password change — a held session must not enable
 *      unlimited old-password guessing either;
 *   3. a per-address OTP verification window (`maxOtpAttemptsPerMinute`)
 *      as the primary cap on TOTP/backup-code guessing.
 *
 * Security events (`lockout`, `global-rate-limit`, `otp-rate-limit`) fire
 * through the injected sink once per window/lockout, never per request.
 * Maps are bounded by prune(): entries are swept only when a map grows
 * past 1024 entries (amortized O(1) per request), and only entries whose
 * state is already irrelevant are dropped.
 *
 * `attempts`, `otpWindows` and `globalAuth` are exposed as plain state so
 * tests can simulate lock expiry and window rollover; the gateway re-exposes
 * them under the same names (see LoginGateway).
 *
 * The policy numbers are read ONCE, here at construction: mutating the
 * passed-in policy object afterwards has no effect. A config change reaches
 * the limiter through a Cordis re-apply, which builds a fresh gateway.
 */

const WINDOW_MS = 60 * 1000

/**
 * Whole seconds a lockout still lasts, as reported in the
 * `retryAfterSeconds` field of every `too-many-attempts` answer (at least 1,
 * so a lockout that is about to lift never advertises 0).
 * @param {number} lockedUntil - ms epoch when the lock expires.
 * @param {number} now - ms epoch.
 * @returns {number}
 */
export function retryAfterSeconds(lockedUntil, now) {
  return Math.max(1, Math.ceil((lockedUntil - now) / 1000))
}

/**
 * @param {object} policy - resolved lockout policy
 *   ({maxLoginFailures, lockMinutes, maxGlobalAuthAttemptsPerMinute,
 *   maxOtpAttemptsPerMinute}).
 * @param {(payload: object) => void} onSecurityEvent - sink for the
 *   one-per-window alerts (`lockout` / `global-rate-limit` /
 *   `otp-rate-limit`).
 */
export function createRateLimiter(policy, onSecurityEvent) {
  const maxFailures = policy.maxLoginFailures ?? 5
  const lockMs = (policy.lockMinutes ?? 5) * 60 * 1000
  const globalLimit = policy.maxGlobalAuthAttemptsPerMinute ?? 60
  const otpLimit = policy.maxOtpAttemptsPerMinute ?? 10
  /** Failed-login tracker: client address -> { count, lockedUntil, updatedAt }. */
  const attempts = new Map()
  /** OTP-verify rate-limit windows: client address -> { windowStart, count, notified }. */
  const otpWindows = new Map()
  /** Global auth rate-limit window: { windowStart, count, notified }. */
  let globalAuth = null

  return {
    attempts,
    otpWindows,
    get globalAuth() {
      return globalAuth
    },

    /**
     * Global sliding-minute auth budget: caps total /login/auth attempts
     * across ALL source addresses, so rotating IPs cannot saturate the
     * scrypt cost. Emits a `global-rate-limit` security event once per
     * window when the budget is exhausted.
     * @param {number} now - ms epoch.
     * @returns {boolean} whether the attempt is inside the budget.
     */
    globalAuthAllowed(now) {
      const state = globalAuth ?? { windowStart: now, count: 0, notified: false }
      if (now - state.windowStart >= WINDOW_MS) {
        state.windowStart = now
        state.count = 0
        state.notified = false
      }
      state.count += 1
      globalAuth = state
      if (state.count > globalLimit && !state.notified) {
        state.notified = true
        onSecurityEvent({ kind: 'global-rate-limit', limit: globalLimit, windowSeconds: 60 })
      }
      return state.count <= globalLimit
    },

    /**
     * Per-client-address sliding-window budget for OTP verification
     * attempts (/otp/verify, /otp/verify-backup, /otp/verify-setup, the OTP
     * re-auth inside /otp/disable, and the OTP step of /login/auth). Three
     * layers: the SHARED global budget, the per-address lockout shared with
     * login failures, then this window as the primary cap. Emits one
     * `otp-rate-limit` security event per exhausted window.
     * @param {string} address - client address.
     * @param {number} now - ms epoch.
     * @returns {boolean} whether the attempt is inside the budget.
     */
    otpVerifyAllowed(address, now) {
      this.prune(now)
      if (!this.globalAuthAllowed(now)) return false
      const lock = attempts.get(address)
      if (lock !== undefined && lock.lockedUntil > now) return false
      let state = otpWindows.get(address)
      if (state === undefined || now - state.windowStart >= WINDOW_MS) {
        state = { windowStart: now, count: 0, notified: false }
      }
      state.count += 1
      otpWindows.set(address, state)
      if (state.count > otpLimit && !state.notified) {
        state.notified = true
        onSecurityEvent({
          kind: 'otp-rate-limit',
          sourceAddress: address,
          limit: otpLimit,
          windowSeconds: Math.ceil(WINDOW_MS / 1000),
        })
      }
      return state.count <= otpLimit
    },

    /**
     * Count one failed credential attempt for the client address toward the
     * SHARED per-address lockout (maxLoginFailures / lockMinutes). Emits one
     * `lockout` security event when the threshold trips (subsequent attempts
     * inside the lock window are refused before reaching here, so no repeat
     * notifications).
     * @param {string} address - client address.
     * @param {number} now - ms epoch.
     */
    recordFailure(address, now) {
      const entry = attempts.get(address) ?? { count: 0, lockedUntil: 0, updatedAt: 0 }
      entry.count += 1
      entry.updatedAt = now
      if (entry.count >= maxFailures) {
        entry.lockedUntil = now + lockMs
        entry.count = 0 // recount after the lock window passes
        onSecurityEvent({
          kind: 'lockout',
          sourceAddress: address,
          maxFailures,
          lockedUntil: entry.lockedUntil,
        })
      }
      attempts.set(address, entry)
    },

    /**
     * Bound the per-address rate maps. A distributed brute force rotating IPs
     * would otherwise grow `attempts`/`otpWindows` without limit for the
     * process lifetime. Sweep only when a map is large (amortized O(1) per
     * request), and drop only entries whose state is already irrelevant:
     * expired locks, counters idle for more than twice the lock window, and
     * OTP windows that have fully rolled over.
     * @param {number} now - ms epoch.
     */
    prune(now) {
      const staleMs = lockMs * 2
      if (attempts.size > 1024) {
        for (const [key, e] of attempts) {
          const expiredLock = e.lockedUntil > 0 && e.lockedUntil <= now
          const idleCounter = e.lockedUntil === 0 && now - e.updatedAt > staleMs
          if (expiredLock || idleCounter) attempts.delete(key)
        }
      }
      if (otpWindows.size > 1024) {
        for (const [key, w] of otpWindows) {
          if (now - w.windowStart > WINDOW_MS) otpWindows.delete(key)
        }
      }
    },
  }
}
