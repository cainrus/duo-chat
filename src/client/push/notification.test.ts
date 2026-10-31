import { describe, expect, it } from 'vitest'
import { INVITE_TTL_MS } from '@shared/constants'
import { expiredNotifications, notificationFor, parsePushPayload } from './notification'

describe('push notification', () => {
  it('every trigger shows the same single word «онлайн»: no body, no names, no app name; one tag that replaces the old', () => {
    for (const kind of ['ping', 'message', 'call'] as const) {
      const spec = notificationFor({ kind }, 123)
      expect(spec.title).toBe('онлайн')
      expect(spec.options.body).toBeUndefined()
      expect(spec.options).toMatchObject({ tag: 'duo', renotify: true, timestamp: 123 })
      expect(spec.options.data.url).toBe('/')
    }
  })

  it('button and message ones expire after INVITE_TTL_MS; a voice room one has no expiry', () => {
    expect(notificationFor({ kind: 'ping' }, 123).options.data).toEqual({ url: '/', expiresAt: 123 + INVITE_TTL_MS })
    expect(notificationFor({ kind: 'message' }, 123).options.data.expiresAt).toBe(123 + INVITE_TTL_MS)
    expect(notificationFor({ kind: 'call' }, 123).options.data).toEqual({ url: '/', expiresAt: null })
  })

  it('shows it even without a readable payload', () => {
    expect(notificationFor(null, 1).title).toBe('онлайн')
  })

  it('parses payloads strictly', () => {
    expect(parsePushPayload('{"kind":"call"}')).toEqual({ kind: 'call' })
    expect(parsePushPayload('{"kind":"message"}')).toEqual({ kind: 'message' })
    // An older server still sends callKind: it is ignored.
    expect(parsePushPayload('{"kind":"call","callKind":"video"}')).toEqual({ kind: 'call' })
    expect(parsePushPayload('{"kind":"ping","x":1}')).toEqual({ kind: 'ping' })
    expect(parsePushPayload('{"kind":"fax"}')).toBeNull()
    expect(parsePushPayload('nope')).toBeNull()
    expect(parsePushPayload(null)).toBeNull()
  })

  it('finds the shown notifications whose time is over', () => {
    const shown = [{ data: { expiresAt: 100 } }, { data: { expiresAt: 200 } }, { data: { expiresAt: null } }, { data: null }, {}]
    expect(expiredNotifications(shown, 150)).toEqual([shown[0]])
    expect(expiredNotifications(shown, 200)).toEqual([shown[0], shown[1]])
  })
})
