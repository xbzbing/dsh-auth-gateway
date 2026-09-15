/**
 * Pure derivation of the settings panel's cookie-Secure status card.
 *
 * Lives outside the component and free of JSX for the same reason as
 * lib/update-notice.js's split: the mapping from the deployment's
 * `cookieSecure` config plus the browser's own transport to what the card
 * claims is exactly the security-relevant judgement, and the repo ships no
 * client test runtime — so every state is covered by
 * tests/cookie-secure.test.mjs instead of living untested in JSX.
 *
 * The judgement uses the BROWSER's protocol, not the server's view: whether a
 * Secure cookie is stored and sent back is decided by the user agent against
 * the URL it actually used. A TLS-terminating reverse proxy therefore makes
 * `protocol` 'https:' even though the gateway's own socket is plain HTTP —
 * and that is the correct answer for what the card should claim, because the
 * browser will indeed send the cookie.
 */

/**
 * One of the five card states, keyed into the panel dictionary:
 *   auto-https  auto mode + HTTPS link → Secure effective
 *   auto-http   auto mode + plain HTTP → Secure off (until TLS lands)
 *   forced-https config pinned true + HTTPS link → Secure effective
 *   forced-http  config pinned true + plain HTTP → browsers refuse the
 *                cookie: logins fail loudly instead of downgrading silently
 *   off         config pinned false → Secure never set
 * @param {'auto'|true|false} mode - the `cookieSecure` config value
 *   (anything else normalizes to 'auto', mirroring the gateway).
 * @param {string} protocol - `window.location.protocol` ('https:' or 'http:').
 * @returns {'auto-https'|'auto-http'|'forced-https'|'forced-http'|'off'}
 */
export function cookieSecureState(mode, protocol) {
  const m = mode === true || mode === false ? mode : 'auto'
  const https = protocol === 'https:'
  if (m === true) return https ? 'forced-https' : 'forced-http'
  if (m === false) return 'off'
  return https ? 'auto-https' : 'auto-http'
}

/** Whether the given state means the Secure attribute is actually in play. */
export function cookieSecureEffective(state) {
  return state === 'auto-https' || state === 'forced-https'
}