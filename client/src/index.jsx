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
  'session.title': '登录会话',
  'session.loggedIn': '已登录',
  'session.desc': '会话有效期 30 天；dsh 重启后需重新登录。',
  'session.logout': '退出登录',
  'dialog.title': '设置 OTP 验证器',
  'dialog.desc': '使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码：',
  'dialog.secret': '密钥（手动输入用）',
  'dialog.code': '输入验证码以完成设置',
  'dialog.codePlaceholder': '{digits}位验证码',
  'dialog.verify': '验证并启用',
  'dialog.verifying': '验证中...',
  'dialog.cancel': '取消',
  'status.otpEnabled': 'OTP 已启用',
  'status.otpDisabled': 'OTP 已禁用',
  'status.passwordChanged': '密码修改成功，请重新登录',
  'error.loadSettings': '加载失败: {message}',
  'error.enableOtp': '启用失败: {message}',
  'error.disableOtp': '禁用失败: {message}',
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
  'session.title': 'Session',
  'session.loggedIn': 'Signed in',
  'session.desc': 'Sessions last 30 days; a dsh restart signs everyone out.',
  'session.logout': 'Sign out',
  'dialog.title': 'Set up OTP authenticator',
  'dialog.desc': 'Scan the QR code with Google Authenticator, Authy or another TOTP app:',
  'dialog.secret': 'Secret key (for manual entry)',
  'dialog.code': 'Enter the code to finish setup',
  'dialog.codePlaceholder': '{digits}-digit code',
  'dialog.verify': 'Verify & enable',
  'dialog.verifying': 'Verifying...',
  'dialog.cancel': 'Cancel',
  'status.otpEnabled': 'OTP enabled',
  'status.otpDisabled': 'OTP disabled',
  'status.passwordChanged': 'Password updated — please sign in again',
  'error.loadSettings': 'Failed to load: {message}',
  'error.enableOtp': 'Failed to enable: {message}',
  'error.disableOtp': 'Failed to disable: {message}',
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

/** Small status badge (success tone or neutral). */
function Pill({ children, tone = 'neutral' }) {
  const toneStyle = tone === 'success'
    ? { color: T.success, background: T.successBg }
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

  useEffect(() => { loadSettings() }, [])

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
        setStatus({ type: 'error', message: t('error.disableOtp', { message: data.error || t('error.unknown') }) })
      }
    } catch (err) { setStatus({ type: 'error', message: t('error.disableOtp', { message: err.message }) }) }
    finally { setDisablingOtp(false) }
  }

  function closeQRModal() {
    // Cancel path: just close, keep the panel button in its
    // current state (OTP was not verified here).
    setShowQRModal(false); setQrData(null); setOtpCode(''); setVerifyingOtp(false)
    setStatus(null)
  }

  async function verifyOTPSetup() {
    if (otpCode.length !== digits) { setStatus({ type: 'error', message: t('error.otpCodeLength', { digits }) }); return }
    setVerifyingOtp(true); setStatus(null)
    try {
      const data = await api.verifyOtpSetup(otpCode)
      if (data.ok) {
        setShowQRModal(false); setQrData(null); setOtpCode(''); setVerifyingOtp(false)
        setOtpEnabled(true)
        setStatus({ type: 'success', message: t('status.otpEnabled') })
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
        setTimeout(() => { location.href = '/login' }, 1500)
      } else setStatus({ type: 'error', message: t('error.changePassword', { message: data.error || t('error.unknown') }) })
    } catch (err) { setStatus({ type: 'error', message: t('error.changePassword', { message: err.message }) }) }
    finally { setChangingPassword(false) }
  }

  async function logout() {
    try { await api.logout(); location.href = '/login' }
    catch (err) { setStatus({ type: 'error', message: t('error.logout', { message: err.message }) }) }
  }

  if (loading) {
    return <div style={{ padding: '24px 0', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>{t('loading')}</div>
  }

  return (
    <>
      <div style={{ paddingTop: '4px' }}>
        <h3 style={{
          margin: '0 0 4px', fontSize: '16px', lineHeight: '24px', fontWeight: 500,
          color: T.textPrimary, display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚙️</span>{t('nav')}
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

        {/* Change password */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔑 {t('password.title')}</span>
          </div>
          <p style={DESC}>{t('password.desc')}</p>
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

        {/* Session */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔒 {t('session.title')}</span>
            <Pill>{t('session.loggedIn')}</Pill>
          </div>
          <p style={DESC}>{t('session.desc')}</p>
          <Button variant="dangerOutline" onClick={logout}>{t('session.logout')}</Button>
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
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '0 24px', marginTop: '20px' }}>
              <Button variant="outline" onClick={closeQRModal}>{t('dialog.cancel')}</Button>
              <Button variant="primary" onClick={verifyOTPSetup} disabled={verifyingOtp}>
                {verifyingOtp ? t('dialog.verifying') : t('dialog.verify')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Services this plugin's apply() actually uses (ctx.slots, ctx.locale). */
const inject = ['slots', 'locale']

function apply(ctx) {
  // Dictionaries for the settings section: registered under our own
  // namespace so the slot's `t` seat follows the dsh UI language.
  ctx.locale.register(NS, { zh, en })
  const t = ctx.locale.bind(NS)
  // Gateway access lives in the apply world; the component only sees the
  // api object through the slot's inject face (no direct fetch in props).
  const api = {
    getSettings: async () => (await fetch('/login-api/settings')).json(),
    enableOtp: async () => (await fetch('/otp/enable', { method: 'POST' })).json(),
    verifyOtpSetup: async (otp) => (await fetch('/otp/verify-setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp }),
    })).json(),
    disableOtp: async (payload) => (await fetch('/otp/disable', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })).json(),
    changePassword: async (oldPassword, newPassword) => (await fetch('/login/change', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    })).json(),
    logout: async () => (await fetch('/login/logout', { method: 'POST' })).json(),
  }
  const injected = () => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'user-settings', order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, UserSettingsPanel))
}

export { apply, inject }
