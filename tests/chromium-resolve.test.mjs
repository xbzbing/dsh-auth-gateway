/**
 * scripts/chromium.mjs — dynamic Chromium discovery for the Playwright
 * scripts.
 *
 * The cache directory name embeds the playwright revision (chromium-1105,
 * chromium-1243, …) and changes on every upgrade; a hard-coded path breaks
 * on the next install. Every resolution branch is pinned here with injectable
 * env/platform so the process environment is never touched — and so that an
 * injected env is authoritative: nothing may leak in from the process user's
 * home directory or PATH.
 *
 * The last test is a conformance test: it reads the layout table out of the
 * installed playwright itself, so a rename on playwright's side (e.g. the
 * Chromium-for-Testing `chrome-headless-shell-*` directories) fails here
 * instead of silently missing an installed browser.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveChromiumPath, compareCacheDirs } from '../scripts/chromium.mjs'

/** Fresh temp dir; callers remove it in a finally block. */
const tempDir = () => mkdtempSync(join(tmpdir(), 'chromium-resolve-'))

/** Create an empty file, including its parent directories. */
function touch(file) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '')
}

/** A playwright cache tree containing one chromium revision; `rel` is the
 *  executable path relative to the revision dir (default: the linux layout). */
function chromiumCache(root, rev, rel = 'chrome-linux64/chrome') {
  const exe = join(root, `chromium-${rev}`, ...rel.split('/'))
  touch(exe)
  return exe
}

/** A playwright cache tree containing one headless-shell revision. */
function headlessShellCache(root, rev, rel) {
  const exe = join(root, `chromium_headless_shell-${rev}`, ...rel.split('/'))
  touch(exe)
  return exe
}

