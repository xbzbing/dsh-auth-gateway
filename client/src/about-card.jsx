/**
 * About card: the running version, the repository link and the new-version
 * notice.
 *
 * The notice is derived in ./update-notice.js (unit-tested) so the four states
 * ("never checked", "failed", "up to date", "update available") cannot drift
 * apart; this file renders whatever the container derived.
 */

import { Button } from './ui.jsx'
import { CARD, CARD_HEAD, CARD_TITLE, DESC_FLUSH, T } from './styles.js'

export function AboutCard({ t, versionInfo, notice, checkingUpdate, onCheck }) {
  return (
    <div style={CARD}>
      <div style={CARD_HEAD}>
        <span style={CARD_TITLE}>ℹ️ {t('about.title')}</span>
      </div>
      {versionInfo === null ? (
        <p style={DESC_FLUSH}>{t('about.checking')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', fontSize: '13px', lineHeight: '20px' }}>
            <span style={{ color: T.textSecondary }}>
              {t('about.version')}
              {' '}
              <span style={{ color: T.textPrimary, fontFamily: T.fontCode }}>
                {versionInfo.version === '' ? t('about.unknown') : 'v' + versionInfo.version}
              </span>
            </span>
            {versionInfo.repository !== '' && (
              <span style={{ color: T.textSecondary }}>
                {t('about.repository')}
                {' '}
                <a
                  href={versionInfo.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: T.brand, textDecoration: 'none' }}
                >{t('about.repositoryLink')}</a>
              </span>
            )}
          </div>
          {/* Explicit check. Automatic checks are off by default, so this
              button is the normal way a user learns about a new release;
              it is also the only thing that makes the outbound request. */}
          {/* Button and its result share one row: the derived notice sits
              to the right of the check button, wrapping below only when the
              row runs out of width. */}
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <Button variant="outline" onClick={onCheck} disabled={checkingUpdate}>
              {checkingUpdate ? t('about.checking') : t('about.check')}
            </Button>
            {/* Result — one derived notice for all four states
                (client/src/update-notice.js), so "never checked", "failed"
                and the two verdicts cannot drift apart. `null` means nothing
                is known, and the card then claims nothing. */}
            {!checkingUpdate && notice !== null && (
              notice.tone === 'banner' ? (
                <div style={{
                  padding: '10px 14px', borderRadius: '10px',
                  fontSize: '13px', lineHeight: '20px',
                  background: T.successBg, color: T.success,
                }}>
                  {notice.text}
                  {notice.href !== '' && (
                    <>
                      {' '}
                      <a
                        href={notice.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: T.success, textDecoration: 'underline' }}
                      >{t('about.releaseNotes')}</a>
                    </>
                  )}
                </div>
              ) : (
                <p style={DESC_FLUSH}>{notice.text}</p>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
