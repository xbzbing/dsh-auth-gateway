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
  // OTP configuration
  { key: 'otpEnabled', def: false, kind: 'bool' },
  { key: 'otpRequired', def: false, kind: 'bool' },
  { key: 'otpIssuer', def: 'DeepSeek Harness', kind: 'string' },
  { key: 'otpPeriod', def: 30, kind: 'int', min: 10, max: 120 },
  { key: 'otpDigits', def: 6, kind: 'int', min: 4, max: 10 },
  { key: 'otpWindow', def: 1, kind: 'int', min: 0, max: 5 },
  { key: 'backupCodeCount', def: 10, kind: 'int', min: 5, max: 20 },
  { key: 'backupCodeLength', def: 8, kind: 'int', min: 6, max: 12 },
]

/**
 * Validate and complete a raw plugin config. Returns a Standard Schema v1
 * result: `{ value }` on success (defaults filled), `{ issues }` on failure
 * (the Loader rejects the entry with the first issue's message).
 */
function validateConfig(value) {
  if (value === undefined || value === null) value = {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { issues: [{ message: 'dsh-password-gate: config must be an object' }] }
  }
  const out = {}
  const issues = []
  for (const { key, def, kind, min, max } of FIELDS) {
    // Defaults fill only `undefined` (a present-but-null field is an error,
    // matching Schemastery's `.default()` semantics).
    const v = value[key] === undefined ? def : value[key]
    if (kind === 'host') {
      if (typeof v !== 'string' || v.length === 0) {
        issues.push({ message: `dsh-password-gate: ${key} must be a non-empty host string`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (kind === 'string') {
      if (typeof v !== 'string' || v.length === 0) {
        issues.push({ message: `dsh-password-gate: ${key} must be a non-empty string`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (kind === 'bool') {
      if (typeof v !== 'boolean') {
        issues.push({ message: `dsh-password-gate: ${key} must be a boolean`, path: [key] })
      } else {
        out[key] = v
      }
    } else if (!Number.isInteger(v) || v < (min ?? 1) || v > (max ?? 65535)) {
      const range = kind === 'port'
        ? 'an integer port between 1 and 65535'
        : `an integer between ${String(min)} and ${String(max)}`
      issues.push({ message: `dsh-password-gate: ${key} must be ${range}`, path: [key] })
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
    vendor: 'dsh-password-gate',
    validate: validateConfig,
  },
}
