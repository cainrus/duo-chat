// Vant theme tokens (docs/ui-framework.md §4). Applied through ConfigProvider, which sets
// `--van-*` custom properties via CSSOM: allowed under `style-src 'self'`.
import type { ConfigProviderThemeVars } from 'vant'

const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, ' +
  '"Noto Sans", system-ui, sans-serif, "Apple Color Emoji", "Noto Color Emoji"'

export const themeVars: ConfigProviderThemeVars = {
  // palette: soft and warm, not neon
  primaryColor: '#6C5CE7',
  successColor: '#22B07D',
  dangerColor: '#EF5A6F',
  warningColor: '#FFB23F',
  textColor: '#2B2440',
  textColor2: '#6B6585',
  textColor3: '#A49FB8',
  background: '#FFF7EE',
  background2: '#FFFFFF',
  borderColor: '#EFE7DC',
  activeColor: '#F3ECFF',

  baseFont: font,
  fontSizeXs: '14px',
  fontSizeSm: '16px',
  fontSizeMd: '18px',
  fontSizeLg: '22px',

  radiusSm: '8px',
  radiusMd: '14px',
  radiusLg: '22px',
  radiusMax: '999px',

  // big touch targets (>= 56px; primary actions 72px)
  buttonDefaultHeight: '56px',
  buttonLargeHeight: '72px',
  buttonDefaultFontSize: '18px',
  buttonNormalFontSize: '18px',
  buttonIconSize: '32px',
  buttonRadius: '22px',
  buttonRoundRadius: '999px',

  popupRoundRadius: '28px',
  dialogRadius: '24px',
  dialogButtonHeight: '56px',
  toastRadius: '20px',
  toastFontSize: '20px',
  toastIconSize: '48px',
  badgeDotSize: '14px',
  countDownFontSize: '18px',
  floatingBubbleSize: '72px',
  floatingBubbleIconSize: '32px',
  actionSheetItemFontSize: '20px',
  tabsLineHeight: '56px',
  tabFontSize: '28px',
  cellFontSize: '18px',
  cellVerticalPadding: '14px',
  fieldInputTextColor: '#2B2440',
}

/** In-call screen only (local scope): dark backdrop, translucent buttons. */
export const callVars: ConfigProviderThemeVars = {
  popupBackground: '#15121F',
  textColor: '#FFFFFF',
  buttonDefaultBackground: 'rgba(255,255,255,.16)',
  buttonDefaultColor: '#FFFFFF',
  buttonDefaultBorderColor: 'transparent',
  floatingBubbleSize: '120px',
}
