/**
 * Presentational primitives shared by the settings cards.
 *
 * Styling goes through dsh's own design tokens (see ./styles.js) so the panel
 * follows the host theme; hover is handled inline because these are plain
 * elements, not dsh primitives.
 */

import { T } from './styles.js'

/** dsh-styled button (design tokens, hover handled inline). */
export function Button({ variant = 'primary', disabled, onClick, children, full, style }) {
  const kinds = {
    primary: { background: T.primaryFill, color: T.primaryForeground, hover: T.primaryHover },
    ghost: { background: 'transparent', color: T.textPrimary, hover: T.hover },
    outline: { background: 'transparent', color: T.textPrimary, hover: T.hover, border: `1px solid ${T.border}` },
    danger: { background: T.danger, color: '#fff', hover: T.dangerSoft },
    dangerOutline: { background: 'transparent', color: T.danger, hover: T.hoverDanger, border: `1px solid ${T.danger}` },
  }
  const k = kinds[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = k.hover }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = k.background }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        height: '32px', padding: '0 14px', borderRadius: '8px', fontSize: '13px', lineHeight: '20px',
        fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit',
        boxSizing: 'border-box', transition: 'background .15s ease',
        ...k, ...(full ? { width: '100%' } : {}), ...(disabled ? { opacity: 0.5 } : {}), ...style,
      }}
    >{children}</button>
  )
}

/** Small status badge (success / warn / neutral tone). */
export function Pill({ children, tone = 'neutral' }) {
  const toneStyle = tone === 'success'
    ? { color: T.success, background: T.successBg }
    : tone === 'warn'
      ? { color: T.danger, background: T.dangerSoft }
      : { color: T.textSecondary, background: T.hover }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', height: '22px', padding: '0 10px',
      borderRadius: '11px', fontSize: '12px', lineHeight: '18px', ...toneStyle,
    }}>{children}</span>
  )
}

/**
 * Status / error banner below the cards, and the compact variant the setup
 * dialog renders inside its own body. One component so the two cannot drift
 * apart in colour or padding.
 */
export function StatusBanner({ status, compact = false }) {
  if (!status) return null
  const ok = status.type === 'success'
  return (
    <div style={compact ? {
      margin: '12px 0', padding: '8px 12px', borderRadius: '8px',
      fontSize: '12px', lineHeight: '18px',
      background: ok ? T.successBg : T.hoverDanger, color: ok ? T.success : T.danger,
    } : {
      marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
      fontSize: '13px', lineHeight: '20px',
      background: ok ? T.successBg : T.hoverDanger, color: ok ? T.success : T.danger,
    }}>{status.message}</div>
  )
}
