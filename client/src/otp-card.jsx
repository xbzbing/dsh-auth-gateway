/**
 * OTP two-factor card: status pill, the enable button, and the inline
 * disable-confirmation form (current code or a one-time backup code).
 *
 * Presentational only — the panel container owns every piece of state and the
 * request, so this file is a pure function of its props.
 */

import { Button, Pill } from './ui.jsx'
import { CARD, CARD_HEAD, CARD_TITLE, DESC, INNER_BOX, INPUT, ROW, T, focusProps } from './styles.js'

export function OtpCard({
  t, enabled, digits, enabling, onEnable,
  showDisable, onShowDisable, code, onCodeChange, disabling, onDisable, onCancelDisable,
}) {
  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <span style={CARD_TITLE}>🔐 {t('otp.title')}</span>
        {enabled ? <Pill tone="success">{t('otp.enabled')}</Pill> : <Pill>{t('otp.disabled')}</Pill>}
      </div>
      <p style={DESC}>{t('otp.desc')}</p>
      {!enabled ? (
        <Button variant="primary" onClick={onEnable} disabled={enabling}>{t('otp.enable')}</Button>
      ) : !showDisable ? (
        <Button variant="dangerOutline" onClick={onShowDisable}>{t('otp.disable')}</Button>
      ) : (
        <div style={INNER_BOX}>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
            {t('otp.disable.confirm', { digits })}
          </p>
          <input
            type="text" placeholder={t('otp.codePlaceholder')}
            value={code} onChange={(e) => onCodeChange(e.target.value)}
            style={INPUT} autoFocus {...focusProps}
            onKeyDown={(e) => { if (e.key === 'Enter') onDisable() }}
          />
          <div style={ROW}>
            <Button variant="danger" onClick={onDisable} disabled={disabling}>
              {disabling ? t('otp.disable.progress') : t('otp.disable.confirmBtn')}
            </Button>
            <Button variant="outline" onClick={onCancelDisable}>{t('dialog.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
