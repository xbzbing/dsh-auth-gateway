/**
 * Onboarding pages: the first-run flow after logging in with the
 * auto-generated initial password. Split into two separate pages:
 *
 *   /onboarding            — step 1 (optional): bind a TOTP authenticator.
 *                            The binding flow is shown directly (auto-starts
 *                            on load); a skip button leads to step 2, and a
 *                            successful binding continues with a "Next"
 *                            button. This is the onboarding entry — the
 *                            settings panel (/otp/setup) is a separate entry
 *                            for already-onboarded sessions.
 *   /onboarding/password   — step 2 (mandatory): set a personal password;
 *                            all access stays blocked until it is replaced.
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
.card { width: min(680px, calc(100vw - 32px)); }
p.sub { margin: 0 0 16px; line-height: 1.6; }
.step { margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 8px; }
.step h3 { margin: 0 0 6px; font-size: 14px; }
.step p { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.6; }
@media (prefers-color-scheme: dark) { .step { background: #1d1f24; } }
/* Two-column binding layout on wide screens: QR + secret on the left, the
   verification form and the skip button on the right — no vertical scrolling
   on desktop. Phones fall back to a single column. */
.otp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.otp-left { display: flex; flex-direction: column; gap: 12px; }
.otp-left .qr-container { display: flex; justify-content: center; }
.otp-left img { border: 1px solid #e2e4e8; border-radius: 8px; width: 200px; height: 200px; }
.otp-left .secret-box {
  background: #fff; border: 1px solid #e2e4e8; border-radius: 8px;
  padding: 10px 12px; word-break: break-all;
  font-family: monospace; font-size: 12px; color: #374151;
}
.otp-right { display: flex; flex-direction: column; gap: 10px; }
.otp-right p { margin: 0; font-size: 13px; color: #6b7280; line-height: 1.6; }
.otp-right input { text-align: center; letter-spacing: 8px; font-size: 18px; font-family: monospace; }
@media (max-width: 640px) { .otp-grid { grid-template-columns: 1fr; } }
/* The password step keeps its fields compact and centered inside the
   widened card. */
.pw-step { max-width: 380px; margin: 0 auto; }
/* Full-viewport decorative frame: the card keeps its size and stays
   centered, while the frame border stretches with the screen — a wide
   desktop gets a wide frame instead of bare side whitespace. */
body::before {
  content: ''; position: fixed; top: 14px; right: 14px; bottom: 14px; left: 14px;
  border: 1px solid rgba(127, 127, 127, 0.22); border-radius: 22px;
  pointer-events: none;
}
@media (prefers-color-scheme: dark) { body::before { border-color: rgba(255, 255, 255, 0.14); } }
`

/** UI copy per locale. */
const STR = {
  zh: {
    otpTitle: '绑定 OTP 双因素认证（可选）',
    otpSub: '可在此完成绑定，或跳过稍后在「认证设置」面板中绑定。',
    otpStep1H3: '1. 扫描 QR 码',
    otpStep2H3: '2. 或手动输入密钥',
    otpStep3H3: '3. 验证设置',
    otpStep3P: '输入认证器应用显示的验证码：',
    otpLabelOtp: 'OTP 验证码',
    otpBtnVerifyEnable: '验证并启用',
    otpSetupDoneP: 'OTP 已启用，请妥善保存下方备份代码。',
    otpBackupH3: '备份代码（请妥善保存）',
    otpBackupP: '每个备份代码只能使用一次。如果丢失认证器设备，可以使用这些代码登录。',
    otpBtnNext: '下一步',
    btnSkip: '跳过，直接设置密码',
    errCodeRequired: '请输入验证码',
    passwordTitle: '设置你的访问密码',
    passwordSub: '当前使用的是系统自动生成的初始密码，为保证安全，请先设置你自己的密码。设置完成前，所有功能暂不可用。',
    passwordStepH3: '设置新密码（必填）',
    passwordStepP: '至少 8 位，且包含大小写字母或特殊字符。',
    labelOld: '初始密码',
    labelNew: '新密码',
    labelConfirm: '确认新密码',
    btnSubmit: '设置新密码',
  },
  en: {
    otpTitle: 'Bind a TOTP authenticator (optional)',
    otpSub: 'Bind it here, or skip and bind it later from the Auth Settings panel.',
    otpStep1H3: '1. Scan the QR code',
    otpStep2H3: '2. Or enter the secret manually',
    otpStep3H3: '3. Verify the setup',
    otpStep3P: 'Enter the code shown in your authenticator app:',
    otpLabelOtp: 'OTP code',
    otpBtnVerifyEnable: 'Verify & enable',
    otpSetupDoneP: 'OTP enabled — save the backup codes below.',
    otpBackupH3: 'Backup codes (keep them safe)',
    otpBackupP: 'Each backup code can be used once. If you lose your authenticator device, use these codes to sign in.',
    otpBtnNext: 'Next',
    btnSkip: 'Skip — set the password',
    errCodeRequired: 'Enter the verification code',
    passwordTitle: 'Set your access password',
    passwordSub: 'You are currently using an auto-generated initial password. Set your own password first — everything stays locked until then.',
    passwordStepH3: 'Set a new password (required)',
    passwordStepP: 'At least 8 characters, with mixed case or a special character.',
    labelOld: 'Initial password',
    labelNew: 'New password',
    labelConfirm: 'Confirm new password',
    btnSubmit: 'Set new password',
  },
}

/** Error codes this page may surface (messages come from lib/errors.js). */
const ERROR_KEYS = [
  'invalid-password', 'password-too-short', 'password-too-simple',
  'unauthenticated', 'password-mismatch', 'bad-payload',
]

/** Onboarding context rewording: changing to a new password, so the shared
 * keys carry "new/current password" phrasing here. */
const ERROR_OVERRIDES = {
  'invalid-password': { zh: '当前密码错误', en: 'Wrong current password' },
  'password-too-short': { zh: '新密码至少需要 8 位', en: 'New password must be at least 8 characters' },
  'password-too-simple': { zh: '新密码需包含大小写字母或特殊字符', en: 'New password needs mixed case or a special character' },
  'password-mismatch': { zh: '两次输入的新密码不一致', en: 'The new passwords do not match' },
}

/**
 * Page renderer: script head (ERRORS + post) plus the page's own script.
 * Each page passes only the script it needs — step 1 must not receive the
 * step-2 form wiring (a listener on a missing #change-form would abort the
 * whole inline script, including the auto-start binding).
 */
const page = (locale, extraScript, basePath) => makePage(STYLE, scriptHead(errorsFor(locale, ERROR_KEYS, ERROR_OVERRIDES)) + `\nconst __basePath = ${JSON.stringify(normalizeBasePath(basePath))};\n` + (extraScript || ''), locale === 'en' ? 'en' : 'zh-CN', basePath)

/** '/' and '' both mean root (''); gateway already passes '/dsh' style prefixes. */
function normalizeBasePath(basePath) {
  return basePath === '/' || basePath === '' ? '' : basePath
}

/**
 * Step 1 — optional OTP binding, shown directly: the binding flow auto-starts
 * on load (QR + secret + verify), the user can skip straight to the password
 * step, and a successful binding continues with a "Next" button.
 * @param {object} options - `{ locale }`: 'zh' (default) or 'en'.
 */
export function onboardingPageHtml({ locale = 'zh', basePath = '/' } = {}) {
  const str = STR[locale] || STR.zh
  return page(locale, `
// Auto-start the binding flow: stage a secret and render the QR right away.
(async () => {
  const err = document.getElementById('error');
  try {
    const data = await post(__basePath + '/otp/enable', {});
    if (!data.ok) { err.textContent = data.error || 'failed'; document.getElementById('otp-loading').textContent = ''; return; }
    document.getElementById('qr').src = data.svgUrl;
    document.getElementById('secret-display').textContent = data.secret;
    document.getElementById('otp-loading').style.display = 'none';
    document.getElementById('otp-setup').style.display = 'block';
  } catch (ex) { err.textContent = ex.message; document.getElementById('otp-loading').textContent = ''; }
})();
document.getElementById('verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  const btn = document.querySelector('#verify-form button[type=submit]');
  const code = document.getElementById('otp').value;
  if (!code) { err.textContent = '${str.errCodeRequired}'; return; }
  btn.disabled = true;
  try {
    const data = await post(__basePath + '/otp/verify-setup', { otp: code });
    document.getElementById('backup-codes').textContent = (data.backupCodes || []).join('\\n');
    // The binding flow is done — replace it with the backup codes and the
    // "Next" button so the whole page stays above the fold.
    document.getElementById('otp-setup').style.display = 'none';
    document.getElementById('setup-done').style.display = 'block';
    document.getElementById('otp-done-btn').onclick = () => { location.href = data.next || __basePath + '/onboarding/password'; };
    err.textContent = '';
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
});
`, basePath)(str.otpTitle, str.otpSub, `
<div id="otp-setup" style="display:none">
  <div class="otp-grid">
    <div class="otp-left">
      <div class="step">
        <h3>${str.otpStep1H3}</h3>
        <div class="qr-container"><img id="qr" alt="OTP QR Code"></div>
      </div>
      <div class="step">
        <h3>${str.otpStep2H3}</h3>
        <div class="secret-box" id="secret-display"></div>
      </div>
    </div>
    <div class="otp-right">
      <div class="step">
        <h3>${str.otpStep3H3}</h3>
        <p>${str.otpStep3P}</p>
        <form id="verify-form">
          <label for="otp">${str.otpLabelOtp}</label>
          <input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" required>
          <button type="submit">${str.otpBtnVerifyEnable}</button>
        </form>
        <button class="secondary" type="button" onclick="location.href=__basePath+'/onboarding/password'" style="margin-top:8px;width:100%;">${str.btnSkip}</button>
      </div>
    </div>
  </div>
</div>
<div id="setup-done" style="display:none">
  <p style="font-size:13px;color:#166534;margin:0 0 12px;">${str.otpSetupDoneP}</p>
  <div class="backup-codes"><h3>${str.otpBackupH3}</h3><pre id="backup-codes"></pre>
    <p style="margin-top:8px;font-size:12px;color:#92400e;">${str.otpBackupP}</p>
  </div>
  <button type="button" id="otp-done-btn" style="margin-top:12px;width:100%;">${str.otpBtnNext}</button>
</div>
<div id="otp-loading" style="font-size:13px;color:#6b7280;">…</div>`)
}

/**
 * Step 2 — mandatory personal password (served at GET /onboarding/password).
 * @param {object} options - `{ locale }`: 'zh' (default) or 'en'.
 */
export function onboardingPasswordPageHtml({ locale = 'zh', basePath = '/' } = {}) {
  const str = STR[locale] || STR.zh
  return page(locale, strengthErrorScript() + `
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
    await post(__basePath + '/login/change', { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value })
    // Password replaced: every session was revoked, so head to the login page.
    location.href = __basePath + '/login'
  } catch (ex) {
    err.textContent = ex.message
    btn.disabled = false
  }
})
`, basePath)(str.passwordTitle, str.passwordSub, `
<form id="change-form">
  <div class="pw-step">
    <div class="step">
      <h3>${str.passwordStepH3}</h3>
      <p>${str.passwordStepP}</p>
      <label for="oldPassword">${str.labelOld}</label>
      <input id="oldPassword" type="password" autocomplete="current-password" required>
      <label for="newPassword">${str.labelNew}</label>
      <input id="newPassword" type="password" autocomplete="new-password" required>
      <label for="confirm">${str.labelConfirm}</label>
      <input id="confirm" type="password" autocomplete="new-password" required>
      <button type="submit">${str.btnSubmit}</button>
    </div>
  </div>
</form>`)
}
