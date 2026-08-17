/**
 * The login page: a zero-build, self-contained HTML page (inline CSS + plain
 * fetch JS). The gateway serves it at GET /login with a mode chosen by
 * server-side state:
 *
 *   auth   — log in (password, plus OTP when 2FA is active)
 *   change — already logged in: change password / log out
 *
 * Scaffolding (base CSS, HTML skeleton, script head) lives in ./page-shell.js.
 */

import { baseStyle, scriptHead, strengthErrorScript, makePage } from './page-shell.js'

/** Page-specific CSS on top of the shared base. */
const STYLE = baseStyle + `
.card { width: min(360px, calc(100vw - 32px)); }
p.sub { margin: 0 0 20px; }
`

/** Server error code → user-facing message (script head). */
const ERRORS = {
  'invalid-password': '密码错误',
  'password-too-short': '密码至少需要 8 位',
  'password-too-simple': '密码需包含大小写字母或特殊字符',
  'too-many-attempts': '密码错误次数过多，已暂时锁定，请稍后再试',
  'rate-limited': '尝试过于频繁，请稍后再试',
  'unauthenticated': '登录状态已失效，请重新登录',
  'password-required': '请输入密码',
  'otp-required': '请输入 OTP 验证码或备份代码',
  'invalid-otp': '验证码错误',
  'invalid-backup-code': '备份代码错误或已使用',
  'backup-code-required': '请输入备份代码',
  'otp-secret-missing': 'OTP 配置异常，请联系管理员',
  'bad-payload': '请求参数不正确',
}

/** Script head (ERRORS + post) followed by shared helpers and wiring. */
const SCRIPT = scriptHead(ERRORS) + strengthErrorScript() + `
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
        err.textContent = '两次输入的密码不一致'
        return
      }
    }
    // Forms that carry an OTP field (login with 2FA) must have a full code:
    // the server requires it whenever 2FA is active (the gateway derives
    // otpRequired as config-or-active, so an enabled OTP always verifies).
    if (payload.otp !== undefined && payload.otp.length !== (opts?.otpDigits ?? 6)) {
      err.textContent = '请输入 ' + (opts?.otpDigits ?? 6) + ' 位 OTP 验证码'
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
      else location.href = '/'   // login success: straight into the app
    } catch (ex) {
      err.textContent = ex.message
      btn.disabled = false
    }
  })
}
`

const page = makePage(STYLE, SCRIPT)

const SCRIPT_AUTH = (digits = 6) => `
// With 2FA active the form carries a TOTP code or, for a lost authenticator,
// a single-use backup code (toggle below). The server accepts both.
function authPayload(f) {
  if (f.getAttribute('data-mode') === 'backup') {
    return { password: f.password.value, backupCode: f.otp.value }
  }
  // The plain login form has no #otp input; only the 2FA form carries one.
  return { password: f.password.value, otp: f.otp ? f.otp.value : undefined }
}
wire('auth', '/login/auth', authPayload, (data) => {
  if (data && data.otpRequired) {
    location.href = '/otp/verify'
  } else {
    location.href = '/'
  }
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
      toggle.textContent = '使用 OTP 验证码'
      if (label) label.textContent = '备份代码'
      field.removeAttribute('pattern')
      field.maxLength = 64
      field.inputMode = 'text'
      field.placeholder = '一次性备份代码'
    } else {
      toggle.textContent = '使用备份代码登录'
      if (label) label.textContent = 'OTP 验证码'
      field.setAttribute('pattern', '[0-9]{${digits}}')
      field.maxLength = ${digits}
      field.inputMode = 'numeric'
      field.placeholder = '${'0'.repeat(digits)}'
    }
    field.focus()
  })
}
`

const SCRIPT_CHANGE = `
wire('change', '/login/change', (f) => ({
  oldPassword: f.oldPassword.value,
  newPassword: f.newPassword.value,
  confirm: f.confirm.value,
}), () => {
  document.getElementById('card').innerHTML =
    '<h1>密码已修改</h1><p class="sub">所有会话已下线，请重新登录。</p>' +
    '<button onclick="location.reload()">重新登录</button>'
}, { strengthField: 'newPassword', confirmField: 'confirm' })
document.getElementById('logout').addEventListener('click', async () => {
  try { await post('/login/logout', {}) } catch { /* ignore */ }
  location.reload()
})
`

/** Render the page for the given mode. */
export function loginPageHtml({ mode, otpEnabled = false, digits = 6, otpRequired = false }) {
  if (mode === 'change') {
    return page('已登录', '修改密码后所有会话将下线，需要重新登录。', `
<form id="change">
  <label for="oldPassword">当前密码</label>
  <input id="oldPassword" type="password" autocomplete="current-password" required>
  <label for="newPassword">新密码</label>
  <input id="newPassword" type="password" autocomplete="new-password" required>
  <label for="confirm">确认新密码</label>
  <input id="confirm" type="password" autocomplete="new-password" required>
  <button type="submit">修改密码</button>
</form>
<button class="secondary" id="logout" type="button" style="margin-top:8px">登出</button>`, SCRIPT_CHANGE)
  }
  // mode === 'auth' (default)
  if (otpEnabled) {
    // The OTP field is mandatory: whenever 2FA is active the server verifies
    // it at login, so the form enforces a full code before submission. The
    // same input doubles as a backup-code field (lost authenticator).
    return page('登录', '请输入密码和 OTP 验证码以继续。', `
<form id="auth" data-mode="otp">
  <label for="password">密码</label>
  <input id="password" type="password" autocomplete="current-password" required>
  <label for="otp">OTP 验证码</label>
  <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" inputmode="numeric" autocomplete="one-time-code" required placeholder="${'0'.repeat(digits)}">
  <button type="submit">登录</button>
</form>
<button class="secondary" id="toggle-otp" type="button" style="margin-top:8px">使用备份代码登录</button>`, SCRIPT_AUTH(digits))
  }
  return page('登录', '请输入访问密码以继续。', `
<form id="auth">
  <label for="password">密码</label>
  <input id="password" type="password" autocomplete="current-password" required>
  <button type="submit">登录</button>
</form>`, SCRIPT_AUTH(digits))
}
