/**
 * Capture UI screenshots for the README (docs/assets/*.png).
 *
 * Usage: BASE=http://127.0.0.1:8002 INITIAL_PASSWORD=... node scripts/screenshots.mjs
 *
 * Requires a running throwaway instance:
 *
 *   DSH_HOME=/tmp/shots-home dsh --profile shots --port 8002
 *
 * Use a throwaway DSH_HOME: INITIAL_PASSWORD only exists on a fresh deployment,
 * and the script really does change the password and enable OTP — running it
 * against a live install would overwrite that install's credentials.
 *
 * Fresh deployments mint an initial password printed to the dsh console;
 * pass it via INITIAL_PASSWORD. The script walks onboarding (set a personal
 * password), then captures: onboarding, settings menu, authentication panel,
 * OTP setup page, login page (with OTP field), 2FA login success.
 *
 * CHROMIUM_PATH overrides browser discovery; otherwise scripts/chromium.mjs
 * probes playwright's own registry, the ms-playwright cache derived from the
 * environment, and finally a system chromium found on PATH.
 */

import { chromium } from 'playwright'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { resolveChromiumPath } from './chromium.mjs'
import { generateTOTP } from '../lib/totp.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8002'
const PASSWORD = process.env.PASSWORD || 'DemoPass!1'
const INITIAL = process.env.INITIAL_PASSWORD
const OUT = new URL('../docs/assets/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

// Locate the Chromium executable dynamically.
const executablePath = resolveChromiumPath({ playwrightExecutable: chromium.executablePath() })
if (!executablePath) {
  console.error('no chromium found: set CHROMIUM_PATH, run `npx playwright install chromium`,'
    + ' or install a system chromium')
  process.exit(2)
}
console.log('chromium:', executablePath)

const browser = await chromium.launch({ executablePath, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = await ctx.newPage()

let step = 0
function done(name, file) {
  step += 1
  console.log(`ok ${step}  ${name} -> docs/assets/${file}`)
}

/**
 * Dismiss dsh's first-run dialogs so the README screenshots show the normal UI.
 *
 * Three shapes ship today: the 0.2.1 preview notice (继续, focus-trapping), the
 * API-key wizard (稍后配置; its primary 保存并继续 stays DISABLED until a key is
 * typed, so a locator that merely matches 继续 resolves to a button that can
 * never be clicked), and the 0.2.1-alpha.3 account prompt (开始使用; offers only
 * 添加 API Key / 登录, so it has no skip button — it is closed through its own
 * close control). The queue pops the next dialog a few hundred ms after the
 * previous one closes, so a single quiet probe slips through the gap; only
 * return once the surface has stayed quiet for a full quiet window. Mirrors
 * scripts/e2e.mjs dismissWelcomeNotice + dismissFirstRunDialogs.
 */
async function dismissFirstRunDialogs(page) {
  const NOTICE_DEADLINE = Date.now() + 10000
  while (Date.now() < NOTICE_DEADLINE) {
    const present = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => d.isConnected && d.offsetParent !== null && /预览版说明/.test(d.textContent || ''))
      if (!dlg) return false
      const btn = [...dlg.querySelectorAll('button')].find((b) => /继续/.test(b.textContent || ''))
      btn?.click()
      return true
    })
    if (!present) break
    await page.waitForTimeout(500)
  }
  const QUIET_MS = 3000
  const DEADLINE = Date.now() + 20000
  let quietSince = Date.now()
  while (Date.now() < DEADLINE) {
    const dismissed = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')]
        .find((d) => d.isConnected && d.offsetParent !== null)
      if (!dlg) return false
      const skip = [...dlg.querySelectorAll('button')]
        .find((b) => !b.disabled && /稍后配置|稍后再说|知道了|跳过/.test(b.textContent || ''))
      if (skip) { skip.click(); return true }
      const close = dlg.querySelector('button[aria-label="关闭"], button[aria-label="Close"]')
      if (close !== null) { close.click(); return true }
      return false
    })
    if (dismissed) {
      quietSince = Date.now()
      await page.waitForTimeout(400)
    } else {
      if (Date.now() - quietSince >= QUIET_MS) return
      await page.waitForTimeout(300)
    }
  }
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
  // Clear any first-run dialog. On a fresh profile dsh opens an "add an API
  // key" prompt whose primary button (保存并继续) stays DISABLED until a key is
  // typed — the previous `button:has-text("继续")` locator matched exactly that
  // disabled button and hung until timeout. Prefer an explicit skip
  // affordance, and never click something that cannot be clicked.
  await dismissFirstRunDialogs(page);

  // ── 3. settings menu with the 认证设置 entry ─────────────────────────
  // dsh 0.2.1-alpha.3 moved the 设置 entry into the sidebar account menu
  // (ui-settings-account rewrote AccountMenu); earlier builds exposed a
  // standalone 设置 button. Same probe as scripts/e2e.mjs openSettings.
  const accountMenu = page.locator('button[aria-label="账号菜单"]')
  if (await accountMenu.count() > 0) {
    await accountMenu.first().click()
    await page.click('button[role="menuitem"]:has-text("设置")')
  } else {
    await page.click('button:has-text("设置")', { force: true })
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT, 'settings-menu.png') })
  done('settings menu (rail with 认证设置)', 'settings-menu.png')

  // ── 4. user settings panel (Cookie 安全 card: dsh Menu dropdown) ────
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
  // Fetches run inside the /otp/setup document: resolve against the gateway
  // basePath, never the document directory (relative 'otp/enable' from
  // /otp/setup would hit /otp/otp/enable).
  const enable = await page.evaluate(async (base) =>
    (await fetch(base + '/otp/enable', { method: 'POST' })).json(), BASE)
  const code = generateTOTP(enable.secret)
  const verify = await page.evaluate(async ({ base, otp }) => {
    const r = await fetch(base + '/otp/verify-setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ otp }),
    })
    return r.json()
  }, { base: BASE, otp: code })
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
  // The first-run API-key prompt is not persisted per profile: it shows again
  // on this fresh page load, so clear it here too or the "homepage" screenshot
  // is really a screenshot of that modal.
  await dismissFirstRunDialogs(page);
  await page.waitForTimeout(500)
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
