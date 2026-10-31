// End-to-end crypto for the pair. Browser WebCrypto only.
// One 256-bit pair secret is created on device 'a' at pairing and reaches device 'b' in the
// URL fragment of the pairing link. It never goes to the server.
// From it we derive (HKDF-SHA-256, empty salt):
//   - roomId:       16 bytes, info "duo-chat/room-id/v1", base64url. Public: addresses the room.
//   - signalingKey: AES-GCM 256, info "duo-chat/signaling/v1". Seals WebRTC signaling.

import type { SealedEnvelope, Side } from '@shared/types'

export type PairKeys = { roomId: string; signalingKey: CryptoKey }

export const PAIR_SECRET_BYTES = 32

const IV_BYTES = 12
const ROOM_ID_BYTES = 16
const ROOM_ID_INFO = 'duo-chat/room-id/v1'
const SIGNALING_INFO = 'duo-chat/signaling/v1'
const AAD_PREFIX = 'duo-chat/v1/'

const enc = new TextEncoder()
const dec = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('invalid base64url')
  }
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function generatePairSecret(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(PAIR_SECRET_BYTES))
}

/** base64url without padding. */
export function encodeSecret(secret: Uint8Array): string {
  return toBase64Url(secret)
}

/** Throws on bad encoding or wrong length. */
export function decodeSecret(text: string): Uint8Array {
  const bytes = fromBase64Url(text)
  if (bytes.length !== PAIR_SECRET_BYTES) throw new Error('invalid pair secret length')
  return bytes
}

function hkdfBits(base: CryptoKey, info: string, bits: number): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    bits,
  )
}

export async function derivePairKeys(secret: Uint8Array): Promise<PairKeys> {
  const subtle = globalThis.crypto.subtle
  const base = await subtle.importKey('raw', secret as Uint8Array<ArrayBuffer>, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ])
  const roomId = toBase64Url(new Uint8Array(await hkdfBits(base, ROOM_ID_INFO, ROOM_ID_BYTES * 8)))
  const signalingKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(SIGNALING_INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { roomId, signalingKey }
}

const aad = (from: Side) => enc.encode(AAD_PREFIX + from)

/**
 * AES-GCM with a random 12-byte IV. The sender's side is bound as additional data,
 * so the server cannot reflect a message back to its sender.
 */
export async function seal(key: CryptoKey, from: Side, payload: unknown): Promise<SealedEnvelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(from) },
    key,
    enc.encode(JSON.stringify(payload)),
  )
  return { v: 1, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) }
}

/** Throws if the envelope was tampered with, or was not sealed by `expectedFrom`. */
export async function open(key: CryptoKey, expectedFrom: Side, env: SealedEnvelope): Promise<unknown> {
  if (env.v !== 1) throw new Error('unsupported envelope version')
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(env.iv), additionalData: aad(expectedFrom) },
    key,
    fromBase64Url(env.ct),
  )
  return JSON.parse(dec.decode(plain))
}

/** Pairing link for device 'b': `${origin}/#pair=<secret>`. */
export function pairingLink(origin: string, secret: Uint8Array): string {
  return `${origin.replace(/\/$/, '')}/#pair=${encodeSecret(secret)}`
}

/** Reads the secret from a location hash like `#pair=...`; null if absent. Throws if malformed. */
export function secretFromHash(hash: string): Uint8Array | null {
  const m = /^#?pair=(.*)$/.exec(hash)
  if (!m) return null
  return decodeSecret(m[1]!)
}
