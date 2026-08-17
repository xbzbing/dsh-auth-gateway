/**
 * Capture UI screenshots for the README (docs/assets/*.png).
 *
 * Usage: node scripts/screenshots.mjs
 * Requires a running instance with OTP enabled in the composition:
 *   dsh --profile web --patch /tmp/demo-otp.yml --port 8002
 * (demo-otp.yml sets otpEnabled: true so the OTP pages are reachable.)
 *
 * Fresh deployments mint an initial password printed to the dsh console;
 * pass it via INITIAL_PASSWORD. The script walks onboarding (set a personal
 * password), then captures: onboarding, settings menu, authentication panel,
 * OTP setup page, login page (with OTP field), 2FA login success.
 */

import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { generateTOTP } from '../lib/totp.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8002'
const PASSWORD = process.env.PASSWORD || 'DemoPass!1'
const INITIAL = process.env.INITIAL_PASSWORD
const OUT = new URL('../docs/assets/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const CACHED_CHROMIUM = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/'
  + 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
)

const browser = await chromium.launch({ executablePath: CACHED_CHROMIUM, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()

let step = 0
function done(name, file) {
  step += 1
  console.log(`ok ${step}  ${name} -> docs/assets/${file}`)
}

try {
  // ── 1. onboarding step 1 (optional OTP binding) after initial login ──
  assertInitial()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#auth', { timeout: 10000 })
  await page.fill('#password', INITIAL)
  await page.click('button[type=submit]')
  await page.waitForURL('**/onboarding', { timeout: 15000 })
  // The binding flow auto-starts on load (QR + secret + verify form).
  await page.waitForSelector('#otp-setup', { state: 'visible', timeout: 10000 })
  await page.waitForSelector('#qr[src]', { timeout: 10000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, 'onboarding.png') })
  done('onboarding step 1 (optional OTP binding)', 'onboarding.png')

  // ── 2. skip to the password step, finish onboarding, land on home ────
  await page.click('button:has-text("跳过，直接设置密码")', { force: true })
  await page.waitForURL('**/onboarding/password', { timeout: 15000 })
  await page.waitForSelector('#change-form', { timeout: 10000 })
  await page.fill('#oldPassword', INITIAL)
  await page.fill('#newPassword', PASSWORD)
  await page.fill('#confirm', PASSWORD)
  await page.click('#change-form button[type=submit]')
  await page.waitForSelector('#auth', { timeout: 15000 })
  await page.fill('#password', PASSWORD)
  await page.click('button[type=submit]', { force: true })
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  await page.waitForTimeout(2500)
  // Dismiss the first-open notice modal if present.
  const notice = page.locator('[role="dialog"] button:has-text("继续")')
  if (await notice.count() > 0) {
    await notice.click()
    await page.waitForTimeout(500)
  }

  // ── 3. settings menu with the 认证设置 entry ─────────────────────────
  await page.click('button:has-text("设置")', { force: true })
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT, 'settings-menu.png') })
  done('settings menu (rail with 认证设置)', 'settings-menu.png')

  // ── 4. user settings panel ──────────────────────────────────────────
  await page.click('[role="dialog"] button:has-text("认证设置")', { force: true })
  await page.waitForSelector('text=OTP 双因素认证', { timeout: 10000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'settings-auth.png') })
  done('user settings panel (OTP / change password / logout)', 'settings-auth.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // ── 5. OTP setup page ───────────────────────────────────────────────
  await page.goto(`${BASE}/otp/setup`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#qr', { timeout: 10000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, 'otp-setup.png') })
  done('OTP setup page (QR + secret)', 'otp-setup.png')

  // ── 6. enable OTP via the API (compute a real TOTP code) ─────────────
  const enable = await (await page.evaluate(async () => (await fetch('/otp/enable', { method: 'POST' })).json()))
  const code = generateTOTP(enable.secret)
  const verify = await page.evaluate(async (otp) => {
    const r = await fetch('/otp/verify-setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp }),
    })
    return r.json()
  }, code)
  if (!verify.ok) throw new Error('OTP enable failed: ' + JSON.stringify(verify))

  // ── 7. enabling OTP revoked every session: the login page now carries ──
  // the OTP field (and the backup-code toggle)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#auth', { timeout: 10000 })
  await page.waitForSelector('#otp', { timeout: 10000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'login.png') })
  done('login page (password + OTP field)', 'login.png')

  // ── 8. 2FA login: password + a fresh TOTP code lands on the homepage ──
  // (login requires the code whenever 2FA is active; the /otp/verify page is
  // reserved for sessions predating the 2FA enablement, so it is not part of
  // the normal flow and not captured here)
  await page.fill('#password', PASSWORD)
  await page.fill('#otp', generateTOTP(enable.secret))
  await page.click('button[type=submit]')
  await page.waitForURL(`${BASE}/`, { timeout: 15000 })
  await page.waitForSelector('text=新会话', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(OUT, 'login-success.png') })
  done('2FA login success (homepage)', 'login-success.png')
} finally {
  await browser.close()
}

/** Require the initial password for a fresh-deployment capture. */
function assertInitial() {
  if (!INITIAL) {
    console.error('missing INITIAL_PASSWORD: fresh deployments print it to the dsh console on first boot')
    process.exit(2)
  }
}
