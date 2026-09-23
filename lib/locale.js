/**
 * Gateway page-language resolution.
 *
 * Priority (fixed):
 *   1. the dsh user preference from the `locale` settings namespace;
 *   2. otherwise the browser's Accept-Language header (highest q-value, en*
 *      -> en, anything else -> zh);
 *   3. zh as the conservative fallback.
 *
 * The preference always wins over the request header: once the user has
 * chosen a language, every device follows that choice regardless of browser
 * language.
 */

/**
 * Read the current dsh UI language from the official settings service.
 * @param {{ describe?: () => Array<{ ns?: string, value?: { preference?: unknown } }> } | undefined} settings
 * @returns {'en'|'zh'|undefined}
 */
export function localePreference(settings) {
  try {
    const value = settings?.describe?.().find((entry) => entry.ns === 'locale')?.value?.preference
    return value === 'en' || value === 'zh' ? value : undefined
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
