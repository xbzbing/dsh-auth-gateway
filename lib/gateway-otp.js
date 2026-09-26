/**
 * OTP route handlers for the login gateway (extracted from lib/gateway.js to
 * keep the gateway file under control; see CODE_REVIEW Optional #2).
 *
 * A module of plain functions bound to the gateway's public state plus the
 * private helpers it cannot reach directly — they arrive through `priv`
 * because they are #-private members a separate module cannot name, while
 * `sendHtml` is a plain lib/page-shell.js export and is imported directly.
 * `createOTPRoutes(gateway, priv)`
 * returns `{ serveSetupPage, handleEnable, handleVerifySetup, serveVerifyPage,
 * handleVerify, handleVerifyBackup, handleDisable }`; the gateway dispatches
 * its /otp/* routes to them.
 */

import { tokenFromCookieHeader, expiredCookie } from './auth.js'
import { verifyPassword } from './store.js'
import {
  getOTPStatus,
  getOTPSecret,
  enableOTP,
  disableOTP,
  verifyAndUseBackupCode,
} from './otp-store.js'
import { verifyTOTP, generateOTPAuthURI, generateSecret } from './totp.js'
import { retryAfterSeconds } from './rate-limit.js'
import { otpSetupPage, otpVerifyPage } from './otp-page.js'
import { sendHtml } from './page-shell.js'
import { generateQRSvg } from './qr-svg.js'
import { OTPCryptoError } from './otp-crypto.js'

/**
 * @param {object} gateway - the LoginGateway instance (public state:
 *   `sessions`, `otp`, `attempts`).
 * @param {object} priv - the gateway's private helpers, bound in the
 *   constructor: `json`, `readJson`, `verifiedTokenOr401`, `otpVerifyAllowed`,
 *   `recordOtpFailure`, `recordFailure`, `verifyOtp`, `otpActive`, `localeFor`,
 *   `authEvent`, `secureCookie`.
 */
