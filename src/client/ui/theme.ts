// Vant theme tokens (docs/ui-framework.md §4). Applied through ConfigProvider, which sets
// `--van-*` custom properties via CSSOM: allowed under `style-src 'self'`.
import type { ConfigProviderThemeVars } from 'vant'

const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, ' +
  '"Noto Sans", system-ui, sans-serif, "Apple Color Emoji", "Noto Color Emoji"'

// One harmonious pastel palette (owner, 2026-10-31): no saturated accents. Pastel tones are
// fills only; text and icons on them are dark ink, never white. Contrast (WCAG): ink on every
// fill >= 8:1, the *Ink tones on the page background >= 5.7:1, textColor3 >= 4.5:1.
// Custom keys become `--van-duo-*` properties (ConfigProvider kebab-cases every key).
const ink = '#2B2440'
const lavender = '#CBBDF6'

export const themeVars: ConfigProviderThemeVars & Record<`duo${string}`, string> = {
  // pastel fills
  duoLavender: lavender, // my bubble, primary buttons, VIDEO on
  duoMint: '#BFE8D4', // AUDIO on
  duoPeach: '#FFD6C0', // «онлайн»
  duoSky: '#C6E3F6', // her voice room is open (AUDIO highlighted)
  duoButter: '#FBE9B0',
  duoRose: '#F9D2DC', // error bar
  duoTrack: '#EEE7DF', // segmented control track, disabled fills
  // inks for text and icons that need a hue
  duoLavenderInk: '#5A48AC',
  duoMintInk: '#2C6E53',
  duoPeachInk: '#94502C',

  primaryColor: lavender,
  successColor: '#2C6E53',
  dangerColor: '#9C3B57',
  warningColor: '#7A5A10',
  textColor: ink,
  textColor2: '#5E5873',
  textColor3: '#736D86',
  background: '#FFF8F1',
  background2: '#FFFFFF',
  borderColor: '#EEE7DF',
  activeColor: '#EEE7DF',
  // dark ink on the pastel primary
  buttonPrimaryColor: ink,
  buttonPrimaryBorderColor: lavender,
  switchOnBackground: '#BFE8D4',
  switchBackground: '#EEE7DF',

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
  actionSheetItemFontSize: '20px',
  tabsLineHeight: '56px',
  tabFontSize: '28px',
  cellFontSize: '18px',
  cellVerticalPadding: '14px',
  fieldInputTextColor: ink,
}
