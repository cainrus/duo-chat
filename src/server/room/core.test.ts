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
    expect(v.incoming).toBeNull()
    expect(v.outgoing).toBeNull()
    expect(v.inCall).toBeNull()
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
    const fx = room.handle('a', { t: 'call', kind: 'video' }, T0)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'call', callKind: 'video' }])
    const v = lastView(fx, 'a')!
    expect(v.outgoing).toEqual({ kind: 'video', until: T0 + CALL_COOLDOWN_MS })
    expect(v.call).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
  })

  it('rings in the app, without push, when the friend is connected', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'call', kind: 'voice' }, T0)
    expect(pushes(fx, 'b')).toEqual([])
    expect(lastView(fx, 'b')!.incoming).toEqual({ kind: 'voice' })
  })

  it('pushes when the friend is within the grace but no longer connected', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.disconnect('b', T0 + 1)
    expect(pushes(room.handle('a', { t: 'call', kind: 'voice' }, T0 + 2), 'b')).toHaveLength(1)
  })

  it('accepting connects the call for both and resets the caller attempts', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    const fx = room.handle('b', { t: 'callAccept' }, T0 + 5)
    expect(lastView(fx, 'a')!.inCall).toEqual({ kind: 'voice' })
    expect(lastView(fx, 'b')!.inCall).toEqual({ kind: 'voice' })
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
    expect(lastView(fx, 'a')!.outgoing).toBeNull()
  })

  it('declining tells the caller and ends the cooldown early', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    const fx = room.handle('b', { t: 'callDecline' }, T0 + 5)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'declined' })
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
  })

  it('times out at the end of the cooldown', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    expect(room.nextAlarmAt(T0)).toBe(T0 + CALL_COOLDOWN_MS)
    const fx = room.alarm(T0 + CALL_COOLDOWN_MS)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'timeout' })
    expect(lastView(fx, 'a')!.outgoing).toBeNull()
  })

  it('the caller hiding the app cancels the call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    const fx = room.handle('a', { t: 'visibility', visible: false }, T0 + 3)
    expect(sends(fx, 'b')).toContainEqual({ t: 'callEnded', reason: 'cancelled' })
    expect(lastView(fx, 'b')!.incoming).toBeNull()
  })

  it('two unanswered calls lead to "nobody\'s home", and a callback lifts it', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    room.alarm(T0 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'call', kind: 'voice' }, T0 + CALL_COOLDOWN_MS)
    room.alarm(T0 + 2 * CALL_COOLDOWN_MS)
    const t = T0 + 2 * CALL_COOLDOWN_MS
    expect(room.view('a', t).call.kind).toBe('nobodyHome')
    expect(room.handle('a', { t: 'call', kind: 'voice' }, t)).toContainEqual({
      type: 'send',
      to: 'a',
      msg: { t: 'error', code: 'not-allowed' },
    })

    room.connect('b', t + 10)
    room.handle('b', { t: 'call', kind: 'voice' }, t + 10)
    const fx = room.handle('a', { t: 'callDecline' }, t + 20)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
  })

  it('simultaneous calls merge into one connected call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call', kind: 'video' }, T0)
    const fx = room.handle('b', { t: 'call', kind: 'voice' }, T0 + 1)
    expect(lastView(fx, 'a')!.inCall).toEqual({ kind: 'video' })
    expect(lastView(fx, 'b')!.inCall).toEqual({ kind: 'video' })
  })

  it('hanging up ends the call for both', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    room.handle('b', { t: 'callAccept' }, T0 + 1)
    const fx = room.handle('b', { t: 'callEnd' }, T0 + 60_000)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'hangup' })
    expect(lastView(fx, 'a')!.inCall).toBeNull()
  })
})

describe('room: ping', () => {
  it('nudges a connected friend in the app', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'ping' }, T0)
    expect(sends(fx, 'b')).toContainEqual({ t: 'nudge' })
    expect(pushes(fx, 'b')).toEqual([])
  })

  it('pushes to an absent friend by the rules and shows the exhausted state', () => {
    room.connect('a', T0)
    expect(pushes(room.handle('a', { t: 'ping' }, T0), 'b')).toEqual([{ kind: 'ping' }])
    expect(pushes(room.handle('a', { t: 'ping' }, T0 + 1), 'b')).toEqual([])
    const fx = room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'ping' }])
    expect(lastView(fx, 'a')!.ping.kind).toBe('exhausted')
  })

  it('a reply from the friend resets the ping counter', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'ping' }, T0)
    room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    room.connect('b', T0 + CALL_COOLDOWN_MS + 1)
    room.handle('b', { t: 'replied' }, T0 + CALL_COOLDOWN_MS + 2)
    expect(room.view('a', T0 + CALL_COOLDOWN_MS + 3).ping).toEqual({ kind: 'ready' })
  })
})

describe('room: persistence', () => {
  it('round-trips through its serializable state', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call', kind: 'voice' }, T0)
    const copy = new RoomCore(structuredClone(room.state))
    expect(copy.view('a', T0 + 1)).toEqual(room.view('a', T0 + 1))
  })
})
