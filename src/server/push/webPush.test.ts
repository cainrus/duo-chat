import { describe, expect, it } from 'vitest'
import { fromBase64url, toBase64url } from '../base64url'
import { ecdhParams, encryptPayload, sendWebPush, vapidAuthorization, type VapidKeys } from './webPush'

// RFC 8291, Appendix A.
const V = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/** User-agent side of RFC 8291, to check round trips with random keys. */
async function decrypt(body: Uint8Array, uaPublic: Uint8Array<ArrayBuffer>, uaPrivate: CryptoKey, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const ct = body.slice(21 + idlen)
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(asKey), uaPrivate, 256))
  const h = async (s: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s, info },
        await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    )
  const e = { encode: (s: string) => new Uint8Array(new TextEncoder().encode(s)) }
  const info = new Uint8Array([...e.encode('WebPush: info\0'), ...uaPublic, ...asPublic])
  const ikm = await h(auth, secret, info, 32)
  const cek = await h(salt, ikm, e.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await h(salt, ikm, e.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct))
  expect(pt.at(-1)).toBe(2)
  return new TextDecoder().decode(pt.slice(0, -1))
}

async function newKeys(alg: 'ECDH' | 'ECDSA') {
  const usages: string[] = alg === 'ECDH' ? ['deriveBits'] : ['sign', 'verify']
  const pair = (await crypto.subtle.generateKey({ name: alg, namedCurve: 'P-256' }, true, usages)) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { pair, publicRaw: raw, privateRaw: fromBase64url((jwk as JsonWebKey).d!) }
}

describe('web push encryption (RFC 8291)', () => {
  it('reproduces the RFC 8291 test vector byte for byte', async () => {
    const body = await encryptPayload(fromBase64url(V.plaintext), { p256dh: V.uaPublic, auth: V.auth }, {
      salt: fromBase64url(V.salt),
      ephemeral: { publicKey: fromBase64url(V.asPublic), privateKey: fromBase64url(V.asPrivate) },
    })
    expect(toBase64url(body)).toBe(V.body)
  })

  it('round-trips with fresh random keys', async () => {
    const ua = await newKeys('ECDH')
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const body = await encryptPayload(new Uint8Array(new TextEncoder().encode('{"kind":"ping"}')), {
      p256dh: toBase64url(ua.publicRaw),
      auth: toBase64url(auth),
    })
    expect(await decrypt(body, ua.publicRaw, ua.pair.privateKey, auth)).toBe('{"kind":"ping"}')
  })

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload(new Uint8Array(1), { p256dh: 'AAAA', auth: V.auth })).rejects.toThrow()
  })
})

describe('VAPID (RFC 8292)', () => {
  it('signs an ES256 JWT for the endpoint origin that verifies with the public key', async () => {
    const k = await newKeys('ECDSA')
    const vapid: VapidKeys = { publicKey: toBase64url(k.publicRaw), privateKey: toBase64url(k.privateRaw), subject: 'mailto:a@b.c' }
    const now = 1_700_000_000_000
    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)!
    expect(m).not.toBeNull()
    expect(m[4]).toBe(vapid.publicKey)
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(m[2]!)))
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'mailto:a@b.c' })
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(m[1]!)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      k.pair.publicKey,
      fromBase64url(m[3]!),
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    )
    expect(ok).toBe(true)
  })
})

describe('sendWebPush', () => {
  it('posts an encrypted body with the push headers and reports gone subscriptions', async () => {
    const k = await newKeys('ECDSA')
    const ua = await newKeys('ECDH')
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const vapid: VapidKeys = { publicKey: toBase64url(k.publicRaw), privateKey: toBase64url(k.privateRaw), subject: 'mailto:a@b.c' }
    const sub = { endpoint: 'https://web.push.apple.com/xyz', keys: { p256dh: toBase64url(ua.publicRaw), auth: toBase64url(auth) } }
    const seen: { url: string; init: RequestInit }[] = []
    let status = 201
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(null, { status })
    }) as unknown as typeof fetch

    const r = await sendWebPush(sub, { kind: 'call', callKind: 'voice' }, vapid, { fetcher })
    expect(r).toEqual({ ok: true, status: 201, gone: false })
    const { url, init } = seen[0]!
    expect(url).toBe(sub.endpoint)
    const h = init.headers as Record<string, string>
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.TTL).toBe('60')
    expect(h.Urgency).toBe('high')
    expect(h.Authorization).toMatch(/^vapid t=/)
    const text = await decrypt(init.body as Uint8Array, ua.publicRaw, ua.pair.privateKey, auth)
    expect(JSON.parse(text)).toEqual({ kind: 'call', callKind: 'voice' })

    status = 410
    expect((await sendWebPush(sub, { kind: 'ping' }, vapid, { fetcher })).gone).toBe(true)
    status = 404
    expect((await sendWebPush(sub, { kind: 'ping' }, vapid, { fetcher })).gone).toBe(true)
  })
})
