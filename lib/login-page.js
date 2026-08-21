/**
 * The login page: a zero-build, self-contained HTML page (inline CSS + plain
 * fetch JS). The gateway serves it at GET /login with a mode chosen by
 * server-side state:
 *
 *   auth   — log in (password, plus OTP when 2FA is active)
 *   change — already logged in: change password / log out
 *
 * The render locale ('zh' default, 'en') is resolved by the gateway
 * (lib/locale.js) and selects the UI copy and the script-head error map.
 *
 * Scaffolding (base CSS, HTML skeleton, script head) lives in ./page-shell.js.
 */

import { baseStyle, scriptHead, strengthErrorScript, makePage } from './page-shell.js'
import { errorsFor } from './errors.js'

/** Page-specific CSS on top of the shared base. */
const STYLE = baseStyle + `
.card { width: min(360px, calc(100vw - 32px)); }
p.sub { margin: 0 0 20px; }
`

/** UI copy per locale. */
const STR = {
  zh: {
    titleAuth: '登录',
    subAuth: '请输入访问密码以继续。',
    subAuthOtp: '请输入密码和 OTP 验证码以继续。',
    titleChange: '已登录',
    subChange: '修改密码后所有会话将下线，需要重新登录。',
    labelPassword: '密码',
    labelOtp: 'OTP 验证码',
    placeholderOtp: 'OTP 验证码',
    labelBackup: '备份代码',
    labelOld: '当前密码',
    labelNew: '新密码',
    labelConfirm: '确认新密码',
    btnLogin: '登录',
    btnChange: '修改密码',
    btnLogout: '登出',
    btnToggleBackup: '使用备份代码登录',
    btnToggleOtp: '使用 OTP 验证码',
    placeholderBackup: '一次性备份代码',
    changeSuccessTitle: '密码已修改',
    changeSuccessSub: '所有会话已下线，请重新登录。',
    changeSuccessBtn: '重新登录',
  },
  en: {
    titleAuth: 'Sign in',
    subAuth: 'Enter your access password to continue.',
    subAuthOtp: 'Enter your password and the OTP code to continue.',
    titleChange: 'Signed in',
    subChange: 'All sessions will be revoked after the password change; please sign in again.',
    labelPassword: 'Password',
    labelOtp: 'OTP code',
    placeholderOtp: 'OTP code',
    labelBackup: 'Backup code',
    labelOld: 'Current password',
    labelNew: 'New password',
    labelConfirm: 'Confirm new password',
    btnLogin: 'Sign in',
    btnChange: 'Change password',
    btnLogout: 'Sign out',
    btnToggleBackup: 'Use a backup code to sign in',
    btnToggleOtp: 'Use the OTP code',
    placeholderBackup: 'One-time backup code',
    changeSuccessTitle: 'Password changed',
    changeSuccessSub: 'All sessions were revoked. Please sign in again.',
    changeSuccessBtn: 'Sign in again',
  },
}

/** Error codes this page may surface (messages come from lib/errors.js). */
const ERROR_KEYS = [
  'invalid-password', 'invalid-credentials', 'password-too-short',
  'password-too-simple', 'too-many-attempts', 'rate-limited',
  'unauthenticated', 'password-required', 'otp-required',
  'invalid-otp', 'invalid-backup-code', 'backup-code-required',
  'otp-secret-missing', 'password-mismatch', 'otp-length', 'bad-payload',
]

/** Login-context rewording for shared keys. */
const ERROR_OVERRIDES = {
  'too-many-attempts': {
    zh: '密码错误次数过多，已暂时锁定，请稍后再试',
    en: 'Too many failed attempts — locked temporarily, try again later',
  },
}

/**
 * Script head (ERRORS + post) followed by shared helpers and wiring. The
 * strength check and the wire() messages resolve through ERRORS, so the
 * whole prologue is locale-agnostic apart from the error map itself.
 */
function buildScript(locale, basePath) {
  // Normalize: '/' and '' both mean root (''); gateway already passes '/dsh' style prefixes
  const bp = basePath === '/' || basePath === '' ? '' : basePath
  return scriptHead(errorsFor(locale, ERROR_KEYS, ERROR_OVERRIDES)) + strengthErrorScript() + `
const __basePath = ${JSON.stringify(bp)};
// opts: { strengthField } names the payload field to strength-check (pass
// undefined for forms that must not be checked — login: the old password may
// predate the policy); { confirmField } names the payload field that must
// equal the strength field (passwords are entered twice to catch typos).
// The server remains the authority — this is early feedback only.
function wire(formId, path, build, onOk, opts) {
  const form = document.getElementById(formId)
  if (!form) return
  const err = document.getElementById('error')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    err.textContent = ''
    const btn = form.querySelector('button[type=submit]')
    const payload = build(form)
    if (opts && opts.strengthField !== undefined) {
      const weak = strengthError(payload[opts.strengthField])
      if (weak) { err.textContent = weak; return }
    }
    if (opts && opts.confirmField !== undefined) {
      if (payload[opts.confirmField] !== payload[opts.strengthField]) {
        err.textContent = ERRORS['password-mismatch']
        return
      }
    }
    // Forms that carry an OTP field (login with 2FA) must have a full code:
    // the server requires it whenever 2FA is active (the gateway derives
    // otpRequired as config-or-active, so an enabled OTP always verifies).
    if (payload.otp !== undefined && payload.otp.length !== (opts?.otpDigits ?? 6)) {
      err.textContent = ERRORS['otp-length'].replace('{digits}', opts?.otpDigits ?? 6)
      return
    }
    if (payload.backupCode !== undefined && payload.backupCode.length === 0) {
      err.textContent = ERRORS['backup-code-required']
      return
    }
    btn.disabled = true
    try {
      const data = await post(path, payload)
      if (onOk) onOk(data)
      else location.href = __basePath + '/'   // login success: straight into the app
    } catch (ex) {
      err.textContent = ex.message
      btn.disabled = false
    }
  })
}
`
}

