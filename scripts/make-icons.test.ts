import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng, render } from './make-icons.ts'

describe('make-icons', () => {
  it('encodes a valid opaque RGB PNG of the requested size', () => {
    const png = encodePng(16, render(16))
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(16)
    expect(png[25]).toBe(2)
    const idatLen = png.readUInt32BE(33)
    expect(png.toString('ascii', 37, 41)).toBe('IDAT')
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe(16 * (16 * 3 + 1))
  })

  it('is deterministic', () => {
    expect(encodePng(32, render(32)).equals(encodePng(32, render(32)))).toBe(true)
  })
})
