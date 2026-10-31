# duo-chat — UI framework choice

Date: 2026-10-31. Versions checked against the npm registry on this date. Where a
claim says "checked in source", the published package tarball was grepped.

## 1. Recommendation: Vant 4

Use **Vant 4** (`vant@4.10.2`, MIT) for components, with **build-time SVG icons**
(`unplugin-icons` + Phosphor), our own **static emoji grid**, `uqr` for showing the
QR and `jsqr` for scanning it.

- It was built for mobile web inside iOS and Android WebViews: touch-first, nothing
  depends on hover, and it has `safe-area-inset-top/bottom` props on Popup,
  ActionSheet, NavBar and Tabbar, plus `van-safe-area-*` helpers.
- Theming goes through one typed config object (`ConfigProvider` `themeVars`, which
  map to `--van-*` tokens), so we style it through the library's own settings, not
  stylesheets.
- It works under a **strict CSP with `style-src 'self'`**. Checked in source: it
  never injects `<style>` elements and has no `eval`/`new Function`. Theme variables
  are set through CSSOM (`style.setProperty`), which CSP does not block.
- It's small: per-component imports, and the whole stylesheet is 196 KB raw
  (≈25–30 KB gzip). It ships a built-in `ru-RU` locale.
- It already has our hard parts: `CountDown` for the call cooldown and ringing, plus `ActionSheet`, `showToast`, `showConfirmDialog`, `Steps`, `Grid` and
  `Tabs`.
- Gaps: there is no chat-bubble component (we write one small `ChatBubble.vue` that
  uses only Vant tokens). Don't rely on Vant's icon font (see §5).
- Runner-up: **Ionic Vue 9** has the best native iOS feel. It loses because Stencil
  injects `<style>` elements for its scoped components, which needs either a
  per-request nonce or `'unsafe-inline'`. Neither fits a static, byte-reproducible
  build under a strict CSP.

## 2. Comparison

| | Ionic Vue | **Vant** | Quasar | Konsta UI + Tailwind | PrimeVue | Vuetify |
|---|---|---|---|---|---|---|
| Version (Oct 2026) | 9.0.10 (9.0.0 out 2026-08-19, very active) | **4.10.2** (Aug 2026, active, slower pace) | 2.35.2 (Oct 2026, active) | 5.5.0 (Sep 2026) + tailwindcss 4.3.3 | 5.0.4 | 4.3.1 (4.0 out 2026-02) |
| License | MIT | **MIT** | MIT | MIT | **PrimeUI License since v5** (commercial, license key, free tier needs a yearly key renewal); 4.5.5 was the last MIT version | MIT |
| Mobile / touch | Excellent: native gestures, iOS and MD modes | **Excellent: mobile-only by design** | Good; Material, all-in-one | Excellent: pixel-perfect iOS and Material | Desktop-first | Good, admin/desktop flavour |
| iOS standalone PWA | Best: ion-content scrolling, keyboard, safe areas | **Good: safe-area props; we write a ~10-line 100dvh shell ourselves** | Good: `--q-safe-area-*`, dialogs use 100dvh | Good: safe areas built in | Weak | OK |
| Theming model | CSS vars (`--ion-color-*`) + `mode` config | **Typed `themeVars` / `themeVarsDark` object → `--van-*`** | Sass variables + brand CSS vars | Tailwind theme + utility classes in templates (= custom CSS) | Design-token presets (styled) or write everything (unstyled) | JS theme object → generated CSS |
| Bundle / tree-shaking | Per-component custom elements, Stencil runtime; heaviest of the mobile three | **Per component; small** | Large CSS, JS tree-shakes | Small, Tailwind JIT | Medium | Heavy |
| Bundled icons, offline | ionicons as data-URL SVG: OK | **Icon font inlined as woff2 data URI, but CSS also carries a remote `at.alicdn.com` fallback URL → use our own SVG icons** | `@quasar/extras` fonts/SVG: OK | None (bring your own) | primeicons 8 (also PrimeUI License) | `@mdi/js` SVG: OK |
| CSP | **Injects `<style>`** for scoped components (alert, action-sheet, loading, input, textarea…; nonce read from `meta[name=csp-nonce]`) → needs nonce or `'unsafe-inline'` | **Clean: no style injection, no eval (checked in source)** | Mostly clean (spot check: only the unused `morph` util injects a style) | Clean (static CSS) | Styled mode injects runtime styles | **Injects runtime theme `<style>`** (`cspNonce` option) |
| Chat bubbles | — | — | **QChatMessage** | **Messages + Messagebar** | — | — |
| FAB / floating | ion-fab | FloatingBubble (draggable) | QFab, QPageSticky | Fab | SpeedDial | v-fab |
| Action sheet | ion-action-sheet | ActionSheet | BottomSheet plugin | Actions | — (Drawer) | v-bottom-sheet |
| Toast / modal | ion-toast, ion-modal (sheet), ion-alert | showToast, showNotify, Popup, showDialog | Notify, QDialog | Toast, Dialog, Sheet, Popup | Toast, Dialog | v-snackbar, v-dialog |
| Countdown | — | **CountDown** | — | — | — | — |
| Verdict | Runner-up (CSP) | **Pick** | Too heavy, Material look | Tailwind toolchain; styling via utility classes; Vue port secondary | **Excluded: license** | CSP + weight |

