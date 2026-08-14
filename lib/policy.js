/**
 * Password strength policy — the shared validation for setup and change.
 *
 * Pure function so the gateway (server-side enforcement) and the login page
 * (client-side early feedback) can agree on the same rules. The server is
 * always the authority; the client check is UX only.
 */

/**
 * Check a candidate password against the policy.
 * @param password - the candidate.
 * @param policy - resolved policy from plugin config.
 * @returns `{ ok: true }` or `{ ok: false, reason }` where reason is a stable
 *   error code the login page maps to a localized message.
 */
export function validatePasswordStrength(password, policy = {}) {
  const minLength = policy.minPasswordLength ?? 8
  const requireMixedCase = policy.requireMixedCase ?? true
  if (typeof password !== 'string' || password.length < minLength) {
    return { ok: false, reason: 'password-too-short' }
  }
  if (requireMixedCase && (!/[a-z]/.test(password) || !/[A-Z]/.test(password))) {
    return { ok: false, reason: 'password-needs-case' }
  }
  return { ok: true }
}
