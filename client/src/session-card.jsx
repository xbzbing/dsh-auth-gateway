/**
 * Session card: the "signed in" state and the sign-out action.
 *
 * Presentational only — the container owns the logout request and redirect.
 */

import { Button, Pill } from './ui.jsx'
import { CARD_FOOT, CARD_HEAD_TIGHT, CARD_TITLE, DESC_TIGHT, SIDE_BOX } from './styles.js'

export function SessionCard({ t, onLogout }) {
  return (
    <div style={SIDE_BOX}>
      <div style={CARD_HEAD_TIGHT}>
        <span style={CARD_TITLE}>🔒 {t('session.title')}</span>
        <Pill>{t('session.loggedIn')}</Pill>
      </div>
      <p style={DESC_TIGHT}>{t('session.desc')}</p>
      <div style={CARD_FOOT}>
        <Button variant="dangerOutline" onClick={onLogout}>{t('session.logout')}</Button>
      </div>
    </div>
  )
}
