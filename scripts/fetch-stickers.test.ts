import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NOTO_CODEPOINTS } from '../src/client/stickers/catalog.ts'
import { FFMPEG_ARGS } from './fetch-stickers.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stickers', 'noto')

describe('fetch-stickers', () => {
  it('a committed animated WebP exists for every Noto sticker, and nothing else', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.webp')).sort()
    expect(files).toEqual(NOTO_CODEPOINTS.map((c) => `${c}.webp`).sort())
    let total = 0
    for (const f of files) {
      const b = readFileSync(join(dir, f))
      total += b.length
      expect(b.toString('ascii', 0, 4), f).toBe('RIFF')
      expect(b.toString('ascii', 8, 12), f).toBe('WEBP')
      expect(b.includes(Buffer.from('ANIM')), `${f} is animated`).toBe(true)
    }
    // The pack stays light (lazy-loaded, but still downloaded once per device).
    expect(total).toBeLessThan(2.5 * 1024 * 1024)
  })

  it('converts at 128 px, loops forever, keeps no metadata', () => {
    const args = FFMPEG_ARGS('in.gif', 'out.webp').join(' ')
    expect(args).toContain('scale=128:-1')
    expect(args).toContain('-c:v libwebp_anim')
    expect(args).toContain('-loop 0')
    expect(args).toContain('-map_metadata -1')
  })
})
