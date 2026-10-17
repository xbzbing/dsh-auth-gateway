/**
 * Wire contract for the settings panel's `/login-api/*` responses.
 *
 * Both halves of this contract live in this repo — lib/gateway-panel-api.js
 * produces these bodies, and client/src/index.jsx consumes them — and the field
 * names are what actually cross the wire. They are defined once here so the
 * producer is checked against them: renaming a field on the host side without
 * updating this type is a `npm run typecheck` failure instead of a panel that
 * silently shows a default.
 *
 * The client half is guarded separately by tests/client-contract.test.mjs,
 * which pins the exact key strings on the panel source (the panel is not part
 * of the typecheck config — checking JSX would require React's types plus the
 * dsh client UI packages as devDependencies).
 *
 * Note the two deliberate shape choices, both load-bearing:
 *   - `requestSecure` is TOP-level, not inside the plugin config block: it is
 *     the gateway's own view of this request's transport, not a plugin setting
 *     (reading it from the config block would always be undefined).
 *   - the plugin config block spreads the resolved OTP config
 *     (`...gateway.otp`, lib/config.js), which is where `otpDigits` comes from.
 */

/** Effective Cookie-Secure policy: 'auto' follows the connection, true/false pin it. */
export type CookieSecureMode = 'auto' | true | false

/** Whether the effective policy comes from the deployment config or a panel override. */
export type CookieSecureSource = 'deployment' | 'panel'

/**
 * The plugin's own block inside `config`. Index-signature'd because the body
 * spreads the whole resolved OTP config (issuer, period, window, …); the
 * members below are the ones the panel actually reads.
 */
export interface PanelPluginConfig {
  [key: string]: unknown
  /** Whether OTP is active for this gateway (lib/gateway-otp.js). */
  otpEnabled?: boolean
  /** Digits the panel must expect in the OTP input (config `otpDigits`). */
  otpDigits?: number
  /** Raw OTP status snapshot. */
  otpStatus?: unknown
  /** Resolved policy, already normalised by the gateway. */
  cookieSecure?: CookieSecureMode
  /** Where {@link cookieSecure} comes from. */
  cookieSecureSource?: CookieSecureSource
}

/** Body of `GET /login-api/settings`. */
export interface PanelSettingsBody {
  ok: boolean
  /**
   * Whether THIS request reached the gateway over a secure transport (TLS
   * socket or `X-Forwarded-Proto: https`). Absent on older gateways, in which
   * case the panel falls back to the browser's own protocol.
   */
  requestSecure?: boolean
  config: {
    'dsh-auth-gateway': PanelPluginConfig
  }
}

/** Body of `GET /login-api/version` (also served for `?refresh=1`). */
export interface PanelVersionBody {
  ok: boolean
  version?: string
  repository?: string
  update?: {
    latest?: string | null
    updateAvailable?: boolean | null
    checkedAt?: string | null
    /** Failure reason when the check could not complete; null when it did. */
    error?: string | null
  }
}
