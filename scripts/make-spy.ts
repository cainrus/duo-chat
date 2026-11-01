// The spy: one fixed character for both kids, the friend's picture and 8 animated mood stickers.
// The classic spy look (fedora, dark glasses, popped trench collar) on the Big Smile 3/4 baby face
// (DiceBear "Big Smile" by Ashley Seo, CC BY 4.0; library MIT), recoloured as a shadow. Hat,
// glasses, coat and animation are our own drawing. Everything is drawn in the face's 480-unit
// space and cropped close.
//
// Build-time only (the app shows the files with <img src>; no DiceBear at runtime).
// Run: node --experimental-strip-types scripts/make-spy.ts
// Output: public/stickers/spy/<mood>.svg (animated, SMIL only) and avatar.svg (the happy spy,
// still: no SMIL, no sparkles). No CSS, no script, no external refs (assertSafeSvg). The output
// is deterministic, so a rerun does not change the committed files.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAvatar } from '@dicebear/core'
import * as bigSmile from '@dicebear/big-smile'
import { SPY_MOODS as MOODS, type SpyMood as Mood } from '../src/client/stickers/catalog.ts'

type Face = NonNullable<bigSmile.Options['eyes']>[number]
type Mouth = NonNullable<bigSmile.Options['mouth']>[number]
const LOOK: Record<Mood, { eyes: Face; mouth: Mouth }> = {
  happy: { eyes: 'cheery', mouth: 'openedSmile' },
  wink: { eyes: 'winking', mouth: 'kawaii' },
  wow: { eyes: 'starstruck', mouth: 'gapSmile' },
  love: { eyes: 'cheery', mouth: 'kawaii' },
  think: { eyes: 'confused', mouth: 'awkwardSmile' },
  sad: { eyes: 'sad', mouth: 'openSad' },
  sleep: { eyes: 'sleepy', mouth: 'unimpressed' },
  angry: { eyes: 'angry', mouth: 'unimpressed' },
}

function face(m: Mood): string {
  const svg: string = createAvatar(bigSmile, {
    seed: `duo-${m}`, accessoriesProbability: 0,
    hair: ['shavedHead'], hairColor: ['3a1a01'], skinColor: ['f5d7b1'], eyes: [LOOK[m].eyes], mouth: [LOOK[m].mouth],
  }).toString()
  const inner = prefixIds(
    svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<metadata[\s\S]*?<\/metadata>/, ''),
    `face-${m}-`,
  )
  const star = LOOK[m].eyes === 'starstruck'
  const shadow = inner
    .replace(/<g transform="[^"]*"><path d="[^"]*" fill="#3a1a01"\/><\/g>/, '')
    .replace(/<path d="[^"]*" fill="#DC2400" style="mix-blend-mode:multiply" opacity="\.1"\/>/, '')
    .replaceAll('fill="#f5d7b1"', 'fill="url(#skin)"')
    .replaceAll('fill="#2A1200"', star ? 'fill="#FFB238"' : 'fill="#FFF1C9"')
    .replaceAll('fill="#71472D"', 'fill="#D9CCF0"')
    .replaceAll('fill="#592125"', 'fill="#FF9C8F"')
    .replaceAll('fill="#873C41"', 'fill="#B5475A"')
  if (/style=|#3a1a01|#DC2400/.test(shadow)) throw new Error('face post-processing missed something: ' + m)
  return `<svg x="0" y="0" width="480" height="480" viewBox="0 0 480 480" overflow="visible">${shadow}</svg>`
}

/** Stable ids instead of DiceBear's random ones: `id="x"` and its `#x` refs get the prefix. */
function prefixIds(svg: string, prefix: string): string {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]!)
  let out = svg
  for (const id of ids) {
    out = out
      .replaceAll(`id="${id}"`, `id="${prefix}${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}${id})`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}${id}"`)
  }
  return out
}

