// Draws the app icons (two overlapping friendly circles on a soft background) as PNGs,
// with no dependencies and no network: a tiny rasterizer plus zlib.
// Run: node --experimental-strip-types scripts/make-icons.ts
// Output: public/icons/icon-192.png, icon-512.png, apple-touch-icon.png (180).
// Icons are opaque and keep the drawing inside the central 80%, so they work as maskable.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RGB = [number, number, number]

const BACKGROUND: RGB = [0xf4, 0xf1, 0xfb]
const LEFT: RGB = [0xff, 0x8f, 0xb1] // pink friend
const RIGHT: RGB = [0x6c, 0xc4, 0xd6] // teal friend
const FACE: RGB = [0x3a, 0x33, 0x4f]

/** Shapes in unit coordinates (0..1), painted in order. */
type Shape = { color: RGB; inside: (x: number, y: number) => boolean }

const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
/** Lower half of a ring: a smile. */
const smile = (cx: number, cy: number, r: number, w: number) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy)
  return y > cy + r * 0.25 && d <= r + w / 2 && d >= r - w / 2
}

function friend(cx: number, cy: number, color: RGB): Shape[] {
  const r = 0.2
  return [
    { color, inside: circle(cx, cy, r) },
    { color: FACE, inside: circle(cx - 0.065, cy - 0.035, 0.024) },
    { color: FACE, inside: circle(cx + 0.065, cy - 0.035, 0.024) },
    { color: FACE, inside: smile(cx, cy + 0.01, 0.085, 0.022) },
  ]
}

const SHAPES: Shape[] = [...friend(0.38, 0.52, LEFT), ...friend(0.62, 0.48, RIGHT)]

const SUPERSAMPLE = 4

function render(size: number): Uint8Array {
  const rgb = new Uint8Array(size * size * 3)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size
          let c = BACKGROUND
          for (const s of SHAPES) if (s.inside(x, y)) c = s.color
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SUPERSAMPLE * SUPERSAMPLE
      const i = (py * size + px) * 3
      rgb[i] = Math.round(r / n)
      rgb[i + 1] = Math.round(g / n)
      rgb[i + 2] = Math.round(b / n)
    }
  }
  return rgb
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function encodePng(size: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor RGB
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0 // filter: none
    raw.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), y * (size * 3 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

export const ICONS: { file: string; size: number }[] = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
  mkdirSync(outDir, { recursive: true })
  for (const { file, size } of ICONS) {
    writeFileSync(join(outDir, file), encodePng(size, render(size)))
    console.log(`wrote public/icons/${file}`)
  }
}

export { render }
