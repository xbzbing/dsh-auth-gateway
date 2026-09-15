/**
 * scripts/chromium.mjs — dynamic Chromium discovery for the Playwright
 * scripts.
 *
 * The cache directory name embeds the playwright revision (chromium-1105,
 * chromium-1243, …) and changes on every upgrade; a hard-coded path breaks
 * on the next install. Every resolution branch is pinned here with injectable
 * env/platform so the process environment is never touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveChromiumPath } from '../scripts/chromium.mjs'

test('CHROMIUM_PATH wins when it names an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chromium-resolve-'))
  const fake = join(dir, 'chrome')
  writeFileSync(fake, '')
  try {
    const got = resolveChromiumPath({ env: { CHROMIUM_PATH: fake }, platform: 'linux' })
    assert.equal(got, fake)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('playwright registry path beats a cache scan when it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chromium-resolve-'))
  const registry = join(dir, 'playwright-chrome')
  writeFileSync(registry, '')
  const cache = join(dir, 'cache')
  mkdirSync(join(cache, 'chromium-9999', 'chrome-linux64'), { recursive: true })
  writeFileSync(join(cache, 'chromium-9999', 'chrome-linux64', 'chrome'), '')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux', playwrightExecutable: registry })
    assert.equal(got, registry, 'the installed registry exe must win over the scan')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('cache scan picks the NEWEST revision and a platform layout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chromium-resolve-'))
  const cache = join(dir, 'cache')
  mkdirSync(join(cache, 'chromium-1105', 'chrome-linux64'), { recursive: true })
  mkdirSync(join(cache, 'chromium-1243', 'chrome-linux64'), { recursive: true })
  const newer = join(cache, 'chromium-1243', 'chrome-linux64', 'chrome')
  const older = join(cache, 'chromium-1105', 'chrome-linux64', 'chrome')
  writeFileSync(newer, '')
  writeFileSync(older, '')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' })
    assert.equal(got, newer, 'newest revision must win when several are installed')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('macOS layout is discovered (Google Chrome for Testing app bundle)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chromium-resolve-'))
  const cache = join(dir, 'cache')
  const exe = join(cache, 'chromium-1243', 'chrome-mac-arm64',
    'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
  mkdirSync(join(exe, '..'), { recursive: true })
  writeFileSync(exe, '')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'darwin' })
    assert.equal(got, exe)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('headless-shell directories are scanned as a fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chromium-resolve-'))
  const cache = join(dir, 'cache')
  const shell = join(cache, 'chromium_headless_shell-1243', 'chrome-linux', 'headless_shell')
  mkdirSync(join(shell, '..'), { recursive: true })
  writeFileSync(shell, '')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' })
    assert.equal(got, shell)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('no candidate anywhere resolves to undefined', () => {
  const got = resolveChromiumPath({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/nonexistent/ms-playwright' },
    platform: 'win32',
  })
  assert.equal(got, undefined)
})
