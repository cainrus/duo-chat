// A static, curated emoji keyboard. Kids cannot use search, skin tones or long-press, so
// there are none. Everything here is Emoji 13.0 or older so older Android renders it.

export type EmojiTab = { icon: string; label: string; emoji: readonly string[] }

export const EMOJI_TABS: readonly EmojiTab[] = [
  {
    icon: '😀',
    label: 'Лица',
    emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '😎', '🤩', '🥳', '😴', '🤔', '🤗', '🤭', '😮', '😲', '😢', '😭', '😡', '🥺', '😱', '🤯'],
  },
  {
    icon: '🐶',
    label: 'Звери',
    emoji: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐤', '🦄', '🐝', '🦋', '🐞', '🐢', '🐙', '🐬', '🐳', '🦈', '🦒', '🐘', '🦔'],
  },
  {
    icon: '🍓',
    label: 'Еда',
    emoji: ['🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🥕', '🌽', '🍕', '🍔', '🍟', '🌭', '🍿', '🍩', '🍪', '🎂', '🧁', '🍰', '🍫', '🍬', '🍭', '🍦', '🥞', '🧇', '🥤', '🧃', '🍼'],
  },
  {
    icon: '❤️',
    label: 'Сердечки',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '💖', '💕', '💗', '✨', '⭐', '🌟', '🎉', '🎊', '🎈', '🎁', '🏆', '👍', '👎', '👏', '🙌', '👋', '🤝', '🙏', '💪', '✌️', '🤞', '👌', '🤙'],
  },
  {
    icon: '🌸',
    label: 'Природа',
    emoji: ['🌸', '🌼', '🌻', '🌷', '🌹', '🌈', '☀️', '🌙', '⛅', '🌧️', '❄️', '⛄', '🔥', '🌊', '🍀', '🍁', '🌵', '🌲', '🌍', '⚡', '💧', '🐚', '🍄', '🌴'],
  },
  {
    icon: '⚽',
    label: 'Игры',
    emoji: ['⚽', '🏀', '🎾', '🏐', '🎮', '🧸', '🪁', '🎨', '🖍️', '🎵', '🎤', '🎧', '📚', '✏️', '🚗', '🚌', '🚲', '🚀', '✈️', '🛴', '🏠', '🏰', '🎠', '🎡'],
  },
]

const NON_TEXT = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣\s]/gu

/** True for short emoji-only messages, which the chat shows large. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim()
  if (!t || t.replace(NON_TEXT, '') !== '') return false
  const glyphs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t.replace(/\s/g, ''))]
  return glyphs.length <= 6
}