test('CHROMIUM_PATH wins when it names an existing file', () => {
  const dir = tempDir()
  const fake = join(dir, 'chrome')
  writeFileSync(fake, '')
  try {
    const got = resolveChromiumPath({ env: { CHROMIUM_PATH: fake }, platform: 'linux' })
    assert.equal(got, fake)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('playwright registry path beats a cache scan when it exists', () => {
  const dir = tempDir()
  const registry = join(dir, 'playwright-chrome')
  writeFileSync(registry, '')
  const cache = join(dir, 'cache')
  chromiumCache(cache, 9999)
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux', playwrightExecutable: registry })
    assert.equal(got, registry, 'the installed registry exe must win over the scan')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('cache scan picks the NEWEST revision and a platform layout', () => {
  const dir = tempDir()
  const cache = join(dir, 'cache')
  const newer = chromiumCache(cache, 1243)
  const older = chromiumCache(cache, 1105)
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' })
    assert.equal(got, newer, 'newest revision must win when several are installed')
    assert.notEqual(got, older)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('cache-dir ordering is a total order: revision desc, then full before shell', () => {
  // Pinned directly, because a behavioral fixture cannot force the filesystem
  // to enumerate the headless-shell directory first on every machine.
  assert.ok(compareCacheDirs('chromium-1243', 'chromium-1105') < 0, 'newer revision first')
  assert.ok(compareCacheDirs('chromium-1105', 'chromium-1243') > 0)
  assert.ok(compareCacheDirs('chromium-1243', 'chromium_headless_shell-1243') < 0, 'full chromium first on a tie')
  assert.ok(compareCacheDirs('chromium_headless_shell-1243', 'chromium-1243') > 0, 'and the rule is antisymmetric')
  assert.equal(compareCacheDirs('chromium-1243', 'chromium-1243'), 0, 'only identical names tie')
  assert.ok(compareCacheDirs('chromium_headless_shell-9999', 'chromium-1243') < 0,
    'a newer shell still beats an older full chromium')
})

test('at the same revision the full chromium beats the headless shell', () => {
  const dir = tempDir()
  // Two roots, opposite creation orders: the contract is that the outcome does
  // not depend on the directory enumeration order (creation order on tmpfs,
  // hash order on ext4), so at least one root exercises the discriminating
  // order on every filesystem.
  const shellFirst = join(dir, 'shell-first')
  const shell = headlessShellCache(shellFirst, 1243, 'chrome-headless-shell-linux64/chrome-headless-shell')
  const full = chromiumCache(shellFirst, 1243)
  const fullFirst = join(dir, 'full-first')
  const full2 = chromiumCache(fullFirst, 1243)
  const shell2 = headlessShellCache(fullFirst, 1243, 'chrome-headless-shell-linux64/chrome-headless-shell')
  try {
    assert.equal(resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: shellFirst }, platform: 'linux' }),
      full, 'the order must be a stable tie-break, not readdir order')
    assert.equal(resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: fullFirst }, platform: 'linux' }),
      full2, 'and it must not depend on which directory was created first')
    assert.notEqual(shell, full)
    assert.notEqual(shell2, full2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('macOS layout is discovered (Google Chrome for Testing app bundle)', () => {
  const dir = tempDir()
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

test('headless shell is found in the Chromium-for-Testing layout', () => {
  const dir = tempDir()
  const cache = join(dir, 'cache')
  // playwright >= 1.49 names the shell after its build:
  // chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell
  const shell = headlessShellCache(cache, 1243, 'chrome-headless-shell-linux64/chrome-headless-shell')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' })
    assert.equal(got, shell)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('older headless-shell directory names still resolve', () => {
  const dir = tempDir()
  const cache = join(dir, 'cache')
  const shell = headlessShellCache(cache, 1243, 'chrome-linux64/headless_shell')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' })
    assert.equal(got, shell)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('headless shell on win32 resolves the 64-bit layout only on that platform', () => {
  const dir = tempDir()
  const cache = join(dir, 'cache')
  const shell = headlessShellCache(cache, 1243, 'chrome-win64/headless_shell.exe')
  try {
    const got = resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'win32' })
    assert.equal(got, shell)
    // The same cache must NOT be found from the linux platform (no /usr/bin
    // probe either — win32 skips the system fallback entirely).
    assert.equal(resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: cache }, platform: 'linux' }), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('no candidate anywhere resolves to undefined (system fallback skipped on win32)', () => {
  const got = resolveChromiumPath({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/nonexistent/ms-playwright' },
    platform: 'win32',
  })
  assert.equal(got, undefined, 'win32 must not probe POSIX /usr/bin paths')
})

test('the default cache root is derived from the injected HOME (linux)', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  const exe = chromiumCache(join(home, '.cache', 'ms-playwright'), 1243)
  try {
    const got = resolveChromiumPath({ env: { HOME: home }, platform: 'linux' })
    assert.equal(got, exe, 'the ms-playwright cache under the effective HOME must be scanned')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an injected env never falls back to the process user\'s cache', () => {
  const dir = tempDir()
  const configured = join(dir, 'cache') // exists but holds no chromium
  mkdirSync(configured, { recursive: true })
  try {
    // No HOME, no PATH, no chromium in the configured root: the process user's
    // real ~/.cache/ms-playwright (which may well hold a chromium) must stay
    // invisible — that leakage is exactly what made this module's behavior
    // depend on the developer machine.
    assert.equal(resolveChromiumPath({
      env: { PLAYWRIGHT_BROWSERS_PATH: configured },
      platform: 'linux',
    }), undefined)
    assert.equal(resolveChromiumPath({ env: {}, platform: 'linux' }), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('XDG_CACHE_HOME wins over HOME on linux (playwright semantics)', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  const xdg = join(dir, 'xdg')
  chromiumCache(join(home, '.cache', 'ms-playwright'), 1105)
  const preferred = chromiumCache(join(xdg, 'ms-playwright'), 1243)
  try {
    const got = resolveChromiumPath({ env: { HOME: home, XDG_CACHE_HOME: xdg }, platform: 'linux' })
    assert.equal(got, preferred)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('darwin and win32 default cache roots follow their own env vars', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  const macExe = chromiumCache(join(home, 'Library', 'Caches', 'ms-playwright'), 1243,
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
  const localAppData = join(dir, 'AppData', 'Local')
  const winExe = chromiumCache(join(localAppData, 'ms-playwright'), 1243, 'chrome-win64/chrome.exe')
  try {
    assert.equal(resolveChromiumPath({ env: { HOME: home }, platform: 'darwin' }), macExe)
    assert.equal(resolveChromiumPath({ env: { LOCALAPPDATA: localAppData }, platform: 'win32' }), winExe)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an empty env value means unset, exactly as playwright reads it', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  const xdg = join(dir, 'xdg')
  const viaHome = chromiumCache(join(home, '.cache', 'ms-playwright'), 1243)
  const viaXdg = chromiumCache(join(xdg, 'ms-playwright'), 1105)
  const winHome = chromiumCache(join(home, 'AppData', 'Local', 'ms-playwright'), 1243, 'chrome-win64/chrome.exe')
  try {
    // playwright uses `||`, so XDG_CACHE_HOME= must not shadow HOME/.cache.
    assert.equal(resolveChromiumPath({ env: { HOME: home, XDG_CACHE_HOME: '' }, platform: 'linux' }),
      viaHome)
    // ...and an empty HOME must not turn the derived root into a relative path.
    assert.equal(resolveChromiumPath({ env: { HOME: '', platform: 'linux' } }), undefined)
    // LOCALAPPDATA= falls back to HOME\AppData\Local on Windows.
    assert.equal(resolveChromiumPath({ env: { HOME: home, LOCALAPPDATA: '' }, platform: 'win32' }),
      winHome)
    // A non-empty XDG_CACHE_HOME is still honored over HOME.
    assert.equal(resolveChromiumPath({ env: { HOME: home, XDG_CACHE_HOME: xdg }, platform: 'linux' }),
      viaXdg)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a configured PLAYWRIGHT_BROWSERS_PATH is scanned before the default root', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  chromiumCache(join(home, '.cache', 'ms-playwright'), 9999) // newer revision, lower priority
  const configured = chromiumCache(join(dir, 'configured'), 1105)
  try {
    const got = resolveChromiumPath({
      env: { HOME: home, PLAYWRIGHT_BROWSERS_PATH: join(dir, 'configured') },
      platform: 'linux',
    })
    assert.equal(got, configured, 'the configured root wins even against a newer default-root revision')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a relative PLAYWRIGHT_BROWSERS_PATH resolves against INIT_CWD', () => {
  const dir = tempDir()
  const initCwd = join(dir, 'init-cwd')
  const exe = chromiumCache(join(initCwd, 'vendored-browsers'), 1243)
  const home = join(dir, 'home') // decoy default root that must lose
  chromiumCache(join(home, '.cache', 'ms-playwright'), 9999)
  try {
    const got = resolveChromiumPath({
      env: { INIT_CWD: initCwd, PLAYWRIGHT_BROWSERS_PATH: 'vendored-browsers', HOME: home },
      platform: 'linux',
    })
    assert.equal(got, exe)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('PLAYWRIGHT_BROWSERS_PATH=0 means "beside the package", not a directory to scan', () => {
  const dir = tempDir()
  const home = join(dir, 'home')
  const exe = chromiumCache(join(home, '.cache', 'ms-playwright'), 1243)
  try {
    // '0' is playwright's sentinel; the registry probe (step 2) covers that
    // mode, so the literal '0' must not shadow the derived default root.
    const got = resolveChromiumPath({ env: { HOME: home, PLAYWRIGHT_BROWSERS_PATH: '0' }, platform: 'linux' })
    assert.equal(got, exe)
    assert.equal(resolveChromiumPath({
      env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
      platform: 'linux',
    }), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('system chromium is discovered on the injected PATH (POSIX only)', () => {
  const dir = tempDir()
  const first = join(dir, 'bin-one')
  const second = join(dir, 'bin-two')
  const preferred = join(first, 'chromium')
  touch(preferred)
  touch(join(second, 'google-chrome'))
  try {
    assert.equal(resolveChromiumPath({
      env: { PATH: [first, second].join(':') },
      platform: 'linux',
    }), preferred, 'the earliest PATH entry wins')
    assert.equal(resolveChromiumPath({ env: { PATH: second }, platform: 'linux' }),
      join(second, 'google-chrome'))
    // A POSIX-style system probe is meaningless on Windows — PATH or not.
    assert.equal(resolveChromiumPath({ env: { PATH: first }, platform: 'win32' }), undefined)
    // No PATH at all: nothing to probe, and no lurking absolute /usr/bin path.
    assert.equal(resolveChromiumPath({ env: {}, platform: 'linux' }), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/**
 * The layout table of the installed playwright, read from its bundled
 * `EXECUTABLE_PATHS` registry — i.e. the paths `npx playwright install` can
 * actually produce. Conformance expectations come from playwright itself
 * rather than from a hand-maintained copy.
 *
 * The three outcomes are deliberately distinct: "playwright is not installed"
 * is the only case that may skip; a resolvable playwright whose registry no
 * longer parses must FAIL, because that is exactly the silent-miss this test
 * exists to prevent.
 * @returns {{ status: 'absent' } | { status: 'unparsed', entry: string } |
 *   { status: 'parsed', tables: Record<string, Array<[string, string[]]>> }}
 */
function playwrightExecutablePaths() {
  let entry
  try { entry = createRequire(import.meta.url).resolve('playwright-core') } catch { return { status: 'absent' } }
  const libDir = join(dirname(entry), 'lib')
  let files
  try { files = readdirSync(libDir).filter((name) => name.endsWith('.js')) } catch { return { status: 'unparsed', entry } }
  const bundle = files.map((name) => join(libDir, name))
    .find((file) => readFileSync(file, 'utf8').includes('EXECUTABLE_PATHS = {'))
  if (bundle === undefined) return { status: 'unparsed', entry }
  const source = readFileSync(bundle, 'utf8')
  const start = source.indexOf('EXECUTABLE_PATHS = {')
  const block = source.slice(start, source.indexOf('\n    };', start))
  const tables = {}
  for (const entryMatch of block.matchAll(/"(chromium|chromium-headless-shell)":\s*\{([\s\S]*?)\n {6}\}/g)) {
    tables[entryMatch[1]] = [...entryMatch[2].matchAll(/"([a-z0-9-]+)":\s*(\[[^\]]*\])/g)]
      .map(([, key, raw]) => [key, JSON.parse(raw)])
  }
  return Object.keys(tables).length > 0 ? { status: 'parsed', tables } : { status: 'unparsed', entry }
}

test('every layout the installed playwright installs is discoverable', (t) => {
  const registry = playwrightExecutablePaths()
  if (registry.status === 'absent') return t.skip('playwright-core is not installed')
  if (registry.status === 'unparsed') {
    assert.fail(`playwright-core is installed (${registry.entry}) but its EXECUTABLE_PATHS registry `
      + 'could not be parsed — update this conformance test (and the layout tables in '
      + 'scripts/chromium.mjs) for the new playwright layout format')
  }
  const tables = registry.tables

  const PLATFORM_OF = {
    'linux-x64': 'linux',
    'linux-arm64': 'linux',
    'mac-x64': 'darwin',
    'mac-arm64': 'darwin',
    'win-x64': 'win32',
  }
  const KINDS = { chromium: 'chromium', 'chromium-headless-shell': 'chromium_headless_shell' }
  /** Human-readable kind for a cache dir prefix (assertion messages). */
  const kindOf = (dirPrefix) => (dirPrefix === 'chromium' ? 'chromium' : 'headless-shell')
  const cases = []
  for (const [kind, dirPrefix] of Object.entries(KINDS)) {
    for (const [arch, layout] of tables[kind] ?? []) {
      const platform = PLATFORM_OF[arch]
      if (platform !== undefined) cases.push({ platform, dirPrefix, layout, arch })
    }
  }
  assert.ok(cases.length >= 10,
    `playwright's EXECUTABLE_PATHS should yield a layout per build; parsed ${cases.length}`)

  const dir = tempDir()
  try {
    for (const { platform, dirPrefix, layout, arch } of cases) {
      const root = join(dir, `${dirPrefix}-${arch}`)
      const exe = join(root, `${dirPrefix}-1243`, ...layout)
      touch(exe)
      assert.equal(
        resolveChromiumPath({ env: { PLAYWRIGHT_BROWSERS_PATH: root }, platform }),
        exe,
        `${kindOf(dirPrefix)} layout ${layout.join('/')} (${arch}) must be discoverable`,
      )
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
