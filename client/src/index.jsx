/**
 * dsh-auth-gateway client plugin — user settings panel.
 *
 * Source of truth for the browser bundle (built by `client/build.mjs` into
 * `client/index.js`, which is what dsh serves via exports["./client"]).
 *
 * Contract notes (packages/client/AGENTS.md):
 * - ctx belongs to the apply world only — the component receives everything
 *   through props: the gateway API via the slot inject face, and the `t`
 *   locale seat (declared through `locale` on the registration).
 * - `inject` lists only the services apply() actually uses (`slots`,
 *   `locale`), aligned with dsh.client.inject in package.json.
 */

import { useEffect, useState } from 'react'
// Side-effect import: guarantees the dsh slots module is materialized by the
// client loader before this plugin's apply() runs (declared in dsh.client.inject).
import '@deepseek-ai/dsh-client-ui-slots'
import { afterCheckAttempt, readVersion, updateNotice } from './update-notice.js'
import { cookieSecureState, cookieSecureEffective } from './cookie-secure.js'

// dsh web design tokens (--dsw-alias-*). They are defined globally by the
// dsh web client and switch automatically with the light/dark theme, so the
// panel follows the host UI instead of hard-coding colors.
const T = {
  bg1: 'var(--dsw-alias-bg-layer-1)',
  bg2: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l2)',
  textPrimary: 'var(--dsw-alias-label-primary)',
  textSecondary: 'var(--dsw-alias-label-secondary)',
  textTertiary: 'var(--dsw-alias-label-tertiary)',
  brand: 'var(--dsw-alias-brand-primary)',
  primaryFill: 'var(--dsw-alias-button-primary-fill)',
  primaryHover: 'var(--dsw-alias-button-primary-hover)',
  primaryForeground: 'var(--dsw-alias-label-primary-foreground)',
  hover: 'var(--dsw-alias-interactive-bg-hover)',
  hoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger)',
  danger: 'var(--dsw-alias-state-error-primary)',
  dangerSoft: 'var(--dsw-alias-state-error-secondary)',
  success: 'var(--dsw-alias-state-success-primary)',
  successBg: 'var(--dsw-alias-state-success-tertiary)',
  shadow3: 'var(--dsw-shadow-lv3)',
  mask1: 'var(--dsw-alias-bg-mask-1)',
  maskBlur: 'var(--dsw-mask-blur)',
  fontCode: 'var(--ds-font-family-code)',
}

const CARD = {
  background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '12px',
  padding: '16px', marginBottom: '12px',
}
const CARD_TITLE = {
  fontSize: '14px', lineHeight: '22px', fontWeight: 500, color: T.textPrimary,
}
const DESC = {
  margin: '0 0 12px', fontSize: '13px', lineHeight: '20px', color: T.textSecondary,
}
const INPUT = {
  height: '32px', padding: '0 12px', borderRadius: '8px',
  border: `1px solid ${T.border}`, background: T.bg1, color: T.textPrimary,
  fontSize: '14px', lineHeight: '22px', outline: 'none', width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .15s ease',
}
const focusProps = {
  onFocus: (e) => { e.currentTarget.style.borderColor = T.brand },
  onBlur: (e) => { e.currentTarget.style.borderColor = '' },
}

/**
 * Dictionary namespace owned by this plugin. The `en` key set must match
 * `zh` exactly (checked by the locale service at registration).
 */
