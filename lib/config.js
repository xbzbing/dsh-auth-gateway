/**
 * Plugin Config as a Standard Schema v1 validator.
 *
 * dsh requires deployment-varying options to be validated Config fields
 * (AGENTS.md "No hardcoded tunables"), and Cordis validates a plugin's
 * exported `Config` through its Standard Schema `validate` before `apply`
 * runs (vendor/cordis/src/fiber.ts resolveConfig). The tutorial's Schemastery
 * is a repo-internal dependency; an out-of-tree plugin keeps zero runtime
 * dependencies by implementing the same Standard Schema contract by hand.
 */

const FIELDS = [
  { key: 'listenHost', def: '0.0.0.0', kind: 'host' },
  { key: 'listenPort', def: 3080, kind: 'port' },
  { key: 'upstreamHost', def: '127.0.0.1', kind: 'host' },
  { key: 'upstreamPort', def: 3081, kind: 'port' },
  { key: 'minPasswordLength', def: 8, kind: 'int', min: 4, max: 128 },
  { key: 'requireMixedCase', def: true, kind: 'bool' },
  { key: 'requireSpecial', def: true, kind: 'bool' },
  { key: 'maxLoginFailures', def: 5, kind: 'int', min: 1, max: 100 },
  { key: 'lockMinutes', def: 5, kind: 'int', min: 1, max: 1440 },
  { key: 'maxGlobalAuthAttemptsPerMinute', def: 60, kind: 'int', min: 1, max: 10000 },
  { key: 'maxOtpAttemptsPerMinute', def: 10, kind: 'int', min: 1, max: 10000 },
  // Sub-path prefix for reverse-proxy deployments (e.g. '/dsh')
  { key: 'basePath', def: '/', kind: 'path' },
  // Whether the session cookie carries the Secure attribute. 'auto' (the
  // default, and byte-for-byte today's behavior on plain HTTP) follows the
  // connection: a TLS-terminated request (socket.encrypted) or one a reverse
  // proxy marked `X-Forwarded-Proto: https` gets Secure, so enabling HTTPS in
  // front of the gateway arms the attribute with no config change. `true`
  // forces it — for a TLS proxy that does not forward the protocol header —
  // and on a plain-HTTP link browsers then refuse to store or send the cookie,
  // so an HTTPS-only deployment fails loudly instead of silently downgrading.
  // `false` opts out explicitly (trusted-network deployments that keep plain
  // HTTP and accept the sniffing exposure).
  { key: 'cookieSecure', def: 'auto', kind: 'cookieSecure' },
  // 匿名可达的上游握手路径（精确匹配、仅 GET）：由上游自己保证安全的一次性
  // 握手端点。默认值只有 dsh 账号登录的 OAuth 回调 `/oauth/callback`——平台把
  // 它作为**跨站顶层导航**回跳（platform.deepseek.com → http://localhost:<port>/
  // oauth/callback），浏览器不会在这类导航里携带 SameSite=Strict 的网关会话
  // Cookie，请求必然匿名到达；上游对该端点用 state + PKCE 校验，不依赖网关
  // 会话（见 docs/zh|en/SECURITY.md「匿名可达的上游握手路径」）。只做精确匹配、
  // 不支持通配符（放行面必须可枚举、可审计）；设为 `[]` 即完全关闭这条放行。
  { key: 'publicPaths', def: ['/oauth/callback'], kind: 'paths' },
  { key: 'otpIssuer', def: 'dsh-auth-gateway', kind: 'string' },
  { key: 'otpPeriod', def: 30, kind: 'int', min: 10, max: 120 },
  { key: 'otpDigits', def: 6, kind: 'int', min: 4, max: 10 },
  { key: 'otpWindow', def: 1, kind: 'int', min: 0, max: 5 },
  { key: 'backupCodeCount', def: 10, kind: 'int', min: 5, max: 20 },
  { key: 'backupCodeLength', def: 8, kind: 'int', min: 6, max: 12 },
  // Automatic new-version check when the settings panel opens. OFF by
  // default: a fresh install makes no outbound request at all. The panel's
  // "check for updates" button performs an explicit on-demand check whatever
  // this is set to — a request then happens only because a signed-in user
  // asked for one. Turn this on to also check automatically on open.
  // (The registry lookup is the only outbound request the plugin makes; see
  // lib/update-check.js.)
  { key: 'updateCheck', def: false, kind: 'bool' },
]

/**
 * Paths a `publicPaths` exemption must never name. Two families:
 * - surfaces the gateway serves itself, matched BEFORE the auth gate
 *   (`/login*`, `/login-api/*`, `/otp/*`, `/onboarding*`): an entry is a
 *   silent no-op because the built-in route wins the first-match lookup;
 * - surfaces whose anonymity would break a documented contract or hand over
 *   the whole upstream face: `/` (the index), `/api*` (the RPC namespace the
 *   gateway promises to answer 401 for), `/connect` (the launch-token
 *   exchange that mints a session), plus the paths that are already public by
 *   design (`/assets/*`, `/favicon.svg`, `/manifest.webmanifest`).
 * `publicPaths` is for upstream-owned one-shot handshake endpoints only — the
 * exempted surface has to stay enumerable and auditable.
 */
const RESERVED_PUBLIC_PATHS = ['/', '/manifest.webmanifest', '/favicon.svg']
const RESERVED_PUBLIC_PREFIXES = ['/api', '/connect', '/login', '/login-api', '/otp', '/onboarding', '/assets']

