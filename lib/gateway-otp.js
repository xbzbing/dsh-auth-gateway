/**
 * OTP route handlers for the login gateway (extracted from lib/gateway.js to
 * keep the gateway file under control; see CODE_REVIEW Optional #2).
 *
 * A module of plain functions bound to the gateway's public state plus the
 * private helpers it cannot reach directly. `createOTPRoutes(gateway, priv)`
 * returns `{ serveSetupPage, handleEnable, handleVerifySetup, serveVerifyPage,
 * handleVerify, handleVerifyBackup, handleDisable }`; the gateway dispatches
 * its /otp/* routes to them.
 */

import { tokenFromCookieHeader, expiredCookie } from './auth.js'
import { verifyPassword } from './store.js'
import {
  hasOTP,
  getOTPStatus,
  getOTPSecret,
  enableOTP,
  disableOTP,
  verifyAndUseBackupCode,
} from './otp-store.js'
import { verifyTOTP, generateOTPAuthURI, generateSecret } from './totp.js'
import { otpSetupPage, otpVerifyPage } from './otp-page.js'
import { generateQRSvg } from './qr-svg.js'

/**
 * @param {object} gateway - the LoginGateway instance (public state only:
 *   `sessions`, `otp`).
 * @param {object} priv - the gateway's private helpers, bound in the
 *   constructor: `json`, `readJson`, `verifiedTokenOr401`, `otpVerifyAllowed`,
 *   `recordOtpFailure`, `verifyOtp`, `otpActive`, `localeFor`.
 */