const NS = 'dsh-auth-gateway'

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'nav': '认证设置',
  'header.desc': '管理登录密码、双因素认证与登录会话。',
  'loading': '加载中...',
  'otp.title': 'OTP 双因素认证',
  'otp.enabled': '已启用',
  'otp.disabled': '未启用',
  'otp.desc': '启用后登录需要密码 + 验证码；兼容 Google Authenticator、Authy 等 TOTP 应用，并提供一次性备份代码。',
  'otp.enable': '启用 OTP',
  'otp.disable': '禁用 OTP',
  'otp.disable.confirm': '输入当前 {digits} 位验证码或一个未使用的备份代码以确认禁用：',
  'otp.disable.confirmBtn': '确认禁用',
  'otp.disable.progress': '禁用中...',
  'otp.codePlaceholder': '验证码或备份代码',
  'password.title': '登录密码',
  'password.desc': '修改后所有会话将下线，需要重新登录。',
  'password.change': '修改密码',
  'password.old': '当前密码',
  'password.new': '新密码（至少 8 位，含大小写字母或特殊字符）',
  'password.confirm': '确认新密码',
  'password.submit': '确认修改',
  'password.progress': '修改中...',
  'session.title': '会话管理',
  'session.loggedIn': '已登录',
  'session.desc': '会话有效期 30 天；dsh 重启后需重新登录。',
  'session.logout': '退出登录',
  'cookie.title': 'Cookie 安全',
  'cookie.pill.effective': 'Secure 生效',
  'cookie.pill.ineffective': 'Secure 未生效',
  'cookie.pill.off': '已关闭',
  'cookie.desc': 'Secure 属性只允许浏览器经加密链路（HTTPS）发送会话 Cookie；明文 HTTP 下强制开启会使登录立即失效。',
  'cookie.state.auto-https': '自动模式：当前连接为 HTTPS，Secure 已生效。',
  'cookie.state.auto-http': '自动模式：当前为明文 HTTP，Secure 未生效；前置 TLS（反向代理或证书）后自动启用。',
  'cookie.state.forced-https': '已强制开启：当前 HTTPS 连接下 Secure 生效。',
  'cookie.state.forced-http': '已强制开启：但当前为明文 HTTP，浏览器将拒绝保存 Secure Cookie，登录会立即失效——请先启用 TLS，或将配置改回 auto。',
  'cookie.state.off': '已显式关闭：Cookie 可经明文链路发送（仅建议在可信内网使用；明文下任何监听者都能捕获会话）。',
  'cookie.configHint': '由部署配置 cookieSecure 控制（auto / true / false；当前：{mode}）',
  'cookie.source.panel': '来源：面板设置（已持久化，优先于部署配置；可“恢复为部署配置”撤销）',
  'cookie.source.deployment': '来源：部署配置',
  'cookie.edit.mode.auto': '自动（跟随连接）',
  'cookie.edit.mode.true': '强制开启',
  'cookie.edit.mode.false': '关闭',
  'cookie.edit.save': '保存',
  'cookie.edit.saving': '保存中...',
  'cookie.edit.saved': '已保存，新策略立即生效',
  'cookie.edit.reset': '恢复为部署配置',
  'cookie.edit.failed.invalid-mode': '无效的模式值',
  'cookie.edit.failed.storage-unavailable': '当前部署不支持面板修改（凭据记录服务不可用）',
  'cookie.edit.failed.storage-failed': '保存失败，请稍后重试',
  'cookie.edit.failed.network': '网络错误，未保存',
  'about.title': '关于',
  'about.version': '当前版本',
  'about.unknown': '未知',
  'about.repository': '仓库',
  'about.repositoryLink': 'GitHub',
  'about.checking': '正在检查更新...',
  'about.check': '检查更新',
  'about.upToDate': '已是最新版本',
  'about.updateAvailable': '发现新版本 v{version}',
  'about.releaseNotes': '查看更新',
  'about.checkFailed': '暂时无法检查更新',
  'dialog.title': '设置 OTP 验证器',
  'dialog.desc': '使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码：',
  'dialog.secret': '密钥（手动输入用）',
  'dialog.code': '输入验证码以完成设置',
  'dialog.codePlaceholder': '{digits}位验证码',
  'dialog.verify': '验证并启用',
  'dialog.verifying': '验证中...',
  'dialog.cancel': '取消',
  'dialog.enabledDesc': '所有会话已下线。请保存以下一次性备份代码（每个只能使用一次），然后重新登录。',
  'dialog.backupCodesTitle': '备份代码',
  'dialog.doneBtn': '完成并重新登录',
  'status.otpEnabled': 'OTP 已启用',
  'status.otpDisabled': 'OTP 已禁用',
  'status.passwordChanged': '密码修改成功，请重新登录',
  'error.loadSettings': '加载失败: {message}',
  'error.enableOtp': '启用失败: {message}',
  'error.disableOtp': '禁用失败: {message}',
  'error.disableOtpInvalid': '验证码错误或已过期，请使用认证器中的最新验证码重试。',
  'error.verifyOtp': '验证失败: {message}',
  'error.changePassword': '修改失败: {message}',
  'error.logout': '退出失败: {message}',
  'error.otpCodeMissing': '请输入当前验证码或备份代码',
  'error.otpCodeLength': '请输入 {digits} 位验证码',
  'error.passwordMismatch': '两次输入的密码不一致',
  'error.passwordTooShort': '密码至少需要 8 位',
  'error.unknown': '未知错误',
  'error.invalidCode': '验证码错误',
}

