import { describe, expect, it } from 'vitest'
import { fromBase64url } from './base64url'
import { bearer, constantTimeEqual, generateDeviceToken, hashToken, isAdmin, verifyToken } from './auth'

describe('auth', () => {
  it('device tokens are 32 random bytes in base64url', () => {
    const t = generateDeviceToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(fromBase64url(t)).toHaveLength(32)
    expect(generateDeviceToken()).not.toBe(t)
  })

  it('stores a SHA-256 hash, not the token', async () => {
    const t = generateDeviceToken()
    const h = await hashToken(t)
    expect(h).not.toContain(t)
    expect(fromBase64url(h)).toHaveLength(32)
    // Known vector: SHA-256("abc").
    expect(await hashToken('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  })

  it('verifies the right token and rejects others', async () => {
    const t = generateDeviceToken()
    const h = await hashToken(t)
    expect(await verifyToken(t, h)).toBe(true)
    expect(await verifyToken(generateDeviceToken(), h)).toBe(false)
    expect(await verifyToken(t, null)).toBe(false)
    expect(await verifyToken('', h)).toBe(false)
  })

  it('constant-time compare handles different lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('reads the bearer and checks the admin secret', async () => {
    const req = (h?: string) => new Request('https://x/', { headers: h ? { Authorization: h } : {} })
    expect(bearer(req('Bearer abc'))).toBe('abc')
    expect(bearer(req('Basic abc'))).toBeNull()
    expect(await isAdmin(req('Bearer s3cret'), 's3cret')).toBe(true)
    expect(await isAdmin(req('Bearer nope'), 's3cret')).toBe(false)
    expect(await isAdmin(req(), 's3cret')).toBe(false)
    expect(await isAdmin(req('Bearer s3cret'), '')).toBe(false)
  })
})
