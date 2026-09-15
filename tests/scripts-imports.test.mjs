/**
 * Static guard for the Playwright scripts' node:builtin imports.
 *
 * Regression: screenshots.mjs once lost `import path from 'node:path'` while
 * six `path.join(OUT, '*.png')` call sites remained — `node --check` only
 * parses the file, so the ReferenceError surfaced only at runtime. `path`,
 * `os` and `fs` identifiers are cheap to verify textually (the client
 * contract tests use the same source-string style), and they are the three
 * built-ins these scripts touch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SCRIPTS = {
  'scripts/e2e.mjs': readFileSync(new URL('../scripts/e2e.mjs', import.meta.url), 'utf8'),
  'scripts/screenshots.mjs': readFileSync(new URL('../scripts/screenshots.mjs', import.meta.url), 'utf8'),
  'scripts/chromium.mjs': readFileSync(new URL('../scripts/chromium.mjs', import.meta.url), 'utf8'),
}

const BUILTINS = ['path', 'os', 'fs']

test('every used node:builtin identifier has a matching import', () => {
  for (const [file, source] of Object.entries(SCRIPTS)) {
    // Code lines only: drop comments and import lines themselves.
    const code = source.split('\n')
      .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('import ') && !l.startsWith('export ') && !l.startsWith('*') && !l.startsWith('/*'))
      .join('\n')
    for (const ident of BUILTINS) {
      const uses = code.includes(`${ident}.`)
      if (!uses) continue
      const hasImport = source.includes(`import ${ident} from 'node:${ident}'`)
        || source.includes(`import * as ${ident} from 'node:${ident}'`)
      assert.ok(hasImport,
        `${file} uses ${ident}.() but imports no node:${ident} module — runtime ReferenceError`)
    }
  }
})

test('scripts resolve the chromium executable through the shared module', () => {
  for (const file of ['e2e.mjs', 'screenshots.mjs']) {
    const source = SCRIPTS[`scripts/${file}`]
    assert.ok(source.includes("resolveChromiumPath({ playwrightExecutable: chromium.executablePath() })"),
      `${file} must resolve chromium through scripts/chromium.mjs`)
  }
})
