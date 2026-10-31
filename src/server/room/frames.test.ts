import { describe, expect, it } from 'vitest'
import { isAllowedPushEndpoint, MAX_FRAME_BYTES, parseClientFrame } from './frames'

const j = (v: unknown) => JSON.stringify(v)

describe('client frame parsing', () => {
  it('accepts every well-formed frame', () => {
    const frames = [
      { t: 'hello', deviceToken: 'abc' },
      { t: 'visibility', visible: false },
      { t: 'signal', env: { v: 1, iv: 'aaa', ct: 'b-_c' } },
      { t: 'call' },
      { t: 'callCancel' },
      { t: 'callAccept' },
      { t: 'callEnd' },
      { t: 'ping' },
      { t: 'wrote' },
      { t: 'pushMute', muted: true },
    ]
    for (const f of frames) expect(parseClientFrame(j(f))).toEqual(f)
  })

  it('accepts a push subscription from a known push service', () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/xyz', keys: { p256dh: 'BCVx', auth: 'BTBZ' } }
    expect(parseClientFrame(j({ t: 'pushSubscribe', sub }))).toEqual({
      t: 'pushSubscribe',
      sub: { ...sub, expirationTime: null },
    })
  })

  it('rejects malformed frames', () => {
    const bad = [
      'not json',
      j([]),
      j({ t: 'nope' }),
      j({ t: 'call', kind: 'chat' }),
      // Calls are voice-only: no kind, and no video calls.
      j({ t: 'call', kind: 'video' }),
      // There is no decline.
      j({ t: 'callDecline' }),
      j({ t: 'pushMute', muted: 'yes' }),
      j({ t: 'pushMute' }),
      j({ t: 'visibility', visible: 'yes' }),
      j({ t: 'ping', extra: 1 }),
      j({ t: 'signal', env: { v: 2, iv: 'a', ct: 'b' } }),
      j({ t: 'signal', env: { v: 1, iv: 'a', ct: 'plain text!' } }),
      j({ t: 'signal', env: { v: 1, iv: 'a', ct: 'b', text: 'hi' } }),
      j({ t: 'hello', deviceToken: '' }),
      j({ t: 'pushSubscribe', sub: { endpoint: 'https://evil.example/x', keys: { p256dh: 'a', auth: 'b' } } }),
      j({ t: 'signal', env: { v: 1, iv: 'a', ct: 'a'.repeat(MAX_FRAME_BYTES) } }),
    ]
    for (const raw of bad) expect(parseClientFrame(raw), raw.slice(0, 80)).toBeNull()
    expect(parseClientFrame(new ArrayBuffer(4))).toBeNull()
  })

  it('allows only https push services', () => {
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false)
    expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false)
  })
})
