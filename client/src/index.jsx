/**
 * dsh-auth-gateway client plugin — user settings panel (container).
 *
 * Source of truth for the browser bundle (built by `client/build.mjs` into
 * `client/index.js`, which is what dsh serves via exports["./client"]).
 *
 * This file owns the apply world and the panel's state: the gateway api
 * factory, every request, and the render tree that wires the presentational
 * cards to that state. The cards (./*-card.jsx, ./otp-setup-dialog.jsx) are
 * pure functions of their props — no fetching, no ctx.
 *
 * Contract notes (packages/client/AGENTS.md):
 * - ctx belongs to the apply world only — the component receives everything
 *   through props: the gateway API via the slot inject face, and the `t`
 *   locale seat (declared through `locale` on the registration).
 * - `inject` lists only the services apply() actually uses (`slots`,
 *   `locale`, `connection`), aligned with dsh.client.inject in package.json.
 *
 * Module layout:
 *   ./locales.js            zh/en dictionaries for our namespace
 *   ./styles.js             design tokens + shared style objects
 *   ./ui.jsx                Button / Pill / StatusBanner primitives
 *   ./otp-card.jsx          ─┐
 *   ./password-card.jsx      │ one presentational card per settings section
 *   ./session-card.jsx       │ (props in; no state, no requests)
 *   ./cookie-secure-card.jsx │
 *   ./about-card.jsx         │
 *   ./otp-setup-dialog.jsx  ─┘
 *   ./cookie-secure.js      pure cookie-Secure state derivation (unit-tested)
 *   ./update-notice.js      pure update-notice derivation (unit-tested)
 */

import { useEffect, useState } from 'react'
// Side-effect import: guarantees the dsh slots module is materialized by the
// client loader before this plugin's apply() runs (declared in dsh.client.inject).
import '@deepseek-ai/dsh-client-ui-slots'
import { afterCheckAttempt, readVersion, updateNotice } from './update-notice.js'
import { cookieSecureState, cookieSecureEffective } from './cookie-secure.js'
import { NS, en, zh } from './locales.js'
import { CARD_TITLE, DESC, T } from './styles.js'
import { StatusBanner } from './ui.jsx'
import { OtpCard } from './otp-card.jsx'
import { PasswordCard } from './password-card.jsx'
import { SessionCard } from './session-card.jsx'
import { CookieSecureCard } from './cookie-secure-card.jsx'
import { AboutCard } from './about-card.jsx'
import { OtpSetupDialog } from './otp-setup-dialog.jsx'

/** Server error codes the cookie-Secure save may answer, mapped to message keys. */
const COOKIE_SECURE_FAILURE_CODES = {
  'invalid-mode': 'invalid-mode',
  'force-secure-requires-tls': 'force-secure-requires-tls',
  'storage-unavailable': 'storage-unavailable',
  'storage-failed': 'storage-failed',
}

/**
 * User Settings Panel component. Receives the gateway API via the slot
 * inject face and the `t` locale seat (declared by `locale: NS` on the
 * registration) — no ctx, no direct fetch.
 */
