/**
 * Locale resolution tests: the gateway page-language decision chain
 * (dsh preference > Accept-Language > zh) and the bilingual page rendering.
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localePreference, acceptLanguagePrimary, pageLocale } from '../lib/locale.js'
import { loginPageHtml } from '../lib/login-page.js'
import { onboardingPageHtml, onboardingPasswordPageHtml } from '../lib/onboarding-page.js'
import { otpSetupPage, otpVerifyPage } from '../lib/otp-page.js'

let home

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-auth-gate-locale-test-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

// ── language resolution ─────────────────────────────────────────────────

test('localePreference reads locale.preference from $DSH_HOME/settings.yaml', () => {
  assert.equal(localePreference(), undefined, 'no settings file -> undefined')

  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: en\n')
  assert.equal(localePreference(), 'en')

  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: "zh"\n')
  assert.equal(localePreference(), 'zh')

  // Unknown values are ignored (fall back to Accept-Language/zh).
  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: ja\n')
  assert.equal(localePreference(), undefined)

  // Other namespaces never count.
  writeFileSync(join(home, 'settings.yaml'), 'ui-theme:\n  preference: dark\n')
  assert.equal(localePreference(), undefined)
})

test('acceptLanguagePrimary picks the highest q-value primary subtag', () => {
  assert.equal(acceptLanguagePrimary('en-US,en;q=0.9,zh;q=0.8'), 'en')
  assert.equal(acceptLanguagePrimary('zh-CN,zh;q=0.9,en;q=0.8'), 'zh')
  assert.equal(acceptLanguagePrimary('en;q=0.5,zh;q=0.9'), 'zh')
  assert.equal(acceptLanguagePrimary('en-US'), 'en')
  assert.equal(acceptLanguagePrimary('fr-FR,fr;q=0.9'), 'fr')
  assert.equal(acceptLanguagePrimary(undefined), undefined)
  assert.equal(acceptLanguagePrimary(''), undefined)
  assert.equal(acceptLanguagePrimary(';q=0.5'), undefined)
})

test('pageLocale: preference wins, then Accept-Language, then zh fallback', () => {
  // Preference always beats the request header.
  assert.equal(pageLocale('en', 'zh-CN,zh;q=0.9'), 'en')
  assert.equal(pageLocale('zh', 'en-US,en;q=0.9'), 'zh')
  // No preference: browser language decides (en* -> en, else zh).
  assert.equal(pageLocale(undefined, 'en-US,en;q=0.9'), 'en')
  assert.equal(pageLocale(undefined, 'zh-CN,zh;q=0.9'), 'zh')
  // Unknown header values and missing headers fall back to zh.
  assert.equal(pageLocale(undefined, 'fr-FR,fr;q=0.9'), 'zh')
  assert.equal(pageLocale(undefined, undefined), 'zh')
})

// ── bilingual page rendering ────────────────────────────────────────────

test('login page renders English copy with locale=en, zh stays the default', () => {
  const en = loginPageHtml({ mode: 'auth', locale: 'en' })
  assert.ok(en.includes('Sign in'), 'en title/button')
  assert.ok(en.includes('Enter your access password to continue.'), 'en subtitle')
  assert.ok(en.includes('Wrong password'), 'en error map')
  assert.ok(!en.includes('请输入访问密码'), 'no zh copy leaked')

  const enOtp = loginPageHtml({ mode: 'auth', otpEnabled: true, locale: 'en' })
  assert.ok(enOtp.includes('Use a backup code to sign in'), 'en backup toggle')
  assert.ok(enOtp.includes('Enter the OTP code'), 'en otp label')

  const enChange = loginPageHtml({ mode: 'change', locale: 'en' })
  assert.ok(enChange.includes('Change password'), 'en change form')
  assert.ok(enChange.includes('All sessions will be revoked'), 'en change subtitle')

  const zh = loginPageHtml({ mode: 'auth' })
  assert.ok(zh.includes('请输入访问密码以继续。'), 'zh default copy')
  assert.ok(zh.includes('密码错误'), 'zh error map')
})

test('onboarding pages render English copy with locale=en', () => {
  // Step 1: the OTP binding flow is shown directly (auto-started on load),
  // with a skip button to the password step.
  const step1 = onboardingPageHtml({ locale: 'en' })
  assert.ok(step1.includes('Bind a TOTP authenticator'), 'en step-1 title')
  assert.ok(step1.includes('Skip — set the password'), 'en skip button')
  assert.ok(step1.includes("location.href=__basePath+'/onboarding/password'"), 'skip links to the password step')
  assert.ok(step1.includes('Verify & enable'), 'en binding-flow button')
  assert.ok(step1.includes("post(__basePath + '/otp/enable', {}"), 'binding flow auto-starts on load')

  // Step 2: mandatory personal password form (its script carries the errors).
  const step2 = onboardingPasswordPageHtml({ locale: 'en' })
  assert.ok(step2.includes('Set your access password'), 'en step-2 title')
  assert.ok(step2.includes('Set new password'), 'en submit button')
  assert.ok(step2.includes('The new passwords do not match'), 'en error map')

  const zh1 = onboardingPageHtml()
  assert.ok(zh1.includes('绑定 OTP 双因素认证'), 'zh step-1 default')
  assert.ok(zh1.includes('验证并启用'), 'zh binding-flow button')
  const zh2 = onboardingPasswordPageHtml()
  assert.ok(zh2.includes('设置你的访问密码'), 'zh step-2 default')
})

test('otp pages render English copy with digits interpolation', () => {
  const setup = otpSetupPage({ uri: 'otpauth://totp/t:u', secret: 'S', backupCodes: [], digits: 8, locale: 'en' })
  assert.ok(setup.includes('Enter the 8-digit code shown in your authenticator app:'), 'en setup subtitle interpolates digits')
  assert.ok(!setup.includes('{digits}'), 'no literal placeholder')
  assert.ok(setup.includes('Verify & enable'), 'en setup button')

  const verify = otpVerifyPage({ hasBackupCodes: true, digits: 6, locale: 'en' })
  assert.ok(verify.includes('OTP verification'), 'en verify title')
  assert.ok(verify.includes('Use a backup code'), 'en backup entry')
  assert.ok(verify.includes('Invalid OTP code'), 'en error map')

  const zh = otpVerifyPage({ digits: 6 })
  assert.ok(zh.includes('OTP 验证'), 'zh default')
})
