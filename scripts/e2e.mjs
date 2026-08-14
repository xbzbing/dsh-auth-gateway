/**
 * End-to-end test against a REAL dsh web instance with the login plugin.
 *
 * Covers the full product flow in a browser:
 *   1. first-open setup password page
 *   2. setup -> straight into the dsh homepage, UI loaded, zero JS errors
 *      (regression: crypto.randomUUID is not a function on plain-HTTP LAN)
 *   3. logout -> login page -> wrong password rejected -> login -> homepage
 *   4. change password -> all sessions revoked -> re-login with new password
 *
 * Usage (against a running `dsh web --port 8002`):
 *   PASSWORD=e2e-pass node scripts/e2e.mjs
 *
 * The script adapts to both fresh (setup page) and configured (login page)
 * deployments. It ends with the password changed to `${PASSWORD}-2`.
 */

import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:8002'
const PASSWORD = process.env.PASSWORD || 'e2e-pass'
const NEW_PASSWORD = `${PASSWORD}-2`

// Playwright 1.62 expects a newer chromium than the machine has cached; point
// at the locally cached executable instead of downloading ~150 MB.
const CACHED_CHROMIUM = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/'
  + 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
)

let step = 0
function ok(name) {
  step += 1
  console.log(`ok ${step}  ${name}`)
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

  // ── 0. unauthenticated API gate (server-side, not UI) ─────────────────
  const unauth = await page.request.post(`${BASE}/api/session.list`, { data: {} })
  assert.equal(unauth.status(), 401, 'unauthenticated /api must be 401')
  ok('unauthenticated /api answers 401 (real interception)')

  // ── 1. login page: setup or auth by server-side state ─────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form', { timeout: 10000 })
  const pageText = await page.evaluate(() => document.body.innerText)
  if (pageText.includes('设置密码')) {
    await page.fill('#password', PASSWORD)
    await page.fill('#confirm', PASSWORD)
    await page.click('button[type=submit]')
    ok('first open shows setup page; password set')
  } else {
    await page.fill('#password', PASSWORD)
    await page.click('button[type=submit]')
    ok('configured deployment: logged in with existing password')
  }

  // ── 2. after auth: must land on the homepage with a working UI ────────
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  ok('after auth the page lands on / (not stuck on /login)')
  await page.waitForTimeout(2500) // let the app settle; catch late errors
  assert.equal(jsErrors.length, 0,
    `homepage must load with zero JS errors, got: ${jsErrors.join(' | ')}`)
  ok('homepage UI loaded with zero JS errors (randomUUID polyfill works)')

  // ── 3. the settings panel must offer the injected 修改密码 entry ──────
  // dsh may pop its first-open "内测声明" modal; dismiss it so the settings
  // trigger is reachable.
  const notice = page.locator('[role="dialog"] button:has-text("继续")')
  if (await notice.count() > 0) {
    await notice.click()
    await page.waitForTimeout(500)
  }
  // Open the settings dialog (sidebar trigger), assert the rail button
  // exists, and follow it — it must land on the change-password form.
  // (force: dsh UI keeps animating, so Playwright's stability check stalls.)
  await page.waitForSelector('button:has-text("设置")', { timeout: 10000 })
  await page.click('button:has-text("设置")', { force: true })
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 })
  await page.waitForSelector('[role="dialog"] button:has-text("修改密码")', { timeout: 10000 })
  ok('settings panel shows the injected "修改密码" entry in the section rail')
  await page.click('[role="dialog"] button:has-text("修改密码")')
  await page.waitForSelector('#change', { timeout: 10000 })
  ok('settings entry opens the change-password form at /login')

  // ── 4. logout -> login page -> wrong password -> login ────────────────
  await page.click('#logout')
  await page.waitForSelector('#auth', { timeout: 10000 })
  ok('logout returns to the login form')

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

  // ── 5. change password revokes the session ────────────────────────────
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
