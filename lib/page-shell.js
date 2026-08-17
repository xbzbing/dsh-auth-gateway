/**
 * Shared scaffolding for the self-contained gateway pages (login, onboarding,
 * OTP): the base stylesheet, the HTML skeleton, and the script prologue
 * (error map + fetch `post` helper). Each page module composes its own
 * `page(title, sub, fields, script)` from these pieces and appends its
 * page-specific CSS rules and JS.
 *
 * No user-controlled content is ever interpolated into these pages, so there
 * is no escaping surface here.
 */

/** Base stylesheet shared by every page. Pages append their own rules. */
export const baseStyle = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: flex; align-items: center;
  justify-content: center; font-family: ui-sans-serif, system-ui, sans-serif;
  background: #f4f5f7;
}
.card {
  background: #fff; border: 1px solid #e2e4e8;
  border-radius: 12px; padding: 28px 24px; box-shadow: 0 8px 24px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  body { background: #17181c; }
  .card { background: #232529; border-color: #33363c; }
  input { background: #17181c; color: #eee; border-color: #3a3d44; }
}
h1 { margin: 0 0 4px; font-size: 18px; }
p.sub { font-size: 13px; color: #6b7280; }
label { display: block; font-size: 12px; color: #6b7280; margin: 12px 0 4px; }
input {
  width: 100%; padding: 9px 10px; font-size: 14px; border: 1px solid #d1d5db;
  border-radius: 8px; outline: none;
}
input:focus { border-color: #4d6bfe; }
button {
  width: 100%; margin-top: 18px; padding: 10px; font-size: 14px; color: #fff;
  background: #4d6bfe; border: 0; border-radius: 8px; cursor: pointer;
}
button.secondary { background: transparent; color: #6b7280; border: 1px solid #d1d5db; }
.error { margin-top: 12px; font-size: 13px; color: #dc2626; min-height: 1em; }
`

/**
 * Script prologue shared by every page: the error-name → message map and the
 * fetch `post` helper (maps server error codes through ERRORS). Pages append
 * their own JS after it.
 * @param {Record<string, string>} errors - server error code → user message.
 */
export function scriptHead(errors) {
  return `const ERRORS = ${JSON.stringify(errors)};
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = null
  try { data = await res.json() } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error((data && (ERRORS[data.error] || data.error)) || ('HTTP ' + res.status))
  return data
}
`
}

/**
 * Shared client-side password-strength pre-check (early feedback only — the
 * server enforces the policy authoritatively). Emitted as page JS; pages that
 * validate a NEW password (login change form, onboarding form) append it
 * after the script head.
 */
export function strengthErrorScript() {
  return `
// Client-side strength check (the server enforces the same policy; this is
// early feedback only). Returns an error message or null.
function strengthError(pw) {
  if (!pw || pw.length < 8) return ERRORS['password-too-short']
  const hasMixed = /[a-z]/.test(pw) && /[A-Z]/.test(pw)
  const hasSpecial = /[^A-Za-z0-9]/.test(pw)
  if (!hasMixed && !hasSpecial) return ERRORS['password-too-simple']
  return null
}`
}

/**
 * Build a page renderer bound to this module's style and script head. The
 * returned function matches the previous per-page `page()` signature.
 * @param {string} style - full stylesheet (base + page extras).
 * @param {string} script - full script prologue (head + page JS before any
 *   per-render script argument).
 */
export function makePage(style, script) {
  return function page(title, sub, fields, pageScript) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${style}</style>
</head>
<body>
<div class="card" id="card">
  <h1>${title}</h1>
  <p class="sub">${sub}</p>
  ${fields}
  <div class="error" id="error"></div>
</div>
<script>${script}${pageScript}</script>
</body>
</html>`
  }
}
