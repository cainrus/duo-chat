import { describe, expect, it } from 'vitest'
import { INVITE_TTL_MS } from '@shared/constants'
import { callPushUrl, expiredNotifications, notificationFor, parseCallPushUrl, parsePushPayload } from './notification'

describe('push notification', () => {
  it('every invitation looks the same: «Дуо», «онлайн» (no names, nothing to act on), one tag that replaces the old', () => {
    const specs = (['ping', 'message', 'call'] as const).map((kind) => notificationFor({ kind }, 123))
    for (const spec of specs) {
      expect(spec.title).toBe('Дуо')
      expect(spec.options.body).toBe('онлайн')
      expect(spec.options).toMatchObject({ tag: 'duo', renotify: true, timestamp: 123 })
    }
    // The kind is only in data, and only decides where a click leads.
    expect(specs.map((s) => s.options.data.kind)).toEqual(['ping', 'message', 'call'])
  })

  it('ping and message expire after INVITE_TTL_MS and open the chat; a call has no expiry and opens the missed-call check', () => {
    expect(notificationFor({ kind: 'ping' }, 123).options.data).toEqual({ url: '/', kind: 'ping', expiresAt: 123 + INVITE_TTL_MS })
    expect(notificationFor({ kind: 'message' }, 123).options.data.expiresAt).toBe(123 + INVITE_TTL_MS)
    expect(notificationFor({ kind: 'call' }, 123).options.data).toEqual({
      url: '/?from=call-push&at=123',
      kind: 'call',
      expiresAt: null,
    })
  })

  it('shows the invitation even without a readable payload', () => {
    const blind = notificationFor(null, 1)
    expect(blind.title).toBe('Дуо')
    expect(blind.options.data.url).toBe('/')
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
    const shown = [
      { data: { expiresAt: 100 } },
      { data: { expiresAt: 200 } },
      { data: { expiresAt: null } },
      { data: null },
      {},
    ]
    expect(expiredNotifications(shown, 150)).toEqual([shown[0]])
    expect(expiredNotifications(shown, 200)).toEqual([shown[0], shown[1]])
  })

  it('call push URL round-trips', () => {
    expect(parseCallPushUrl(callPushUrl(77).slice(1))).toEqual({ at: 77 })
    expect(parseCallPushUrl('?from=call-push')).toBeNull()
    expect(parseCallPushUrl('?pair=x')).toBeNull()
  })
})
