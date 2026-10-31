// Room semantics from the plan that the original core tests do not show.
import { beforeEach, describe, expect, it } from 'vitest'
import { CALL_COOLDOWN_MS, LOCK_MS, PRESENCE_GRACE_MS } from '@shared/constants'
import type { RoomView, ServerToClient } from '@shared/protocol'
import type { Side } from '@shared/types'
import { RoomCore, type Effect } from './core'

const T0 = 50_000_000
const sends = (fx: Effect[], to: Side): ServerToClient[] => fx.flatMap((e) => (e.type === 'send' && e.to === to ? [e.msg] : []))
const pushes = (fx: Effect[], to: Side) => fx.flatMap((e) => (e.type === 'push' && e.to === to ? [e.payload] : []))
const lastView = (fx: Effect[], to: Side): RoomView | undefined =>
  sends(fx, to).flatMap((m) => (m.t === 'view' ? [m.view] : [])).at(-1)

let room: RoomCore
beforeEach(() => {
  room = new RoomCore()
  room.setPaired('a')
  room.setPaired('b')
})

describe('room: restart and reconnect (review focus 1 and 4)', () => {
  it('a restored core whose sockets died turns the peer absent after the grace', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    // The DO was evicted with both flagged connected; only 'a' reconnects a live socket.
    const restored = new RoomCore(structuredClone(room.state))
    expect(restored.state.sides.b.connected).toBe(true)
    const t = T0 + 5_000
    // The DO wake path disconnects every side without a live socket.
    restored.disconnect('b', t)
    expect(restored.view('a', t + PRESENCE_GRACE_MS - 1).peerPresent).toBe(true)
    expect(restored.nextAlarmAt(t)).toBe(t + PRESENCE_GRACE_MS)
    const fx = restored.alarm(t + PRESENCE_GRACE_MS)
    expect(lastView(fx, 'a')!.peerPresent).toBe(false)
  })

  it('a callee whose socket drops while ringing still has the call after reconnecting', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    room.disconnect('b', T0 + 1_000)
    const fx = room.connect('b', T0 + 30_000)
    expect(lastView(fx, 'b')!.incoming).toBe(true)
  })

  it('a caller whose socket drops cancels the call (it still counts)', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.disconnect('a', T0 + 1_000)
    expect(sends(fx, 'b')).toContainEqual({ t: 'callEnded', reason: 'cancelled' })
    expect(room.state.sides.a.call.attemptsLeft).toBe(1)
    expect(room.state.pendingCall).toBeNull()
  })

  it('a dropped socket during a call ends it with hangup for the peer', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    room.handle('b', { t: 'callAccept' }, T0 + 1)
    const fx = room.disconnect('b', T0 + 10_000)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'hangup' })
    expect(lastView(fx, 'a')!.inCall).toBe(false)
  })

  it('hiding during a connected call does not end it', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    room.handle('b', { t: 'callAccept' }, T0 + 1)
    const fx = room.handle('b', { t: 'visibility', visible: false }, T0 + 2)
    expect(lastView(fx, 'a')!.inCall).toBe(true)
  })
})

describe('room: frames and views', () => {
  it('relaying signaling sends no views', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    const fx = room.handle('a', { t: 'signal', env: { v: 1, iv: 'i', ct: 'c' } }, T0 + 1)
    expect(fx).toEqual([{ type: 'send', to: 'b', msg: { t: 'signal', env: { v: 1, iv: 'i', ct: 'c' } } }])
  })

  it('never emits frames for a disconnected side', () => {
    room.connect('a', T0)
    const fx = room.handle('a', { t: 'call' }, T0)
    expect(sends(fx, 'b')).toEqual([])
  })

  it('stores the push subscription', () => {
    room.connect('a', T0)
    const sub = { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }
    room.handle('a', { t: 'pushSubscribe', sub }, T0)
    expect(room.state.sides.a.pushSub).toEqual(sub)
    room.clearPushSub('a')
    expect(room.state.sides.a.pushSub).toBeNull()
  })

  it('reports peerPaired false until the second device claims', () => {
    const fresh = new RoomCore()
    fresh.setPaired('a')
    expect(lastView(fresh.connect('a', T0), 'a')!.peerPaired).toBe(false)
    expect(lastView(fresh.handle('a', { t: 'call' }, T0), 'a')).toBeDefined()
    expect(fresh.state.pendingCall).toBeNull()
  })
})

