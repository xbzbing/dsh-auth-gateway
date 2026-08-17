/**
 * OTP pages: setup, verify, and backup code entry.
 *
 * Self-contained HTML pages with inline CSS and vanilla JS.
 * The QR code is generated server-side as an SVG data-URL
 * (see ./qr-svg.js), so no client-side QR library is needed.
 * No user-controlled content is interpolated into these pages.
 */

import { generateQRSvg } from './qr-svg.js'

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; font-family: ui-sans-serif, system-ui, sans-serif;
  background: #f4f5f7;
}
.card {
  width: min(400px, calc(100vw - 32px)); background: #fff; border: 1px solid #e2e4e8;
  border-radius: 12px; padding: 28px 24px; box-shadow: 0 8px 24px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  body { background: #17181c; }
  .card { background: #232529; border-color: #33363c; }
  input { background: #17181c; color: #eee; border-color: #3a3d44; }
  .secret-box { background: #17181c; border-color: #3a3d44; }
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
.qr-container {
  display: flex; justify-content: center; margin: 16px 0;
}
.qr-container img {
  border: 1px solid #e2e4e8;
  border-radius: 8px;
  width: 200px;
  height: 200px;
}
.secret-box {
  background: #f9fafb; border: 1px solid #e2e4e8; border-radius: 8px;
  padding: 12px; margin: 12px 0; word-break: break-all;
  font-family: monospace; font-size: 12px; color: #374151;
}
.backup-codes {
  background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px;
  padding: 12px; margin: 12px 0;
}
.backup-codes pre {
  margin: 0; font-size: 11px; line-height: 1.5;
  font-family: monospace; white-space: pre-wrap;
}
.step { margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px; }
.step h3 { margin: 0 0 8px; font-size: 14px; }
.step p { margin: 0; font-size: 13px; color: #6b7280; }
`

const SCRIPT = `
const ERRORS = {
  'invalid-otp': 'OTP代码错误',
  'otp-required': '请输入OTP代码',
  'invalid-backup-code': '备份代码错误',
  'backup-code-used': '该备份代码已使用',
  'otp-not-enabled': 'OTP未启用',
  'otp-already-enabled': 'OTP已启用',
  'too-many-attempts': '尝试次数过多，请稍后再试',
  'rate-limited': '尝试过于频繁，请稍后再试',
  'unauthenticated': '登录状态已失效，请重新登录',
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
`

const SCRIPT_SETUP = (digits = 6) => `
// OTP setup page
document.getElementById('verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  const btn = document.querySelector('button[type=submit]');
  const otp = document.getElementById('otp').value;
  
  if (!otp || otp.length !== ${digits}) {
    err.textContent = ERRORS['otp-required'];
    return;
  }
  
  btn.disabled = true;
  try {
    const data = await post('/otp/verify-setup', { otp });
    // Show the generated backup codes and finish (they only exist after enable)
    document.getElementById('backup-codes').textContent = (data.backupCodes || []).join('\\n');
    document.getElementById('verify-form').style.display = 'none';
    document.getElementById('setup-done').style.display = 'block';
    err.textContent = '';
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
`

const SCRIPT_VERIFY = (digits = 6) => `
// OTP verify page (during login)
document.getElementById('verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  const btn = document.querySelector('button[type=submit]');
  const otp = document.getElementById('otp').value;
  
  if (!otp || otp.length !== ${digits}) {
    err.textContent = ERRORS['otp-required'];
    return;
  }
  
  btn.disabled = true;
  try {
    const data = await post('/otp/verify', { otp });
    location.href = '/';
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});

document.getElementById('use-backup').addEventListener('click', () => {
  document.getElementById('otp-form').style.display = 'none';
  document.getElementById('backup-form').style.display = 'block';
});

document.getElementById('backup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  const btn = document.querySelector('button[type=submit]');
  const code = document.getElementById('backup-code').value;
  
  if (!code) {
    err.textContent = ERRORS['invalid-backup-code'];
    return;
  }
  
  btn.disabled = true;
  try {
    const data = await post('/otp/verify-backup', { code });
    location.href = '/';
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
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

/**
 * Render OTP setup page.
 * @param {object} options - Setup data.
 * @param {string} options.uri - otpauth:// URI.
 * @param {string} options.secret - Base32 encoded secret.
 * @param {string[]} options.backupCodes - Raw backup codes.
 * @returns {string} HTML page.
 */
export function otpSetupPage({ uri, secret, backupCodes, digits = 6 }) {
  const codesText = backupCodes.join('\n')
  const qrSvg = generateQRSvg(uri, 256)
  return page('设置 OTP', '使用认证器应用扫描以下 QR 码，或手动输入密钥。', `
<div class="step">
  <h3>1. 扫描 QR 码</h3>
  <div class="qr-container">
    <img id="qr" src="${qrSvg}" alt="OTP QR 码">
  </div>
</div>

<div class="step">
  <h3>2. 或手动输入密钥</h3>
  <div class="secret-box" id="secret-display">${secret}</div>
</div>

<div class="step">
  <h3>3. 验证设置</h3>
  <p>输入认证器应用显示的 ${digits} 位验证码：</p>
  <form id="verify-form">
    <label for="otp">OTP 验证码</label>
    <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" 
           inputmode="numeric" autocomplete="one-time-code" required
           placeholder="${'0'.repeat(digits)}">
    <button type="submit">验证并启用</button>
  </form>
  <div id="setup-done" style="display:none; margin-top:12px;">
    <p style="font-size:13px;color:#166534;margin:0 0 12px;">OTP 已启用，请妥善保存下方备份代码。</p>
    <button type="button" onclick="location.href='/'">完成</button>
  </div>
</div>

<div class="backup-codes">
  <h3>备份代码（请妥善保存）</h3>
  <pre id="backup-codes">${codesText}</pre>
  <p style="margin-top:8px;font-size:12px;color:#92400e;">
    每个备份代码只能使用一次。如果丢失认证器设备，可以使用这些代码登录。
  </p>
</div>
`, SCRIPT_SETUP(digits))
}

/**
 * Render OTP verification page (during login).
 * @param {object} options - Verification data.
 * @param {boolean} options.hasBackupCodes - Whether backup codes are available.
 * @returns {string} HTML page.
 */
export function otpVerifyPage({ hasBackupCodes = true, digits = 6 } = {}) {
  let backupSection = ''
  if (hasBackupCodes) {
    backupSection = `
<button class="secondary" id="use-backup" type="button" style="margin-top:12px">
  使用备份代码
</button>
<div id="backup-form" style="display:none">
  <label for="backup-code">备份代码</label>
  <input id="backup-code" type="text" placeholder="XXXX-XXXX" required>
  <button type="submit">验证备份代码</button>
</div>
`
  }

  return page('OTP 验证', '请输入认证器应用显示的 ${digits} 位验证码。', `
<div id="otp-form">
  <form id="verify-form">
    <label for="otp">OTP 验证码</label>
    <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" 
           inputmode="numeric" autocomplete="one-time-code" required
           placeholder="${'0'.repeat(digits)}">
    <button type="submit">验证</button>
  </form>
  ${backupSection}
</div>
`, SCRIPT_VERIFY(digits))
}

