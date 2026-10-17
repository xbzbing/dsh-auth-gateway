/**
 * OTP setup dialog (dsh dialog pattern: mask + blur, rounded panel, footer
 * actions). Two phases:
 *
 *   - scan: QR code + manual secret + the verification input;
 *   - done: OTP is enabled and every session was revoked, so the dialog holds
 *     the one-time backup codes — it must not be closable (the container
 *     guards this too; the mask and the ✕ are simply not wired).
 *
 * Presentational only. The post-setup redirect is the container's `onDone`,
 * so this file needs no knowledge of the gateway's base path.
 */

import { Button, StatusBanner } from './ui.jsx'
import { BLOCK_16, FIELD_LABEL, INPUT, T, focusProps } from './styles.js'

export function OtpSetupDialog({
  t, digits, qrData, otpCode, setupDone, backupCodes, status, verifyingOtp,
  onClose, onCodeChange, onVerify, onDone,
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
      // After a successful setup the dialog holds the one-time backup
      // codes; the mask must not dismiss it (see the container's close handler).
    }} onClick={setupDone ? undefined : onClose}>
      <div style={{ position: 'absolute', inset: 0, background: T.mask1, backdropFilter: T.maskBlur }} />
      <div style={{
        position: 'relative', boxSizing: 'border-box', background: T.bg2,
        borderRadius: '24px', boxShadow: T.shadow3, border: `1px solid ${T.border}`,
        width: 'min(400px, 100%)', maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '20px 24px 4px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', lineHeight: '24px', fontWeight: 500, color: T.textPrimary }}>
            {t('dialog.title')}
          </h3>
          {/* No ✕ after setup: closing would drop the one-time backup codes. */}
          {!setupDone && (
            <Button variant="ghost" onClick={onClose} style={{ height: '28px', width: '28px', padding: 0, borderRadius: '8px' }}>✕</Button>
          )}
        </div>
        <div style={{ padding: '0 24px' }}>
          {setupDone ? (
            <>
              <div style={{
                margin: '8px 0 16px', padding: '10px 12px', borderRadius: '10px',
                fontSize: '13px', lineHeight: '20px', color: T.success,
                background: T.successBg, border: `1px solid ${T.border}`,
              }}>
                {t('status.otpEnabled')} — {t('dialog.enabledDesc')}
              </div>
              <div style={BLOCK_16}>
                <div style={FIELD_LABEL}>
                  {t('dialog.backupCodesTitle')}
                </div>
                <div style={{
                  padding: '8px 12px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '8px',
                  fontFamily: T.fontCode, fontSize: '13px', lineHeight: '22px', color: T.textPrimary,
                }}>
                  {backupCodes.join('\n')}
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: '8px 0 16px', fontSize: '13px', lineHeight: '20px', color: T.textSecondary }}>
                {t('dialog.desc')}
              </p>
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <img src={qrData.svgUrl} alt="OTP QR Code" style={{ border: `1px solid ${T.border}`, borderRadius: '8px', width: '200px', height: '200px' }} />
              </div>
              <div style={BLOCK_16}>
                <div style={FIELD_LABEL}>
                  {t('dialog.secret')}
                </div>
                <div style={{
                  padding: '8px 12px', background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '8px',
                  fontFamily: T.fontCode, fontSize: '13px', lineHeight: '20px', color: T.textPrimary, wordBreak: 'break-all',
                }}>{qrData.secret}</div>
              </div>
              <div style={BLOCK_16}>
                <div style={FIELD_LABEL}>
                  {t('dialog.code')}
                </div>
                <input
                  type="text" placeholder={t('dialog.codePlaceholder', { digits })} maxLength={digits}
                  value={otpCode} onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ''))}
                  style={{ ...INPUT, width: '140px', textAlign: 'center', letterSpacing: '6px', fontFamily: T.fontCode }}
                  {...focusProps}
                  onKeyDown={(e) => { if (e.key === 'Enter') onVerify() }}
                />
              </div>
              <StatusBanner status={status} compact />
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '0 24px 24px', marginTop: '20px' }}>
          {setupDone ? (
            <Button variant="primary" onClick={onDone}>{t('dialog.doneBtn')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>{t('dialog.cancel')}</Button>
              <Button variant="primary" onClick={onVerify} disabled={verifyingOtp}>
                {verifyingOtp ? t('dialog.verifying') : t('dialog.verify')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
