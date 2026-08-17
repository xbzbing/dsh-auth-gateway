/**
 * OTP pages: setup, verify, and backup code entry.
 *
 * Self-contained HTML pages with inline CSS and vanilla JS.
 * The QR code is generated server-side as an SVG data-URL
 * (see ./qr-svg.js), so no client-side QR library is needed.
 * No user-controlled content is interpolated into these pages.
 *
 * The render locale ('zh' default, 'en') is resolved by the gateway
 * (lib/locale.js) and selects the UI copy and the script-head error map.
 *
 * Scaffolding (base CSS, HTML skeleton, script head) lives in ./page-shell.js.
 */

import { baseStyle, scriptHead, makePage } from './page-shell.js'
import { generateQRSvg } from './qr-svg.js'

/** Page-specific CSS on top of the shared base. */
const STYLE = baseStyle + `
.card { width: min(400px, calc(100vw - 32px)); }
p.sub { margin: 0 0 20px; }
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
@media (prefers-color-scheme: dark) { .secret-box { background: #17181c; border-color: #3a3d44; } }
`

/** UI copy per locale. */
const STR = {
  zh: {
    titleSetup: '设置 OTP',
    subSetup: '使用认证器应用扫描以下 QR 码，或手动输入密钥。',
    step1H3: '1. 扫描 QR 码',
    step2H3: '2. 或手动输入密钥',
    step3H3: '3. 验证设置',
    step3P: '输入认证器应用显示的 {digits} 位验证码：',
    labelOtp: 'OTP 验证码',
    btnVerifyEnable: '验证并启用',
    setupDoneP: 'OTP 已启用，请妥善保存下方备份代码。',
    btnDone: '完成',
    backupH3: '备份代码（请妥善保存）',
    backupP: '每个备份代码只能使用一次。如果丢失认证器设备，可以使用这些代码登录。',
    titleVerify: 'OTP 验证',
    subVerify: '请输入认证器应用显示的 {digits} 位验证码。',
    btnVerify: '验证',
    btnUseBackup: '使用备份代码',
    labelBackup: '备份代码',
    placeholderBackup: 'XXXX-XXXX',
    btnVerifyBackup: '验证备份代码',
  },
  en: {
    titleSetup: 'Set up OTP',
    subSetup: 'Scan the QR code with an authenticator app, or enter the secret manually.',
    step1H3: '1. Scan the QR code',
    step2H3: '2. Or enter the secret manually',
    step3H3: '3. Verify the setup',
    step3P: 'Enter the {digits}-digit code shown in your authenticator app:',
    labelOtp: 'OTP code',
    btnVerifyEnable: 'Verify & enable',
    setupDoneP: 'OTP enabled — save the backup codes below.',
    btnDone: 'Done',
    backupH3: 'Backup codes (keep them safe)',
    backupP: 'Each backup code can be used once. If you lose your authenticator device, use these codes to sign in.',
    titleVerify: 'OTP verification',
    subVerify: 'Enter the {digits}-digit code shown in your authenticator app.',
    btnVerify: 'Verify',
    btnUseBackup: 'Use a backup code',
    labelBackup: 'Backup code',
    placeholderBackup: 'XXXX-XXXX',
    btnVerifyBackup: 'Verify backup code',
  },
}

/** Server error code → user-facing message, per locale. */
const ERRORS = {
  zh: {
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
  },
  en: {
    'invalid-otp': 'Invalid OTP code',
    'otp-required': 'Enter the OTP code',
    'invalid-backup-code': 'Invalid backup code',
    'backup-code-used': 'That backup code has already been used',
    'otp-not-enabled': 'OTP is not enabled',
    'otp-already-enabled': 'OTP is already enabled',
    'too-many-attempts': 'Too many attempts, try again later',
    'rate-limited': 'Too many attempts, try again later',
    'unauthenticated': 'Your session has expired, please sign in again',
    'bad-payload': 'Invalid request parameters',
  },
}

/** Script head (ERRORS + post) shared by both OTP pages. */
const page = (locale) => makePage(STYLE, scriptHead(ERRORS[locale]))

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

/**
 * Render OTP setup page.
 * @param {object} options - Setup data.
 * @param {string} options.uri - otpauth:// URI.
 * @param {string} options.secret - Base32 encoded secret.
 * @param {string[]} options.backupCodes - Raw backup codes.
 * @param {string} [options.locale='zh'] - 'zh' or 'en'.
 * @returns {string} HTML page.
 */
export function otpSetupPage({ uri, secret, backupCodes, digits = 6, locale = 'zh' }) {
  const str = STR[locale] || STR.zh
  const codesText = backupCodes.join('\n')
  const qrSvg = generateQRSvg(uri, 256)
  return page(locale)(str.titleSetup, str.subSetup, `
<div class="step">
  <h3>${str.step1H3}</h3>
  <div class="qr-container">
    <img id="qr" src="${qrSvg}" alt="OTP QR Code">
  </div>
</div>

<div class="step">
  <h3>${str.step2H3}</h3>
  <div class="secret-box" id="secret-display">${secret}</div>
</div>

<div class="step">
  <h3>${str.step3H3}</h3>
  <p>${str.step3P.replace('{digits}', digits)}</p>
  <form id="verify-form">
    <label for="otp">${str.labelOtp}</label>
    <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" 
           inputmode="numeric" autocomplete="one-time-code" required
           placeholder="${'0'.repeat(digits)}">
    <button type="submit">${str.btnVerifyEnable}</button>
  </form>
  <div id="setup-done" style="display:none; margin-top:12px;">
    <p style="font-size:13px;color:#166534;margin:0 0 12px;">${str.setupDoneP}</p>
    <button type="button" onclick="location.href='/'">${str.btnDone}</button>
  </div>
</div>

<div class="backup-codes">
  <h3>${str.backupH3}</h3>
  <pre id="backup-codes">${codesText}</pre>
  <p style="margin-top:8px;font-size:12px;color:#92400e;">
    ${str.backupP}
  </p>
</div>
`, SCRIPT_SETUP(digits))
}

/**
 * Render OTP verification page (during login).
 * @param {object} options - Verification data.
 * @param {boolean} options.hasBackupCodes - Whether backup codes are available.
 * @param {string} [options.locale='zh'] - 'zh' or 'en'.
 * @returns {string} HTML page.
 */
export function otpVerifyPage({ hasBackupCodes = true, digits = 6, locale = 'zh' } = {}) {
  const str = STR[locale] || STR.zh
  let backupSection = ''
  if (hasBackupCodes) {
    backupSection = `
<button class="secondary" id="use-backup" type="button" style="margin-top:12px">
  ${str.btnUseBackup}
</button>
<div id="backup-form" style="display:none">
  <label for="backup-code">${str.labelBackup}</label>
  <input id="backup-code" type="text" placeholder="${str.placeholderBackup}" required>
  <button type="submit">${str.btnVerifyBackup}</button>
</div>
`
  }

  return page(locale)(str.titleVerify, str.subVerify.replace('{digits}', digits), `
<div id="otp-form">
  <form id="verify-form">
    <label for="otp">${str.labelOtp}</label>
    <input id="otp" type="text" pattern="[0-9]{${digits}}" maxlength="${digits}" 
           inputmode="numeric" autocomplete="one-time-code" required
           placeholder="${'0'.repeat(digits)}">
    <button type="submit">${str.btnVerify}</button>
  </form>
  ${backupSection}
</div>
`, SCRIPT_VERIFY(digits))
}
