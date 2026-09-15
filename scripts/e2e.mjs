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
 *   5. the Remote mux WebSocket completes its handshake — catches a reverse
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
 * password changed to `${PASSWORD}-2`.
 */

import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:8002'
const PASSWORD = process.env.PASSWORD || 'e2e-pass'
const NEW_PASSWORD = `${PASSWORD}-2`

// Point at the locally cached executable instead of downloading ~150 MB.
// CHROMIUM_PATH wins (same override scripts/screenshots.mjs honours); the
// default tracks the cache directory the current playwright install produced.
const CACHED_CHROMIUM = process.env.CHROMIUM_PATH || path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/'
  + 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
)

let step = 0
function ok(name) {
  step += 1
  console.log(`ok ${step}  ${name}`)
}

/**
 * Close whatever first-run dialog is up (the beta notice with 继续, the
 * API-key wizard with 稍后配置) so UI behind it is clickable. Some dsh
 * builds greet a first sign-in with these; harmless when none is present.
 */
async function dismissFirstRunDialogs(page) {
  for (let i = 0; i < 5; i++) {
    const label = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => d.isConnected && d.offsetParent !== null)
      if (!dlg) return null
      const btn = [...dlg.querySelectorAll('button')]
        .find((b) => /继续|稍后配置/.test(b.textContent || ''))
      return btn ? btn.textContent.trim() : null
    })
    if (!label) return
    await page.click(`[role="dialog"] button:has-text("${label}")`, { force: true }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

const browser = await chromium.launch({ executablePath: CACHED_CHROMIUM, headless: true })
try {
  const page = await browser.newPage()
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
