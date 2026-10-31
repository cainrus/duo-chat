// Web Push with VAPID, on WebCrypto only (runs in Workers and Node, no library).
//   RFC 8291: message encryption (aes128gcm content coding, RFC 8188), so the push service
//             cannot read the payload.
//   RFC 8292: VAPID, an ES256 JWT that identifies this server to the push service.
// The payload is only { kind } (see PushPayload): no names, no text.

import type { PushSubscriptionJSONLike } from '@shared/protocol'
import { fromBase64url, toBase64url } from '../base64url'

export type VapidKeys = {
  /** Uncompressed P-256 point (65 bytes), base64url. Also what the app passes to PushManager.subscribe. */
  publicKey: string
  /** P-256 private scalar (32 bytes), base64url. */
  privateKey: string
  /** "mailto:..." or "https://..." contact for push services. */
  subject: string
}

export type PushResult = { ok: boolean; status: number; /** 404/410: delete the stored subscription. */ gone: boolean }

const RECORD_SIZE = 4096
const encoder = new TextEncoder()
// UTF-8 bytes backed by a plain ArrayBuffer (what WebCrypto typings want).
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(s))

// WebCrypto names the ECDH peer key `public`; the Workers typings spell it `$public`.
export const ecdhParams = (peer: CryptoKey) => ({ name: 'ECDH', public: peer }) as unknown as SubtleCryptoDeriveKeyAlgorithm

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Imports a P-256 key pair from raw public point + private scalar (as VAPID keys are stored). */
async function importPrivate(publicKey: Uint8Array, privateKey: Uint8Array, alg: 'ECDH' | 'ECDSA'): Promise<CryptoKey> {
  if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) throw new Error('bad P-256 key')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64url(publicKey.slice(1, 33)),
    y: toBase64url(publicKey.slice(33, 65)),
    d: toBase64url(privateKey),
    ext: true,
  }
  const usages: string[] = alg === 'ECDH' ? ['deriveBits'] : ['sign']
  return crypto.subtle.importKey('jwk', jwk, { name: alg, namedCurve: 'P-256' }, false, usages)
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Sender-side randomness, injectable so the RFC 8291 test vector can be reproduced. */
export type EncryptOptions = {
  salt?: Uint8Array<ArrayBuffer>
  /** Ephemeral application server key pair (raw public point + private scalar). */
  ephemeral?: { publicKey: Uint8Array<ArrayBuffer>; privateKey: Uint8Array<ArrayBuffer> }
}

/** RFC 8291 §3-4: encrypts `plaintext` for one subscription into a single aes128gcm record. */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  keys: { p256dh: string; auth: string },
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromBase64url(keys.p256dh)
  const authSecret = fromBase64url(keys.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad subscription keys')
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('payload too large')

  let asPublic: Uint8Array<ArrayBuffer>
  let asPrivateKey: CryptoKey
  if (opts.ephemeral) {
    asPublic = opts.ephemeral.publicKey
    asPrivateKey = await importPrivate(asPublic, opts.ephemeral.privateKey, 'ECDH')
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    asPrivateKey = pair.privateKey
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams(uaKey), asPrivateKey, 256),
  )

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  // One record, last-record delimiter 0x02, no extra padding.
  const record = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))

  // RFC 8188 header: salt(16) || rs(uint32 BE) || idlen(1) || keyid (= as_public)
  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, ct)
}

/** RFC 8292: `Authorization: vapid t=<jwt>, k=<public key>` for the endpoint's origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()): Promise<string> {
  const header = toBase64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  )
  const signingInput = `${header}.${claims}`
  const key = await importPrivate(fromBase64url(vapid.publicKey), fromBase64url(vapid.privateKey), 'ECDSA')
  // WebCrypto returns ECDSA signatures as raw r||s, which is exactly the JWS ES256 format.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signingInput)))
  return `vapid t=${signingInput}.${toBase64url(sig)}, k=${vapid.publicKey}`
}

/** Encrypts `payload` (JSON) and POSTs it to the subscription's push service. */
export async function sendWebPush(
  sub: PushSubscriptionJSONLike,
  payload: unknown,
  vapid: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; fetcher?: typeof fetch } = {},
): Promise<PushResult> {
  const body = await encryptPayload(utf8(JSON.stringify(payload)), sub.keys)
  const res = await (opts.fetcher ?? fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttlSeconds ?? 60),
      Urgency: opts.urgency ?? 'high',
    },
    body,
  })
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 }
}
