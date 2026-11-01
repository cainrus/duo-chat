import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SPY_MOODS } from '../src/client/stickers/catalog.ts'
import { assertSafeSvg, spyAvatarSvg, spyFiles } from './make-spy.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stickers', 'spy')

describe('make-spy', () => {
  it('writes one sticker per mood plus the avatar', () => {
    expect(Object.keys(spyFiles()).sort()).toEqual([...SPY_MOODS.map((m) => `${m}.svg`), 'avatar.svg'].sort())
  })

  it('is deterministic and matches the committed files', () => {
    const a = spyFiles()
    expect(spyFiles()).toEqual(a)
    for (const [name, svg] of Object.entries(a)) expect(readFileSync(join(dir, name), 'utf8'), name).toBe(svg)
  })

  it('committed files are plain drawings: no CSS, script or external refs', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg'))
    expect(files.length).toBe(SPY_MOODS.length + 1)
    for (const f of files) {
      const svg = readFileSync(join(dir, f), 'utf8')
      expect(() => assertSafeSvg(svg), f).not.toThrow()
      expect(svg, f).not.toMatch(/style=|<style|<script/i)
    }
  })

  it('stickers animate, the avatar stands still', () => {
    for (const m of SPY_MOODS) expect(spyFiles()[`${m}.svg`]).toMatch(/<animate/)
    expect(spyAvatarSvg()).not.toMatch(/<animate|<set\b/)
  })

  it('the safety check rejects what an <img> SVG must not carry', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(#a)"/></svg>'
    expect(() => assertSafeSvg(ok)).not.toThrow()
    for (const bad of [
      '<svg><path style="fill:red"/></svg>',
      '<svg><style>path{}</style></svg>',
      '<svg><script>alert(1)</script></svg>',
      '<svg><path onclick="x()"/></svg>',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      '<svg><use xlink:href="other.svg#a"/></svg>',
      '<svg><path fill="url(https://evil.example/#a)"/></svg>',
      '<svg><foreignObject/></svg>',
    ]) {
      expect(() => assertSafeSvg(bad), bad).toThrow(/unsafe/)
    }
  })
})
