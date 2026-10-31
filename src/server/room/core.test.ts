import { beforeEach, describe, expect, it } from 'vitest'
import { CALL_COOLDOWN_MS, PRESENCE_GRACE_MS } from '@shared/constants'
import type { RoomView, ServerToClient } from '@shared/protocol'
import type { SealedEnvelope, Side } from '@shared/types'
import { RoomCore, type Effect } from './core'

const T0 = 20_000_000

function sends(effects: Effect[], to: Side): ServerToClient[] {
  return effects.flatMap((e) => (e.type === 'send' && e.to === to ? [e.msg] : []))
}
function pushes(effects: Effect[], to: Side) {
  return effects.flatMap((e) => (e.type === 'push' && e.to === to ? [e.payload] : []))
}
function lastView(effects: Effect[], to: Side): RoomView | undefined {
  const views = sends(effects, to).flatMap((m) => (m.t === 'view' ? [m.view] : []))
  return views.at(-1)
}

let room: RoomCore

beforeEach(() => {
  room = new RoomCore()
  room.setPaired('a')
  room.setPaired('b')
})

describe('room: presence and views', () => {
  it('sends a view to a side when it connects', () => {
    const fx = room.connect('a', T0)
    const v = lastView(fx, 'a')!
    expect(v.self).toBe('a')
    expect(v.peerPaired).toBe(true)
    expect(v.peerPresent).toBe(false)
    expect(v.call).toEqual({ kind: 'ready' })
    expect(v.ping).toEqual({ kind: 'ready' })
    expect(v.incoming).toBe(false)
    expect(v.outgoing).toBeNull()
    expect(v.inCall).toBe(false)
  })

  it('tells the peer when the other side comes and goes, after the 1-minute grace', () => {
    room.connect('a', T0)
    expect(lastView(room.connect('b', T0 + 1), 'a')!.peerPresent).toBe(true)
    room.disconnect('b', T0 + 1000)
    expect(room.view('a', T0 + 1000 + PRESENCE_GRACE_MS - 1).peerPresent).toBe(true)
    expect(room.nextAlarmAt(T0 + 1000)).toBe(T0 + 1000 + PRESENCE_GRACE_MS)
    const fx = room.alarm(T0 + 1000 + PRESENCE_GRACE_MS)
    expect(lastView(fx, 'a')!.peerPresent).toBe(false)
  })

  it('hiding the app starts the grace too', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('b', { t: 'visibility', visible: false }, T0 + 5)
    expect(room.view('a', T0 + 5 + PRESENCE_GRACE_MS).peerPresent).toBe(false)
  })
})

describe('room: signaling relay', () => {
  const env: SealedEnvelope = { v: 1, iv: 'aaa', ct: 'bbb' }

  it('relays sealed signaling to the connected peer unchanged', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'signal', env }, T0 + 1)
    expect(sends(fx, 'b')).toContainEqual({ t: 'signal', env })
    expect(sends(fx, 'a').some((m) => m.t === 'signal')).toBe(false)
  })

  it('drops signaling when the peer is not connected', () => {
    room.connect('a', T0)
    expect(sends(room.handle('a', { t: 'signal', env }, T0 + 1), 'b')).toEqual([])
  })
})

describe('room: calls', () => {
  it('pushes a call to an absent friend and shows the caller a ringing state', () => {
    room.connect('a', T0)
    const fx = room.handle('a', { t: 'call' }, T0)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'call' }])
    const v = lastView(fx, 'a')!
    expect(v.outgoing).toEqual({ until: T0 + CALL_COOLDOWN_MS })
    expect(v.call).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
  })

  it('rings in the app, without push, when the friend is connected', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'call' }, T0)
    expect(pushes(fx, 'b')).toEqual([])
    expect(lastView(fx, 'b')!.incoming).toBe(true)
  })

  it('pushes when the friend is within the grace but no longer connected', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.disconnect('b', T0 + 1)
    expect(pushes(room.handle('a', { t: 'call' }, T0 + 2), 'b')).toHaveLength(1)
  })

  it('accepting connects the call for both and resets the caller attempts', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.handle('b', { t: 'callAccept' }, T0 + 5)
    expect(lastView(fx, 'a')!.inCall).toBe(true)
    expect(lastView(fx, 'b')!.inCall).toBe(true)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
    expect(lastView(fx, 'a')!.outgoing).toBeNull()
  })

  it('rings for one minute; nobody joining is an unanswered attempt at the timeout', () => {
    expect(CALL_COOLDOWN_MS).toBe(60_000)
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    expect(room.nextAlarmAt(T0)).toBe(T0 + CALL_COOLDOWN_MS)
    expect(room.view('b', T0 + CALL_COOLDOWN_MS - 1).incoming).toBe(true)
    const fx = room.alarm(T0 + CALL_COOLDOWN_MS)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'timeout' })
    expect(sends(fx, 'b')).toContainEqual({ t: 'callEnded', reason: 'timeout' })
    expect(lastView(fx, 'a')!.outgoing).toBeNull()
    expect(lastView(fx, 'b')!.incoming).toBe(false)
    // One of the two attempts is used; the button is ready for the second.
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
    expect(room.state.sides.a.call.attemptsLeft).toBe(1)
  })

  it('has no decline: the callee cannot end a ringing call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    // "end" from the callee while it rings changes nothing; the call keeps ringing.
    const fx = room.handle('b', { t: 'callEnd' }, T0 + 5)
    expect(sends(fx, 'a').some((m) => m.t === 'callEnded')).toBe(false)
    expect(lastView(fx, 'a')!.outgoing).toEqual({ until: T0 + CALL_COOLDOWN_MS })
    expect(lastView(fx, 'b')!.incoming).toBe(true)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
  })

  it('the caller hiding the app cancels the call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.handle('a', { t: 'visibility', visible: false }, T0 + 3)
    expect(sends(fx, 'b')).toContainEqual({ t: 'callEnded', reason: 'cancelled' })
    expect(lastView(fx, 'b')!.incoming).toBe(false)
  })

  it('two unanswered calls lead to "nobody\'s home", and a callback lifts it', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    room.alarm(T0 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'call' }, T0 + CALL_COOLDOWN_MS)
    room.alarm(T0 + 2 * CALL_COOLDOWN_MS)
    const t = T0 + 2 * CALL_COOLDOWN_MS
    expect(room.view('a', t).call.kind).toBe('nobodyHome')
    expect(room.handle('a', { t: 'call' }, t)).toContainEqual({
      type: 'send',
      to: 'a',
      msg: { t: 'error', code: 'not-allowed' },
    })

    room.connect('b', t + 10)
    const fx = room.handle('b', { t: 'call' }, t + 10)
    // Unlocked as soon as she calls back, whether or not the callback is joined.
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
    const ended = room.alarm(t + 10 + CALL_COOLDOWN_MS)
    expect(lastView(ended, 'a')!.call).toEqual({ kind: 'ready' })
  })

  it('simultaneous calls merge into one connected call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.handle('b', { t: 'call' }, T0 + 1)
    expect(lastView(fx, 'a')!.inCall).toBe(true)
    expect(lastView(fx, 'b')!.inCall).toBe(true)
  })

  it('hanging up ends the call for both', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    room.handle('b', { t: 'callAccept' }, T0 + 1)
    const fx = room.handle('b', { t: 'callEnd' }, T0 + 60_000)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'hangup' })
    expect(lastView(fx, 'a')!.inCall).toBe(false)
  })
})

