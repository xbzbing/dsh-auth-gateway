/**
 * Locate a Chromium executable for the Playwright-driven scripts
 * (scripts/e2e.mjs, scripts/screenshots.mjs).
 *
 * Resolution order (first EXISTING hit wins):
 *   1. CHROMIUM_PATH            — explicit override, always respected
 *   2. playwright's own registry — the installed revision's executable, passed
 *                                  in as `playwrightExecutable`
 *                                  (`chromium.executablePath()`), versioned
 *                                  automatically by playwright
 *   3. a scan of the ms-playwright cache(s) (chromium-* / headless-shell-*
 *      directories), probing every known per-platform path layout
 *   4. a system chromium discovered on the effective PATH (POSIX only)
 *
 * No absolute location is hard-coded. The cache root is derived the way
 * playwright itself derives it — `PLAYWRIGHT_BROWSERS_PATH` (a relative value
 * resolved against `INIT_CWD`, as playwright does), else `XDG_CACHE_HOME` /
 * `HOME` / `LOCALAPPDATA` plus `ms-playwright`, with an empty value meaning
 * unset — and the system browser is probed on PATH, so a machine with a
 * non-default cache or an unusual prefix works without editing this file. The
 * revision directory name embeds the playwright revision (chromium-1105,
 * -1243, …) and changes on every upgrade, so it MUST be discovered
 * dynamically: a hard-coded path breaks on the very next
 * `npx playwright install`.
 *
 * Pure module: env and platform are injectable so tests can drive every branch
 * without mutating the process. An injected env is authoritative — the resolver
 * never reaches for the process user's home or PATH behind the caller's back.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** Per-platform executable path layouts inside a chromium-<rev> cache dir. */
const CHROMIUM_LAYOUTS = {
  darwin: [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ],
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
}

/**
 * Per-platform executable path layouts inside a
 * chromium_headless_shell-<rev> cache dir, playwright's current
 * Chromium-for-Testing naming first, then the older full-chromium directory
 * names. Both are probed; the conformance test in
 * tests/chromium-resolve.test.mjs pins this table against playwright's own
 * `EXECUTABLE_PATHS` registry, so a rename on playwright's side fails loudly
 * instead of silently missing an installed browser.
 */
const HEADLESS_SHELL_LAYOUTS = {
  darwin: [
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-mac-arm64/headless_shell',
    'chrome-mac-x64/headless_shell',
    'chrome-mac/headless_shell',
  ],
  linux: [
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-linux/headless_shell',
    'chrome-linux64/headless_shell',
  ],
  win32: [
    'chrome-headless-shell-win64/chrome-headless-shell.exe',
    'chrome-win64/headless_shell.exe',
    'chrome-win/headless_shell.exe',
  ],
}

const CACHE_DIR_RE = /^chromium(_headless_shell)?-\d+$/

/** Playwright's "browsers live beside the package" sentinel, not a path. */
const BESIDE_PACKAGE = '0'

/** System chromium names probed on each PATH entry (POSIX only). */
const SYSTEM_NAMES = ['chromium', 'chromium-browser', 'google-chrome']

/** Revision number from a cache dir name ('chromium-1243' -> 1243). */
const revNum = (dir) => Number(dir.slice(dir.lastIndexOf('-') + 1))

/** Full chromium outranks the headless shell when two revisions tie. */
const kindRank = (dir) => (dir.startsWith('chromium_headless_shell') ? 1 : 0)

/**
 * Cache-dir ordering: newest revision first, and at the same revision the full
 * chromium before the headless shell. A total order for every pair of distinct
 * names, so the scan result never depends on the readdir enumeration order.
 * Exported for the tie-break test.
 * @param {string} a - cache dir name ('chromium-1243').
 * @param {string} b - cache dir name.
 * @returns {number} negative when `a` should be scanned before `b`.
 */
export function compareCacheDirs(a, b) {
  return revNum(b) - revNum(a) || kindRank(a) - kindRank(b)
}

/**
 * Playwright reads these env vars with `||`, so an empty string means unset —
 * treating `XDG_CACHE_HOME=`/`LOCALAPPDATA=`/`HOME=` as a directory would
 * derive a root relative to the cwd instead of falling back like playwright.
 * @param {string | undefined} value - raw env value.
 * @returns {string | undefined} the value, or undefined when unset/empty.
 */
const orUnset = (value) => (value === undefined || value === '' ? undefined : value)

