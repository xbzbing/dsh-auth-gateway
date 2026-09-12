/**
 * Version and package-identity tests: the panel's "current version" and the
 * update notice both hinge on this module being right, and on it never
 * inventing an answer it cannot derive.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FALLBACK_REPOSITORY,
  UNKNOWN_VERSION,
  compareVersions,
  isNewerVersion,
  normalizeRepository,
  parseVersion,
  readPackageMeta,
} from '../lib/version.js'

test('compareVersions orders major, minor and patch numerically', () => {
  assert.equal(compareVersions('0.6.0', '0.6.0'), 0)
  assert.equal(compareVersions('0.6.1', '0.6.0'), 1)
  assert.equal(compareVersions('0.6.0', '0.6.1'), -1)
  assert.equal(compareVersions('0.7.0', '0.6.9'), 1)
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1)
  // Numeric, not lexicographic: 10 > 9 (a string compare would say otherwise).
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1)
  assert.equal(compareVersions('0.6.10', '0.6.9'), 1)
})

test('compareVersions treats a release as newer than its prereleases', () => {
  assert.equal(compareVersions('0.7.0', '0.7.0-rc.1'), 1)
  assert.equal(compareVersions('0.7.0-rc.1', '0.7.0'), -1)
  assert.equal(compareVersions('0.7.0-rc.2', '0.7.0-rc.1'), 1)
  assert.equal(compareVersions('0.7.0-rc.1', '0.7.0-rc.1'), 0)
  // A shorter chain ranks lower when the shared identifiers match.
  assert.equal(compareVersions('0.7.0-rc', '0.7.0-rc.1'), -1)
  // Numeric identifiers rank below alphanumeric ones (SemVer §11).
  assert.equal(compareVersions('0.7.0-1', '0.7.0-alpha'), -1)
  assert.equal(compareVersions('0.7.0-alpha.10', '0.7.0-alpha.9'), 1)
})

test('compareVersions ignores build metadata and accepts a v prefix', () => {
  assert.equal(compareVersions('0.7.0+build.5', '0.7.0'), 0)
  assert.equal(compareVersions('v0.7.0', '0.7.0'), 0)
  assert.equal(compareVersions('v0.7.0', 'v0.6.0'), 1)
})

test('compareVersions returns null for anything unparsable', () => {
  for (const bad of ['', 'unknown', '0.6', '1', 'latest', 'x.y.z', null, undefined, 42, {}]) {
    assert.equal(compareVersions(bad, '0.6.0'), null, `${String(bad)} must not compare`)
    assert.equal(compareVersions('0.6.0', bad), null, `${String(bad)} must not compare`)
  }
  assert.deepEqual(parseVersion('0.6.0'), { numbers: [0, 6, 0], prerelease: null })
  assert.deepEqual(parseVersion('v1.2.3-rc.1+build'), { numbers: [1, 2, 3], prerelease: ['rc', '1'] })
  assert.equal(parseVersion('nope'), null)
})

test('isNewerVersion is false when either side is unparsable', () => {
  assert.equal(isNewerVersion('0.7.0', '0.6.0'), true)
  assert.equal(isNewerVersion('0.6.0', '0.6.0'), false)
  assert.equal(isNewerVersion('0.5.0', '0.6.0'), false)
  // "cannot tell" must never be reported as "no update" by this helper's
  // callers, so an unparsable pair is simply false here.
  assert.equal(isNewerVersion('latest', UNKNOWN_VERSION), false)
})

test('normalizeRepository accepts every shape npm allows', () => {
  const expected = 'https://github.com/xbzbing/dsh-auth-gateway'
  assert.equal(normalizeRepository('https://github.com/xbzbing/dsh-auth-gateway'), expected)
  assert.equal(normalizeRepository('git+https://github.com/xbzbing/dsh-auth-gateway.git'), expected)
  assert.equal(normalizeRepository('git://github.com/xbzbing/dsh-auth-gateway.git'), expected)
  assert.equal(normalizeRepository('git@github.com:xbzbing/dsh-auth-gateway.git'), expected)
  assert.equal(normalizeRepository('https://github.com/xbzbing/dsh-auth-gateway/'), expected)
  assert.equal(normalizeRepository({ type: 'git', url: 'git+https://github.com/xbzbing/dsh-auth-gateway.git' }), expected)
})

test('normalizeRepository refuses to produce a non-http link', () => {
  for (const bad of [undefined, null, '', '   ', 42, {}, { url: 7 }, 'javascript:alert(1)', 'file:///etc/passwd']) {
    assert.equal(normalizeRepository(bad), FALLBACK_REPOSITORY, `${String(bad)} must fall back`)
  }
})

test('readPackageMeta reads the shipped package.json', () => {
  const meta = readPackageMeta()
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(meta.version, pkg.version)
  assert.equal(parseVersion(meta.version) !== null, true, 'the shipped version must be parsable')
  assert.equal(meta.repository, 'https://github.com/xbzbing/dsh-auth-gateway')
})

test('readPackageMeta degrades instead of throwing', () => {
  const missing = readPackageMeta(new URL('./does-not-exist.json', import.meta.url))
  assert.equal(missing.version, UNKNOWN_VERSION)
  assert.equal(missing.repository, FALLBACK_REPOSITORY)
  // An unparsable version must not become a comparable one.
  assert.equal(compareVersions('0.7.0', missing.version), null)
})