export function createOTPRoutes(gateway, priv) {
  const { sessions, otp } = gateway
  const {
    json, readJson, verifiedTokenOr401,
    otpVerifyAllowed, recordOtpFailure, verifyOtp, otpActive, localeFor,
  } = priv
  const addressOf = (req) => req.socket.remoteAddress ?? 'unknown'

  return {
    /** GET /otp/setup — render OTP setup page. */
    serveSetupPage(req, res) {
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return

      if (otpActive()) {
        return json(res, 409, { ok: false, error: 'otp-already-enabled' })
      }

      // Generate temporary secret for setup (will be confirmed on verification)
      const tempSecret = generateSecret()
      const uri = generateOTPAuthURI(tempSecret, {
        issuer: otp.otpIssuer || 'dsh-auth-gateway',
        account: 'dsh-user',
      })

      // Store temp secret in session for verification
      sessions.setTempOTP(token, tempSecret)

      const html = otpSetupPage({
        uri,
        secret: tempSecret,
        backupCodes: [], // Will be generated on successful setup
        digits: otp.otpDigits || 6,
        locale: localeFor(req),
      })

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(html)
    },

    /**
     * POST /otp/enable — prepare OTP setup: generate the secret, build the QR
     * code, and stage the secret on the session. Nothing is persisted yet; the
     * actual enable happens in /otp/verify-setup after the code is confirmed,
     * so the stored secret always matches the one the user scanned.
     */
    async handleEnable(req, res) {
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return

      if (otpActive()) {
        return json(res, 409, { ok: false, error: 'otp-already-enabled' })
      }

      const secret = generateSecret()
      const uri = generateOTPAuthURI(secret, {
        issuer: otp.otpIssuer || 'dsh-auth-gateway',
        account: 'dsh-user',
      })

      // Generate QR code as SVG data URL
      const svgUrl = generateQRSvg(uri, 256)

      // Stage the secret for confirmation via /otp/verify-setup
      sessions.setTempOTP(token, secret)

      json(res, 200, {
        ok: true,
        secret,
        uri,
        svgUrl,
      })
    },

    /** POST /otp/verify-setup — verify OTP setup (confirm secret). */
    async handleVerifySetup(req, res) {
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return

      // Cap setup-code guessing per client address.
      if (!otpVerifyAllowed(addressOf(req), Date.now())) {
        return json(res, 429, { ok: false, error: 'rate-limited' })
      }

      const body = await readJson(req, res)
      if (body === undefined) return

      const { otp: code } = body
      if (typeof code !== 'string' || code.length !== (otp.otpDigits || 6)) {
        return json(res, 400, { ok: false, error: 'invalid-otp' })
      }

      // Get temp secret from session
      const tempSecret = sessions.getTempOTP(token)
      if (!tempSecret) {
        return json(res, 400, { ok: false, error: 'setup-expired' })
      }

      // Verify OTP (temp secret is one-shot per session; no replay watermark)
      const { valid } = verifyTOTP(tempSecret, code, {
        window: otp.otpWindow || 1,
        digits: otp.otpDigits || 6,
        period: otp.otpPeriod || 30,
      })

      if (!valid) {
        recordOtpFailure(addressOf(req), Date.now())
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

      // Clear temp secret; the session is revoked below together with every
      // other pre-2FA session.
      sessions.clearTempOTP(token)

      // Enabling 2FA invalidates every session minted before it: they were
      // verified against the password-only policy, and the user must sign in
      // again under the new password + OTP policy. This includes the session
      // that just enabled OTP — the response carries an expired cookie.
      sessions.revokeAll()

      json(res, 200, {
        ok: true,
        backupCodes: result.backupCodes,
        sessionRevoked: true,
      }, expiredCookie())
    },

    /** GET /otp/verify — render OTP verification page. */
    serveVerifyPage(req, res) {
      const token = tokenFromCookieHeader(req.headers.cookie)
      if (!sessions.isValid(token)) {
        return json(res, 401, { ok: false, error: 'unauthenticated' })
      }

      if (!hasOTP() || !getOTPStatus().enabled) {
        return json(res, 400, { ok: false, error: 'otp-not-enabled' })
      }

      const otpStatus = getOTPStatus()
      const html = otpVerifyPage({
        hasBackupCodes: otpStatus.backupCodesCount > 0,
        digits: otp.otpDigits || 6,
        locale: localeFor(req),
      })

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(html)
    },

    /** POST /otp/verify — verify OTP code during login. */
    async handleVerify(req, res) {
      const token = tokenFromCookieHeader(req.headers.cookie)
      if (!sessions.isValid(token)) {
        return json(res, 401, { ok: false, error: 'unauthenticated' })
      }

      if (!hasOTP() || !getOTPStatus().enabled) {
        return json(res, 400, { ok: false, error: 'otp-not-enabled' })
      }

      // Cap OTP guessing per client address (brute-forcing the TOTP code).
      if (!otpVerifyAllowed(addressOf(req), Date.now())) {
        return json(res, 429, { ok: false, error: 'rate-limited' })
      }

      const body = await readJson(req, res)
      if (body === undefined) return

      const { otp: code } = body
      if (typeof code !== 'string' || code.length !== (otp.otpDigits || 6)) {
        return json(res, 400, { ok: false, error: 'invalid-otp' })
      }

      const secret = getOTPSecret()
      if (!secret) {
        return json(res, 500, { ok: false, error: 'otp-secret-missing' })
      }

      if (!verifyOtp(secret, code, addressOf(req))) {
        return json(res, 401, { ok: false, error: 'invalid-otp' })
      }

      // OTP verified, mark session as OTP-verified
      sessions.markOTPVerified(token)

      json(res, 200, { ok: true })
    },

    /** POST /otp/verify-backup — verify backup code during login. */
    async handleVerifyBackup(req, res) {
      const token = tokenFromCookieHeader(req.headers.cookie)
      if (!sessions.isValid(token)) {
        return json(res, 401, { ok: false, error: 'unauthenticated' })
      }

      if (!hasOTP() || !getOTPStatus().enabled) {
        return json(res, 400, { ok: false, error: 'otp-not-enabled' })
      }

      // Cap backup-code guessing per client address.
      if (!otpVerifyAllowed(addressOf(req), Date.now())) {
        return json(res, 429, { ok: false, error: 'rate-limited' })
      }

      const body = await readJson(req, res)
      if (body === undefined) return

      const { code } = body
      if (typeof code !== 'string' || code.length === 0) {
        return json(res, 400, { ok: false, error: 'invalid-backup-code' })
      }

      const valid = await verifyAndUseBackupCode(code)
      if (!valid) {
        recordOtpFailure(addressOf(req), Date.now())
        return json(res, 401, { ok: false, error: 'invalid-backup-code' })
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
     */
    async handleDisable(req, res) {
      const token = verifiedTokenOr401(req, res)
      if (token === undefined) return

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
          return json(res, 401, { ok: false, error: 'invalid-password' })
        }
      }

      // If OTP is enabled, disabling requires re-authentication with the
      // second factor: a valid TOTP code or an unused backup code.
      if (otpActive()) {
        const secret = getOTPSecret()
        if (!secret) {
          return json(res, 500, { ok: false, error: 'otp-secret-missing' })
        }

        // Cap TOTP/backup guessing per client address.
        if (!otpVerifyAllowed(addressOf(req), Date.now())) {
          return json(res, 429, { ok: false, error: 'rate-limited' })
        }

        const hasOtp = typeof otpCode === 'string' && otpCode.length > 0
        const hasBackupCode = typeof backupCode === 'string' && backupCode.length > 0
        if (!hasOtp && !hasBackupCode) {
          return json(res, 400, { ok: false, error: 'otp-required' })
        }

        if (hasOtp) {
          if (otpCode.length !== (otp.otpDigits || 6)) {
            return json(res, 400, { ok: false, error: 'invalid-otp' })
          }
          if (!verifyOtp(secret, otpCode, addressOf(req))) {
            return json(res, 401, { ok: false, error: 'invalid-otp' })
          }
        } else {
          const valid = await verifyAndUseBackupCode(backupCode)
          if (!valid) {
            recordOtpFailure(addressOf(req), Date.now())
            return json(res, 401, { ok: false, error: 'invalid-backup-code' })
          }
        }
      }

      disableOTP()
      json(res, 200, { ok: true })
    },
  }
}
