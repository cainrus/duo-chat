// End-to-end crypto for the pair. Browser WebCrypto only.
// One 256-bit pair secret is created on device 'a' at pairing and reaches device 'b' in the
// URL fragment of the pairing link. It never goes to the server.
// From it we derive (HKDF-SHA-256, empty salt):
//   - roomId:       16 bytes, info "duo-chat/room-id/v1", base64url. Public: addresses the room.
//   - signalingKey: AES-GCM 256, info "duo-chat/signaling/v1". Seals WebRTC signaling.

import type { SealedEnvelope, Side } from '@shared/types'

export type PairKeys = { roomId: string; signalingKey: CryptoKey }

export const PAIR_SECRET_BYTES = 32

export function generatePairSecret(): Uint8Array {
  throw new Error('not implemented')
}

/** base64url without padding. */
export function encodeSecret(_secret: Uint8Array): string {
  throw new Error('not implemented')
}

/** Throws on bad encoding or wrong length. */
export function decodeSecret(_text: string): Uint8Array {
  throw new Error('not implemented')
}

export async function derivePairKeys(_secret: Uint8Array): Promise<PairKeys> {
  throw new Error('not implemented')
}

/**
 * AES-GCM with a random 12-byte IV. The sender's side is bound as additional data,
 * so the server cannot reflect a message back to its sender.
 */
export async function seal(_key: CryptoKey, _from: Side, _payload: unknown): Promise<SealedEnvelope> {
  throw new Error('not implemented')
}

/** Throws if the envelope was tampered with, or was not sealed by `expectedFrom`. */
export async function open(_key: CryptoKey, _expectedFrom: Side, _env: SealedEnvelope): Promise<unknown> {
  throw new Error('not implemented')
}

/** Pairing link for device 'b': `${origin}/#pair=<secret>`. */
export function pairingLink(_origin: string, _secret: Uint8Array): string {
  throw new Error('not implemented')
}

/** Reads the secret from a location hash like `#pair=...`; null if absent. Throws if malformed. */
export function secretFromHash(_hash: string): Uint8Array | null {
  throw new Error('not implemented')
}