describe('room: ping', () => {
  const SUB = { endpoint: 'https://push.test/b', keys: { p256dh: 'p', auth: 'a' } }
  const subscribe = (side: Side) => room.handle(side, { t: 'pushSubscribe', sub: SUB }, T0)
  const results = (fx: Effect[], to: Side) => sends(fx, to).filter((m) => m.t === 'pingResult')

  it('nudges a connected friend in the app and tells the pinger', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'ping' }, T0)
    expect(sends(fx, 'b')).toContainEqual({ t: 'nudge' })
    expect(pushes(fx, 'b')).toEqual([])
    expect(results(fx, 'a')).toEqual([{ t: 'pingResult', result: 'nudged' }])
    expect(results(fx, 'b')).toEqual([])
  })

  it('pushes to an absent friend by the rules and shows the exhausted state', () => {
    room.connect('a', T0)
    subscribe('b')
    const first = room.handle('a', { t: 'ping' }, T0)
    expect(pushes(first, 'b')).toEqual([{ kind: 'ping' }])
    expect(results(first, 'a')).toEqual([{ t: 'pingResult', result: 'pushed' }])
    const rationed = room.handle('a', { t: 'ping' }, T0 + 1)
    expect(pushes(rationed, 'b')).toEqual([])
    expect(results(rationed, 'a')).toEqual([{ t: 'pingResult', result: 'held' }])
    const fx = room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'ping' }])
    expect(lastView(fx, 'a')!.ping.kind).toBe('exhausted')
  })

  it('a friend without a push subscription is not pushed and the cap is not spent', () => {
    room.connect('a', T0)
    for (let i = 0; i < 3; i++) {
      const fx = room.handle('a', { t: 'ping' }, T0 + i * CALL_COOLDOWN_MS)
      expect(pushes(fx, 'b')).toEqual([])
      expect(results(fx, 'a')).toEqual([{ t: 'pingResult', result: 'held' }])
    }
    expect(room.state.sides.a.ping).toEqual({ pushesSent: 0, lastPushAt: null, exhaustedSince: null })
    expect(room.view('a', T0 + 3 * CALL_COOLDOWN_MS).ping).toEqual({ kind: 'ready' })
    // Once she subscribes, the first ping is pushed.
    subscribe('b')
    const fx = room.handle('a', { t: 'ping' }, T0 + 3 * CALL_COOLDOWN_MS)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'ping' }])
    expect(results(fx, 'a')).toEqual([{ t: 'pingResult', result: 'pushed' }])
  })

  it('a ping to a friend who has not paired is held', () => {
    const solo = new RoomCore()
    solo.setPaired('a')
    solo.connect('a', T0)
    expect(sends(solo.handle('a', { t: 'ping' }, T0), 'a')).toContainEqual({ t: 'pingResult', result: 'held' })
  })

  it('a reply from the friend resets the ping counter', () => {
    room.connect('a', T0)
    subscribe('b')
    room.handle('a', { t: 'ping' }, T0)
    room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    expect(room.view('a', T0 + CALL_COOLDOWN_MS + 1).ping.kind).toBe('exhausted')
    room.connect('b', T0 + CALL_COOLDOWN_MS + 1)
    room.handle('b', { t: 'replied' }, T0 + CALL_COOLDOWN_MS + 2)
    expect(room.view('a', T0 + CALL_COOLDOWN_MS + 3).ping).toEqual({ kind: 'ready' })
  })
})

describe('room: persistence', () => {
  it('round-trips through its serializable state', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    const copy = new RoomCore(structuredClone(room.state))
    expect(copy.view('a', T0 + 1)).toEqual(room.view('a', T0 + 1))
  })
})
