/**
 * Central error-message dictionary for the gateway pages (login, onboarding,
 * OTP). Every server error code the pages can surface has exactly one entry
 * here — add or reword a message in ONE place instead of touching each page.
 *
 * Each page selects the subset it cares about via {@link errorsFor}; a page
 * that needs a context-specific wording for a shared key passes an override
 * (e.g. the onboarding page says "当前密码错误" instead of the generic
 * "密码错误", because there the user is re-verifying the old password while
 * changing it, not logging in).
 *
 * Security note: the login flow intentionally returns ONE code
 * (`invalid-credentials`) for password, OTP and backup-code failures, so an
 * attacker cannot tell which credential was wrong (credential-stuffing
 * mitigation). The three shared keys stay listed here because the protected
 * flows (OTP verify-setup / disable) still use them, where the caller already
 * holds a session and distinguishing the failing value is the point.
 */

/** Master dictionary: every key used by any page, both locales. */
export const ERRORS = {
  zh: {
    'bad-payload': '请求参数不正确',
    'backup-code-required': '请输入备份代码',
    'backup-code-used': '该备份代码已使用',
    'invalid-backup-code': '备份代码错误或已使用',
    'invalid-credentials': '密码或验证码错误',
    'invalid-otp': '验证码错误',
    'invalid-password': '密码错误',
    'otp-already-enabled': 'OTP已启用',
    'otp-length': '请输入 {digits} 位 OTP 验证码',
    'otp-not-enabled': 'OTP未启用',
    'otp-required': '请输入 OTP 验证码或备份代码',
    'otp-secret-missing': 'OTP 配置异常，请联系管理员',
    'password-mismatch': '两次输入的密码不一致',
    'password-required': '请输入密码',
    'password-too-short': '密码至少需要 8 位',
    'password-too-simple': '密码需包含大小写字母或特殊字符',
    'rate-limited': '尝试过于频繁，请稍后再试',
    'too-many-attempts': '尝试次数过多，请稍后再试',
    'unauthenticated': '登录状态已失效，请重新登录',
  },
  en: {
    'bad-payload': 'Invalid request parameters',
    'backup-code-required': 'Enter a backup code',
    'backup-code-used': 'That backup code has already been used',
    'invalid-backup-code': 'Invalid or already-used backup code',
    'invalid-credentials': 'Invalid password or code',
    'invalid-otp': 'Invalid code',
    'invalid-password': 'Wrong password',
    'otp-already-enabled': 'OTP is already enabled',
    'otp-length': 'Enter the {digits}-digit OTP code',
    'otp-not-enabled': 'OTP is not enabled',
    'otp-required': 'Enter the OTP code or a backup code',
    'otp-secret-missing': 'OTP configuration error, contact the administrator',
    'password-mismatch': 'Passwords do not match',
    'password-required': 'Enter your password',
    'password-too-short': 'Password must be at least 8 characters',
    'password-too-simple': 'Password needs mixed case or a special character',
    'rate-limited': 'Too many attempts, try again later',
    'too-many-attempts': 'Too many failed attempts — locked temporarily, try again later',
    'unauthenticated': 'Your session has expired, please sign in again',
  },
}

/**
 * Build the page-local error map a page embeds in its script head.
 * @param {string} locale - 'zh' (default) or 'en'.
 * @param {Iterable<string>} keys - error codes this page may surface.
 * @param {Record<string, { zh: string, en: string }>} [overrides] - context-specific
 *   wordings for shared keys (key → both locales).
 * @returns {Record<string, string>} error code → message for the page.
 */
export function errorsFor(locale, keys, overrides = {}) {
  const lang = ERRORS[locale] ? locale : 'zh'
  const out = {}
  for (const key of keys) {
    const override = overrides[key]
    if (override) out[key] = override[lang]
    else if (ERRORS[lang][key] !== undefined) out[key] = ERRORS[lang][key]
  }
  return out
}
