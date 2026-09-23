/**
 * End-to-end test against a REAL dsh web instance with the login plugin.
 *
 * Covers the full product flow in a browser:
 *   1. fresh deployment: initial password -> forced onboarding -> personal
 *      password -> re-login (regression: crypto.randomUUID is not a function
 *      on plain-HTTP LAN)
 *   2. after auth: homepage UI loaded, zero JS errors
 *   3. logout -> login page -> wrong password rejected -> login -> homepage
 *   4. change password -> all sessions revoked -> re-login with new password
 *   5. two-factor: enable OTP through the settings panel, verify with a real
 *      TOTP code, log in with password + code, disable OTP again (restores
 *      the deployment state) — 2FA is THE product's core feature, so the
 *      suite actually exercises it instead of only skipping the onboarding
 *      binding
 *   6. the Remote mux WebSocket completes its handshake — catches a reverse
 *      proxy that does not forward Upgrade/Connection (TROUBLESHOOTING §7)
 *
 * Point BASE at the URL users actually use. When a reverse proxy fronts the
 * gateway, testing the *proxied* origin is what exercises the proxy hop; run
 * against the gateway port directly and there is no proxy in the path to catch.
 *
 * Usage (against a running `dsh web --port 8002`):
 *   PASSWORD=e2e-pass node scripts/e2e.mjs            (configured deploy)
 *   INITIAL_PASSWORD=<console> PASSWORD=e2e-pass node scripts/e2e.mjs
 *                                                    (fresh deploy)
 *
 * A fresh deployment mints an auto-generated initial password printed to the
 * dsh console; pass it via INITIAL_PASSWORD. The script ends with the
 * password changed to `${PASSWORD}-2` and OTP disabled again.
 */

import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { resolveChromiumPath } from './chromium.mjs'
import { generateTOTP } from '../lib/totp.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8002'
const PASSWORD = process.env.PASSWORD || 'e2e-pass'
const NEW_PASSWORD = `${PASSWORD}-2`

// Locate the Chromium executable dynamically (scripts/chromium.mjs):
// CHROMIUM_PATH wins, then the installed playwright's own registry, then a
// scan of the ms-playwright cache. The cache directory name embeds the
// playwright revision (-1105, -1243, …) and changes on every upgrade — a
// hard-coded path here would break on the next `npx playwright install`.
const executablePath = resolveChromiumPath({ playwrightExecutable: chromium.executablePath() })
if (!executablePath) {
  console.error('no chromium found: set CHROMIUM_PATH, run `npx playwright install chromium`,'
    + ' or install a system chromium')
  process.exit(2)
}

let step = 0
function ok(name) {
  step += 1
  console.log(`ok ${step}  ${name}`)
}

/**
 * Close whatever first-run dialog is up (the beta notice with 继续, the
 * API-key wizard with 稍后配置) so UI behind it is clickable. Some dsh
 * builds greet a first sign-in with these; harmless when none is present.
 *
 * The queue pops the next dialog a few hundred ms after the previous one
 * closes, so a single quiet probe can slip through the gap and a later pop
 * would then cover the settings dialog this suite opens next. Only return
 * after the surface has stayed quiet for a full quiet window.
 */
async function dismissFirstRunDialogs(page) {
  const QUIET_MS = 3000
  const DEADLINE = Date.now() + 15000
  let quietSince = Date.now()
  while (Date.now() < DEADLINE) {
    const label = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => d.isConnected && d.offsetParent !== null)
      if (!dlg) return null
      const btn = [...dlg.querySelectorAll('button')]
        .find((b) => /继续|稍后配置/.test(b.textContent || ''))
      return btn ? btn.textContent.trim() : null
    })
    if (label) {
      await page.click(`[role="dialog"] button:has-text("${label}")`, { force: true }).catch(() => {})
      quietSince = Date.now()
      await page.waitForTimeout(400)
    } else {
      if (Date.now() - quietSince >= QUIET_MS) return
      await page.waitForTimeout(300)
    }
  }
}