/** @param {string} path @returns {boolean} */
function isReservedPublicPath(path) {
  if (RESERVED_PUBLIC_PATHS.includes(path)) return true
  return RESERVED_PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * Validate and complete a raw plugin config. Returns a Standard Schema v1
 * result: `{ value }` on success (defaults filled), `{ issues }` on failure
 * (the Loader rejects the entry with the first issue's message).
 */
function validateConfig(value) {
  if (value === undefined || value === null) value = {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { issues: [{ message: 'dsh-auth-gateway: config must be an object' }] }
  }
  const out = {}
  const issues = []
  for (const key of Object.keys(value)) {
    if (!FIELDS.some((field) => field.key === key)) {
      issues.push({ message: `dsh-auth-gateway: unknown config field ${key}`, path: [key] })
    }
  }
  for (const { key, def, kind, min, max } of FIELDS) {
    // Defaults fill only `undefined` (a present-but-null field is an error,
    // matching Schemastery's `.default()` semantics).
    const v = value[key] === undefined ? def : value[key]
    if (kind === 'host') {
      if (typeof v !== 'string' || v.length === 0) {
        issues.push({ message: `dsh-auth-gateway: ${key} must be a non-empty host string`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (kind === 'string') {
      if (typeof v !== 'string' || v.length === 0) {
        issues.push({ message: `dsh-auth-gateway: ${key} must be a non-empty string`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (kind === 'path') {
      // Strict sub-path charset: the value is embedded into served pages
      // (script globals + hrefs), so quotes, angle brackets, whitespace and
      // protocol-relative `//` are rejected outright — config is trusted,
      // but a hostile value must not be able to break out of the HTML.
      // This is an allowlist and therefore a compatibility tightening: a
      // deployment carrying e.g. `/app+v2` or `/a%20b` is now rejected at
      // load (the entry is refused, loudly) and must use the charset below.
      if (typeof v !== 'string' || !v.startsWith('/') || v.includes('..')
        || v.includes('//') || /[^A-Za-z0-9._~/-]/.test(v)) {
        issues.push({
          message: `dsh-auth-gateway: ${key} must be a sub-path starting with '/' `
            + 'using only A-Za-z0-9._~/- (no "..", "//", quotes, whitespace or angle brackets; e.g. \'/dsh\')',
          path: [key],
        })
      } else {
        out[key] = v
      }
    } else if (kind === 'bool') {
      if (typeof v !== 'boolean') {
        issues.push({ message: `dsh-auth-gateway: ${key} must be a boolean`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (kind === 'cookieSecure') {
      // Three-state: the string 'auto' or a boolean. Anything else (including
      // `null` and the lookalikes 'true'/'on') is rejected rather than
      // coerced — a typo must not silently pin the attribute either way.
      if (v !== 'auto' && v !== true && v !== false) {
        issues.push({
          message: `dsh-auth-gateway: ${key} must be 'auto', true or false`,
          path: [key],
        })
      } else {
        out[key] = v
      }
    } else if (kind === 'paths') {
      // 精确路径列表：字符集与 basePath 同源（值会参与路由匹配与日志），并
      // 额外拒绝查询串/片段——配置只声明路径本身，查询串随请求原样转发。
      // 数组与逗号分隔字符串都接受；空数组是合法取值（= 关闭放行）。
      const list = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : null)
      if (list === null) {
        issues.push({
          message: `dsh-auth-gateway: ${key} must be an array of absolute paths (or a comma-separated string)`,
          path: [key],
        })
      } else {
        const normalized = []
        let malformed = false
        for (const entry of list) {
          const item = typeof entry === 'string' ? entry.trim() : ''
          if (item === '' || !item.startsWith('/') || item.includes('..') || item.includes('//')
            || /[^A-Za-z0-9._~/-]/.test(item)) {
            issues.push({
              message: `dsh-auth-gateway: ${key} entries must be absolute paths using only `
                + 'A-Za-z0-9._~/- (no "..", "//", quotes, whitespace, query or angle brackets; e.g. \'/oauth/callback\')',
              path: [key],
            })
            malformed = true
            break
          }
          if (isReservedPublicPath(item)) {
            issues.push({
              message: `dsh-auth-gateway: ${key} must not name the reserved path ${item} — the index, `
                + '/api*, /connect, the gateway\'s own pages (/login*, /login-api/*, /otp/*, /onboarding*) '
                + 'and the already-public static assets cannot be exempted; publicPaths is for '
                + 'upstream-owned handshake endpoints only (e.g. \'/oauth/callback\')',
              path: [key],
            })
            malformed = true
            break
          }
          if (!normalized.includes(item)) normalized.push(item)
        }
        if (!malformed) out[key] = normalized
      }
    } else if (!Number.isInteger(v) || v < (min ?? 1) || v > (max ?? 65535)) {
      const range = kind === 'port'
        ? 'an integer port between 1 and 65535'
        : `an integer between ${String(min)} and ${String(max)}`
      issues.push({ message: `dsh-auth-gateway: ${key} must be ${range}`, path: [key] })
    } else {
      out[key] = v
    }
  }
  return issues.length > 0 ? { issues } : { value: out }
}

/** Standard Schema v1 validator object, exported as the plugin's `Config`. */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-auth-gateway',
    validate: validateConfig,
  },
}
