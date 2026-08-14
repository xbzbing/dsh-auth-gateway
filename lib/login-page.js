/**
 * The login page: a zero-build, self-contained HTML page (inline CSS + plain
 * fetch JS). The gateway serves it at GET /login with a mode chosen by
 * server-side state:
 *
 *   setup  — no password set yet: create one
 *   auth   — password set: log in
 *   change — already logged in: change password / log out
 *
 * No user-controlled content is ever interpolated into this page, so there
 * is no escaping surface here.
 */

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; font-family: ui-sans-serif, system-ui, sans-serif;
  background: #f4f5f7;
}
.card {
  width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid #e2e4e8;
  border-radius: 12px; padding: 28px 24px; box-shadow: 0 8px 24px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  body { background: #17181c; }
  .card { background: #232529; border-color: #33363c; }
  input { background: #17181c; color: #eee; border-color: #3a3d44; }
}
h1 { margin: 0 0 4px; font-size: 18px; }
p.sub { margin: 0 0 20px; font-size: 13px; color: #6b7280; }
label { display: block; font-size: 12px; color: #6b7280; margin: 12px 0 4px; }
input {
  width: 100%; padding: 9px 10px; font-size: 14px; border: 1px solid #d1d5db;
  border-radius: 8px; outline: none;
}
input:focus { border-color: #4d6bfe; }
button {
  width: 100%; margin-top: 18px; padding: 10px; font-size: 14px; color: #fff;
  background: #4d6bfe; border: 0; border-radius: 8px; cursor: pointer;
}
button.secondary { background: transparent; color: #6b7280; border: 1px solid #d1d5db; }
.error { margin-top: 12px; font-size: 13px; color: #dc2626; min-height: 1em; }
`

const SCRIPT = `
const ERRORS = {
  'invalid-password': '密码错误',
  'password-too-short': '密码至少需要 8 位',
  'password-too-simple': '密码需包含大小写字母或特殊字符',
  'too-many-attempts': '密码错误次数过多，已暂时锁定，请稍后再试',
  'unauthenticated': '登录状态已失效，请重新登录',
  'already-setup': '密码已设置，请直接登录',
  'password-required': '请输入密码',
  'bad-payload': '请求参数不正确',
}
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error((data && (ERRORS[data.error] || data.error)) || ('HTTP ' + res.status))
  return data
}
// Client-side strength check (the server enforces the same policy; this is
// early feedback only). Returns an error message or null.
function strengthError(pw) {
  if (!pw || pw.length < 8) return ERRORS['password-too-short']
  const hasMixed = /[a-z]/.test(pw) && /[A-Z]/.test(pw)
  const hasSpecial = /[^A-Za-z0-9]/.test(pw)
  if (!hasMixed && !hasSpecial) return ERRORS['password-too-simple']
  return null
}
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
    btn.disabled = true
    try {
      const data = await post(path, payload)
      if (onOk) onOk(data)
      else location.href = '/'   // setup / login success: straight into the app
    } catch (ex) {
      err.textContent = ex.message
      btn.disabled = false
    }
  })
}
`

const SCRIPT_SETUP = `
wire('setup', '/login/setup', (f) => ({ password: f.password.value, confirm: f.confirm.value }),
  undefined, { strengthField: 'password', confirmField: 'confirm' })
`

const SCRIPT_AUTH = `
wire('auth', '/login/auth', (f) => ({ password: f.password.value }))
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

function page(title, sub, fields, script) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="card" id="card">
  <h1>${title}</h1>
  <p class="sub">${sub}</p>
  ${fields}
  <div class="error" id="error"></div>
</div>
<script>${SCRIPT}${script}</script>
</body>
</html>`
}

/** Render the page for the given mode. */
export function loginPageHtml({ mode }) {
  if (mode === 'setup') {
    return page('设置密码', '首次使用：请设置访问密码（至少 8 位，且包含大小写字母或特殊字符），之后每次打开都需要登录。', `
<form id="setup">
  <label for="password">新密码</label>
  <input id="password" type="password" autocomplete="new-password" required>
  <label for="confirm">确认新密码</label>
  <input id="confirm" type="password" autocomplete="new-password" required>
  <button type="submit">设置密码并进入</button>
</form>`, SCRIPT_SETUP)
  }
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
  return page('登录', '请输入访问密码以继续。', `
<form id="auth">
  <label for="password">密码</label>
  <input id="password" type="password" autocomplete="current-password" required>
  <button type="submit">登录</button>
</form>`, SCRIPT_AUTH)
}
