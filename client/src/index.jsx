/**
 * dsh-password-gate client plugin — user settings panel.
 *
 * Source of truth for the browser bundle (built by `client/build.mjs` into
 * `client/index.js`, which is what dsh serves via exports["./client"]).
 * Register the "用户设置" section through the dsh settings slot system.
 */

import { useEffect, useState } from 'react'
// Side-effect import: guarantees the dsh slots module is materialized by the
// client loader before this plugin's apply() runs (declared in dsh.client.inject).
import '@deepseek-ai/dsh-client-ui-slots'

/**
 * User Settings Panel component.
 */
function UserSettingsPanel({ ctx }) {
  const [otpEnabled, setOtpEnabled] = useState(false)
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
      const res = await fetch('/login-api/settings')
      const data = await res.json()
      if (data.ok) setOtpEnabled(data.config?.['dsh-password-gate']?.otpEnabled || false)
    } catch (err) {
      setStatus({ type: 'error', message: '加载失败: ' + err.message })
    } finally { setLoading(false) }
  }

  async function enableOTP() {
    setStatus(null)
    try {
      const res = await fetch('/otp/enable', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setQrData({ secret: data.secret, uri: data.uri, svgUrl: data.svgUrl, backupCodes: data.backupCodes })
        setShowQRModal(true)
        // Do NOT flip the panel button here — OTP is not enabled
        // until the 6-digit code is verified via verify-setup.
      } else {
        setStatus({ type: 'error', message: '启用失败: ' + (data.error || '未知错误') })
      }
    } catch (err) { setStatus({ type: 'error', message: '启用失败: ' + err.message }) }
  }

  async function disableOTP() {
    setStatus(null)
    const code = disableOtpCode.trim()
    if (!code) { setStatus({ type: 'error', message: '请输入当前验证码或备份代码' }); return }
    const isDigits = /^\d{6}$/.test(code)
    const body = isDigits ? { otp: code } : { backupCode: code }
    setDisablingOtp(true)
    try {
      const res = await fetch('/otp/disable', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
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
    if (otpCode.length !== 6) { setStatus({ type: 'error', message: '请输入 6 位验证码' }); return }
    setVerifyingOtp(true); setStatus(null)
    try {
      const res = await fetch('/otp/verify-setup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otp: otpCode }),
      })
      const data = await res.json()
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
      const res = await fetch('/login/change', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      const data = await res.json()
      if (data.ok) {
        setStatus({ type: 'success', message: '密码修改成功，请重新登录' })
        setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('')
        setTimeout(() => { location.href = '/login' }, 1500)
      } else setStatus({ type: 'error', message: '修改失败: ' + (data.error || '未知错误') })
    } catch (err) { setStatus({ type: 'error', message: '修改失败: ' + err.message }) }
    finally { setChangingPassword(false) }
  }

  async function logout() {
    try { await fetch('/login/logout', { method: 'POST' }); location.href = '/login' }
    catch (err) { setStatus({ type: 'error', message: '退出失败: ' + err.message }) }
  }

  if (loading) return <div>加载中...</div>

  const sectionStyle = { marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #f0f0f0' }
  const titleStyle = { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#1a1a1a' }
  const descStyle = { margin: '0 0 12px 0', fontSize: '12px', color: '#8c8c8c', lineHeight: '1.5' }
  const inputStyle = { border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', outline: 'none', width: '100%' }

  return (
    <>
      <div style={{ padding: '20px 0' }}>
        <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', fontWeight: '600', color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚙️</span>用户设置
        </h3>
        {/* OTP */}
        <div style={sectionStyle}>
          <div style={titleStyle}><span>🔐</span>OTP 双因素认证</div>
          <p style={descStyle}>启用后登录需要密码 + 验证码，提高安全性。</p>
          {!otpEnabled ? (
            <button onClick={enableOTP} style={{ background: '#52c41a', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
              启用 OTP
            </button>
          ) : !showDisableOtp ? (
            <button onClick={() => setShowDisableOtp(true)} style={{ background: '#ff4d4f', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
              禁用 OTP
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', background: '#fafafa', borderRadius: '8px' }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#666', lineHeight: '1.5' }}>输入当前 6 位验证码或一个未使用的备份代码以确认禁用：</p>
              <input
                type="text" placeholder="6位验证码或备份代码"
                value={disableOtpCode} onChange={(e) => setDisableOtpCode(e.target.value)}
                style={inputStyle} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') disableOTP() }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button onClick={disableOTP} disabled={disablingOtp} style={{ background: '#ff4d4f', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: disablingOtp ? 'not-allowed' : 'pointer', opacity: disablingOtp ? 0.6 : 1 }}>
                  {disablingOtp ? '禁用中...' : '确认禁用'}
                </button>
                <button onClick={() => { setShowDisableOtp(false); setDisableOtpCode('') }} style={{ background: 'transparent', color: '#666', border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Change Password */}
        <div style={sectionStyle}>
          <div style={titleStyle}><span>🔑</span>修改密码</div>
          <p style={descStyle}>修改您的登录密码。</p>
          {!showChangePassword ? (
            <button onClick={() => setShowChangePassword(true)} style={{ background: '#1677ff', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
              修改密码
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: '#fafafa', borderRadius: '8px' }}>
              <input type="password" placeholder="当前密码" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} style={inputStyle} />
              <input type="password" placeholder="新密码（至少 8 位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
              <input type="password" placeholder="确认新密码" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button onClick={changePassword} disabled={changingPassword} style={{ background: '#1677ff', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: changingPassword ? 'not-allowed' : 'pointer', opacity: changingPassword ? 0.6 : 1 }}>
                  {changingPassword ? '修改中...' : '确认修改'}
                </button>
                <button onClick={() => { setShowChangePassword(false); setOldPassword(''); setNewPassword(''); setConfirmPassword('') }} style={{ background: 'white', color: '#666', border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
        {/* Logout */}
        <div style={{ paddingTop: '4px' }}>
          <button
            onClick={logout}
            style={{ background: 'white', color: '#ff4d4f', border: '1px solid #ff4d4f', borderRadius: '6px', padding: '7px 15px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', boxSizing: 'border-box' }}
            onMouseEnter={(e) => { e.target.style.background = '#ff4d4f'; e.target.style.color = 'white' }}
            onMouseLeave={(e) => { e.target.style.background = 'white'; e.target.style.color = '#ff4d4f' }}
          >
            退出登录
          </button>
        </div>
        {/* Status */}
        {status && (
          <div style={{ marginTop: '16px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '500', background: status.type === 'success' ? '#f6ffed' : '#fff2f0', border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`, color: status.type === 'success' ? '#52c41a' : '#ff4d4f' }}>
            {status.message}
          </div>
        )}
      </div>
      {/* QR Modal */}
      {showQRModal && qrData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={closeQRModal}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', maxWidth: '400px', width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }}>设置 OTP 验证器</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#666' }}>使用 Google Authenticator、Authy 或其他 TOTP 应用扫描以下二维码：</p>
            <div style={{ textAlign: 'center', margin: '16px 0' }}>
              <img src={qrData.svgUrl} alt="OTP QR Code" style={{ border: '1px solid #e8e8e8', borderRadius: '8px', width: '200px', height: '200px' }} />
            </div>
            <div style={{ margin: '16px 0' }}>
              <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '8px' }}>密钥（手动输入用）：</div>
              <div style={{ padding: '8px 12px', background: '#f6f8fa', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>{qrData.secret}</div>
            </div>
            <div style={{ margin: '16px 0' }}>
              <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: '8px' }}>输入验证码以完成设置：</div>
              <input
                type="text" placeholder="6位验证码" maxLength={6}
                value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                style={{ border: '1px solid #d9d9d9', borderRadius: '6px', padding: '8px 12px', fontSize: '14px', outline: 'none', width: '140px', textAlign: 'center', letterSpacing: '6px', fontFamily: 'monospace' }}
                onKeyDown={(e) => { if (e.key === 'Enter') verifyOTPSetup() }}
              />
            </div>
            {status && (
              <div style={{ margin: '12px 0', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: status.type === 'success' ? '#f6ffed' : '#fff2f0', border: `1px solid ${status.type === 'success' ? '#b7eb8f' : '#ffccc7'}`, color: status.type === 'success' ? '#52c41a' : '#ff4d4f' }}>
                {status.message}
              </div>
            )}
            <button onClick={verifyOTPSetup} disabled={verifyingOtp} style={{ width: '100%', marginTop: '8px', padding: '10px', background: '#52c41a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: verifyingOtp ? 'not-allowed' : 'pointer', opacity: verifyingOtp ? 0.6 : 1 }}>
              {verifyingOtp ? '验证中...' : '验证并启用'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const inject = ['slots', 'connection', 'remote', 'settingsScope']

function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'user-settings', order: 20,
    label: () => '用户设置', locale: 'dsh-password-gate',
  }, UserSettingsPanel))
}

export { apply, inject }