## 3. Screen → components

Global: `<van-config-provider :theme-vars theme="light" theme-vars-scope="global">`
wraps `App.vue`. `Locale.use('ru-RU', ruRU)`. Icons are `~icons/ph/*-fill` SVG
components, passed through each component's `#icon` slot.

**Chat (home)**
- Shell: a plain flex column at `height: 100dvh`, with
  `padding: env(safe-area-inset-*)` via `van-safe-area-top` / `van-safe-area-bottom`.
- Header: friend avatar `van-image round width="56" height="56"` wrapped in
  `van-badge dot :color="present ? success : gray"` (the "friend is here" indicator).
- Message list: our `ChatBubble.vue`: background `var(--van-primary-color)` (mine) or
  `var(--van-background-2)` (theirs), `border-radius: var(--van-radius-lg)`. Emoji-only
  messages get a large font (48px). "Missed call" marker: system bubble plus
  `van-button round type="success" size="large"` for calling back.
- Input row: `van-field v-model type="textarea" rows="1" autosize :maxlength="500"
  :border="false"`, an emoji toggle `van-button round icon-only`, and a send button
  `van-button round type="primary"`.
- Emoji picker: `van-popup v-model:show position="bottom" round safe-area-inset-bottom
  :style="{ height: '45%' }"` → `van-tabs swipeable sticky` (tab titles are emoji, no
  text) → `van-grid :column-num="6" square :border="false" clickable` →
  `van-grid-item @click="insert(e)"` with the emoji in the default slot at 40px.
- Call bar under the header (calls live inside the chat; owner, 2026-10-31): one
  segmented call switch OFF | AUDIO | VIDEO (`CallSwitch.vue`, plain `<button
  role="radio">` segments on Vant tokens, Phosphor icons phone-slash / phone /
  video-camera, 64×56 targets). Under it one status line: «ждём <имя>…», the call
  timer, «<имя> зовёт», «снова через» + `van-count-down`, or «никого нет». The ping
  button sits at the right of the bar, only while the friend is away
  (`PingButton.vue`, a plain button on Vant tokens):
  - Ready: warning colour, waving hand.
  - Cooldown: disabled look, an SVG ring empties with the seconds left.
  - Pushes used up: disabled, «🌙 завтра».
  - Her call: the AUDIO segment glows (no glow under prefers-reduced-motion).
  - VIDEO: disabled while OFF and for 3 s after AUDIO, with a small lock icon.
