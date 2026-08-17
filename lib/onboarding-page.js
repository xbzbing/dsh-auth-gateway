/**
 * Onboarding page: shown after logging in with the auto-generated initial
 * password. Step 1 (mandatory): set a personal password — all access stays
 * blocked until it is replaced. Step 2 (optional): bind a TOTP authenticator
 * via the OTP setup flow.
 *
 * The render locale ('zh' default, 'en') is resolved by the gateway
 * (lib/locale.js) and selects the UI copy and the script-head error map.
 *
 * Scaffolding (base CSS, HTML skeleton, script head) lives in ./page-shell.js.
 */

import { baseStyle, scriptHead, strengthErrorScript, makePage } from './page-shell.js'

/** Page-specific CSS on top of the shared base. */
const STYLE = baseStyle + `
.card { width: min(420px, calc(100vw - 32px)); }
p.sub { margin: 0 0 16px; line-height: 1.6; }
.step { margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px; }
.step h3 { margin: 0 0 6px; font-size: 14px; }
.step p { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.6; }
@media (prefers-color-scheme: dark) { .step { background: #1d1f24; } }
`

/** UI copy per locale. */
const STR = {
  zh: {
    title: '设置你的访问密码',
    sub: '当前使用的是系统自动生成的初始密码，为保证安全，请先设置你自己的密码。设置完成前，所有功能暂不可用。',
    step1H3: '1. 设置新密码（必填）',
    step1P: '至少 8 位，且包含大小写字母或特殊字符。',
    labelOld: '初始密码',
    labelNew: '新密码',
    labelConfirm: '确认新密码',
    btnSubmit: '设置新密码',
    step2H3: '2. 绑定 OTP 双因素认证（可选）',
    step2POn: '建议绑定认证器应用（Google Authenticator、Authy 等），登录时除密码外还需输入动态验证码。可在登录后随时通过"认证设置"面板或 /otp/setup 启用。',
    step2POff: '当前部署未启用 OTP 功能；如需使用双因素认证，请在配置中设置 otpEnabled: true。',
    btnBind: '前往绑定 OTP',
  },
  en: {
    title: 'Set your access password',
    sub: 'You are currently using an auto-generated initial password. Set your own password first — everything stays locked until then.',
    step1H3: '1. Set a new password (required)',
    step1P: 'At least 8 characters, with mixed case or a special character.',
    labelOld: 'Initial password',
    labelNew: 'New password',
    labelConfirm: 'Confirm new password',
    btnSubmit: 'Set new password',
    step2H3: '2. Bind a TOTP authenticator (optional)',
    step2POn: 'Recommended: bind an authenticator app (Google Authenticator, Authy, ...). Login will then require a verification code as well. You can also enable it later from the Auth Settings panel or /otp/setup.',
    step2POff: 'OTP is not enabled in this deployment; set otpEnabled: true in the configuration to use two-factor authentication.',
    btnBind: 'Bind OTP',
  },
}

/** Server error code → user-facing message, per locale. */
const ERRORS = {
  zh: {
    'invalid-password': '当前密码错误',
    'password-too-short': '新密码至少需要 8 位',
    'password-too-simple': '新密码需包含大小写字母或特殊字符',
    'unauthenticated': '登录状态已失效，请重新登录',
    'password-mismatch': '两次输入的新密码不一致',
    'bad-payload': '请求参数不正确',
  },
  en: {
    'invalid-password': 'Wrong current password',
    'password-too-short': 'New password must be at least 8 characters',
    'password-too-simple': 'New password needs mixed case or a special character',
    'unauthenticated': 'Your session has expired, please sign in again',
    'password-mismatch': 'The new passwords do not match',
    'bad-payload': 'Invalid request parameters',
  },
}

/**
 * Script head (ERRORS + post) followed by strength check and form wiring.
 * The mismatch message resolves through ERRORS so the script stays
 * locale-agnostic apart from the error map.
 */
function buildScript(locale) {
  return scriptHead(ERRORS[locale]) + strengthErrorScript() + `
document.getElementById('change-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const err = document.getElementById('error')
  err.textContent = ''
  const f = document.getElementById('change-form')
  if (f.newPassword.value !== f.confirm.value) {
    err.textContent = ERRORS['password-mismatch']
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
}

const page = (locale) => makePage(STYLE, buildScript(locale))

/**
 * Render the onboarding page.
 * @param {object} options - `{ otpEnabled }`: whether OTP binding is offered;
 *   `{ locale }`: 'zh' (default) or 'en'.
 */
export function onboardingPageHtml({ otpEnabled = false, locale = 'zh' } = {}) {
  const str = STR[locale] || STR.zh
  const otpStep = otpEnabled ? `
<div class="step">
  <h3>${str.step2H3}</h3>
  <p>${str.step2POn}</p>
  <button class="secondary" type="button" onclick="location.href='/otp/setup'" style="margin-top:10px">${str.btnBind}</button>
</div>` : `
<div class="step">
  <h3>${str.step2H3}</h3>
  <p>${str.step2POff}</p>
</div>`
  return page(locale)(str.title, str.sub, `
<form id="change-form">
  <div class="step">
    <h3>${str.step1H3}</h3>
    <p>${str.step1P}</p>
    <label for="oldPassword">${str.labelOld}</label>
    <input id="oldPassword" type="password" autocomplete="current-password" required>
    <label for="newPassword">${str.labelNew}</label>
    <input id="newPassword" type="password" autocomplete="new-password" required>
    <label for="confirm">${str.labelConfirm}</label>
    <input id="confirm" type="password" autocomplete="new-password" required>
    <button type="submit">${str.btnSubmit}</button>
  </div>
</form>
${otpStep}`, '')
}