/**
 * The `ms-playwright` cache root playwright itself would use on `platform`,
 * read from the effective env (playwright derives it from `XDG_CACHE_HOME` /
 * the home directory / `LOCALAPPDATA`).
 * @param {NodeJS.ProcessEnv} env - effective environment.
 * @param {string} platform - os.platform() value.
 * @returns {string | undefined} the cache root, or undefined when the env names
 *   neither a cache dir nor a home directory (nothing to derive, nothing probed).
 */
function defaultCacheRoot(env, platform) {
  const home = orUnset(env.HOME)
  if (platform === 'darwin') {
    return home === undefined
      ? undefined
      : path.join(home, 'Library', 'Caches', 'ms-playwright')
  }
  if (platform === 'win32') {
    const local = orUnset(env.LOCALAPPDATA)
      ?? (home === undefined ? undefined : path.join(home, 'AppData', 'Local'))
    return local === undefined ? undefined : path.join(local, 'ms-playwright')
  }
  const cache = orUnset(env.XDG_CACHE_HOME)
    ?? (home === undefined ? undefined : path.join(home, '.cache'))
  return cache === undefined ? undefined : path.join(cache, 'ms-playwright')
}

/**
 * Cache roots to scan, most specific first.
 * @param {NodeJS.ProcessEnv} env - effective environment.
 * @param {string} platform - os.platform() value.
 * @returns {string[]} existing-or-not roots, deduplicated, in scan order.
 */
function cacheRoots(env, platform) {
  const roots = []
  const configured = orUnset(env.PLAYWRIGHT_BROWSERS_PATH)
  // '0' makes playwright keep browsers beside the package instead of in a
  // cache dir; the registry probe (step 2) covers that mode, so it must not be
  // scanned as if it were a path.
  if (configured !== undefined && configured !== BESIDE_PACKAGE) {
    // playwright resolves a relative value against INIT_CWD (the directory the
    // npm script was started from) before falling back to its own cwd; with
    // INIT_CWD unset the relative value is resolved against our cwd by the
    // existsSync probes below, i.e. the same base.
    const initCwd = orUnset(env.INIT_CWD)
    roots.push(initCwd === undefined ? configured : path.resolve(initCwd, configured))
  }
  const fallback = defaultCacheRoot(env, platform)
  if (fallback !== undefined) roots.push(fallback)
  return [...new Set(roots)]
}

/**
 * Existing system chromium executables reachable through the effective PATH,
 * in PATH order. The probe is `existsSync` only (this module never stats or
 * spawns anything); an empty PATH entry means "current directory" in shell
 * semantics and is deliberately not probed. Windows is skipped: Chrome/Edge
 * live under Program Files and the registry, so use CHROMIUM_PATH or
 * `npx playwright install` there.
 * @param {NodeJS.ProcessEnv} env - effective environment.
 * @param {string} platform - os.platform() value.
 * @returns {string[]} existing candidates, PATH order first.
 */
function systemCandidates(env, platform) {
  if (platform === 'win32') return []
  const found = []
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue
    for (const name of SYSTEM_NAMES) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) found.push(candidate)
    }
  }
  return found
}

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - effective env (injectable for tests);
 *   authoritative: every root, and the system probe, comes from it.
 * @param {string} [opts.platform] - os.platform() value (injectable for tests).
 * @param {string} [opts.playwrightExecutable] - `chromium.executablePath()` as
 *   reported by the installed playwright; used when it actually exists.
 * @returns {string | undefined} an existing executable path, or undefined.
 */
export function resolveChromiumPath({ env = process.env, platform = process.platform, playwrightExecutable } = {}) {
  if (env.CHROMIUM_PATH && existsSync(env.CHROMIUM_PATH)) return env.CHROMIUM_PATH
  if (playwrightExecutable && existsSync(playwrightExecutable)) return playwrightExecutable

  for (const root of cacheRoots(env, platform)) {
    if (!existsSync(root)) continue
    let dirs
    try { dirs = readdirSync(root).filter((d) => CACHE_DIR_RE.test(d)) } catch { continue }
    // Newest revision first; at the same revision the full chromium wins over
    // the headless shell (a stable order, not readdir order).
    dirs.sort(compareCacheDirs)
    for (const dir of dirs) {
      const layouts = dir.startsWith('chromium_headless_shell')
        ? (HEADLESS_SHELL_LAYOUTS[platform] ?? [])
        : (CHROMIUM_LAYOUTS[platform] ?? [])
      for (const rel of layouts) {
        const candidate = path.join(root, dir, rel)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  return systemCandidates(env, platform)[0]
}
