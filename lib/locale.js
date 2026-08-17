/**
 * Gateway page-language resolution.
 *
 * Priority (fixed):
 *   1. the dsh user preference — `locale.preference` in
 *      $DSH_HOME/settings.yaml, written when the user picks a language in the
 *      dsh settings UI (re-read lazily on every page render, so a preference
 *      change applies on the next request without a restart);
 *   2. otherwise the browser's Accept-Language header (highest q-value, en*
 *      -> en, anything else -> zh);
 *   3. zh as the conservative fallback.
 *
 * The preference always wins over the request header: once the user has
 * chosen a language, every device follows that choice regardless of browser
 * language.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './store.js'

/**
 * The dsh UI language preference, when one was ever set. Returns undefined
 * when unset (fresh install, or the user never picked a language in the dsh
 * settings UI) or when the file is unreadable.
 * @returns {'en'|'zh'|undefined}
 */
export function localePreference() {
  try {
    const file = join(dshHome(), 'settings.yaml')
    if (!existsSync(file)) return undefined
    const text = readFileSync(file, 'utf8')
    const match = /^locale:[\s\S]*?^[ \t]+preference:[ \t]*["']?([a-zA-Z-]+)/m.exec(text)
    if (!match) return undefined
    const value = match[1].toLowerCase()
    return value === 'en' ? 'en' : value === 'zh' ? 'zh' : undefined
  } catch {
    return undefined
  }
}

/**
 * Primary language subtag with the highest q-value from an Accept-Language
 * header ('en-US,en;q=0.9,zh;q=0.8' -> 'en'; absent/invalid -> undefined).
 * @param {string|undefined} header
 * @returns {string|undefined} lowercase primary subtag.
 */
export function acceptLanguagePrimary(header) {
  if (typeof header !== 'string' || header.length === 0) return undefined
  let best
  let bestQ = -1
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    if (!tag) continue
    let q = 1
    for (const param of params) {
      const match = /^\s*q\s*=\s*([0-9.]+)/.exec(param)
      if (match) {
        q = parseFloat(match[1])
        break
      }
    }
    if (!Number.isFinite(q)) q = 0
    if (q > bestQ) {
      bestQ = q
      best = tag.trim().split('-')[0].toLowerCase()
    }
  }
  return best
}

/**
 * Resolve the language for a gateway page render.
 * @param {'en'|'zh'|undefined} preference - dsh user preference.
 * @param {string|undefined} acceptLanguage - request Accept-Language header.
 * @returns {'en'|'zh'}
 */
export function pageLocale(preference, acceptLanguage) {
  if (preference === 'en') return 'en'
  if (preference === 'zh') return 'zh'
  return acceptLanguagePrimary(acceptLanguage) === 'en' ? 'en' : 'zh'
}