- Video (only while both switches are on VIDEO): a rounded block above the messages,
  her `<video>` big, ours small in the corner (`CallVideo.vue`).
- Header: a bell button toggles pushes to this device («Уведомления вкл/выкл»).

**Setup (adult, one time)**
- `van-steps direction="vertical" :active`, with sections in
  `van-cell-group inset`:
  1. Name: `van-field label="Имя" maxlength="20"`. Avatar: `van-grid :column-num="4"
     square` of bundled avatar images, the selected one marked with `van-badge`.
  2. Pairing, first device: QR shown in a `van-image` whose `src` is a
     `data:image/svg+xml` URL rendered by `uqr`, plus a `van-button` "Скопировать
     ссылку" → `showToast`.
  3. Pairing, second device: the scanner is a `<video>` inside a full-height
     `van-popup` and runs `jsqr` on frames. Fallback: `van-field` to paste the link.
  4. Install: if `matchMedia('(display-mode: standalone)')` is false, show
     `van-steps` with icon steps ("Поделиться → На экран «Домой»"). The QR scan must
     happen inside the installed PWA, because on iPadOS the home-screen app's storage
     is separate from Safari's.
  5. Notifications: `van-button type="primary" size="large" round` calls
     `Notification.requestPermission()` (iOS needs a tap inside the installed PWA).
     Show the result with `van-cell :title :value` status rows.
  6. Reset/re-pair: `showConfirmDialog({ title, message })`.

## 4. Theme config

```ts
// src/theme.ts
import type { ConfigProviderThemeVars } from 'vant'

const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", Roboto, ' +
  '"Noto Sans", system-ui, sans-serif, "Apple Color Emoji", "Noto Color Emoji"'

export const themeVars: ConfigProviderThemeVars = {
  // palette: soft and warm, not neon
  primaryColor: '#6C5CE7',      // lavender-indigo: my bubble, main actions
  successColor: '#22B07D',      // accept call
  dangerColor: '#EF5A6F',       // errors
  warningColor: '#FFB23F',      // ping, muted state
  textColor: '#2B2440',
  textColor2: '#6B6585',
  textColor3: '#A49FB8',
  background: '#FFF7EE',        // warm cream page
  background2: '#FFFFFF',       // cards, friend's bubble
  borderColor: '#EFE7DC',
  activeColor: '#F3ECFF',

  baseFont: font,
  fontSizeXs: '14px', fontSizeSm: '16px', fontSizeMd: '18px', fontSizeLg: '22px',

  radiusSm: '8px', radiusMd: '14px', radiusLg: '22px', radiusMax: '999px',

  // big touch targets (≥ 56px; primary actions 72px)
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
}

```

Also needed:
- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover">`, `<meta name="theme-color" content="#FFF7EE">`.
- Global `body { -webkit-tap-highlight-color: transparent; overscroll-behavior: none;
  user-select: none }`. Keep `user-select: text` on the textarea.

Dark mode: **light only in v1**. Force `theme="light"` on ConfigProvider and ignore
`prefers-color-scheme`. Reasons: one look on both kids' devices, half the visual
states to test, and the video block is dark by itself. Vant's
`themeVarsDark` stays available if a dark theme is wanted later.

Emoji: **a static curated list, no picker library.** Use ~120 emoji in 5–6 tabs
(faces, animals, food, hearts/party, nature, play), rendered with the system emoji
font. Kids can't use search, skin tones or long-press, so all three are left out.
Keep to Emoji ≤ 13.0 so they render on older Android too (iPadOS 16.4 has 15.0).
Rejected: `emoji-picker-element` 1.29.1 (default `dataSource` is a CDN, so it would
need self-hosted JSON; small tiles; search-centric UI), `emoji-mart` 5.6.0 (dormant
since 2024), `vue3-emoji-picker` 1.1.8 (dormant since 2023).

## 5. Packages to pin, and CSP notes

