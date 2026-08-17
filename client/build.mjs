/**
 * Build the dsh client plugin bundle.
 *
 * dsh resolves a plugin's browser half via `exports["./client"]` and serves it
 * under `/plugins/<name>/client.js` with its source map (see
 * @deepseek-ai/dsh-client-modules). The bundle must be a
 * `window.__ModuleLoader__.load({ id, factory })` call whose factory receives
 * the loader's `require` and returns `module.exports`; react,
 * react/jsx-runtime and @deepseek-ai/dsh-client-ui-slots are provided by the
 * dsh runtime and stay external.
 *
 * Usage: node client/build.mjs
 */

import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outfile = join(root, 'client', 'index.js')

const result = await build({
  entryPoints: [join(root, 'client', 'src', 'index.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-slots'],
  sourcemap: 'external',
  sourcesContent: true,
  outfile,
  write: false,
})

const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text
  .replace(/\/\/# sourceMappingURL=.*\n?$/, '') // we append our own pointer
const map = result.outputFiles.find((f) => f.path.endsWith('.map')).text

const indent = (s) => s.split('\n').map((line) => '\t\t' + line).join('\n')
const bundle = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-password-gate",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  indent(js),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
  '//# sourceMappingURL=index.js.map',
  '',
].join('\n')

writeFileSync(outfile, bundle)
writeFileSync(join(root, 'client', 'index.js.map'), map)
console.log(`built ${outfile} (${bundle.length} bytes)`)
