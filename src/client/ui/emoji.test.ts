import { describe, expect, it } from 'vitest'
import { EMOJI_TABS, isEmojiOnly } from './emoji'

describe('emoji list', () => {
  it('has no duplicates and about 120+ entries', () => {
    const all = EMOJI_TABS.flatMap((t) => t.emoji)
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBeGreaterThanOrEqual(120)
  })

  it('detects short emoji-only messages', () => {
    expect(isEmojiOnly('😍')).toBe(true)
    expect(isEmojiOnly('🐱🐶🦄')).toBe(true)
    expect(isEmojiOnly('❤️ ✨')).toBe(true)
    expect(isEmojiOnly('Привет 👋')).toBe(false)
    expect(isEmojiOnly('123')).toBe(false)
    expect(isEmojiOnly('😀😀😀😀😀😀😀')).toBe(false)
  })
})