Pin exact versions (no `^`), commit the lockfile, and pin Node in `.nvmrc` /
`engines`.

| package | version | role |
|---|---|---|
| `vue` | 3.5.44 | |
| `vite` | 8.3.5 | |
| `vant` | 4.10.2 | UI |
| `unplugin-vue-components` | 32.1.0 | auto-import Vant components and their CSS |
| `@vant/auto-import-resolver` | 1.3.0 | resolver for the above |
| `unplugin-icons` | 24.0.0 | build-time SVG icons as Vue components |
| `@iconify-json/ph` | 1.2.2 | Phosphor icon set (fill weight: rounded, friendly) |
| `uqr` | 0.1.3 | QR generation → SVG string, zero deps |
| `jsqr` | 1.4.0 | QR decoding from canvas frames, pure JS, no WASM |
| `vite-plugin-pwa` | 2.0.0 | manifest + service worker (optional; a hand-written SW is fine too) |

Not chosen for scanning: `barcode-detector` 3.2.3 (polyfill on `zxing-wasm` 3.1.6).
It fetches its `.wasm` from jsDelivr by default and needs
`script-src 'wasm-unsafe-eval'`. Safari still has no native `BarcodeDetector`, so the
iPad would always take the WASM path. `jsqr` keeps the CSP free of wasm.

Target CSP for the frontend (served as a header from Pages `_headers`):

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss://<worker-host>;
worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

Watch for:
- **Vant icon CSS** (`vant/es/icon/index.css`, pulled in by Field, Popup close icon,
  Loading and others) declares the font as a woff2 `data:` URI **followed by a
  fallback `url(//at.alicdn.com/...woff)`**. Browsers stop at the supported woff2, and
  `font-src 'self' data:` blocks the fallback anyway, so no request goes out. But the
  string ends up in `dist/`, and a reviewer grepping for third-party hosts will find
  it. Strip it with a tiny Vite `transform` (or PostCSS) step, and add a CI check that
  fails if `dist/` contains `https?://` outside `w3.org` XML namespaces.
- Vue `:style` bindings and Vant theme vars go through CSSOM, which `style-src 'self'`
  allows. Do **not** add `require-trusted-types-for`: Vue's runtime still assigns
  `innerHTML` in places.
- `vite-plugin-pwa`: use `injectRegister: 'script'` (or register manually), never
  `'inline'`, which emits an inline `<script>`.
- Render the QR as `<img src="data:image/svg+xml,...">` (covered by `img-src data:`),
  not `v-html`.
- No Google Fonts: the font stack is system-only. That's also why Konsta's Material
  theme (Roboto) and Quasar's Roboto default were ruled out.
- If Ionic is ever reconsidered: its scoped components inject `<style>` and read a
  nonce from `<meta name="csp-nonce">`. A static nonce in a static file adds no
  protection, so honestly that means `style-src 'unsafe-inline'`.

Sources: npm registry (versions, publish dates); package tarballs grepped for
`createElement('style')`, `eval`, remote URLs (vant 4.10.2, @ionic/core 9.0.10,
ionicons 8.1.0, vuetify 4.3.1, quasar 2.35.2, konsta 5.5.0);
[Ionic 9 announcement](https://ionic.io/blog/announcing-ionic-framework-9),
[Ionic BREAKING.md](https://github.com/ionic-team/ionic-framework/blob/main/BREAKING.md),
[Ionic security / setNonce](https://ionicframework.com/docs/techniques/security),
[Stencil CSP nonce](https://stenciljs.com/docs/csp-nonce),
[Vuetify Feb 2026 update](https://link.vuetifyjs.com/february-2026-update),
[PrimeVue 5.0.0](https://blog.primeui.dev/blog/primevue-5-0-0/),
[PrimeUI next chapter](https://primeui.dev/nextchapter),
[Konsta UI Vue install](https://konstaui.com/vue/installation).
