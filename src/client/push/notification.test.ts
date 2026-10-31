import { describe, expect, it } from 'vitest'
import { callPushUrl, notificationFor, parseCallPushUrl, parsePushPayload } from './notification'

describe('push notification text', () => {
  it('call and ping texts use the friend name', () => {
    const call = notificationFor({ kind: 'call', callKind: 'video' }, 'Соня', 123)
    expect(call.title).toBe('Соня зовёт')
    expect(call.options.data.url).toBe('/?from=call-push&kind=video&at=123')
    const ping = notificationFor({ kind: 'ping' }, 'Соня', 123)
    expect(ping.title).toBe('Соня зовёт в чат')
    expect(ping.options.data.url).toBe('/')
  })

  it('falls back to "Подружка" and to the ping text', () => {
    expect(notificationFor({ kind: 'call', callKind: 'voice' }, null, 1).title).toBe('Подружка зовёт')
    expect(notificationFor(null, ' ', 1).title).toBe('Подружка зовёт в чат')
  })

  it('parses payloads strictly', () => {
    expect(parsePushPayload('{"kind":"call","callKind":"voice"}')).toEqual({ kind: 'call', callKind: 'voice' })
    expect(parsePushPayload('{"kind":"ping","x":1}')).toEqual({ kind: 'ping' })
    expect(parsePushPayload('{"kind":"call","callKind":"fax"}')).toBeNull()
    expect(parsePushPayload('nope')).toBeNull()
    expect(parsePushPayload(null)).toBeNull()
  })

  it('call push URL round-trips', () => {
    expect(parseCallPushUrl(callPushUrl('voice', 77).slice(1))).toEqual({ kind: 'voice', at: 77 })
    expect(parseCallPushUrl('?from=call-push&kind=voice')).toBeNull()
    expect(parseCallPushUrl('?pair=x')).toBeNull()
  })
})
