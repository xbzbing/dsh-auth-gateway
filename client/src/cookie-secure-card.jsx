/**
 * Cookie-Secure card: the effective policy, what actually applies to THIS
 * browser, and the panel override editor.
 *
 * The judgement itself lives in ./cookie-secure.js (unit-tested); this file
 * only renders the state it is handed and forwards the user's edits to the
 * container, which owns the request (POST /login-api/cookie-secure).
 */

// dsh's own dropdown primitive (Menu: anchor button + portal menu + check on
// the selected row). It ships in the shell's frozen module table
// (PLATFORM_MODULES), so it resolves as a baseline external like react — no
// `dsh.client.external` entry, no bundled copy of host UI.
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button, Pill } from './ui.jsx'
import { CARD, CARD_HEAD, CARD_TITLE, DESC, DESC_FLUSH, T } from './styles.js'

export function CookieSecureCard({
  t, secureState, secureEffective, mode, source, draft, menuOpen, saving, hint,
  onToggleMenu, onCloseMenu, onSelectMode, onSave, onReset,
}) {
  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <span style={CARD_TITLE}>🛡️ {t('cookie.title')}</span>
        <Pill tone={secureEffective ? 'success' : (secureState === 'auto-http' ? 'neutral' : 'warn')}>
          {secureEffective ? t('cookie.pill.effective')
            : (secureState === 'off' ? t('cookie.pill.off') : t('cookie.pill.ineffective'))}
        </Pill>
      </div>
      <p style={DESC}>{t('cookie.desc')}</p>
      <p style={DESC_FLUSH}>{t(`cookie.state.${secureState}`)}</p>
      <p style={{ margin: '8px 0 0', fontSize: '12px', lineHeight: '18px', color: T.textTertiary }}>
        {t('cookie.configHint', { mode: String(mode) })}
        {' · '}
        {source === 'panel' ? t('cookie.source.panel') : t('cookie.source.deployment')}
      </p>
      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Menu
          // dsh official dropdown: the anchor button below is the visible
          // control, the menu portals to <body> with a check on the chosen
          // row. Values stay strings so 'auto'/'true'/'false' never
          // collide (mirrored by the parse in onSelect).
          open={menuOpen}
          onClose={onCloseMenu}
          items={[
            { id: 'auto', label: t('cookie.edit.mode.auto') },
            { id: 'true', label: t('cookie.edit.mode.true') },
            { id: 'false', label: t('cookie.edit.mode.false') },
          ]}
          selectedId={String(draft ?? mode)}
          onSelect={(id) => {
            onCloseMenu()
            onSelectMode(id === 'true' ? true : id === 'false' ? false : 'auto')
          }}
          align="start"
          portal
          anchor={
            // Styled as dsh's own dropdown trigger (its `*_selector`
            // rule): bg-module-platform fill, radius-md, 36px tall,
            // 14px label, 12px gap, borderless, and the same 14px
            // stroke-1 chevron — no rotation on open (dsh does not
            // rotate it either). The Menu primitive owns everything
            // else: portal, outside-click, Escape, arrow-key roving.
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={saving}
              onClick={onToggleMenu}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = T.hover }}
              onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = T.bgModule }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '12px',
                height: '36px', padding: '0 14px', borderRadius: T.radiusMd,
                background: T.bgModule, color: T.textPrimary, border: 'none',
                fontSize: '14px', lineHeight: '22px', fontFamily: 'inherit',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.5 : 1, transition: 'background .15s ease',
              }}
            >
              <span>{t(`cookie.edit.mode.${String(draft ?? mode)}`)}</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
                strokeWidth="1" style={{ flexShrink: 0 }}>
                <path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor" />
              </svg>
            </button>
          }
        />
        <Button variant="primary" onClick={onSave} disabled={
          saving || draft === null || draft === mode
        }>
          {saving ? t('cookie.edit.saving') : t('cookie.edit.save')}
        </Button>
        {source === 'panel' && (
          <Button variant="outline" onClick={onReset} disabled={saving}>
            {t('cookie.edit.reset')}
          </Button>
        )}
        {hint !== null && (
          <span style={{ fontSize: '12px', lineHeight: '18px',
            color: hint.tone === 'warn' ? T.danger : T.textSecondary }}>
            {hint.text}
          </span>
        )}
      </div>
    </div>
  )
}
