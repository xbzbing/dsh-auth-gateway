/**
 * Plugin identity and version comparison.
 *
 * The settings panel shows which version this installation runs and links to
 * the repository; the update check (lib/update-check.js) needs the same
 * version to decide whether a registry release is newer. Both read the one
 * source of truth: the package.json sitting next to this module in the
 * installed copy (`lib/../package.json`). Nothing is hardcoded except a
 * fallback used when package.json is unreadable or carries no repository —
 * a deployment that lost its metadata must still render a panel, not throw.
 *
 * Versions are compared by a dependency-free SemVer subset: numeric
 * major/minor/patch, then the prerelease chain per SemVer §11 (a release
 * outranks its own prereleases, numeric identifiers rank below
 * alphanumeric ones). Build metadata (`+sha`) is ignored, as the spec
 * requires. Anything unparsable compares as `null` — "cannot tell", which
 * the callers surface as "unknown" instead of inventing an answer.
 */

import { readFileSync } from 'node:fs'

/** npm package name; also the registry path the update check queries. */
export const PACKAGE_NAME = 'dsh-auth-gateway'

/** Shown when package.json cannot be read. Parses as nothing, so it never
 *  fabricates an "update available" verdict. */
export const UNKNOWN_VERSION = 'unknown'

/** Repository used when package.json carries no (usable) repository field. */
export const FALLBACK_REPOSITORY = 'https://github.com/xbzbing/dsh-auth-gateway'

/** SemVer with an optional `v` prefix and optional `+build` metadata. */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parse a version into comparable parts, or `null` when it is not a version.
 * @param {unknown} value
 * @returns {{numbers: number[], prerelease: string[] | null} | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = SEMVER.exec(value.trim())
  if (match === null) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  }
}

/** Order two prerelease chains per SemVer §11: -1, 0 or 1. */
function comparePrerelease(left, right) {
  if (left === null && right === null) return 0
  if (left === null) return 1 // a release outranks its prereleases
  if (right === null) return -1
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const a = left[i]
    const b = right[i]
    if (a === undefined) return -1 // a shorter chain ranks lower
    if (b === undefined) return 1
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1 // numeric identifiers rank below alphanumeric
    } else if (a !== b) {
      return a < b ? -1 : 1
    }
  }
  return 0
}

/**
 * Compare two versions. Returns -1 / 0 / 1, or `null` when either side is
 * not a parsable version (the caller must treat that as "unknown", never as
 * "equal").
 * @param {unknown} left
 * @param {unknown} right
 * @returns {-1 | 0 | 1 | null}
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Whether `candidate` is strictly newer than `current`. An unparsable pair
 * is `false` (no update claimed) — callers that need to distinguish "no
 * update" from "cannot tell" use compareVersions directly.
 * @param {unknown} candidate
 * @param {unknown} current
 * @returns {boolean}
 */
export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) === 1
}

/**
 * Normalize a package.json `repository`/`homepage` value into a browsable
 * https URL. Accepts the string and `{ url }` forms, rewrites the git
 * shorthands npm allows (`git+https://`, `git://`, `git@host:owner/repo`)
 * and strips a trailing `.git`. Anything that does not end up as http(s)
 * falls back — a link rendered into the panel is always a real URL.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRepository(value) {
  const raw = typeof value === 'string' ? value : value?.url
  if (typeof raw !== 'string' || raw.trim() === '') return FALLBACK_REPOSITORY
  let url = raw.trim().replace(/^git\+/, '').replace(/^git:\/\//, 'https://')
  const scp = /^git@([^:]+):(.+)$/.exec(url)
  if (scp !== null) url = `https://${scp[1]}/${scp[2]}`
  url = url.replace(/\.git$/, '').replace(/\/+$/, '')
  return /^https?:\/\//.test(url) ? url : FALLBACK_REPOSITORY
}

/**
 * Read the version and repository of this installation.
 * @param {URL} [url] - package.json location (injectable for tests)
 * @returns {{version: string, repository: string}}
 */
export function readPackageMeta(url = new URL('../package.json', import.meta.url)) {
  try {
    const raw = JSON.parse(readFileSync(url, 'utf8'))
    return {
      version: typeof raw?.version === 'string' && raw.version.trim() !== ''
        ? raw.version.trim()
        : UNKNOWN_VERSION,
      repository: normalizeRepository(raw?.repository ?? raw?.homepage),
    }
  } catch {
    return { version: UNKNOWN_VERSION, repository: FALLBACK_REPOSITORY }
  }
}
