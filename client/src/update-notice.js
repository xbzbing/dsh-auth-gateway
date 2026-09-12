/**
 * Pure derivation of the About card's version/update state.
 *
 * This lives outside the component and free of JSX on purpose: the mapping
 * from a gateway response to what the card actually claims is exactly what
 * broke, and the repo ships no client test runtime (React is provided by dsh
 * at runtime, not by this package), so logic buried in the component cannot be
 * unit-tested. Extracted, every state is covered by tests/update-notice.test.mjs.
 *
 * The bug this split fixes: the component had two failure paths that disagreed
 * (one dropped the known version and repository, the other kept them), and its
 * failure line was conditioned on `checkedAt`, which a failed attempt leaves
 * null — so a failed check erased the card's identity AND said nothing.
 */

/**
 * Identity + update state from a gateway `/login-api/version` body.
 * @param {unknown} data
 * @returns {{version: string, repository: string, update: object}}
 */
export function readVersion(data) {
  return {
    version: typeof data?.version === 'string' ? data.version : '',
    // Only ever an http(s) URL: the gateway normalizes it (lib/version.js
    // normalizeRepository), and anything else is dropped rather than rendered
    // into an href.
    repository: /^https?:\/\//.test(data?.repository) ? data.repository : '',
    update: data?.update || {},
  }
}

/**
 * The update state left behind by a check that could not complete.
 * @param {string} reason - error code from the transport or the gateway
 * @returns {{latest: null, updateAvailable: null, checkedAt: null, error: string}}
 */
export function failedUpdate(reason) {
  return { latest: null, updateAvailable: null, checkedAt: null, error: reason }
}

/**
 * Next panel state after a manual check attempt.
 *
 * Identity (version, repository) is PRESERVED when the attempt fails: a failed
 * check must not erase what the card already knows, it only replaces the
 * update outcome. Both failure paths (a non-ok body and a thrown request)
 * funnel through here, so they cannot drift apart again.
 *
 * @param {{version: string, repository: string, update: object} | null} previous
 * @param {{data?: object, error?: string}} outcome
 */
export function afterCheckAttempt(previous, { data, error } = {}) {
  if (data?.ok === true) return readVersion(data)
  return { ...(previous || readVersion(null)), update: failedUpdate(error ?? 'unauthenticated') }
}

/**
 * The single notice the card shows for an update state, or `null` when nothing
 * is known and the card must claim nothing.
 *
 * One derivation for all four states so they cannot drift apart: `error` is
 * the failure signal, `updateAvailable` the verdict, and "never checked" is
 * simply both absent. `updateAvailable: null` must never be dressed up as
 * "up to date".
 *
 * @param {object} update - the `update` object from the gateway
 * @param {(key: string, vars?: object) => string} t - bound translator
 * @param {string} repository - normalized repository URL ('' when unknown)
 * @returns {{tone: 'banner' | 'muted', text: string, href: string} | null}
 */
export function updateNotice(update, t, repository) {
  if (update?.updateAvailable === true) {
    return {
      tone: 'banner',
      text: t('about.updateAvailable', { version: update.latest || '' }),
      href: repository ? repository + '/releases' : '',
    }
  }
  if (update?.updateAvailable === false) {
    return { tone: 'muted', text: t('about.upToDate'), href: '' }
  }
  if (typeof update?.error === 'string' && update.error !== '') {
    return { tone: 'muted', text: t('about.checkFailed'), href: '' }
  }
  return null
}