const loop = (attr: string, values: string, dur: number, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" repeatCount="indefinite"${extra}/>`
const move = (values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s" repeatCount="indefinite" additive="sum"${extra}/>`
const spin = (values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="rotate" values="${values}" dur="${dur}s" repeatCount="indefinite" additive="sum"${extra}/>`
const ease = (n: number) => ` calcMode="spline" keySplines="${Array(n).fill('.45 0 .55 1').join(';')}"`

const defs = `<defs>
<linearGradient id="skin" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#2B2633"/><stop offset="1" stop-color="#4A4258"/></linearGradient>
<linearGradient id="felt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8A8F98"/><stop offset=".6" stop-color="#686D76"/><stop offset="1" stop-color="#50545C"/></linearGradient>
<linearGradient id="brim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7F848D"/><stop offset="1" stop-color="#4F535B"/></linearGradient>
<linearGradient id="coat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8E939B"/><stop offset="1" stop-color="#6A6F77"/></linearGradient>
<linearGradient id="lapelL" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#6E737B"/><stop offset="1" stop-color="#A9AEB5"/></linearGradient>
<linearGradient id="lapelR" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9DA2A9"/><stop offset="1" stop-color="#C3C7CC"/></linearGradient>
<linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3E46"/><stop offset="1" stop-color="#16181C"/></linearGradient>
</defs>`

// --- hat --------------------------------------------------------------------------------------

function hat(m: Mood): string {
  const jump = m === 'wow' ? move('0 0;0 -60;0 -46;0 0;0 0', 1.6, ` keyTimes="0;.14;.3;.45;1"`)
    : m === 'angry' ? move('0 0;-2 0;2 0;0 0', 0.25) : ''
  return `<g transform="translate(0 -16) rotate(-6 260 160)"><g>${jump}` +
    // crown with the pinched top (two bumps and a dip)
    `<path d="M150 160 C140 96 146 24 176 -18 Q204 -48 238 -22 Q270 -50 304 -20 C338 18 352 92 348 160Z" fill="url(#felt)"/>` +
    `<path d="M238 -20 Q232 20 240 60" fill="none" stroke="#2A2D33" stroke-width="7" stroke-linecap="round" opacity=".6"/>` +
    `<path d="M178 6 Q160 50 162 110" fill="none" stroke="#7B8089" stroke-width="10" stroke-linecap="round" opacity=".55"/>` +
    // band
    `<path d="M146 120 Q250 140 350 120 L350 156 Q250 176 146 156Z" fill="#3A3D44"/>` +
    `<path d="M148 128 Q250 147 348 128" fill="none" stroke="#5A5E66" stroke-width="3" opacity=".8"/>` +
    // brim
    `<ellipse cx="256" cy="168" rx="236" ry="44" fill="url(#brim)"/>` +
    `<path d="M40 160 Q256 120 472 160" fill="none" stroke="#6E737C" stroke-width="6" stroke-linecap="round" opacity=".7"/>` +
    `<path d="M150 158 Q250 176 348 158 L348 166 Q250 184 150 166Z" fill="#23262B" opacity=".55"/>` +
    `</g></g>`
}

// --- glasses ----------------------------------------------------------------------------------

const lensNear = 'M238 224 L340 224 Q344 278 292 284 Q238 282 238 224Z'
const lensFar = 'M356 224 L416 222 Q418 272 390 278 Q358 276 356 224Z'

function glasses(m: Mood): string {
  const motion =
    m === 'wink' ? move('0 0;0 0;0 26;0 26;0 0', 2.4, ` keyTimes="0;.15;.3;.75;1"`) + spin('0 330 240;0 330 240;-6 330 240;-6 330 240;0 330 240', 2.4, ` keyTimes="0;.15;.3;.75;1"`)
    : m === 'wow' ? move('0 0;0 -70;0 -56;0 0;0 0', 1.6, ` keyTimes="0;.14;.3;.45;1"`)
    : m === 'sleep' ? spin('8 330 240;12 330 240;8 330 240', 3, ease(2)) + move('0 14;0 18;0 14', 3, ease(2))
    : m === 'think' ? move('0 0;0 0;0 -10;0 -10;0 0', 3, ` keyTimes="0;.3;.4;.8;1"`)
    : ''
  const shine = `<path d="M256 234 L280 234 L264 270 L244 270Z" fill="#fff" opacity=".22"/><path d="M366 232 L380 232 L370 262 L360 262Z" fill="#fff" opacity=".2"/>`
  const hearts = m === 'love'
    ? ([[290, 254, 16], [387, 250, 12]] as const).map(([x, y, s]) => `<g transform="translate(${x} ${y})"><path d="${heartPath(0, 0, s)}" fill="#FF6E98">` +
      `<animateTransform attributeName="transform" type="scale" values="1;1.3;1;1.15;1" keyTimes="0;.15;.3;.45;1" dur="1.3s" repeatCount="indefinite"/></path></g>`).join('')
    : ''
  return `<g><g>${motion}` +
    `<path d="M240 232 L116 250" stroke="#D5D9DE" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="${lensNear}" fill="url(#lens)" stroke="#D5D9DE" stroke-width="6"/><path d="${lensFar}" fill="url(#lens)" stroke="#D5D9DE" stroke-width="6"/>` +
    `<path d="M340 234 Q348 227 356 234" fill="none" stroke="#D5D9DE" stroke-width="8" stroke-linecap="round"/>` +
    shine + hearts + `</g></g>`
}

// --- coat -------------------------------------------------------------------------------------

/** Shoulders and the far (back) half of the popped collar, behind the head. */
const coatBack =
  `<path d="M-40 560 C-30 470 40 432 140 420 L360 420 C450 432 510 470 520 560Z" fill="url(#coat)"/>` +
  `<ellipse cx="250" cy="468" rx="116" ry="34" fill="#2A2731"/>` +
  `<path d="M190 560 L120 440 L10 280 Q4 266 20 270 L170 372 L240 440Z" fill="url(#lapelL)"/>` +
  `<path d="M20 270 L170 372 L160 390Z" fill="#4E535B"/>`

/** The near lapel: rises beside the cheek and sweeps across the chest. */
const coatFront =
  `<path d="M226 560 Q270 476 356 432 L448 300 Q462 284 470 300 L476 430 Q468 470 436 476 L404 472 Q340 500 300 560Z" fill="url(#lapelR)"/>` +
  `<path d="M358 434 L450 304" stroke="#E2E5E8" stroke-width="5" stroke-linecap="round" opacity=".8"/>` +
  `<path d="M404 472 L474 440" stroke="#7E838B" stroke-width="4" stroke-linecap="round" opacity=".7"/>` +
  `<circle cx="214" cy="528" r="9" fill="#44484E"/>`

// --- signs ------------------------------------------------------------------------------------

const sparkle = (x: number, y: number, s: number, begin: number, color = '#FFC93C') =>
  `<g transform="translate(${x} ${y})"><path d="M0 ${-s} Q${s * 0.16} ${-s * 0.16} ${s} 0 Q${s * 0.16} ${s * 0.16} 0 ${s} Q${-s * 0.16} ${s * 0.16} ${-s} 0 Q${-s * 0.16} ${-s * 0.16} 0 ${-s}Z" fill="${color}">` +
  `<animateTransform attributeName="transform" type="scale" values="0;1;0;0" keyTimes="0;.3;.6;1" dur="1.6s" begin="${begin}s" repeatCount="indefinite"/></path></g>`
function heartPath(x: number, y: number, s: number): string {
  return `M${x} ${y + s * 0.85} C${x - s * 1.45} ${y - s * 0.05} ${x - s * 0.85} ${y - s * 1.15} ${x} ${y - s * 0.38} C${x + s * 0.85} ${y - s * 1.15} ${x + s * 1.45} ${y - s * 0.05} ${x} ${y + s * 0.85}Z`
}

function signs(m: Mood): string {
  switch (m) {
    case 'happy': return sparkle(20, 250, 24, 0) + sparkle(470, 300, 20, 0.5) + sparkle(456, 10, 16, 1)
    case 'wink': return sparkle(462, 220, 24, 0.6)
    case 'wow': return `<g transform="translate(462 330)"><g><rect x="-13" y="-66" width="26" height="74" rx="13" fill="#FF5A6E"/><circle cx="0" cy="34" r="14" fill="#FF5A6E"/>` +
      `<animateTransform attributeName="transform" type="scale" values="0;1.25;1;1;0" keyTimes="0;.12;.22;.85;1" dur="1.6s" repeatCount="indefinite"/></g></g>`
    case 'love': return ([[24, 300, 0], [470, 280, 0.6], [460, 400, 1.2], [30, 140, 0.9]] as const).map(([x, y, b]) =>
      `<path d="${heartPath(x, y, 20)}" fill="#FF5C8A" opacity="0">${loop('opacity', '0;1;0', 1.8, ` begin="${b}s"`)}${move('0 0;0 -70', 1.8, ` begin="${b}s"`)}</path>`).join('')
    case 'think': return `<g transform="translate(450 40)"><g><path d="M-24 -12 Q-24 -48 8 -48 Q40 -48 40 -16 Q40 6 14 16 L12 34" fill="none" stroke="#5B6CFF" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<circle cx="12" cy="66" r="12" fill="#5B6CFF"/>${move('0 0;0 -10;0 0', 1.6, ease(2))}${spin('-6;6;-6', 3.2)}</g></g>`
    case 'sad': return `<path d="M0 -14 Q-12 6 0 14 Q12 6 0 -14Z" fill="#7CC6FF" transform="translate(300 282)">` +
      move('0 0;0 0;0 50;0 76', 2.2, ` keyTimes="0;.25;.8;1"`) + loop('opacity', '1;1;1;0', 2.2, ` keyTimes="0;.25;.8;1"`) + `</path>`
    case 'sleep': return ([[410, 100, 26, 0], [440, 40, 34, 1]] as const).map(([x, y, s, b]) =>
      `<path d="M${x} ${y} h${s} l${-s} ${s} h${s}" fill="none" stroke="#8EA2FF" stroke-width="${s / 3.4}" stroke-linecap="round" stroke-linejoin="round" opacity="0">` +
      loop('opacity', '0;1;1;0', 2, ` begin="${b}s"`) + move('0 0;16 -34', 2, ` begin="${b}s"`) + `</path>`).join('')
    case 'angry': return `<g transform="translate(452 40)"><g fill="none" stroke="#FF4D4D" stroke-width="12" stroke-linecap="round">` +
      `<path d="M-28 -7 Q-14 -7 -7 -24"/><path d="M28 -7 Q14 -7 7 -24"/><path d="M-28 7 Q-14 7 -7 24"/><path d="M28 7 Q14 7 7 24"/>` +
      `<animateTransform attributeName="transform" type="scale" values="1;1.25;1" dur=".8s" repeatCount="indefinite"/></g></g>`
  }
}

function headMotion(m: Mood): string {
  switch (m) {
    case 'happy': return move('0 0;0 -12;0 0', 0.9, ease(2))
    case 'wink': return spin('0 250 420;5 250 420;5 250 420;0 250 420', 2.4, ` keyTimes="0;.2;.75;1"`)
    case 'love': return spin('-4 250 420;4 250 420;-4 250 420', 2.4, ease(2))
    case 'think': return spin('0 250 420;-6 250 420;-6 250 420;0 250 420', 3, ` keyTimes="0;.3;.7;1"`)
    case 'sad': return move('0 0;0 6;0 0', 2.4, ease(2))
    case 'sleep': return spin('0 250 420;-6 250 420;0 250 420', 3, ease(2))
    case 'angry': return move('0 0;-4 0;4 0;0 0', 0.25)
    case 'wow': return ''
  }
}

function squash(m: Mood): string {
  if (m === 'happy') return `<animateTransform attributeName="transform" type="scale" values="1 1;1.03 .97;.98 1.03;1 1" dur=".9s" repeatCount="indefinite" additive="sum"/>`
  if (m === 'wow') return `<animateTransform attributeName="transform" type="scale" values="1 1;.96 1.05;1 1;1 1" keyTimes="0;.14;.35;1" dur="1.6s" repeatCount="indefinite" additive="sum"/>`
  return ''
}

/** One animated sticker. With `signs: false` the sparkles, hearts etc. around the spy are left out. */
export function spySvg(m: Mood, opts: { signs?: boolean } = {}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -30 520 520">` + defs +
    `<g transform="translate(240 560)"><g>${squash(m)}<g transform="translate(-240 -560)">` +
    coatBack +
    `<g transform="translate(0 40)"><g>${headMotion(m)}${face(m)}${glasses(m)}${hat(m)}</g></g>` +
    coatFront +
    `</g></g></g><g transform="translate(0 40)">` + (opts.signs === false ? '' : signs(m)) + `</g></svg>`
  assertSafeSvg(svg)
  return svg
}

/**
 * The friend's picture: the happy spy standing still (its first frame: every SMIL element
 * removed, and the sparkles, which start at scale 0, left out). The header stays calm.
 */
export function spyAvatarSvg(): string {
  const svg = spySvg('happy', { signs: false }).replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g, '')
  if (/<(?:animate|set)\b/i.test(svg)) throw new Error('spy avatar: SMIL left in')
  assertSafeSvg(svg)
  return svg
}

/**
 * The files are shown with <img src> under a strict CSP, and must stay plain drawings: no CSS
 * (`style=`, <style>), no script or event handlers, no external references, no embedded HTML.
 * Throws on the first problem.
 */
export function assertSafeSvg(svg: string): void {
  const problems: [RegExp, string][] = [
    [/\bstyle\s*=/i, 'style attribute'],
    [/<style\b/i, '<style>'],
    [/<script\b/i, '<script>'],
    [/<foreignObject\b/i, '<foreignObject>'],
    [/\son[a-z]+\s*=/i, 'event handler attribute'],
    [/\bhref\s*=\s*"(?!#)/i, 'external href'],
    [/url\(\s*(?!#)/i, 'external url()'],
    [/javascript:/i, 'javascript: URL'],
  ]
  for (const [re, what] of problems) if (re.test(svg)) throw new Error(`unsafe spy SVG: ${what}`)
  const urls = svg.match(/\b(?:https?|wss?|ftp):\/\/[^\s"'<>]+/gi) ?? []
  for (const u of urls) if (u !== 'http://www.w3.org/2000/svg') throw new Error(`unsafe spy SVG: external URL ${u}`)
}

/** Every file make-spy writes, by name. */
export function spyFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const m of MOODS) files[`${m}.svg`] = spySvg(m)
  files['avatar.svg'] = spyAvatarSvg()
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stickers', 'spy')
  mkdirSync(dir, { recursive: true })
  for (const [name, svg] of Object.entries(spyFiles())) {
    writeFileSync(join(dir, name), svg)
    console.log(`wrote public/stickers/spy/${name} (${svg.length} bytes)`)
  }
}
