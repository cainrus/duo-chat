import { describe, expect, it } from 'vitest'
import { isStickerId, NOTO_CODEPOINTS, NOTO_STICKERS, notoEmoji, SPY_MOODS, SPY_STICKERS, stickerLabel, stickerSrc } from './catalog'

describe('sticker catalogue', () => {
  it('knows every spy mood and every Noto codepoint', () => {
    for (const m of SPY_MOODS) expect(isStickerId(`spy:${m}`)).toBe(true)
    for (const c of NOTO_CODEPOINTS) expect(isStickerId(`noto:${c}`)).toBe(true)
    expect(SPY_STICKERS).toHaveLength(8)
    expect(NOTO_STICKERS).toHaveLength(31)
  })

  it('rejects unknown ids', () => {
    for (const id of ['spy:dance', 'noto:1f4a9', 'cat:happy', 'noto:2764']) expect(isStickerId(id), id).toBe(false)
  })

  it('rejects malformed ids and non-strings', () => {
    for (const id of ['', 'spy', 'spy:', ':happy', ' spy:happy', 'spy:happy ', 'SPY:happy', 'spy:happy:x', 'noto:../1f600', '/stickers/spy/happy.svg'])
      expect(isStickerId(id), JSON.stringify(id)).toBe(false)
    for (const v of [null, undefined, 42, {}, ['spy:happy']]) expect(isStickerId(v)).toBe(false)
  })

  it('maps ids to same-origin files and names', () => {
    expect(stickerSrc('spy:love')).toBe('/stickers/spy/love.svg')
    expect(stickerSrc('noto:2764_fe0f')).toBe('/stickers/noto/2764_fe0f.webp')
    expect(notoEmoji('2764_fe0f')).toBe('❤️')
    expect(stickerLabel('noto:1f984')).toBe('🦄')
    expect(stickerLabel('spy:sleep')).toBe('шпион: сплю')
  })
})