const browser = await chromium.launch({ executablePath, headless: true })
try {
  // Pin the browser locale: every selector and assertion in this suite is
  // Chinese (gateway pages AND the dsh shell UI), and an en-US default
  // context would make them time out against a pristine instance.
  const context = await browser.newContext({ locale: 'zh-CN' })
  const page = await context.newPage()
  const jsErrors = []
  page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    jsErrors.push(`console: ${m.text()} @ ${m.location().url}`)
  })

  // Every WebSocket the page opens. Registered before the first navigation so
  // the app's Remote mux socket is seen. This event fires on CREATION — i.e.
  // even when the handshake then fails — so it evidences "attempted", not
  // "connected"; the console-error assertion in step 5 proves success.
  const webSockets = []
  page.on('websocket', (ws) => webSockets.push(ws.url()))

  // ── 0. unauthenticated API gate (server-side, not UI) ─────────────────
  const unauth = await page.request.post(`${BASE}/api/session.list`, { data: {} })
  assert.equal(unauth.status(), 401, 'unauthenticated /api must be 401')
  ok('unauthenticated /api answers 401 (real interception)')

  // ── 1. login: the initial password (fresh deployment) or a personal one
  // ────────────────────────────────────────────────────────────────────────
  // Fresh deployments mint an auto-generated initial password printed to the
  // dsh console; pass it via INITIAL_PASSWORD. Logging in with it lands on
  // the onboarding page (set a personal password), then re-login. A
  // configured deployment logs in with PASSWORD directly.
  const INITIAL = process.env.INITIAL_PASSWORD
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form', { timeout: 10000 })
  if (INITIAL) {
    await page.fill('#password', INITIAL)
    await page.click('button[type=submit]')
    // Must be forced into onboarding, not into the app.
    await page.waitForURL('**/onboarding', { timeout: 15000 })
    // Step 1 is the OPTIONAL OTP binding page; skip it to step 2 (the
    // mandatory personal-password form lives at /onboarding/password).
    await page.waitForSelector('#otp-setup', { timeout: 10000 })
    await page.click('text=跳过，直接设置密码')
    ok('initial password login is routed to onboarding step 1 (OTP optional)')
    await page.waitForURL('**/onboarding/password', { timeout: 10000 })
    await page.waitForSelector('#change-form', { timeout: 10000 })
    await page.fill('#oldPassword', INITIAL)
    await page.fill('#newPassword', PASSWORD)
    await page.fill('#confirm', PASSWORD)
    await page.click('#change-form button[type=submit]')
    // Setting the personal password revokes every session: back to the
    // login form, then re-login with the new password.
    await page.waitForURL('**/login', { timeout: 15000 })
    await page.waitForSelector('#auth', { timeout: 10000 })
    await page.fill('#password', PASSWORD)
    await page.click('button[type=submit]')
    ok('onboarding sets a personal password; re-login succeeds')
  } else {
    await page.fill('#password', PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForURL(`${BASE}/`, { timeout: 15000 })
    ok('personal password login lands on /')
  }

  // ── 2. after auth: must land on the homepage with a working UI ────────
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  ok('after auth the page lands on / (not stuck on /login)')
  await page.waitForTimeout(2500) // let the app settle; catch late errors
  assert.equal(jsErrors.length, 0,
    `homepage must load with zero JS errors, got: ${jsErrors.join(' | ')}`)
  ok('homepage UI loaded with zero JS errors (randomUUID polyfill works)')

  // ── 2b. the Remote mux WebSocket must complete its handshake ──────────
  // The dsh client keeps a WebSocket (the Remote stream mux) connected while
  // idle. A reverse proxy that does not forward Upgrade/Connection for that
  // path degrades the handshake to a plain GET, and the failure shows up ONLY
  // as a browser console error — so that error, not the socket's existence, is
  // the signal. Deliberately path-agnostic: dsh has renamed the endpoint
  // before (/api/events.mux -> /api/remote.mux), and this must keep working.
  const wsDeadline = Date.now() + 5000
  while (webSockets.length === 0 && Date.now() < wsDeadline) await page.waitForTimeout(200)
  const wsFailures = jsErrors.filter((e) => /WebSocket connection to .* failed/i.test(e))
  assert.equal(wsFailures.length, 0,
    'the Remote mux WebSocket must complete its handshake. If this deployment sits behind a '
    + 'reverse proxy, it must forward Upgrade/Connection on the catch-all location (use '
    + '`map $http_upgrade $connection_upgrade`) — see docs/*/NGINX-DEPLOYMENT.md and '
    + `TROUBLESHOOTING §7. Got: ${wsFailures.join(' | ')}`)
  assert.ok(webSockets.length > 0,
    'expected the dsh client to open at least one WebSocket (the Remote mux), otherwise this '
    + 'WebSocket check can never fire and is silently dead. If dsh changed its transport, update '
    + `this step. BASE=${BASE} (point it at the proxied origin to exercise the proxy hop)`)
  ok(`Remote mux WebSocket attempted (${webSockets.length}) with no failed handshake`)

  // ── 2c. auth settings panel: cookie-Secure save & restore (click-through)
  // The panel's Save button once called api.setCookieSecure() while the api
  // factory did not define it — the click failed SILENTLY as "网络错误，未
  // 保存", and because the error was swallowed by the catch, neither the
  // zero-JS-errors assertion nor the console would have seen it (PR #21
  // review R1). A real click-through pins the whole button chain: api
  // method, POST route, hint copy, source flip, restore button lifecycle.
  await dismissFirstRunDialogs(page)
  await page.click('button:has-text("设置")', { force: true })
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(600)
  await page.click('[role="dialog"] button:has-text("认证设置")', { force: true })
  await page.waitForSelector('text=Cookie 安全', { timeout: 10000 })
  await page.waitForTimeout(500)

  // Fresh panel: deployment source, no restore button yet.
  assert.ok(await page.evaluate(() => document.body.innerText.includes('来源：部署配置')),
    'panel must open with the deployment source')
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')]
    .some((b) => /恢复为部署配置/.test(b.textContent || ''))), false,
  'no restore button while the deployment config rules')

  // Save 关闭 -> hint, source flip, restore button appears.
  await page.selectOption('select', 'false')
  await page.click('button:has-text("保存")')
  await page.waitForFunction(() => /已保存，新策略立即生效/.test(document.body.innerText), { timeout: 8000 })
  assert.ok(await page.evaluate(() => document.body.innerText.includes('来源：面板设置')),
    'the source must flip to 面板设置 after a panel save')
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')]
    .some((b) => /恢复为部署配置/.test(b.textContent || ''))),
  'the restore button must appear after a panel save')

  // Restore -> deployment source back, restore button gone.
  await page.click('button:has-text("恢复为部署配置")')
  await page.waitForFunction(() => /已恢复为部署配置/.test(document.body.innerText), { timeout: 8000 })
  assert.ok(await page.evaluate(() => document.body.innerText.includes('来源：部署配置')),
    'the source must return to 部署配置 after restoring')
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')]
    .some((b) => /恢复为部署配置/.test(b.textContent || ''))), false,
  'the restore button must disappear after restoring')
  ok('auth settings panel: cookie Secure save + restore work (no silent failure)')

  // ── 3. logout -> login page -> wrong password -> login ────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#logout', { timeout: 10000 })
  await page.click('#logout')
  await page.waitForSelector('#auth', { timeout: 10000 })
  ok('logged-in /login shows change form; logout returns to login form')

  await page.fill('#password', 'definitely-wrong')
  await page.click('button[type=submit]')
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.length > 0)
  const wrongErr = await page.evaluate(() => document.getElementById('error').textContent)
  assert.ok(wrongErr.length > 0, 'wrong password must surface an error')
  ok(`wrong password rejected (${wrongErr})`)

  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  ok('correct password logs in and lands on /')

  // ── 4. change password revokes the session ────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#change', { timeout: 10000 })
  // A weak new password must be rejected client-side before any request.
  await page.fill('#oldPassword', PASSWORD)
  await page.fill('#newPassword', 'weak')
  await page.fill('#confirm', 'weak')
  await page.click('#change button[type=submit]')
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.length > 0)
  const weakErr = await page.evaluate(() => document.getElementById('error').textContent)
  assert.ok(weakErr.includes('8'), `weak password must show a strength error, got: ${weakErr}`)
  ok(`weak new password rejected client-side (${weakErr})`)
  // Mismatched confirmation must be rejected without a request.
  await page.fill('#newPassword', NEW_PASSWORD)
  await page.fill('#confirm', 'Different1!')
  await page.click('#change button[type=submit]')
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.includes('不一致'))
  ok('mismatched password confirmation rejected client-side')
  await page.fill('#confirm', NEW_PASSWORD)
  await page.click('#change button[type=submit]')
  await page.waitForFunction(() => document.body.innerText.includes('重新登录'))
  ok('password changed; session revoked; re-login prompt shown')

  // Old password must now fail; new one must work.
  await page.click('button:has-text("重新登录")')
  await page.waitForSelector('#auth', { timeout: 10000 })
  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => document.getElementById('error')?.textContent?.length > 0)
  ok('old password rejected after change')

  await page.fill('#password', NEW_PASSWORD)
  await page.click('button[type=submit]')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  ok('new password logs in and lands on /')

  // ── 5. two-factor: enable OTP via the panel, log in with password + TOTP
  // code, then disable it again (the deployment must be left password-only)
  // ────────────────────────────────────────────────────────────────────────
  // Instrument fetch to capture the staged secret /otp/enable answers (the
  // QR modal shows it too, but the API is the stable contract the panel
  // itself reads, and the same fields drive the later login). Installed in
  // the CURRENT document: the panel flow never navigates, so an init script
  // would not apply.
  await page.evaluate(() => {
    window.__otpEnable = null
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const res = await originalFetch(...args)
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '')
      if (url.includes('/otp/enable') && res.ok) {
        res.clone().json()
          .then((data) => { if (data && data.ok && typeof data.secret === 'string') window.__otpEnable = data })
          .catch(() => {})
      }
      return res
    }
  })

  await dismissFirstRunDialogs(page)
  await page.click('button:has-text("设置")', { force: true })
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(600)
  await page.click('[role="dialog"] button:has-text("认证设置")', { force: true })
  await page.waitForSelector('text=双因素认证', { timeout: 10000 })
  await page.waitForTimeout(500)
  assert.ok(await page.evaluate(() => document.body.innerText.includes('未启用')),
    'the OTP card must start disabled')
  await page.click('button:has-text("启用 OTP")')
  await page.waitForFunction(() => window.__otpEnable !== null, { timeout: 10000 })

  const otpSecret = await page.evaluate(() => window.__otpEnable.secret)
  assert.match(otpSecret, /^[A-Z2-7]{16,}$/, 'the staged secret must be plain base32')
  // Verify the setup with a REAL code computed from that secret — pins the
  // whole chain: staged secret -> QR -> authenticator -> verify-setup.
  await page.fill('input[placeholder*="位验证码"]', generateTOTP(otpSecret))
  await page.click('button:has-text("验证并启用")')
  // The dialog must show the one-time backup codes after a verified setup.
  await page.waitForFunction(() => /\w{4}-\w{4}/.test(document.body.innerText),
    undefined, { timeout: 10000 })
  assert.ok(await page.evaluate(() => document.body.innerText.includes('备份代码')),
    'backup codes must be presented once for saving')
  ok('panel enables OTP; a real TOTP code verifies the setup; backup codes shown')

  // Enabling revoked every session: the dialog's own button signs back in.
  await page.click('button:has-text("完成并重新登录")')
  await page.waitForURL('**/login', { timeout: 15000 })
  await page.waitForSelector('#auth', { timeout: 10000 })
  assert.ok(await page.evaluate(() => document.getElementById('otp') !== null),
    'with 2FA active the login form must carry the OTP field')
  // Password alone must no longer suffice: the login form (2FA mode) refuses
  // to submit without a full code — the server-side otp-required refusal is
  // pinned by the unit tests, this is the UI half of the same gate. The
  // refusal can arrive as either the browser's native validation (the #otp
  // input is required with a digit pattern, so the submit event never fires)
  // or wire()'s own otp-length message in #error; accept whichever the
  // current browser enforces first.
  await page.fill('#password', NEW_PASSWORD)
  await page.click('#auth button[type=submit]')
  await page.waitForFunction(() =>
    (document.getElementById('error')?.textContent?.length ?? 0) > 0
    || (document.getElementById('otp')?.validationMessage?.length ?? 0) > 0)
  ok('the 2FA login form blocks a password-only submit (OTP code demanded)')
  // Password + a fresh code (computed at submit time so the 30s step cannot
  // roll over in between).
  await page.fill('#password', NEW_PASSWORD)
  await page.fill('#otp', generateTOTP(otpSecret))
  await page.click('#auth button[type=submit]')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  ok('password + TOTP code logs in and lands on / (real 2FA login)')

  // ── 5b. disable OTP again (restore the password-only deployment state) ──
  await dismissFirstRunDialogs(page)
  await page.click('button:has-text("设置")', { force: true })
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(600)
  await page.click('[role="dialog"] button:has-text("认证设置")', { force: true })
  await page.waitForSelector('text=双因素认证', { timeout: 10000 })
  await page.waitForTimeout(500)
  await page.click('button:has-text("禁用 OTP")')
  await page.waitForSelector('input[placeholder*="备份代码"]', { timeout: 10000 })
  await page.fill('input[placeholder*="备份代码"]', generateTOTP(otpSecret))
  await page.click('[role="dialog"] button:has-text("禁用")')
  await page.waitForFunction(() => document.body.innerText.includes('OTP 已禁用'), { timeout: 10000 })
  assert.ok(await page.evaluate(() => document.body.innerText.includes('未启用')),
    'the OTP card must return to disabled after the confirmed disable')
  ok('OTP disabled again with a fresh code (deployment state restored)')

  // The two 401 resource logs are the TEST's own wrong-password submissions
  // (browsers log a failed resource load for any HTTP error status — that is
  // the gate working, not a defect). Anything else is a real failure.
  const unexpected = jsErrors.filter(
    (e) => !e.startsWith('console: Failed to load resource: the server responded with a status of 401'),
  )
  assert.equal(unexpected.length, 0, `whole flow must stay error-free, got: ${unexpected.join(' | ')}`)
  ok('zero unexpected JS errors across the whole flow')
} finally {
  await browser.close()
}
