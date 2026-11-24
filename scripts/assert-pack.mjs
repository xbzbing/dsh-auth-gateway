#!/usr/bin/env node
/**
 * Asserts an unpacked `npm pack` tree carries everything the plugin needs to
 * load, ships no install-time lifecycle hooks, and matches the checkout the
 * release gate packed from.
 *
 * The unit suite exercises `lib/` from the working tree and `build:check`
 * rebuilds the client bundle — neither notices a `files` entry that dropped a
 * runtime artifact (a missing docs/details file fails the detail page only
 * after install, locale/*.json missing breaks the panel dictionary, a missing
 * cordis.patch.yml silently disables the bundle patch). This script checks the
 * artifact that actually ships, so such a mistake fails the release instead of
 * the user.
 *
 * Usage: node scripts/assert-pack.mjs <unpacked-package-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Lifecycle hooks that must never be present: install must not build or
 * rewrite anything (zero-runtime-dependency policy, cf. AGENTS.md). */
const INSTALL_HOOKS = [
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublish', 'prepublishOnly', 'prepack', 'postpack',
]

/** Top-level artifacts every install needs. lib/ and locale/ are checked
 * against the checkout wholesale below, so they are not listed file by file —
 * a new lib file then cannot be forgotten here. */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'index.js',
  'client/index.js',
  'client/index.js.map',
  'locale/zh.json',
  'locale/en.json',
  'docs/details/DETAIL.md',
  'docs/details/DETAIL.en.md',
  'scripts/uninstall.mjs',
  'scripts/reset.mjs',
  'icon.svg',
  'README.md',
  'README.en.md',
]

const [, , pkgDirArg] = process.argv
if (!pkgDirArg) {
  console.error('usage: node scripts/assert-pack.mjs <unpacked-package-dir>')
  process.exit(2)
}
const pkgDir = resolve(process.cwd(), pkgDirArg)
if (!existsSync(join(pkgDir, 'package.json'))) {
  console.error(`${pkgDirArg} has no package.json — extract the tarball first`)
  process.exit(1)
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const failures = []

// 1. Every file the manifest promises, plus the entry points npm cannot infer.
for (const rel of REQUIRED) {
  if (!existsSync(join(pkgDir, rel))) failures.push(`missing required file: ${rel}`)
}

// 2. Every lib/*.js and locale/*.json in the checkout must ship: the manifest's
//    `files` globs are the only thing keeping them in, and a glob typo would
//    otherwise surface as a runtime MODULE_NOT_FOUND after install.
for (const dir of ['lib', 'locale']) {
  for (const name of readdirSync(join(repoRoot, dir))) {
    if (!name.endsWith('.js') && !name.endsWith('.json')) continue
    if (!existsSync(join(pkgDir, dir, name))) failures.push(`missing from package: ${dir}/${name}`)
  }
}

// 3. No install-time hooks: DSH installs refuse to run package scripts.
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
for (const hook of INSTALL_HOOKS) {
  if (pkg.scripts && hook in pkg.scripts) {
    failures.push(`install lifecycle hook present: scripts.${hook}`)
  }
}

// 4. The tarball must be this checkout's version — a stale tgz in the workspace
//    would otherwise be uploaded under the new tag.
const repoPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
if (pkg.version !== repoPkg.version) {
  failures.push(`package version ${pkg.version} != checkout version ${repoPkg.version}`)
}
if (pkg.name !== repoPkg.name) {
  failures.push(`package name ${pkg.name} != checkout name ${repoPkg.name}`)
}

if (failures.length > 0) {
  console.error('assert-pack failed:')
  for (const line of failures) console.error(`  - ${line}`)
  process.exit(1)
}
const shipped = readdirSync(join(pkgDir, 'lib')).length
console.log(`assert-pack ok: ${pkg.name}@${pkg.version}, ${shipped} lib files, no install hooks`)
