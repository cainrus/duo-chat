// The known stickers. A sticker travels as a chat message whose `text` is its id:
// `spy:<mood>` (our own spy character) or `noto:<codepoint>` (Google Noto Animated Emoji).
// Anything the friend sends is checked against these lists; unknown ids are dropped.
// No imports: scripts/make-spy.ts and scripts/fetch-stickers.ts read the same lists.

/** The spy's moods, in panel order. Files: public/stickers/spy/<mood>.svg. */
export const SPY_MOODS = ['happy', 'wink', 'wow', 'love', 'think', 'sad', 'sleep', 'angry'] as const
export type SpyMood = (typeof SPY_MOODS)[number]

export const SPY_LABELS: Record<SpyMood, string> = {
  happy: 'радуюсь',
  wink: 'подмигиваю',
  wow: 'ух ты!',
  love: 'люблю',
  think: 'думаю',
  sad: 'грущу',
  sleep: 'сплю',
  angry: 'сержусь',
}

/** Noto Animated Emoji, in panel order. Files: public/stickers/noto/<codepoint>.webp. */
export const NOTO_CODEPOINTS = [
  '1f600', '1f602', '1f60d', '1f970', '1f618', '1f60e', '1f973', '1f929',
  '1f62d', '1f97a', '1f914', '1f634', '1f631', '1f61c', '1f917', '1f44b',
  '1f44d', '1f44f', '2764_fe0f', '1f496', '1f308', '1f984', '1f431', '1f98a',
  '1f43c', '1f389', '1f382', '1f366', '2b50', '1f388', '1f381',
] as const
export type NotoCodepoint = (typeof NOTO_CODEPOINTS)[number]

export type StickerId = `spy:${SpyMood}` | `noto:${NotoCodepoint}`

const KNOWN: ReadonlySet<string> = new Set<string>([
  ...SPY_MOODS.map((m) => `spy:${m}`),
  ...NOTO_CODEPOINTS.map((c) => `noto:${c}`),
])

/** True only for a sticker id from the lists above (exact match, nothing else). */
export function isStickerId(value: unknown): value is StickerId {
  return typeof value === 'string' && KNOWN.has(value)
}

export const SPY_STICKERS: readonly StickerId[] = SPY_MOODS.map((m) => `spy:${m}` as const)
export const NOTO_STICKERS: readonly StickerId[] = NOTO_CODEPOINTS.map((c) => `noto:${c}` as const)

/** The still (non-animated) happy spy: the friend's picture in the header and the call area. */
export const SPY_AVATAR_SRC = '/stickers/spy/avatar.svg'

/** Same-origin image URL of a sticker. */
export function stickerSrc(id: StickerId): string {
  const [pack, name] = id.split(':') as ['spy' | 'noto', string]
  return pack === 'spy' ? `/stickers/spy/${name}.svg` : `/stickers/noto/${name}.webp`
}

/** The emoji a Noto codepoint stands for (`2764_fe0f` -> ❤️). */
export function notoEmoji(cp: NotoCodepoint): string {
  return String.fromCodePoint(...cp.split('_').map((h) => parseInt(h, 16)))
}

/** A short accessible name (Russian mood word for the spy, the emoji itself for Noto). */
export function stickerLabel(id: StickerId): string {
  const [pack, name] = id.split(':') as ['spy' | 'noto', string]
  return pack === 'spy' ? `шпион: ${SPY_LABELS[name as SpyMood]}` : notoEmoji(name as NotoCodepoint)
}