function UserSettingsPanel({ api, t }) {
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [digits, setDigits] = useState(6)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrData, setQrData] = useState(null)
  // Cookie Secure policy from the gateway ('auto' | true | false) and the
  // transport THIS browser actually used — the Secure attribute is enforced
  // by the user agent against its own URL, so the card judges by
  // window.location.protocol, never by what the server thinks it saw.
  // Derivation lives in client/src/cookie-secure.js (unit-tested).
  const [cookieSecure, setCookieSecure] = useState('auto')
  // Where the effective policy comes from ('deployment' = composition patch,
  // 'panel' = runtime override in the credential record). The panel edits it
  // via POST /login-api/cookie-secure.
  const [cookieSecureSource, setCookieSecureSource] = useState('deployment')
  // Draft mode for the mode dropdown; null while the card shows the state only.
  const [cookieSecureDraft, setCookieSecureDraft] = useState(null)
  // Open state for the mode dropdown (dsh Menu primitive — the shell owns
  // outside-click / Escape / arrow-key handling, we only own the value).
  const [cookieMenuOpen, setCookieMenuOpen] = useState(false)
  const [savingCookieSecure, setSavingCookieSecure] = useState(false)
  const [cookieSecureHint, setCookieSecureHint] = useState(null)
  // The gateway's own view of THIS request's transport (TLS socket or a
  // proxy-forwarded X-Forwarded-Proto: https), reported by /login-api/settings.
  // Unlike the card state it is not about what the browser stores — it tells
  // the panel whether THIS entry is a secure origin, i.e. whether a reissued
  // cookie can overwrite a stored Secure one. Older gateways do not report
  // it; the browser's protocol is then the best available proxy.
  const [requestSecure, setRequestSecure] = useState(false)
  /** Normalize a policy value from the gateway ('auto' | true | false) —
   * lookalikes fall back to 'auto', mirroring the gateway's own rule. */
  const normalizeMode = (v) => (v === true || v === false ? v : 'auto')
  const [isHttps] = useState(() => typeof window !== 'undefined' && window.location.protocol === 'https:')
  // Post-verification state inside the QR dialog: OTP is enabled, every
  // session (including this one) was revoked — show the backup codes, then
  // the user signs in again under the new password + OTP policy.
  const [setupDone, setSetupDone] = useState(false)
  const [backupCodes, setBackupCodes] = useState([])

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  // In-flight guard for the enable click: a double-click would POST /otp/enable
  // twice and the second response would OVERWRITE the staged secret, making
  // the scanned QR disagree with the codes the user verifies.
  const [enablingOtp, setEnablingOtp] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [showDisableOtp, setShowDisableOtp] = useState(false)
  const [disableOtpCode, setDisableOtpCode] = useState('')
  const [disablingOtp, setDisablingOtp] = useState(false)

  // Version / update state (GET /login-api/version). Loaded separately from
  // the settings call so a slow or unreachable registry never delays the
  // panel's own data; `null` means "not answered yet". Automatic checks are
  // off by default, so this first load normally reports no verdict — the
  // "check for updates" button below is what makes the outbound request.
  // The state derivation itself lives in client/src/update-notice.js, where it
  // is unit-tested (this component has no test runtime available).
  const [versionInfo, setVersionInfo] = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => { loadSettings(); loadVersion() }, [])

  async function loadVersion() {
    try {
      const data = await api.getVersion()
      setVersionInfo(readVersion(data?.ok ? data : null))
    } catch {
      setVersionInfo(readVersion(null))
    }
  }

  /**
   * The explicit "check now" action (`?refresh=1`). Works whether or not the
   * deployment enabled automatic checks — a click is the user's own consent
   * for the one outbound request. The button is disabled while in flight, so
   * a double-click cannot stack requests.
   */
  async function checkForUpdates() {
    setCheckingUpdate(true)
    try {
      const data = await api.checkForUpdates()
      setVersionInfo((prev) => afterCheckAttempt(prev, data?.ok ? { data } : { error: 'unauthenticated' }))
    } catch (err) {
      setVersionInfo((prev) => afterCheckAttempt(prev, { error: err?.message || 'network' }))
    } finally {
      setCheckingUpdate(false)
    }
  }

  /** POST the panel's cookieSecure override, then re-read the effective state. */
  async function saveCookieSecure() {
    // Forcing Secure from a plaintext entry locks the operator out of this
    // very entry (the browser refuses to store the Secure cookie, so every
    // login "succeeds" but holds no session) — refuse the save with the
    // explanation instead of letting the next login die confusingly.
    if (cookieSecureDraft === true && !requestSecure) {
      setCookieSecureHint({ tone: 'warn', text: t('cookie.save.warn.force-on-http') })
      return
    }
    setSavingCookieSecure(true)
    setCookieSecureHint(null)
    try {
      const data = await api.setCookieSecure(cookieSecureDraft)
      if (data?.ok === true) {
        // The POST answers the new effective policy; patch local state
        // instead of re-fetching the whole settings snapshot (it would
        // re-read OTP state we did not touch, for zero benefit).
        const mode = normalizeMode(data.cookieSecure)
        setCookieSecure(mode)
        setCookieSecureSource(data.cookieSecureSource === 'panel' ? 'panel' : 'deployment')
        setCookieSecureDraft(null)
        // The gateway reissued the session cookie under the new policy, but a
        // plaintext entry cannot overwrite a stored Secure cookie. The note
        // is relevant only when the NEW policy drops Secure ('off', or
        // 'auto' over plain HTTP) and this entry cannot rewrite a leftover —
        // switching between Secure states over HTTPS needs no warning.
        const hasLeftover = (mode === false || (mode === 'auto' && !isHttps)) && !requestSecure
        const hint = hasLeftover ? t('cookie.save.note.secure-leftover') : ''
        setCookieSecureHint({
          tone: 'success',
          text: hasLeftover
            ? t('cookie.edit.saved.with-hint', { hint })
            : t('cookie.edit.saved'),
        })
      } else {
        const code = COOKIE_SECURE_FAILURE_CODES[data?.error] ?? 'network'
        setCookieSecureHint({ tone: 'warn', text: t(`cookie.edit.failed.${code}`) })
      }
    } catch {
      setCookieSecureHint({ tone: 'warn', text: t('cookie.edit.failed.network') })
    } finally {
      setSavingCookieSecure(false)
    }
  }

  /** Drop the panel override; the deployment config rules again. */
  async function resetCookieSecure() {
    setSavingCookieSecure(true)
    setCookieSecureHint(null)
    try {
      const data = await api.resetCookieSecure()
      if (data?.ok === true) {
        const mode = normalizeMode(data.cookieSecure)
        setCookieSecure(mode)
        setCookieSecureSource(data.cookieSecureSource === 'panel' ? 'panel' : 'deployment')
        setCookieSecureDraft(null)
        const hasLeftover = (mode === false || (mode === 'auto' && !isHttps)) && !requestSecure
        const hint = hasLeftover ? t('cookie.save.note.secure-leftover') : ''
        setCookieSecureHint({
          tone: 'success',
          text: hasLeftover
            ? t('cookie.edit.restored.with-hint', { hint })
            : t('cookie.edit.restored'),
        })
      } else {
        setCookieSecureHint({ tone: 'warn', text: t('cookie.edit.failed.network') })
      }
    } catch {
      setCookieSecureHint({ tone: 'warn', text: t('cookie.edit.failed.network') })
    } finally {
      setSavingCookieSecure(false)
    }
  }

  async function loadSettings() {
    try {
      const data = await api.getSettings()
      if (data.ok) {
        // The key must match the gateway's /login-api/settings response
        // (lib/gateway.js #handleGetSettings) — regression-guarded in
        // tests/client-contract.test.mjs.
        const cfg = data.config?.['dsh-auth-gateway'] || {}
        setOtpEnabled(cfg.otpEnabled || false)
        setDigits(cfg.otpDigits || 6)
        // Three-state cookie Secure policy; absent means auto.
        const mode = normalizeMode(cfg.cookieSecure)
        setCookieSecure(mode)
        setCookieSecureSource(cfg.cookieSecureSource === 'panel' ? 'panel' : 'deployment')
        // Secure origin as the GATEWAY sees it. It lives at the TOP level of
        // the response (server-side transport truth, incl. X-Forwarded-Proto),
        // NOT inside cfg — reading it from cfg would always be undefined and
        // silently fall back to the browser's own protocol. Missing on older
        // gateways, in which case the browser's protocol is the best proxy.
        setRequestSecure(data.requestSecure === undefined ? isHttps : data.requestSecure === true)
        setCookieSecureDraft(null)
      } else {
        // A non-ok answer (401: the session died while the panel was open;
        // 5xx: plugin/record state broken) must NOT render the default
        // snapshot — "OTP off / deployment policy" would be a fake security
        // picture. Surface the failure instead.
        setStatus({
          type: 'error',
          message: data?.error === 'unauthenticated'
            ? t('error.sessionExpired')
            : t('error.loadSettings', { message: data?.error || t('error.unknown') }),
        })
      }
    } catch (err) {
      setStatus({ type: 'error', message: t('error.loadSettings', { message: err.message }) })
    } finally { setLoading(false) }
  }

  async function enableOTP() {
    if (enablingOtp) return
    setEnablingOtp(true)
    setStatus(null)
    try {
      const data = await api.enableOtp()
      if (data.ok) {
        // /otp/enable answers the staged secret + QR, NOT the backup codes
        // (those exist only after verify-setup) — no backupCodes field here.
        setQrData({ secret: data.secret, uri: data.uri, svgUrl: data.svgUrl })
        setShowQRModal(true)
        // Do NOT flip the panel state here — OTP is not enabled
        // until the code is verified via verify-setup.
      } else {
        setStatus({ type: 'error', message: t('error.enableOtp', { message: data.error || t('error.unknown') }) })
      }
    } catch (err) { setStatus({ type: 'error', message: t('error.enableOtp', { message: err.message }) }) }
    finally { setEnablingOtp(false) }
  }

  async function disableOTP() {
    setStatus(null)
    const code = disableOtpCode.trim()
    if (!code) { setStatus({ type: 'error', message: t('error.otpCodeMissing') }); return }
    const isDigits = new RegExp('^\\d{' + digits + '}$').test(code)
    const body = isDigits ? { otp: code } : { backupCode: code }
    setDisablingOtp(true)
    try {
      const data = await api.disableOtp(body)
      if (data.ok) {
        setStatus({ type: 'success', message: t('status.otpDisabled') })
        setOtpEnabled(false)
        setShowDisableOtp(false)
        setDisableOtpCode('')
      } else {
        const message = data.error === 'invalid-otp'
          ? t('error.disableOtpInvalid')
          : t('error.disableOtp', { message: data.error || t('error.unknown') })
        setStatus({ type: 'error', message })
      }
    } catch (err) { setStatus({ type: 'error', message: t('error.disableOtp', { message: err.message }) }) }
    finally { setDisablingOtp(false) }
  }

  function closeQRModal() {
    // The backup codes are returned EXACTLY ONCE by /otp/verify-setup (the
    // gateway revoked every session, so they can never be re-fetched). Once
    // setup is done the dialog must not be closable: the mask and the ✕ no
    // longer call this, and this guard is the second line of defence.
    if (setupDone) return
    // Cancel path: just close, keep the panel button in its
    // current state (OTP was not verified here).
    setShowQRModal(false); setQrData(null); setOtpCode(''); setVerifyingOtp(false)
    setSetupDone(false); setBackupCodes([])
    setStatus(null)
  }

  async function verifyOTPSetup() {
    if (otpCode.length !== digits) { setStatus({ type: 'error', message: t('error.otpCodeLength', { digits }) }); return }
    setVerifyingOtp(true); setStatus(null)
    try {
      const data = await api.verifyOtpSetup(otpCode)
      if (data.ok) {
        // The gateway revoked every session (sessionRevoked) — this one is
        // gone too, so the panel cannot refresh anything anymore. Keep the
        // dialog open showing the backup codes, then sign in again.
        setOtpEnabled(true)
        setBackupCodes(data.backupCodes || [])
        setSetupDone(true)
        setOtpCode('')
      } else {
        setStatus({ type: 'error', message: t('error.verifyOtp', { message: data.error || t('error.invalidCode') }) })
      }
    } catch (err) {
      setStatus({ type: 'error', message: t('error.verifyOtp', { message: err.message }) })
    } finally {
      setVerifyingOtp(false)
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { setStatus({ type: 'error', message: t('error.passwordMismatch') }); return }
    if (newPassword.length < 8) { setStatus({ type: 'error', message: t('error.passwordTooShort') }); return }
    setChangingPassword(true); setStatus(null)
    try {
      const data = await api.changePassword(oldPassword, newPassword)
      if (data.ok) {
        setStatus({ type: 'success', message: t('status.passwordChanged') })
        setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('')
        setTimeout(() => { location.href = BASE + '/login' }, 1500)
      } else setStatus({ type: 'error', message: t('error.changePassword', { message: data.error || t('error.unknown') }) })
    } catch (err) { setStatus({ type: 'error', message: t('error.changePassword', { message: err.message }) }) }
    finally { setChangingPassword(false) }
  }

  async function logout() {
    try { await api.logout(); location.href = BASE + '/login' }
    catch (err) { setStatus({ type: 'error', message: t('error.logout', { message: err.message }) }) }
  }

  if (loading) {
    return <div style={{ padding: '24px 0', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>{t('loading')}</div>
  }

  // The single notice the About card shows (null when nothing is known).
  const notice = updateNotice(versionInfo?.update, t, versionInfo?.repository ?? '')

  // Cookie Secure card state: policy from the gateway + this browser's
  // transport (see client/src/cookie-secure.js, unit-tested).
  const secureState = cookieSecureState(cookieSecure, isHttps ? 'https:' : 'http:')
  const secureEffective = cookieSecureEffective(secureState)

  return (
    <>
      <div style={{ paddingTop: '4px' }}>
        <h3 style={{
          margin: '0 0 4px', fontSize: '16px', lineHeight: '24px', fontWeight: 500,
          color: T.textPrimary, display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          {t('nav')}
          {versionInfo !== null && versionInfo.version !== '' && (
            <span style={{
              fontSize: '12px', lineHeight: '18px', padding: '0 8px', borderRadius: '9px',
              background: T.hover, color: T.textSecondary, fontWeight: 400,
            }}>v{versionInfo.version}</span>
          )}
        </h3>
        <p style={{ ...DESC, margin: '0 0 16px' }}>{t('header.desc')}</p>

        {/* OTP two-factor */}
        <OtpCard
          t={t}
          enabled={otpEnabled}
          digits={digits}
          enabling={enablingOtp}
          onEnable={enableOTP}
          showDisable={showDisableOtp}
          onShowDisable={() => setShowDisableOtp(true)}
          code={disableOtpCode}
          onCodeChange={setDisableOtpCode}
          disabling={disablingOtp}
          onDisable={disableOTP}
          onCancelDisable={() => { setShowDisableOtp(false); setDisableOtpCode('') }}
        />

        {/* Password change + session management, side by side. No outer CARD
            shell: the two bordered boxes ARE the card, and a nested border
            would draw a double frame. */}
        <div style={{
          display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'stretch',
          marginBottom: '12px',
        }}>
          <PasswordCard
            t={t}
            open={showChangePassword}
            changing={changingPassword}
            oldPassword={oldPassword}
            newPassword={newPassword}
            confirmPassword={confirmPassword}
            onOpen={() => setShowChangePassword(true)}
            onCancel={() => { setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('') }}
            onOldChange={setOldPassword}
            onNewChange={setNewPassword}
            onConfirmChange={setConfirmPassword}
            onSubmit={changePassword}
          />
          <SessionCard t={t} onLogout={logout} />
        </div>

        {/* Cookie Secure: effective policy + what actually applies here,
            plus the panel override editor (persisted via the credential
            record; POST /login-api/cookie-secure) */}
        <CookieSecureCard
          t={t}
          secureState={secureState}
          secureEffective={secureEffective}
          mode={cookieSecure}
          source={cookieSecureSource}
          draft={cookieSecureDraft}
          menuOpen={cookieMenuOpen}
          saving={savingCookieSecure}
          hint={cookieSecureHint}
          onToggleMenu={() => setCookieMenuOpen((value) => !value)}
          onCloseMenu={() => setCookieMenuOpen(false)}
          onSelectMode={setCookieSecureDraft}
          onSave={saveCookieSecure}
          onReset={resetCookieSecure}
        />

        {/* About: running version, repository link, new-version notice */}
        <AboutCard
          t={t}
          versionInfo={versionInfo}
          notice={notice}
          checkingUpdate={checkingUpdate}
          onCheck={checkForUpdates}
        />

        {/* Status */}
        <StatusBanner status={status} />
      </div>

      {/* QR dialog (dsh dialog pattern: mask + blur, rounded panel, footer actions) */}
      {showQRModal && qrData && (
        <OtpSetupDialog
          t={t}
          digits={digits}
          qrData={qrData}
          otpCode={otpCode}
          setupDone={setupDone}
          backupCodes={backupCodes}
          status={status}
          verifyingOtp={verifyingOtp}
          onClose={closeQRModal}
          onCodeChange={setOtpCode}
          onVerify={verifyOTPSetup}
          onDone={() => { location.href = BASE + '/login' }}
        />
      )}
    </>
  )
}

/** Services this plugin's apply() actually uses (ctx.slots, ctx.locale,
 * ctx.connection — declared so the LAN trust getter install below is a
 * legitimate Cordis service access rather than an undeclared read). */
const inject = ['slots', 'locale', 'connection']

/**
 * LAN trust through the official plugin seam (second layer).
 *
 * dsh computes `connection.isLoopback` once from `location.hostname` when the
 * connection plugin applies; every settings consumer snapshots it for its
 * host/memory persistence decision. Behind a reverse proxy or LAN IP that
 * value is false, so Models / Credentials / locale preferences fall back to
 * per-browser memory — even though the gateway has already authenticated the
 * page and rewrites Host/Origin to loopback server-side.
 *
 * The PRIMARY mechanism is the host plugin's tapIndex-injected loader proxy
 * (lib/lan-trust-script.js): it intercepts the connection registration before
 * any consumer wakes, per the sanctioned minimal intervention documented in
 * AGENTS.md. THIS function is the second layer — a getter on the final
 * handle for boots where that bootstrap did not run (unexpected loader
 * shape): a getter (not a plain write) is used so a consumer whose apply ran
 * before ours still reads true afterwards. The historical 0.4.2 breakage came
 * from REPLACING ctx.provide during registration; neither layer does that.
 */
function installLanTrust(ctx) {
  if (typeof location === 'undefined' || !location.hostname) return
  const hn = location.hostname
  const loopback = hn === 'localhost' || hn === '127.0.0.1' || hn === '::1'
    || hn === '[::1]' || hn === '0.0.0.0'
  if (loopback) return // hostname detection already yields true
  let handle
  try {
    handle = ctx.connection
  } catch {
    return // connection not injected this boot — nothing to mark
  }
  if (!handle || Object.getOwnPropertyDescriptor(handle, 'isLoopback')?.get) return
  Object.defineProperty(handle, 'isLoopback', {
    get: () => true,
    set: () => {},
    configurable: true,
    enumerable: true,
  })
}

const BASE = (typeof window !== 'undefined' && window.__dshAuthGatewayBasePath__) || ''

function apply(ctx) {
  installLanTrust(ctx)
  // Dictionaries for the settings section: registered under our own
  // namespace so the slot's `t` seat follows the dsh UI language.
  ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)
  // Gateway access lives in the apply world; the component only sees the
  // api object through the slot's inject face (no direct fetch in props).
  const api = {
    getSettings: async () => (await fetch(BASE + '/login-api/settings')).json(),
    getVersion: async () => (await fetch(BASE + '/login-api/version')).json(),
    // Explicit on-demand check: the only path that makes the gateway contact
    // the registry when automatic checks are off (the default).
    checkForUpdates: async () => (await fetch(BASE + '/login-api/version?refresh=1')).json(),
    enableOtp: async () => (await fetch(BASE + '/otp/enable', { method: 'POST' })).json(),
    verifyOtpSetup: async (otp) => (await fetch(BASE + '/otp/verify-setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp }),
    })).json(),
    disableOtp: async (payload) => (await fetch(BASE + '/otp/disable', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })).json(),
    changePassword: async (oldPassword, newPassword) => (await fetch(BASE + '/login/change', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    })).json(),
    setCookieSecure: async (mode) => (await fetch(BASE + '/login-api/cookie-secure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    })).json(),
    resetCookieSecure: async () => (await fetch(BASE + '/login-api/cookie-secure', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    })).json(),
    logout: async () => (await fetch(BASE + '/login/logout', { method: 'POST' })).json(),
  }
  const injected = () => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'user-settings', order: 100,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, UserSettingsPanel))
  // Plugin detail page: guide to Settings -> Authentication Settings. The
  // detail page hands registrants only the subject — no shell open handle
  // exists outside the official launcher/onboarding seats — so the section
  // explains the path instead of navigating there.
  const DetailGuide = ({ subject, t: seatT }) => {
    const pkg = subject?.kind === 'bundle' || subject?.kind === 'row' ? subject.pkg : undefined
    if (pkg?.name !== 'dsh-auth-gateway') return null
    const tr = seatT ?? t
    return (
      <section style={{ marginTop: '12px' }}>
        <div style={CARD_TITLE}>{tr('detail.guide.title')}</div>
        <p style={{ ...DESC, margin: '4px 0 0' }}>{tr('detail.guide.body')}</p>
      </section>
    )
  }
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', id: 'auth-gateway-guide', order: 0,
    locale: NS,
  }, DetailGuide))
}

export { apply, inject }
