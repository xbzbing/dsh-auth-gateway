/**
 * Login-password card: the change-password form (old / new / confirm) with its
 * client-side pre-checks done by the container's handler.
 *
 * Presentational only — the container owns the field state, the request and
 * the redirect that follows a successful change.
 */

import { Button } from './ui.jsx'
import {
  CARD_FOOT, CARD_HEAD_TIGHT, CARD_TITLE, DESC_TIGHT, INNER_BOX, INPUT, ROW, SIDE_BOX, focusProps,
} from './styles.js'

export function PasswordCard({
  t, open, changing, oldPassword, newPassword, confirmPassword,
  onOpen, onCancel, onOldChange, onNewChange, onConfirmChange, onSubmit,
}) {
  return (
    <div style={SIDE_BOX}>
      <div style={CARD_HEAD_TIGHT}>
        <span style={CARD_TITLE}>🔑 {t('password.title')}</span>
      </div>
      <p style={DESC_TIGHT}>{t('password.desc')}</p>
      <div style={CARD_FOOT}>
        {!open ? (
          <Button variant="primary" onClick={onOpen}>{t('password.change')}</Button>
        ) : (
          <div style={INNER_BOX}>
            <input type="password" placeholder={t('password.old')} value={oldPassword}
              onChange={(e) => onOldChange(e.target.value)} style={INPUT} {...focusProps} />
            <input type="password" placeholder={t('password.new')} value={newPassword}
              onChange={(e) => onNewChange(e.target.value)} style={INPUT} {...focusProps} />
            <input type="password" placeholder={t('password.confirm')} value={confirmPassword}
              onChange={(e) => onConfirmChange(e.target.value)} style={INPUT} {...focusProps}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }} />
            <div style={ROW}>
              <Button variant="primary" onClick={onSubmit} disabled={changing}>
                {changing ? t('password.progress') : t('password.submit')}
              </Button>
              <Button variant="outline" onClick={onCancel}>{t('dialog.cancel')}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
