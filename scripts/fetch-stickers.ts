// Fetches the Noto Animated Emoji stickers (Google, CC BY 4.0) and converts them to small
// animated WebP files that the app serves itself (no third-party request at runtime).
// Needs ffmpeg with libwebp. Rerunnable: it rewrites every file from the source GIF.
// Run: node --experimental-strip-types scripts/fetch-stickers.ts
// Output: public/stickers/noto/<codepoint>.webp (128 px, 15 fps, quality 60, loops forever).
// 15 fps rather than 20: at 20 the 31 files weigh 3.1 MB, at 15 about 2.4 MB, and the motion
// still reads as smooth at sticker size. Quality and compression level barely move the size.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOTO_CODEPOINTS } from '../src/client/stickers/catalog.ts'

export const sourceUrl = (cp: string) => `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512.gif`

export const FFMPEG_ARGS = (input: string, output: string): string[] => [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', input,
  '-vf', 'fps=15,scale=128:-1:flags=lanczos',
  '-c:v', 'libwebp_anim', '-q:v', '60', '-compression_level', '6', '-loop', '0',
  // No metadata, so the same GIF gives the same bytes.
  '-map_metadata', '-1',
  output,
]

async function main(): Promise<void> {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'stickers', 'noto')
  mkdirSync(outDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'duo-noto-'))
  let total = 0
  try {
    for (const cp of NOTO_CODEPOINTS) {
      const res = await fetch(sourceUrl(cp))
      if (!res.ok) throw new Error(`${cp}: HTTP ${res.status}`)
      const gif = join(tmp, `${cp}.gif`)
      writeFileSync(gif, Buffer.from(await res.arrayBuffer()))
      const out = join(outDir, `${cp}.webp`)
      execFileSync('ffmpeg', FFMPEG_ARGS(gif, out), { stdio: 'inherit' })
      const size = statSync(out).size
      total += size
      console.log(`wrote public/stickers/noto/${cp}.webp (${(size / 1024).toFixed(1)} KB)`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB for ${NOTO_CODEPOINTS.length} stickers`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