const page = (locale, basePath) => makePage(STYLE, buildScript(locale, basePath), locale === 'en' ? 'en' : 'zh-CN')

const SCRIPT_AUTH = (digits, str) => `
// With 2FA active the form carries a TOTP code or, for a lost authenticator,
// a single-use backup code (toggle below). The server accepts both.
function authPayload(f) {
  if (f.getAttribute('data-mode') === 'backup') {
    return { password: f.password.value, backupCode: f.otp.value }
  }
  // The plain login form has no #otp input; only the 2FA form carries one.
  return { password: f.password.value, otp: f.otp ? f.otp.value : undefined }
}
wire('auth', __basePath + '/login/auth', authPayload, () => {
  // Login success: straight into the app. (A session that still owes OTP
  // verification is redirected server-side on its next request.)
  location.href = __basePath + '/'
}, { otpDigits: ${digits} })

const toggle = document.getElementById('toggle-otp')
if (toggle) {
  toggle.addEventListener('click', () => {
    const form = document.getElementById('auth')
    const mode = form.getAttribute('data-mode') === 'backup' ? 'otp' : 'backup'
    form.setAttribute('data-mode', mode)
    const label = document.querySelector('label[for=otp]')
    const field = document.getElementById('otp')
    field.value = ''
    if (mode === 'backup') {
      toggle.textContent = '${str.btnToggleOtp}'
      if (label) label.textContent = '${str.labelBackup}'
      field.removeAttribute('pattern')
      field.maxLength = 64
      field.inputMode = 'text'
      field.placeholder = '${str.placeholderBackup}'
    } else {
      toggle.textContent = '${str.btnToggleBackup}'
      if (label) label.textContent = '${str.labelOtp}'
      field.setAttribute('pattern', '[0-9]{${digits}}')
      field.maxLength = ${digits}
      field.inputMode = 'numeric'
      field.placeholder = '${str.placeholderOtp}'
    }
    field.focus()
  })
}
`

const SCRIPT_CHANGE = (str) => `
wire('change', __basePath + '/login/change', (f) => ({
  oldPassword: f.oldPassword.value,
  newPassword: f.newPassword.value,
  confirm: f.confirm.value,
}), () => {
  document.getElementById('card').innerHTML =
    '<h1>${str.changeSuccessTitle}</h1><p class="sub">${str.changeSuccessSub}</p>' +
    '<button onclick="location.reload()">${str.changeSuccessBtn}</button>'
}, { strengthField: 'newPassword', confirmField: 'confirm' })
document.getElementById('logout').addEventListener('click', async () => {
  try { await post(__basePath + '/login/logout', {}) } catch { /* ignore */ }
  location.reload()
})
`

/** Render the page for the given mode. */
export function loginPageHtml({ mode, otpEnabled = false, digits = 6, locale = 'zh', basePath = '/' }) {
  const str = STR[locale] || STR.zh
  const render = page(locale, basePath)
  if (mode === 'change') {
    return render(str.titleChange, str.subChange, `
<form id="change">
  <label for="oldPassword">${str.labelOld}</label>
  <input id="oldPassword" type="password" autocomplete="current-password" required>
  <label for="newPassword">${str.labelNew}</label>
  <input id="newPassword" type="password" autocomplete="new-password" required>
  <label for="confirm">${str.labelConfirm}</label>
  <input id="confirm" type="password" autocomplete="new-password" required>
  <button type="submit">${str.btnChange}</button>
</form>
<button class="secondary" id="logout" type="button" style="margin-top:8px">${str.btnLogout}</button>`, SCRIPT_CHANGE(str))
  }
  // mode === 'auth' (default)
  if (otpEnabled) {
    // The OTP field is mandatory: whenever 2FA is active the server verifies
    // it at login, so the form enforces a full code before submission. The
    // same input doubles as a backup-code field (lost authenticator).
    return render(str.titleAuth, str.subAuthOtp, `
<form id="auth" data-mode="otp">
  <label for="password">${str.labelPassword}</label>
  <input id="password" type="password" autocomplete="current-password" required>
  <label for="otp">${str.labelOtp}</label>
  <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" inputmode="numeric" autocomplete="one-time-code" required placeholder="${str.placeholderOtp}">
  <button type="submit">${str.btnLogin}</button>
</form>
<button class="secondary" id="toggle-otp" type="button" style="margin-top:8px">${str.btnToggleBackup}</button>`, SCRIPT_AUTH(digits, str))
  }
  return render(str.titleAuth, str.subAuth, `
<form id="auth">
  <label for="password">${str.labelPassword}</label>
  <input id="password" type="password" autocomplete="current-password" required>
  <button type="submit">${str.btnLogin}</button>
</form>`, SCRIPT_AUTH(digits, str))
}