describe('room: call rules across both sides', () => {
  it('a hidden callee still connected within the grace rings in the app, without push', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('b', { t: 'visibility', visible: false }, T0 + 1)
    // b is still "present" (grace) and connected, so it is reachable: in-app ring, no push.
    expect(pushes(room.handle('a', { t: 'call' }, T0 + 2), 'b')).toEqual([])
  })

  it('a second call while already ringing is refused', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    expect(sends(room.handle('a', { t: 'call' }, T0 + 1), 'a')).toContainEqual({ t: 'error', code: 'not-allowed' })
  })

  it('cancelling twice uses both attempts and locks', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    room.handle('a', { t: 'callCancel' }, T0 + 1)
    // The pause after the first attempt.
    expect(sends(room.handle('a', { t: 'call' }, T0 + 2), 'a')).toContainEqual({ t: 'error', code: 'not-allowed' })
    const t = T0 + 1 + CALL_COOLDOWN_MS
    room.handle('a', { t: 'call' }, t)
    const fx = room.handle('a', { t: 'callCancel' }, t + 1)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'nobodyHome', until: t + 1 + LOCK_MS })
  })

  it('merging simultaneous calls resets both sides', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.handle('b', { t: 'call' }, T0 + 1)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'ready' })
    expect(lastView(fx, 'b')!.call).toEqual({ kind: 'ready' })
    expect(room.state.sides.a.call.attemptsLeft).toBe(2)
    expect(room.state.sides.b.call.attemptsLeft).toBe(2)
  })

  it('a call from the friend resets my ping counter, a text message does not unlock calls', () => {
    room.connect('a', T0)
    room.handle('b', { t: 'pushSubscribe', sub: { endpoint: 'https://push.test/b', keys: { p256dh: 'p', auth: 'a' } } }, T0)
    room.handle('a', { t: 'ping' }, T0)
    room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'call' }, T0 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'callCancel' }, T0 + 2 * CALL_COOLDOWN_MS)
    room.handle('a', { t: 'call' }, T0 + 3 * CALL_COOLDOWN_MS)
    room.handle('a', { t: 'callCancel' }, T0 + 3 * CALL_COOLDOWN_MS)
    const t = T0 + 3 * CALL_COOLDOWN_MS + 1
    expect(room.view('a', t).call.kind).toBe('nobodyHome')
    expect(room.view('a', t).ping.kind).toBe('exhausted')
    room.connect('b', t)
    room.handle('b', { t: 'wrote' }, t)
    expect(room.state.sides.a.ping.pushesSent).toBe(0)
    expect(room.view('a', t).ping).toEqual({ kind: 'ready' })
    expect(room.view('a', t).call.kind).toBe('nobodyHome')
    room.handle('b', { t: 'call' }, t + 1)
    expect(room.view('a', t + 1).call).toEqual({ kind: 'ready' })
  })

  it('a call still waiting after a long time is not closed by other events', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    const fx = room.handle('a', { t: 'ping' }, T0 + 60 * 60_000)
    expect(sends(fx, 'a').some((m) => m.t === 'callEnded')).toBe(false)
    expect(lastView(fx, 'a')!.outgoing).toBe(true)
  })

  it('schedules an alarm when the 24h lock lifts', () => {
    room.connect('a', T0)
    room.handle('a', { t: 'call' }, T0)
    room.handle('a', { t: 'callCancel' }, T0)
    room.handle('a', { t: 'call' }, T0 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'callCancel' }, T0 + CALL_COOLDOWN_MS)
    expect(room.nextAlarmAt(T0 + CALL_COOLDOWN_MS)).toBe(T0 + CALL_COOLDOWN_MS + LOCK_MS)
  })
})

describe('room: push for a ringing call when the callee turns unreachable', () => {
  // The friend can receive pushes (the room skips an invitation to a device without one).
  beforeEach(() => {
    room.handle('b', { t: 'pushSubscribe', sub: { endpoint: 'https://push.test/b', keys: { p256dh: 'p', auth: 'a' } } }, T0)
  })

  it('pushes when the hidden callee grace runs out while the call still rings', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('b', { t: 'visibility', visible: false }, T0 + 1)
    expect(pushes(room.handle('a', { t: 'call' }, T0 + 2), 'b')).toEqual([])
    const expiry = T0 + 1 + PRESENCE_GRACE_MS
    expect(room.nextAlarmAt(T0 + 2)).toBe(expiry)
    expect(pushes(room.alarm(expiry - 1), 'b')).toEqual([])
    expect(pushes(room.alarm(expiry), 'b')).toEqual([{ kind: 'call' }])
    // Once per call: later events do not push again.
    expect(pushes(room.alarm(expiry + 10), 'b')).toEqual([])
    expect(pushes(room.disconnect('b', expiry + 20), 'b')).toEqual([])
  })

  it('pushes when the callee socket drops while ringing, once', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    expect(pushes(room.handle('a', { t: 'call' }, T0), 'b')).toEqual([])
    expect(pushes(room.disconnect('b', T0 + 1_000), 'b')).toEqual([{ kind: 'call' }])
    room.connect('b', T0 + 2_000)
    expect(pushes(room.disconnect('b', T0 + 3_000), 'b')).toEqual([])
  })

  it('does not push again for a call already pushed when it was placed', () => {
    room.connect('a', T0)
    expect(pushes(room.handle('a', { t: 'call' }, T0), 'b')).toHaveLength(1)
    expect(pushes(room.alarm(T0 + 1_000), 'b')).toEqual([])
  })

  it('does not push after the ringing call ended', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('b', { t: 'visibility', visible: false }, T0 + 1)
    room.handle('a', { t: 'call' }, T0 + 2)
    room.handle('a', { t: 'callCancel' }, T0 + 3)
    expect(pushes(room.alarm(T0 + 1 + PRESENCE_GRACE_MS), 'b')).toEqual([])
  })

  it('loads a pending call persisted without the pushed flag', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const old = structuredClone(room.state)
    delete old.pendingCall!.pushed
    const restored = new RoomCore(old)
    expect(pushes(restored.disconnect('b', T0 + 1), 'b')).toEqual([{ kind: 'call' }])
  })
})
