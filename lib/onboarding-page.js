/**
 * Onboarding page: shown after logging in with the auto-generated initial
 * password. Step 1 (mandatory): set a personal password — all access stays
 * blocked until it is replaced. Step 2 (optional): bind a TOTP authenticator
 * via the OTP setup flow.
 *
 * Scaffolding (base CSS, HTML skeleton, script head) lives in ./page-shell.js.
 */

import { baseStyle, scriptHead, makePage } from './page-shell.js'

/** Page-specific CSS on top of the shared base. */
const STYLE = baseStyle + `
.card { width: min(420px, calc(100vw - 32px)); }
p.sub { margin: 0 0 16px; line-height: 1.6; }
.step { margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px; }
.step h3 { margin: 0 0 6px; font-size: 14px; }
.step p { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.6; }
@media (prefers-color-scheme: dark) { .step { background: #1d1f24; } }
`

/** Server error code → user-facing message (script head). */
const ERRORS = {
  'invalid-password': '当前密码错误',
  'password-too-short': '新密码至少需要 8 位',
  'password-too-simple': '新密码需包含大小写字母或特殊字符',
  'unauthenticated': '登录状态已失效，请重新登录',
  'bad-payload': '请求参数不正确',
}

/** Script head (ERRORS + post) followed by the change-form wiring. */
const SCRIPT = scriptHead(ERRORS) + `
function strengthError(pw) {
  if (!pw || pw.length < 8) return ERRORS['password-too-short']
  const hasMixed = /[a-z]/.test(pw) && /[A-Z]/.test(pw)
  const hasSpecial = /[^A-Za-z0-9]/.test(pw)
  if (!hasMixed && !hasSpecial) return ERRORS['password-too-simple']
  return null
}
document.getElementById('change-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = document.getElementById('error')
  err.textContent = ''
  const f = document.getElementById('change-form')
  if (f.newPassword.value !== f.confirm.value) {
    err.textContent = '两次输入的新密码不一致'
    return
  }
  const weak = strengthError(f.newPassword.value)
  if (weak) { err.textContent = weak; return }
  const btn = f.querySelector('button[type=submit]')
  btn.disabled = true
  try {
    await post('/login/change', { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value })
    // Password replaced: every session was revoked, so head to the login page.
    location.href = '/login'
  } catch (ex) {
    err.textContent = ex.message
    btn.disabled = false
  }
})
`

const page = makePage(STYLE, SCRIPT)

/**
 * Render the onboarding page.
 * @param {object} options - `{ otpEnabled }`: whether OTP binding is offered.
 */
export function onboardingPageHtml({ otpEnabled = false } = {}) {
  const otpStep = otpEnabled ? `
<div class="step">
  <h3>2. 绑定 OTP 双因素认证（可选）</h3>
  <p>建议绑定认证器应用（Google Authenticator、Authy 等），登录时除密码外还需输入动态验证码。可在登录后随时通过"认证设置"面板或 /otp/setup 启用。</p>
  <button class="secondary" type="button" onclick="location.href='/otp/setup'" style="margin-top:10px">前往绑定 OTP</button>
</div>` : `
<div class="step">
  <h3>2. 绑定 OTP 双因素认证（可选）</h3>
  <p>当前部署未启用 OTP 功能；如需使用双因素认证，请在配置中设置 otpEnabled: true。</p>
</div>`
  return page('设置你的访问密码', '当前使用的是系统自动生成的初始密码，为保证安全，请先设置你自己的密码。设置完成前，所有功能暂不可用。', `
<form id="change-form">
  <div class="step">
    <h3>1. 设置新密码（必填）</h3>
    <p>至少 8 位，且包含大小写字母或特殊字符。</p>
    <label for="oldPassword">初始密码</label>
    <input id="oldPassword" type="password" autocomplete="current-password" required>
    <label for="newPassword">新密码</label>
    <input id="newPassword" type="password" autocomplete="new-password" required>
    <label for="confirm">确认新密码</label>
    <input id="confirm" type="password" autocomplete="new-password" required>
    <button type="submit">设置新密码</button>
  </div>
</form>
${otpStep}`, '')
}