/** English dictionary, checked complete against the zh key set. */
const en = {
  'nav': 'Authentication Settings',
  'header.desc': 'Manage the login password, two-factor authentication and the active session.',
  'loading': 'Loading...',
  'otp.title': 'Two-factor authentication (OTP)',
  'otp.enabled': 'Enabled',
  'otp.disabled': 'Disabled',
  'otp.desc': 'When enabled, login requires a password plus a verification code; works with Google Authenticator, Authy and other TOTP apps, and provides one-time backup codes.',
  'otp.enable': 'Enable OTP',
  'otp.disable': 'Disable OTP',
  'otp.disable.confirm': 'Enter the current {digits}-digit code or an unused backup code to confirm:',
  'otp.disable.confirmBtn': 'Disable',
  'otp.disable.progress': 'Disabling...',
  'otp.codePlaceholder': 'Code or backup code',
  'password.title': 'Login password',
  'password.desc': 'All sessions will be revoked and you will need to sign in again.',
  'password.change': 'Change password',
  'password.old': 'Current password',
  'password.new': 'New password (8+ chars, mixed case or special)',
  'password.confirm': 'Confirm new password',
  'password.submit': 'Update',
  'password.progress': 'Updating...',
  'session.title': 'Session Management',
  'session.loggedIn': 'Signed in',
  'session.desc': 'Sessions last 30 days; a dsh restart signs everyone out.',
  'session.logout': 'Sign out',
  'cookie.title': 'Cookie Security',
  'cookie.pill.effective': 'Secure on',
  'cookie.pill.ineffective': 'Secure off',
  'cookie.pill.off': 'Disabled',
  'cookie.desc': 'The Secure attribute lets the browser send the session cookie over an encrypted (HTTPS) link only; forcing it on a plain-HTTP link breaks the login instead of protecting it.',
  'cookie.state.auto-https': 'Auto mode: this connection is HTTPS, so Secure is in effect.',
  'cookie.state.auto-http': 'Auto mode: this connection is plain HTTP, so Secure is off; it engages automatically once TLS (reverse proxy or certificate) fronts the gateway.',
  'cookie.state.forced-https': 'Forced on: HTTPS connection, Secure is in effect.',
  'cookie.state.forced-http': 'Forced on, but this connection is plain HTTP: the browser will refuse to store the Secure cookie and logins fail immediately — enable TLS first, or set the config back to auto.',
  'cookie.state.off': 'Explicitly off: the cookie may travel in clear text (trusted LAN only; any listener on the link can capture the session).',
  'cookie.configHint': 'Controlled by the deployment config cookieSecure (auto / true / false; current: {mode})',
  'cookie.source.panel': 'Source: panel override (persisted, takes precedence over the deployment config; “Restore deployment config” undoes it)',
  'cookie.source.deployment': 'Source: deployment config',
  'cookie.edit.mode.auto': 'Auto (follow the connection)',
  'cookie.edit.mode.true': 'Force on',
  'cookie.edit.mode.false': 'Off',
  'cookie.edit.save': 'Save',
  'cookie.edit.saving': 'Saving...',
  'cookie.edit.saved': 'Saved — the new policy applies immediately',
  'cookie.edit.reset': 'Restore deployment config',
  'cookie.edit.failed.invalid-mode': 'Invalid mode value',
  'cookie.edit.failed.storage-unavailable': 'This deployment cannot store panel changes (credential-record service unavailable)',
  'cookie.edit.failed.storage-failed': 'Save failed — retry later',
  'cookie.edit.failed.network': 'Network error — not saved',
  'about.title': 'About',
  'about.version': 'Current version',
  'about.unknown': 'unknown',
  'about.repository': 'Repository',
  'about.repositoryLink': 'GitHub',
  'about.checking': 'Checking for updates...',
  'about.check': 'Check for updates',
  'about.upToDate': 'Up to date',
  'about.updateAvailable': 'New version v{version} available',
  'about.releaseNotes': 'View release',
  'about.checkFailed': 'Update check unavailable',
  'dialog.title': 'Set up OTP authenticator',
  'dialog.desc': 'Scan the QR code with Google Authenticator, Authy or another TOTP app:',
  'dialog.secret': 'Secret key (for manual entry)',
  'dialog.code': 'Enter the code to finish setup',
  'dialog.codePlaceholder': '{digits}-digit code',
  'dialog.verify': 'Verify & enable',
  'dialog.verifying': 'Verifying...',
  'dialog.cancel': 'Cancel',
  'dialog.enabledDesc': 'All sessions were signed out. Save these one-time backup codes (each can be used once), then sign in again.',
  'dialog.backupCodesTitle': 'Backup codes',
  'dialog.doneBtn': 'Done — sign in again',
  'status.otpEnabled': 'OTP enabled',
  'status.otpDisabled': 'OTP disabled',
  'status.passwordChanged': 'Password updated — please sign in again',
  'error.loadSettings': 'Failed to load: {message}',
  'error.enableOtp': 'Failed to enable: {message}',
  'error.disableOtp': 'Failed to disable: {message}',
  'error.disableOtpInvalid': 'Invalid or expired code — use the latest code from your authenticator and try again.',
  'error.verifyOtp': 'Verification failed: {message}',
  'error.changePassword': 'Failed to update: {message}',
  'error.logout': 'Failed to sign out: {message}',
  'error.otpCodeMissing': 'Enter the current code or a backup code',
  'error.otpCodeLength': 'Enter the {digits}-digit code',
  'error.passwordMismatch': 'Passwords do not match',
  'error.passwordTooShort': 'Password must be at least 8 characters',
  'error.unknown': 'Unknown error',
  'error.invalidCode': 'Invalid code',
}

