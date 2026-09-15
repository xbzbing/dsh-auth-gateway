/**
 * Locate a Chromium executable for the Playwright-driven scripts
 * (scripts/e2e.mjs, scripts/screenshots.mjs).
 *
 * Resolution order (first EXISTING hit wins):
 *   1. CHROMIUM_PATH            — explicit override, always respected
 *   2. playwright's own registry — the installed revision's executable,
 *                                  versioned automatically by playwright
 *   3. a scan of the ms-playwright cache (chromium-* / headless-shell-*
 *      directories), probing every known per-platform relative path
 *   4. a system chromium on PATH (/usr/bin/chromium etc.)
 *
 * The cache scan makes a reinstall work without editing any script: the
 * directory name embeds the playwright revision (chromium-1105, -1243, …),
 * so it MUST be discovered dynamically — a hard-coded path breaks on the
 * very next `npx playwright install` upgrade.
 *
 * Pure module: env and platform are injectable so tests can drive every
 * branch without mutating the process.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Per-platform relative executable paths inside a chromium-<rev> cache dir. */
const CHROMIUM_RELATIVES = {
  darwin: [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ],
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
}

/** Per-platform relative paths inside a chromium_headless_shell-<rev> dir. */
const HEADLESS_SHELL_RELATIVES = {
  darwin: [
    'chrome-mac-arm64/headless_shell',
    'chrome-mac-x64/headless_shell',
    'chrome-mac/headless_shell',
  ],
  linux: ['chrome-linux/headless_shell'],
  win32: ['chrome-win/headless_shell.exe'],
}

const CACHE_DIR_RE = /^chromium(_headless_shell)?-\d+$/

/** Cache roots to scan, most specific first. */
export function cacheRoots(env, platform) {
  const roots = []
  if (env.PLAYWRIGHT_BROWSERS_PATH) roots.push(env.PLAYWRIGHT_BROWSERS_PATH)
  const home = os.homedir()
  if (platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Caches', 'ms-playwright'))
  } else if (platform === 'win32') {
    roots.push(path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'ms-playwright'))
  } else {
    roots.push(path.join(home, '.cache', 'ms-playwright'))
  }
  return roots
}

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] - process env (injectable for tests).
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
    // Newest revision first: chromium-1243 sorts above chromium-1105.
    dirs.sort((a, b) => Number(b.slice(b.lastIndexOf('-') + 1)) - Number(a.slice(a.lastIndexOf('-') + 1)))
    for (const dir of dirs) {
      const relatives = dir.startsWith('chromium_headless_shell')
        ? (HEADLESS_SHELL_RELATIVES[platform] ?? [])
        : (CHROMIUM_RELATIVES[platform] ?? [])
      for (const rel of relatives) {
        const candidate = path.join(root, dir, rel)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  for (const name of ['chromium', 'chromium-browser', 'google-chrome']) {
    const candidate = `/usr/bin/${name}`
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
