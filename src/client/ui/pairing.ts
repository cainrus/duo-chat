// Pairing link helpers for the setup screen. The secret lives in the URL fragment.
import { renderSVG } from 'uqr'
import { secretFromHash } from '../crypto/pair'

/** Accepts a full pairing link or just its `#...` part. Null when it holds no valid secret. */
export function parsePairingLink(text: string): Uint8Array | null {
  const t = text.trim()
  if (!t) return null
  let hash = t
  if (!t.startsWith('#')) {
    try {
      hash = new URL(t).hash
    } catch {
      return null
    }
  }
  try {
    return secretFromHash(hash)
  } catch {
    return null
  }
}

/** QR as an <img> data URL (covered by `img-src data:`; no v-html). */
export function qrDataUrl(text: string): string {
  const svg = renderSVG(text, { border: 2, pixelSize: 8, whiteColor: '#FFFFFF', blackColor: '#2B2440' })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
}

export function isAppleTouch(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