/** dsh-styled button (design tokens, hover handled inline). */
function Button({ variant = 'primary', disabled, onClick, children, full, style }) {
  const kinds = {
    primary: { background: T.primaryFill, color: T.primaryForeground, hover: T.primaryHover },
    ghost: { background: 'transparent', color: T.textPrimary, hover: T.hover },
    outline: { background: 'transparent', color: T.textPrimary, hover: T.hover, border: `1px solid ${T.border}` },
    danger: { background: T.danger, color: '#fff', hover: T.dangerSoft },
    dangerOutline: { background: 'transparent', color: T.danger, hover: T.hoverDanger, border: `1px solid ${T.danger}` },
  }
  const k = kinds[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = k.hover }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = k.background }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        height: '32px', padding: '0 14px', borderRadius: '8px', fontSize: '13px', lineHeight: '20px',
        fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit',
        boxSizing: 'border-box', transition: 'background .15s ease',
        ...k, ...(full ? { width: '100%' } : {}), ...(disabled ? { opacity: 0.5 } : {}), ...style,
      }}
    >{children}</button>
  )
}

/** Small status badge (success / warn / neutral tone). */
function Pill({ children, tone = 'neutral' }) {
  const toneStyle = tone === 'success'
    ? { color: T.success, background: T.successBg }
    : tone === 'warn'
      ? { color: T.danger, background: T.dangerSoft }
      : { color: T.textSecondary, background: T.hover }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 10px',
      borderRadius: '11px', fontSize: '12px', lineHeight: '18px', ...toneStyle,
    }}>{children}</span>
  )
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
  // Draft mode for the edit radio; null while the card shows the state only.
  const [cookieSecureDraft, setCookieSecureDraft] = useState(null)
  const [savingCookieSecure, setSavingCookieSecure] = useState(false)
  const [cookieSecureHint, setCookieSecureHint] = useState(null)
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
    setSavingCookieSecure(true)
    setCookieSecureHint(null)
    try {
      const data = await api.setCookieSecure(cookieSecureDraft)
      if (data?.ok === true) {
        await loadSettings()
        setCookieSecureHint({ tone: 'success', text: t('cookie.edit.saved') })
      } else {
        const code = data?.error === 'invalid-mode' ? 'invalid-mode'
          : data?.error === 'storage-unavailable' ? 'storage-unavailable'
            : data?.error === 'storage-failed' ? 'storage-failed' : 'network'
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
        await loadSettings()
        setCookieSecureHint({ tone: 'success', text: t('cookie.edit.saved') })
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
        // Deployment switch (composition config), distinct from the active
        // state above: when false, enabling OTP from the panel is impossible
        // (the server answers otp-not-enabled) and the card explains why.
        setDigits(cfg.otpDigits || 6)
        // Three-state cookie Secure policy; absent (older gateway) means auto.
        const mode = cfg.cookieSecure === true || cfg.cookieSecure === false ? cfg.cookieSecure : 'auto'
        setCookieSecure(mode)
        setCookieSecureSource(cfg.cookieSecureSource === 'panel' ? 'panel' : 'deployment')
        setCookieSecureDraft(null)
      }
    } catch (err) {
      setStatus({ type: 'error', message: t('error.loadSettings', { message: err.message }) })
    } finally { setLoading(false) }
  }

  async function enableOTP() {
    setStatus(null)
    try {
      const data = await api.enableOtp()
      if (data.ok) {
        setQrData({ secret: data.secret, uri: data.uri, svgUrl: data.svgUrl, backupCodes: data.backupCodes })
        setShowQRModal(true)
        // Do NOT flip the panel state here — OTP is not enabled
        // until the code is verified via verify-setup.
      } else {
        setStatus({ type: 'error', message: t('error.enableOtp', { message: data.error || t('error.unknown') }) })
      }
    } catch (err) { setStatus({ type: 'error', message: t('error.enableOtp', { message: err.message }) }) }
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
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔐 {t('otp.title')}</span>
            {otpEnabled ? <Pill tone="success">{t('otp.enabled')}</Pill> : <Pill>{t('otp.disabled')}</Pill>}
          </div>
          <p style={DESC}>{t('otp.desc')}</p>
          {!otpEnabled ? (
            <Button variant="primary" onClick={enableOTP}>{t('otp.enable')}</Button>
          ) : !showDisableOtp ? (
            <Button variant="dangerOutline" onClick={() => setShowDisableOtp(true)}>{t('otp.disable')}</Button>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
              background: T.bg2, borderRadius: '10px', border: `1px solid ${T.border}`,
            }}>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
                {t('otp.disable.confirm', { digits })}
              </p>
              <input
                type="text" placeholder={t('otp.codePlaceholder')}
                value={disableOtpCode} onChange={(e) => setDisableOtpCode(e.target.value)}
                style={INPUT} autoFocus {...focusProps}
                onKeyDown={(e) => { if (e.key === 'Enter') disableOTP() }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="danger" onClick={disableOTP} disabled={disablingOtp}>
                  {disablingOtp ? t('otp.disable.progress') : t('otp.disable.confirmBtn')}
                </Button>
                <Button variant="outline" onClick={() => { setShowDisableOtp(false); setDisableOtpCode('') }}>{t('dialog.cancel')}</Button>
              </div>
            </div>
          )}
        </div>

        {/* Password change + session management, side by side. No outer CARD
            shell: the two bordered boxes ARE the card, and a nested border
            would draw a double frame. */}
        <div style={{
          display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'stretch',
          marginBottom: '12px',
        }}>
          <div style={{
            flex: '1 1 0', minWidth: '200px', display: 'flex', flexDirection: 'column',
            border: `1px solid ${T.border}`, borderRadius: '10px', padding: '12px',
          }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={CARD_TITLE}>🔑 {t('password.title')}</span>
              </div>
              <p style={{ ...DESC, margin: '0 0 10px' }}>{t('password.desc')}</p>
              <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                {!showChangePassword ? (
                  <Button variant="primary" onClick={() => setShowChangePassword(true)}>{t('password.change')}</Button>
                ) : (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
                    background: T.bg2, borderRadius: '10px', border: `1px solid ${T.border}`,
                  }}>
                    <input type="password" placeholder={t('password.old')} value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)} style={INPUT} {...focusProps} />
                    <input type="password" placeholder={t('password.new')} value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)} style={INPUT} {...focusProps} />
                    <input type="password" placeholder={t('password.confirm')} value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)} style={INPUT} {...focusProps}
                      onKeyDown={(e) => { if (e.key === 'Enter') changePassword() }} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Button variant="primary" onClick={changePassword} disabled={changingPassword}>
                        {changingPassword ? t('password.progress') : t('password.submit')}
                      </Button>
                      <Button variant="outline" onClick={() => { setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('') }}>{t('dialog.cancel')}</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{
              flex: '1 1 0', minWidth: '200px', display: 'flex', flexDirection: 'column',
              border: `1px solid ${T.border}`, borderRadius: '10px', padding: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <span style={CARD_TITLE}>🔒 {t('session.title')}</span>
                <Pill>{t('session.loggedIn')}</Pill>
              </div>
              <p style={{ ...DESC, margin: '0 0 10px' }}>{t('session.desc')}</p>
              <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                <Button variant="dangerOutline" onClick={logout}>{t('session.logout')}</Button>
              </div>
            </div>
        </div>

        {/* Cookie Secure: effective policy + what actually applies here,
            plus the panel override editor (persisted via the credential
            record; POST /login-api/cookie-secure) */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🛡️ {t('cookie.title')}</span>
            <Pill tone={secureEffective ? 'success' : (secureState === 'auto-http' ? 'neutral' : 'warn')}>
              {secureEffective ? t('cookie.pill.effective')
                : (secureState === 'off' ? t('cookie.pill.off') : t('cookie.pill.ineffective'))}
            </Pill>
          </div>
          <p style={DESC}>{t('cookie.desc')}</p>
          <p style={{ ...DESC, margin: 0 }}>{t(`cookie.state.${secureState}`)}</p>
          <p style={{ margin: '8px 0 0', fontSize: '12px', lineHeight: '18px', color: T.textTertiary }}>
            {t('cookie.configHint', { mode: String(cookieSecure) })}
            {' · '}
            {cookieSecureSource === 'panel' ? t('cookie.source.panel') : t('cookie.source.deployment')}
          </p>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={String(cookieSecureDraft ?? cookieSecure)}
              onChange={(e) => { const v = e.target.value; setCookieSecureDraft(v === 'true' ? true : v === 'false' ? false : 'auto') }}
              style={{
                height: '32px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${T.border}`,
                background: T.bg1, color: T.textPrimary, fontSize: '13px', lineHeight: '20px',
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none', minWidth: '150px',
              }}
            >
              <option value="auto">{t('cookie.edit.mode.auto')}</option>
              <option value="true">{t('cookie.edit.mode.true')}</option>
              <option value="false">{t('cookie.edit.mode.false')}</option>
            </select>
            <Button variant="primary" onClick={saveCookieSecure} disabled={
              savingCookieSecure || cookieSecureDraft === null || cookieSecureDraft === cookieSecure
            }>
              {savingCookieSecure ? t('cookie.edit.saving') : t('cookie.edit.save')}
            </Button>
            {cookieSecureSource === 'panel' && (
              <Button variant="outline" onClick={resetCookieSecure} disabled={savingCookieSecure}>
                {t('cookie.edit.reset')}
              </Button>
            )}
            {cookieSecureHint !== null && (
              <span style={{ fontSize: '12px', lineHeight: '18px',
                color: cookieSecureHint.tone === 'warn' ? T.danger : T.textSecondary }}>
                {cookieSecureHint.text}
              </span>
            )}
          </div>
        </div>

        {/* About: running version, repository link, new-version notice */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>ℹ️ {t('about.title')}</span>
          </div>
          {versionInfo === null ? (
            <p style={{ ...DESC, margin: 0 }}>{t('about.checking')}</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: '13px', lineHeight: '20px' }}>
                <span style={{ color: T.textSecondary }}>
                  {t('about.version')}
                  {' '}
                  <span style={{ color: T.textPrimary, fontFamily: T.fontCode }}>
                    {versionInfo.version === '' ? t('about.unknown') : 'v' + versionInfo.version}
                  </span>
                </span>
                {versionInfo.repository !== '' && (
                  <span style={{ color: T.textSecondary }}>
                    {t('about.repository')}
                    {' '}
                    <a
                      href={versionInfo.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: T.brand, textDecoration: 'none' }}
                    >{t('about.repositoryLink')}</a>
                  </span>
                )}
              </div>
              {/* Explicit check. Automatic checks are off by default, so this
                  button is the normal way a user learns about a new release;
                  it is also the only thing that makes the outbound request. */}
              <div style={{ marginTop: '12px' }}>
                <Button variant="outline" onClick={checkForUpdates} disabled={checkingUpdate}>
                  {checkingUpdate ? t('about.checking') : t('about.check')}
                </Button>
              </div>
              {/* Result line — one derived notice for all four states
                  (client/src/update-notice.js), so "never checked", "failed"
                  and the two verdicts cannot drift apart. `null` means nothing
                  is known, and the card then claims nothing. */}
              {!checkingUpdate && notice !== null && (
                notice.tone === 'banner' ? (
                  <div style={{
                    marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
                    fontSize: '13px', lineHeight: '20px',
                    background: T.successBg, color: T.success,
                  }}>
                    {notice.text}
                    {notice.href !== '' && (
                      <>
                        {' '}
                        <a
                          href={notice.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: T.success, textDecoration: 'underline' }}
                        >{t('about.releaseNotes')}</a>
                      </>
                    )}
                  </div>
                ) : (
                  <p style={{ ...DESC, margin: '10px 0 0' }}>{notice.text}</p>
                )
              )}
            </>
          )}
        </div>

        {/* Status */}
        {status && (
          <div style={{
            marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
            fontSize: '13px', lineHeight: '20px',
            background: status.type === 'success' ? T.successBg : T.hoverDanger,
            color: status.type === 'success' ? T.success : T.danger,
          }}>
            {status.message}
          </div>
        )}
      </div>

      {/* QR dialog (dsh dialog pattern: mask + blur, rounded panel, footer actions) */}
      {showQRModal && qrData && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '24px',
        }} onClick={closeQRModal}>
          <div style={{ position: 'absolute', inset: 0, background: T.mask1, backdropFilter: T.maskBlur }} />
          <div style={{
            position: 'relative', boxSizing: 'border-box', background: T.bg2,
            borderRadius: '24px', boxShadow: T.shadow3, border: `1px solid ${T.border}`,
            width: 'min(400px, 100%)', maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '20px 24px 4px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 500, color: T.textPrimary }}>
                {t('dialog.title')}
              </h3>
              <Button variant="ghost" onClick={closeQRModal} style={{ height: '28px', width: '28px', padding: 0, borderRadius: '8px' }}>✕</Button>
            </div>
            <div style={{ padding: '0 24px' }}>
              {setupDone ? (
                <>
                  <div style={{
                    margin: '8px 0 16px', padding: '10px 12px', borderRadius: '10px',
                    fontSize: '13px', lineHeight: '20px', color: T.success,
                    background: T.successBg, border: `1px solid ${T.border}`,
                  }}>
                    {t('status.otpEnabled')} — {t('dialog.enabledDesc')}
                  </div>
                  <div style={{ margin: '16px 0' }}>
                    <div style={{ fontSize: '12px', lineHeight: '18px', fontWeight: 500, color: T.textSecondary, marginBottom: '6px' }}>
                      {t('dialog.backupCodesTitle')}
                    </div>
                    <div style={{
                      padding: '8px 12px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '8px',
                      fontFamily: T.fontCode, fontSize: '13px', lineHeight: '22px', color: T.textPrimary,
                    }}>
                      {backupCodes.join('\n')}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: '8px 0 16px', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
                    {t('dialog.desc')}
                  </p>
                  <div style={{ textAlign: 'center', margin: '16px 0' }}>
                    <img src={qrData.svgUrl} alt="OTP QR Code" style={{ border: `1px solid ${T.border}`, borderRadius: '8px', width: '200px', height: '200px' }} />
                  </div>
                  <div style={{ margin: '16px 0' }}>
                    <div style={{ fontSize: '12px', lineHeight: '18px', fontWeight: 500, color: T.textSecondary, marginBottom: '6px' }}>
                      {t('dialog.secret')}
                    </div>
                    <div style={{
                      padding: '8px 12px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '8px',
                      fontFamily: T.fontCode, fontSize: '13px', lineHeight: '20px', color: T.textPrimary, wordBreak: 'break-all',
                    }}>{qrData.secret}</div>
                  </div>
                  <div style={{ margin: '16px 0' }}>
                    <div style={{ fontSize: '12px', lineHeight: '18px', fontWeight: 500, color: T.textSecondary, marginBottom: '6px' }}>
                      {t('dialog.code')}
                    </div>
                    <input
                      type="text" placeholder={t('dialog.codePlaceholder', { digits })} maxLength={digits}
                      value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      style={{ ...INPUT, width: '140px', textAlign: 'center', letterSpacing: '6px', fontFamily: T.fontCode }}
                      {...focusProps}
                      onKeyDown={(e) => { if (e.key === 'Enter') verifyOTPSetup() }}
                    />
                  </div>
                  {status && (
                    <div style={{
                      margin: '12px 0', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: '18px',
                      background: status.type === 'success' ? T.successBg : T.hoverDanger,
                      color: status.type === 'success' ? T.success : T.danger,
                    }}>{status.message}</div>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '0 24px 24px', marginTop: '20px' }}>
              {setupDone ? (
                <Button variant="primary" onClick={() => { location.href = BASE + '/login' }}>{t('dialog.doneBtn')}</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={closeQRModal}>{t('dialog.cancel')}</Button>
                  <Button variant="primary" onClick={verifyOTPSetup} disabled={verifyingOtp}>
                    {verifyingOtp ? t('dialog.verifying') : t('dialog.verify')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Services this plugin's apply() actually uses (ctx.slots, ctx.locale,
 * ctx.connection — declared so the LAN trust getter install below is a
 * legitimate Cordis service access rather than an undeclared read). */
const inject = ['slots', 'locale', 'connection']

/**
 * LAN trust through the official plugin seam.
 *
 * dsh computes `connection.isLoopback` once from `location.hostname` when the
 * connection plugin applies; every settings consumer snapshots it for its
 * host/memory persistence decision. Behind a reverse proxy or LAN IP that
 * value is false, so Models / Credentials / locale preferences fall back to
 * per-browser memory — even though the gateway has already authenticated the
 * page and rewrites Host/Origin to loopback server-side.
 *
 * The previous fix wrapped the module loader to intercept
 * `ctx.provide('connection', ...)`; that global surgery broke coexisting
 * plugins (dsh-better-sidebar's service registration chain). This version
 * stays on the official seam: declare `connection` in inject, then install a
 * getter that always reports trusted. A getter (not a plain write) is used so
 * a consumer whose apply ran before ours still reads true afterwards.
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

// settings.section has no icon field; the shell renders its own fallback.
// We register the section the standard way (ctx.slots.inject) and leave the
// chrome alone — no DOM probing, no style injection.

/**
 * Gateway basePath ('' for root, '/dsh' for sub-path deployments), published
 * as a global by the host plugin's tapIndex injection (index.js). All panel
 * API calls and redirects must go through it so they survive reverse-proxy
 * sub-path deployments — root-absolute paths would bypass the /dsh/ prefix
 * and never reach the gateway.
 */
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
    logout: async () => (await fetch(BASE + '/login/logout', { method: 'POST' })).json(),
  }
  const injected = () => ({ api })
  // Nav position. SlotCore keeps a list slot's entries sorted by
  // (priority, order) with a STABLE sort, and the settings shell re-sorts the
  // same list by `order` alone — so an `order` that EQUALS a shipped entry's is
  // resolved by plugin load order, not by "official first". That is not
  // theoretical: agent-presets ships `order: 20` too, and a tie made this
  // section land before 「Agent 预设」 on one composition and after it on
  // another. dsh ships general 0, models 10, plugins 15, agent-presets 20, so a
  // third-party section must sort strictly above all of them. 100 is the value
  // dsh's own contributed-entry example uses — see `order: 100` in
  // @deepseek-ai/dsh-cordis-client-runner/lib/client.js, and the
  // `settings.section` declaration in
  // @deepseek-ai/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts;
  // both ship inside the installed dsh, so a reader can actually check them.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'user-settings', order: 100,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, UserSettingsPanel))
}

export { apply, inject }