export function createOTPRoutes(gateway, priv) {
  const { sessions, otp } = gateway
  const {
    json, readJson, verifiedTokenOr401,
    otpVerifyAllowed, recordOtpFailure, recordFailure, verifyOtp, otpActive, localeFor,
    authEvent, secureCookie,
  } = priv
  const addressOf = (req) => req.socket.remoteAddress ?? 'unknown'

  /**
   * Preamble of the setup entry points (/otp/setup, /otp/enable): a fully
   * verified session while 2FA is still OFF. Answers the refusal (401 when
   * the session is not fully verified, 409 when a binding already exists)
   * and returns the token, or undefined once answered.
   */
  function setupSession(req, res) {
    const token = verifiedTokenOr401(req, res)
    if (token === undefined) return undefined
    if (otpActive()) {
      json(res, 409, { ok: false, error: 'otp-already-enabled' })
      return undefined
    }
    return token
  }

  /**
   * Preamble of every /otp/verify* endpoint: a live session and an active
   * 2FA binding. Answers 401 `unauthenticated` / 400 `otp-not-enabled`
   * itself; returns the token, or undefined once answered.
   */
  function activeOtpSession(req, res) {
    const token = tokenFromCookieHeader(req.headers.cookie)
    if (!sessions.isValid(token)) {
      json(res, 401, { ok: false, error: 'unauthenticated' })
      return undefined
    }
    if (!otpActive()) {
      json(res, 400, { ok: false, error: 'otp-not-enabled' })
      return undefined
    }
    return token
  }

  /**
   * Per-address OTP budget (lib/rate-limit.js) shared by every code
   * submission, checked BEFORE the body is read — a flood costs neither the
   * body parse nor the verification work behind it.
   * @returns {boolean} whether the attempt was refused (429 already sent).
   */
  function otpRateLimited(req, res) {
    if (otpVerifyAllowed(addressOf(req), Date.now())) return false
    json(res, 429, { ok: false, error: 'rate-limited' })
    return true
  }

  /**
   * Read a TOTP code body and check it is a full-length code (400
   * `invalid-otp` otherwise).
   * @returns {Promise<string|undefined>} the code, or undefined once answered.
   */
  async function readOtpCode(req, res) {
    const body = await readJson(req, res)
    if (body === undefined) return undefined
    const code = body.otp
    if (typeof code !== 'string' || code.length !== (otp.otpDigits || 6)) {
      json(res, 400, { ok: false, error: 'invalid-otp' })
      return undefined
    }
    return code
  }

  /**
   * Generate a fresh setup secret, stage it on the session for the
   * /otp/verify-setup confirmation, and build the otpauth:// URI the QR code
   * and the manual entry both show.
   */
  function stageSetupSecret(token) {
    const secret = generateSecret()
    const uri = generateOTPAuthURI(secret, {
      issuer: otp.otpIssuer || 'dsh-auth-gateway',
      account: 'dsh-user',
    })
    sessions.setTempOTP(token, secret)
    return { secret, uri }
  }

  return {
    /** GET /otp/setup — render OTP setup page. */
    serveSetupPage(req, res) {
      const token = setupSession(req, res)
      if (token === undefined) return

      const { secret, uri } = stageSetupSecret(token)
      sendHtml(res, otpSetupPage({
        uri,
        secret,
        backupCodes: [], // Will be generated on successful setup
        digits: otp.otpDigits || 6,
        locale: localeFor(req),
        basePath: gateway.basePath,
      }))
    },

    /**
     * POST /otp/enable — prepare OTP setup: generate the secret, build the QR
     * code, and stage the secret on the session. Nothing is persisted yet; the
     * actual enable happens in /otp/verify-setup after the code is confirmed,
     * so the stored secret always matches the one the user scanned.
     */
    async handleEnable(req, res) {
      const token = setupSession(req, res)
      if (token === undefined) return

      const { secret, uri } = stageSetupSecret(token)
      json(res, 200, {
        ok: true,
        secret,
        uri,
        // QR code as an SVG data URL, ready for the setup page.
        svgUrl: generateQRSvg(uri, 256),
      })
    },

    /**
     * POST /otp/verify-setup — verify OTP setup (confirm secret).
     *
     * Binding 2FA is a security-state change and must leave a trail
     * (AGENTS.md「安全状态变更必须留审计」): success emits `otp-enabled`,
     * a failed confirmation `otp-enable-failed` + reason. The shared
     * preambles (address budget, malformed body) answer before this handler
     * runs and are covered by the rate limiter's security events instead.
     */
    async handleVerifySetup(req, res) {
      // Setup, not verification: the binding does not exist yet, so the
      // only gates are a fully verified session and the address budget.
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return
      const setupIp = addressOf(req)

      // Cap setup-code guessing per client address.
      if (otpRateLimited(req, res)) return

      const code = await readOtpCode(req, res)
      if (code === undefined) return

      // Get temp secret from session
      const tempSecret = sessions.getTempOTP(token)
      if (!tempSecret) {
        authEvent('otp-enable-failed', setupIp, 'setup-expired')
        return json(res, 400, { ok: false, error: 'setup-expired' })
      }

      // Verify OTP (temp secret is one-shot per session; no replay watermark)
      const { valid } = verifyTOTP(tempSecret, code, {
        // `?? 1`, never `|| 1`: a configured zero-width window (0) must stay 0.
        window: otp.otpWindow ?? 1,
        digits: otp.otpDigits || 6,
        period: otp.otpPeriod || 30,
      })

      if (!valid) {
        recordOtpFailure(setupIp, Date.now())
        authEvent('otp-enable-failed', setupIp, 'invalid-otp')
        return json(res, 401, { ok: false, error: 'invalid-otp' })
      }

      // Enable OTP with the verified secret, so the stored secret matches the
      // one the user scanned in the QR code.
      const result = await enableOTP({
        secret: tempSecret,
        algorithm: 'SHA1',
        digits: otp.otpDigits || 6,
        period: otp.otpPeriod || 30,
        backupCodeCount: otp.backupCodeCount || 10,
        backupCodeLength: otp.backupCodeLength || 8,
      })

      sessions.clearTempOTP(token)

      // OTP activation and session revocation: a REGULAR session (already
      // past onboarding) is revoked — it was verified under the password-only
      // policy and must sign in again under the password + OTP policy. An
      // ONBOARDING session (logged in with the initial password) keeps
      // working: it is marked OTP-verified and finishes the onboarding
      // password step, whose /login/change revokes every session once
      // (revoking now would force a re-login only to re-enter onboarding).
      sessions.markOTPVerified(token)
      const onboarding = sessions.isNeedsOnboarding(token)
      if (!onboarding) sessions.revokeAll()
      // Audited after the state actually changed — mirroring `otp-disabled`.
      authEvent('otp-enabled', setupIp)

      // The onboarding branch keeps BOTH the session and the cookie (no
      // expired Set-Cookie): the user continues straight to the password
      // step. The regular branch revokes and clears the cookie.
      json(res, 200, {
        ok: true,
        backupCodes: result.backupCodes,
        sessionRevoked: !onboarding,
        next: onboarding ? (gateway.basePath + '/onboarding/password') : gateway.basePath + '/',
      }, onboarding ? undefined : expiredCookie(secureCookie(req)))
    },

    /** GET /otp/verify — render OTP verification page. */
    serveVerifyPage(req, res) {
      if (activeOtpSession(req, res) === undefined) return

      const status = getOTPStatus()
      sendHtml(res, otpVerifyPage({
        hasBackupCodes: status.backupCodesCount > 0,
        digits: otp.otpDigits || 6,
        locale: localeFor(req),
        basePath: gateway.basePath,
      }))
    },

    /** POST /otp/verify — verify OTP code during login. */
    async handleVerify(req, res) {
      const token = activeOtpSession(req, res)
      if (token === undefined) return

      // Cap OTP guessing per client address (brute-forcing the TOTP code).
      if (otpRateLimited(req, res)) return

      const code = await readOtpCode(req, res)
      if (code === undefined) return

      let secret
      try {
        secret = getOTPSecret()
      } catch (err) {
        if (err instanceof OTPCryptoError) {
          return json(res, err.status, { ok: false, error: err.code, message: err.message })
        }
        throw err
      }
      if (!secret) {
        return json(res, 500, { ok: false, error: 'otp-secret-missing' })
      }

      if (!verifyOtp(secret, code, addressOf(req))) {
        return json(res, 401, { ok: false, error: 'invalid-credentials' })
      }

      // OTP verified, mark session as OTP-verified
      sessions.markOTPVerified(token)

      json(res, 200, { ok: true })
    },

    /** POST /otp/verify-backup — verify backup code during login. */
    async handleVerifyBackup(req, res) {
      const token = activeOtpSession(req, res)
      if (token === undefined) return

      // Cap backup-code guessing per client address.
      if (otpRateLimited(req, res)) return

      const body = await readJson(req, res)
      if (body === undefined) return

      const { code } = body
      if (typeof code !== 'string' || code.length === 0) {
        return json(res, 400, { ok: false, error: 'invalid-backup-code' })
      }

      const valid = await verifyAndUseBackupCode(code)
      if (!valid) {
        recordOtpFailure(addressOf(req), Date.now())
        return json(res, 401, { ok: false, error: 'invalid-credentials' })
      }

      // Backup code verified, mark session as OTP-verified
      sessions.markOTPVerified(token)

      json(res, 200, { ok: true })
    },

    /**
     * POST /otp/disable — disable OTP.
     *
     * Security: when 2FA is active, the session alone is NOT enough to disable
     * it — the caller must re-authenticate with the current TOTP code or an
     * unused backup code, otherwise an attacker with a hijacked session could
     * silently turn 2FA off.
     *
     * Audit: every outcome goes through the auth-audit sink (`otp-disabled` /
     * `otp-disable-failed` + reason) — disabling the second factor is a
     * security-state change and must leave a trail. A wrong companion
     * password counts toward the SAME per-address lockout as login failures,
     * mirroring /login/change: a held session must not enable unlimited
     * old-password guessing either.
     */
    async handleDisable(req, res) {
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return
      const disableIp = addressOf(req)

      // Read body if present (optional for settings panel)
      let password, otpCode, backupCode
      const contentType = req.headers['content-type'] || ''
      if (contentType.includes('application/json')) {
        const body = await readJson(req, res)
        if (body === undefined) return
        password = body.password
        otpCode = body.otp
        backupCode = body.backupCode
      }

      // If password provided, verify it
      if (typeof password === 'string') {
        if (!await verifyPassword(password)) {
          recordFailure(disableIp, Date.now())
          const entry = gateway.attempts.get(disableIp)
          if (entry !== undefined && entry.lockedUntil > Date.now()) {
            authEvent('otp-disable-failed', disableIp, 'too-many-attempts')
            return json(res, 429, {
              ok: false, error: 'too-many-attempts',
              retryAfterSeconds: retryAfterSeconds(entry.lockedUntil, Date.now()),
            })
          }
          authEvent('otp-disable-failed', disableIp, 'invalid-password')
          return json(res, 401, { ok: false, error: 'invalid-password' })
        }
      }

      // If OTP is enabled, disabling requires re-authentication with the
      // second factor: a valid TOTP code or an unused backup code.
      if (otpActive()) {
        let secret
        try {
          secret = getOTPSecret()
        } catch (err) {
          if (err instanceof OTPCryptoError) {
            authEvent('otp-disable-failed', disableIp, err.code)
            return json(res, err.status, { ok: false, error: err.code, message: err.message })
          }
          throw err
        }
        if (!secret) {
          authEvent('otp-disable-failed', disableIp, 'otp-secret-missing')
          return json(res, 500, { ok: false, error: 'otp-secret-missing' })
        }

        // Cap TOTP/backup guessing per client address.
        if (!otpVerifyAllowed(disableIp, Date.now())) {
          authEvent('otp-disable-failed', disableIp, 'rate-limited')
          return json(res, 429, { ok: false, error: 'rate-limited' })
        }

        const hasOtp = typeof otpCode === 'string' && otpCode.length > 0
        const hasBackupCode = typeof backupCode === 'string' && backupCode.length > 0
        if (!hasOtp && !hasBackupCode) {
          authEvent('otp-disable-failed', disableIp, 'otp-required')
          return json(res, 400, { ok: false, error: 'otp-required' })
        }

        if (hasOtp) {
          if (otpCode.length !== (otp.otpDigits || 6)) {
            authEvent('otp-disable-failed', disableIp, 'invalid-otp')
            return json(res, 400, { ok: false, error: 'invalid-otp' })
          }
          // Verify the TOTP window WITHOUT the global lastCounter watermark:
          // disabling is a destructive action — a valid code destroys the
          // secret (and the watermark with it), so rejecting the code that
          // the user just used to log in within the same time step has no
          // security value and only produces a confusing "invalid-otp".
          // Failures still count toward the shared lockout, and the code
          // must still be inside the time window.
          const result = verifyTOTP(secret, otpCode, {
            // `?? 1`, never `|| 1`: a configured zero-width window must stay 0.
            window: otp.otpWindow ?? 1,
            digits: otp.otpDigits || 6,
            period: otp.otpPeriod || 30,
          })
          if (!result.valid) {
            recordOtpFailure(disableIp, Date.now())
            authEvent('otp-disable-failed', disableIp, 'invalid-otp')
            return json(res, 401, { ok: false, error: 'invalid-otp' })
          }
        } else {
          const valid = await verifyAndUseBackupCode(backupCode)
          if (!valid) {
            recordOtpFailure(disableIp, Date.now())
            authEvent('otp-disable-failed', disableIp, 'invalid-backup-code')
            return json(res, 401, { ok: false, error: 'invalid-backup-code' })
          }
        }
      }

      disableOTP()
      authEvent('otp-disabled', disableIp)
      json(res, 200, { ok: true })
    },
  }
}
