/**
 * dsh-auth-gateway client plugin — user settings panel.
 *
 * Source of truth for the browser bundle (built by `client/build.mjs` into
 * `client/index.js`, which is what dsh serves via exports["./client"]).
 *
 * Contract notes (packages/client/AGENTS.md):
 * - ctx belongs to the apply world only — the component receives everything
 *   through props. All gateway access is wrapped in `api` inside apply() and
 *   delivered via the slot's inject face, so the component never fetches
 *   directly and stays injectable/testable.
 * - `inject` lists only the services apply() actually uses (`slots`), aligned
 *   with dsh.client.inject in package.json.
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
 * User Settings Panel component. Receives the gateway API via the
 * settings.section inject face — no ctx, no direct fetch.
 */
function UserSettingsPanel({ api }) {
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
      setStatus({ type: 'error', message: '加载失败: ' + err.message })
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
        setStatus({ type: 'error', message: '启用失败: ' + (data.error || '未知错误') })
      }
    } catch (err) { setStatus({ type: 'error', message: '启用失败: ' + err.message }) }
  }

  async function disableOTP() {
    setStatus(null)
    const code = disableOtpCode.trim()
    if (!code) { setStatus({ type: 'error', message: '请输入当前验证码或备份代码' }); return }
    const isDigits = new RegExp('^\\d{' + digits + '}$').test(code)
    const body = isDigits ? { otp: code } : { backupCode: code }
    setDisablingOtp(true)
    try {
      const data = await api.disableOtp(body)
      if (data.ok) {
        setStatus({ type: 'success', message: 'OTP 已禁用' })
        setOtpEnabled(false)
        setShowDisableOtp(false)
        setDisableOtpCode('')
      } else {
        setStatus({ type: 'error', message: '禁用失败: ' + (data.error || '未知错误') })
      }
    } catch (err) { setStatus({ type: 'error', message: '禁用失败: ' + err.message }) }
    finally { setDisablingOtp(false) }
  }

  function closeQRModal() {
    // Cancel path: just close, keep the panel button in its
    // current state (OTP was not verified here).
    setShowQRModal(false); setQrData(null); setOtpCode(''); setVerifyingOtp(false)
    setStatus(null)
  }

  async function verifyOTPSetup() {
    if (otpCode.length !== digits) { setStatus({ type: 'error', message: '请输入 ' + digits + ' 位验证码' }); return }
    setVerifyingOtp(true); setStatus(null)
    try {
      const data = await api.verifyOtpSetup(otpCode)
      if (data.ok) {
        setShowQRModal(false); setQrData(null); setOtpCode(''); setVerifyingOtp(false)
        setOtpEnabled(true)
        setStatus({ type: 'success', message: 'OTP 已启用' })
      } else {
        setStatus({ type: 'error', message: '验证失败: ' + (data.error || '验证码错误') })
      }
    } catch (err) {
      setStatus({ type: 'error', message: '验证失败: ' + err.message })
    } finally {
      setVerifyingOtp(false)
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { setStatus({ type: 'error', message: '两次输入的密码不一致' }); return }
    if (newPassword.length < 8) { setStatus({ type: 'error', message: '密码至少需要 8 位' }); return }
    setChangingPassword(true); setStatus(null)
    try {
      const data = await api.changePassword(oldPassword, newPassword)
      if (data.ok) {
        setStatus({ type: 'success', message: '密码修改成功，请重新登录' })
        setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('')
        setTimeout(() => { location.href = '/login' }, 1500)
      } else setStatus({ type: 'error', message: '修改失败: ' + (data.error || '未知错误') })
    } catch (err) { setStatus({ type: 'error', message: '修改失败: ' + err.message }) }
    finally { setChangingPassword(false) }
  }

  async function logout() {
    try { await api.logout(); location.href = '/login' }
    catch (err) { setStatus({ type: 'error', message: '退出失败: ' + err.message }) }
  }

  if (loading) {
    return <div style={{ padding: '24px 0', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>加载中...</div>
  }

  return (
    <>
      <div style={{ paddingTop: '4px' }}>
        <h3 style={{
          margin: '0 0 4px', fontSize: '16px', lineHeight: '24px', fontWeight: 500,
          color: T.textPrimary, display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚙️</span>认证设置
        </h3>
        <p style={{ ...DESC, margin: '0 0 16px' }}>管理登录密码、双因素认证与登录会话。</p>

        {/* OTP two-factor */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔐 OTP 双因素认证</span>
            {otpEnabled ? <Pill tone="success">已启用</Pill> : <Pill>未启用</Pill>}
          </div>
          <p style={DESC}>启用后登录需要密码 + 验证码；兼容 Google Authenticator、Authy 等 TOTP 应用，并提供一次性备份代码。</p>
          {!otpEnabled ? (
            <Button variant="primary" onClick={enableOTP}>启用 OTP</Button>
          ) : !showDisableOtp ? (
            <Button variant="dangerOutline" onClick={() => setShowDisableOtp(true)}>禁用 OTP</Button>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
              background: T.bg2, borderRadius: '10px', border: `1px solid ${T.border}`,
            }}>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
                输入当前 {digits} 位验证码或一个未使用的备份代码以确认禁用：
              </p>
              <input
                type="text" placeholder="验证码或备份代码"
                value={disableOtpCode} onChange={(e) => setDisableOtpCode(e.target.value)}
                style={INPUT} autoFocus {...focusProps}
                onKeyDown={(e) => { if (e.key === 'Enter') disableOTP() }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="danger" onClick={disableOTP} disabled={disablingOtp}>
                  {disablingOtp ? '禁用中...' : '确认禁用'}
                </Button>
                <Button variant="outline" onClick={() => { setShowDisableOtp(false); setDisableOtpCode('') }}>取消</Button>
              </div>
            </div>
          )}
        </div>

        {/* Change password */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔑 登录密码</span>
          </div>
          <p style={DESC}>修改后所有会话将下线，需要重新登录。</p>
          {!showChangePassword ? (
            <Button variant="primary" onClick={() => setShowChangePassword(true)}>修改密码</Button>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
              background: T.bg2, borderRadius: '10px', border: `1px solid ${T.border}`,
            }}>
              <input type="password" placeholder="当前密码" value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)} style={INPUT} {...focusProps} />
              <input type="password" placeholder="新密码（至少 8 位，含大小写字母或特殊字符）" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} style={INPUT} {...focusProps} />
              <input type="password" placeholder="确认新密码" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} style={INPUT} {...focusProps}
                onKeyDown={(e) => { if (e.key === 'Enter') changePassword() }} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="primary" onClick={changePassword} disabled={changingPassword}>
                  {changingPassword ? '修改中...' : '确认修改'}
                </Button>
                <Button variant="outline" onClick={() => { setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('') }}>取消</Button>
              </div>
            </div>
          )}
        </div>

        {/* Session */}
        <div style={CARD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={CARD_TITLE}>🔒 登录会话</span>
            <Pill>已登录</Pill>
          </div>
          <p style={DESC}>会话有效期 30 天；dsh 重启后需重新登录。</p>
          <Button variant="dangerOutline" onClick={logout}>退出登录</Button>
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
                设置 OTP 验证器
              </h3>
              <Button variant="ghost" onClick={closeQRModal} style={{ height: '28px', width: '28px', padding: 0, borderRadius: '8px' }}>✕</Button>
            </div>
            <div style={{ padding: '0 24px' }}>
              <p style={{ margin: '8px 0 16px', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
                使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码：
              </p>
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <img src={qrData.svgUrl} alt="OTP QR Code" style={{ border: `1px solid ${T.border}`, borderRadius: '8px', width: '200px', height: '200px' }} />
              </div>
              <div style={{ margin: '16px 0' }}>
                <div style={{ fontSize: '12px', lineHeight: '18px', fontWeight: 500, color: T.textSecondary, marginBottom: '6px' }}>
                  密钥（手动输入用）
                </div>
                <div style={{
                  padding: '8px 12px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '8px',
                  fontFamily: T.fontCode, fontSize: '13px', lineHeight: '20px', color: T.textPrimary, wordBreak: 'break-all',
                }}>{qrData.secret}</div>
              </div>
              <div style={{ margin: '16px 0' }}>
                <div style={{ fontSize: '12px', lineHeight: '18px', fontWeight: 500, color: T.textSecondary, marginBottom: '6px' }}>
                  输入验证码以完成设置
                </div>
                <input
                  type="text" placeholder={digits + '位验证码'} maxLength={digits}
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
              <Button variant="outline" onClick={closeQRModal}>取消</Button>
              <Button variant="primary" onClick={verifyOTPSetup} disabled={verifyingOtp}>
                {verifyingOtp ? '验证中...' : '验证并启用'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Services this plugin's apply() actually uses (ctx.slots only). */
const inject = ['slots']

function apply(ctx) {
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
    label: () => '认证设置',
    inject: injected,
  }, UserSettingsPanel))
}

export { apply, inject }
