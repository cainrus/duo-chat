import { describe, expect, it } from 'vitest'
import {
  decodeSecret,
  derivePairKeys,
  encodeSecret,
  generatePairSecret,
  open,
  pairingLink,
  PAIR_SECRET_BYTES,
  seal,
  secretFromHash,
} from './pair'

const fixedSecret = () => new Uint8Array(PAIR_SECRET_BYTES).map((_, i) => i)

describe('pair secret', () => {
  it('is 32 random bytes', () => {
    const a = generatePairSecret()
    const b = generatePairSecret()
    expect(a).toHaveLength(32)
    expect(encodeSecret(a)).not.toBe(encodeSecret(b))
  })

  it('round-trips through base64url without padding', () => {
    const s = fixedSecret()
    const text = encodeSecret(s)
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeSecret(text)).toEqual(s)
  })

  it('rejects a secret of the wrong length', () => {
    expect(() => decodeSecret(encodeSecret(new Uint8Array(16)))).toThrow()
    expect(() => decodeSecret('not base64!')).toThrow()
  })

  it('travels in the URL fragment, which browsers never send to the server', () => {
    const link = pairingLink('https://duo.example', fixedSecret())
    const url = new URL(link)
    expect(url.search).toBe('')
    expect(url.hash.startsWith('#pair=')).toBe(true)
    expect(secretFromHash(url.hash)).toEqual(fixedSecret())
    expect(secretFromHash('')).toBeNull()
    expect(() => secretFromHash('#pair=xx')).toThrow()
  })
})

describe('derived keys', () => {
  it('gives both devices the same room id, and a room id that does not reveal the secret', async () => {
    const k1 = await derivePairKeys(fixedSecret())
    const k2 = await derivePairKeys(fixedSecret())
    expect(k1.roomId).toBe(k2.roomId)
    expect(k1.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(k1.roomId).not.toContain(encodeSecret(fixedSecret()).slice(0, 10))
  })

  it('different secrets give different rooms', async () => {
    const k1 = await derivePairKeys(fixedSecret())
    const k2 = await derivePairKeys(generatePairSecret())
    expect(k1.roomId).not.toBe(k2.roomId)
  })
})

describe('seal / open', () => {
  it('round-trips a payload between the two sides', async () => {
    const { signalingKey } = await derivePairKeys(fixedSecret())
    const payload = { type: 'offer', sdp: 'v=0 ...' }
    const env = await seal(signalingKey, 'a', payload)
    expect(env.v).toBe(1)
    expect(JSON.stringify(env)).not.toContain('offer')
    expect(await open(signalingKey, 'a', env)).toEqual(payload)
  })

  it('uses a fresh IV every time', async () => {
    const { signalingKey } = await derivePairKeys(fixedSecret())
    const e1 = await seal(signalingKey, 'a', { x: 1 })
    const e2 = await seal(signalingKey, 'a', { x: 1 })
    expect(e1.iv).not.toBe(e2.iv)
    expect(e1.ct).not.toBe(e2.ct)
  })

  it('rejects a tampered envelope', async () => {
    const { signalingKey } = await derivePairKeys(fixedSecret())
    const env = await seal(signalingKey, 'a', { x: 1 })
    const ct = env.ct.startsWith('A') ? 'B' + env.ct.slice(1) : 'A' + env.ct.slice(1)
    await expect(open(signalingKey, 'a', { ...env, ct })).rejects.toThrow()
  })

  it('rejects a message reflected back as if from the other side', async () => {
    const { signalingKey } = await derivePairKeys(fixedSecret())
    const env = await seal(signalingKey, 'a', { x: 1 })
    await expect(open(signalingKey, 'b', env)).rejects.toThrow()
  })

  it('rejects an envelope from another pair', async () => {
    const mine = await derivePairKeys(fixedSecret())
    const theirs = await derivePairKeys(generatePairSecret())
    const env = await seal(theirs.signalingKey, 'a', { x: 1 })
    await expect(open(mine.signalingKey, 'a', env)).rejects.toThrow()
  })
})
