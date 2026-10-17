// dsh web design tokens (--dsw-alias-*). They are defined globally by the
// dsh web client and switch automatically with the light/dark theme, so the
// panel follows the host UI instead of hard-coding colors.
export const T = {
  bg1: 'var(--dsw-alias-bg-layer-1)',
  bg2: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l2)',
  textPrimary: 'var(--dsw-alias-label-primary)',
  textSecondary: 'var(--dsw-alias-label-secondary)',
  textTertiary: 'var(--dsw-alias-label-tertiary)',
  brand: 'var(--dsw-alias-brand-primary)',
  primaryFill: 'var(--dsw-alias-button-primary-fill)',
  primaryHover: 'var(--dsw-alias-button-primary-hover)',
  primaryForeground: 'var(--dsw-alias-label-primary-foreground)',
  hover: 'var(--dsw-alias-interactive-bg-hover)',
  hoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger)',
  // The two tokens dsh's own dropdown triggers are built from (its
  // `<name>_selector` rule): a soft module surface rather than a bordered
  // field, with `interactive-bg-hover` as the hover fill. Sourcing them by
  // name keeps the panel on the host's theme instead of a copied hex.
  bgModule: 'var(--dsw-alias-bg-module-platform)',
  radiusMd: 'var(--dsw-radius-md)',
  danger: 'var(--dsw-alias-state-error-primary)',
  dangerSoft: 'var(--dsw-alias-state-error-secondary)',
  success: 'var(--dsw-alias-state-success-primary)',
  successBg: 'var(--dsw-alias-state-success-tertiary)',
  shadow3: 'var(--dsw-shadow-lv3)',
  mask1: 'var(--dsw-alias-bg-mask-1)',
  maskBlur: 'var(--dsw-mask-blur)',
  fontCode: 'var(--ds-font-family-code)',
}

export const CARD = {
  background: T.bg1, border: `1px solid ${T.border}`, borderRadius: '12px',
  padding: '16px', marginBottom: '12px',
}
export const CARD_TITLE = {
  fontSize: '14px', lineHeight: '22px', fontWeight: 500, color: T.textPrimary,
}
export const DESC = {
  margin: '0 0 12px', fontSize: '13px', lineHeight: '20px', color: T.textSecondary,
}
export const INPUT = {
  height: '32px', padding: '0 12px', borderRadius: '8px',
  border: `1px solid ${T.border}`, background: T.bg1, color: T.textPrimary,
  fontSize: '14px', lineHeight: '22px', outline: 'none', width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .15s ease',
}
export const focusProps = {
  onFocus: (e) => { e.currentTarget.style.borderColor = T.brand },
  onBlur: (e) => { e.currentTarget.style.borderColor = '' },
}

// Repeated layout fragments, named once so the cards read as structure instead
// of as a wall of inline objects. Every value below is the literal one the
// panel already used — extracting them changes no rendered style.
/** Card header row (icon + title + status pill). */
export const CARD_HEAD = {
  display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px',
}
/** Card header row with the tighter bottom margin the side-by-side cards use. */
export const CARD_HEAD_TIGHT = { ...CARD_HEAD, marginBottom: '2px' }
/** Inset box for an inline form (OTP disable confirm, password change). */
export const INNER_BOX = {
  display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
  background: T.bg2, borderRadius: '10px', border: `1px solid ${T.border}`,
}
/** Horizontal action row. */
export const ROW = { display: 'flex', gap: '8px' }
/** One of the two side-by-side cards (password / session). */
export const SIDE_BOX = {
  flex: '1 1 0', minWidth: '200px', display: 'flex', flexDirection: 'column',
  border: `1px solid ${T.border}`, borderRadius: '10px', padding: '12px',
}
/** Footer that pins a card's action to the bottom edge. */
export const CARD_FOOT = { marginTop: 'auto', paddingTop: '8px' }
/** Description paragraph inside a side-by-side card. */
export const DESC_TIGHT = { ...DESC, margin: '0 0 10px' }
/** Description paragraph with no bottom margin (state lines, notices). */
export const DESC_FLUSH = { ...DESC, margin: 0 }
/** Small field label above a code/secret block in the setup dialog. */
export const FIELD_LABEL = {
  fontSize: '12px', lineHeight: '18px', fontWeight: 500,
  color: T.textSecondary, marginBottom: '6px',
}
/** Vertical rhythm between the dialog's field blocks. */
export const BLOCK_16 = { margin: '16px 0' }
