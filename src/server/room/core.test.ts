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
    expect(v.outgoing).toBe(false)
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
  // The friend can receive pushes (the room skips an invitation to a device without one).
  beforeEach(() => {
    room.handle('b', { t: 'pushSubscribe', sub: { endpoint: 'https://push.test/b', keys: { p256dh: 'p', auth: 'a' } } }, T0)
  })

  it('pushes a call to an absent friend once and shows the caller waiting', () => {
    room.connect('a', T0)
    const fx = room.handle('a', { t: 'call' }, T0)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'call' }])
    expect(lastView(fx, 'a')!.outgoing).toBe(true)
    expect(room.state.sides.a.call.attemptsLeft).toBe(1)
    // No repeats while she waits.
    expect(pushes(room.alarm(T0 + 30 * 60_000), 'b')).toEqual([])
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
    expect(lastView(fx, 'a')!.outgoing).toBe(false)
  })

  it('voice room: no ring timeout; the caller waits while her app is visible', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    // Nothing is scheduled for the call itself (only the invitation pause).
    expect(room.nextAlarmAt(T0)).toBe(T0 + CALL_COOLDOWN_MS)
    const later = T0 + 2 * 60 * 60_000
    const fx = room.alarm(later)
    expect(sends(fx, 'a').some((m) => m.t === 'callEnded')).toBe(false)
    expect(room.view('a', later).outgoing).toBe(true)
    expect(room.view('b', later).incoming).toBe(true)
  })

  it('giving up is an unanswered attempt and starts the one-minute pause', () => {
    expect(CALL_COOLDOWN_MS).toBe(60_000)
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    const t = T0 + 10 * 60_000
    const fx = room.handle('a', { t: 'callCancel' }, t)
    expect(sends(fx, 'a')).toContainEqual({ t: 'callEnded', reason: 'cancelled' })
    expect(sends(fx, 'b')).toContainEqual({ t: 'callEnded', reason: 'cancelled' })
    expect(lastView(fx, 'b')!.incoming).toBe(false)
    expect(lastView(fx, 'a')!.call).toEqual({ kind: 'cooldown', until: t + CALL_COOLDOWN_MS })
    expect(room.nextAlarmAt(t)).toBe(t + CALL_COOLDOWN_MS)
    expect(lastView(room.alarm(t + CALL_COOLDOWN_MS), 'a')!.call).toEqual({ kind: 'ready' })
  })

  it('has no decline: the callee cannot end a ringing call', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    room.handle('a', { t: 'call' }, T0)
    // "end" from the callee while she is called changes nothing; the caller keeps waiting.
    const fx = room.handle('b', { t: 'callEnd' }, T0 + 5)
    expect(sends(fx, 'a').some((m) => m.t === 'callEnded')).toBe(false)
    expect(lastView(fx, 'a')!.outgoing).toBe(true)
    expect(lastView(fx, 'b')!.incoming).toBe(true)
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
    room.handle('a', { t: 'callCancel' }, T0 + 1)
    room.handle('a', { t: 'call' }, T0 + 1 + CALL_COOLDOWN_MS)
    room.handle('a', { t: 'visibility', visible: false }, T0 + 2 * CALL_COOLDOWN_MS)
    room.handle('a', { t: 'visibility', visible: true }, T0 + 2 * CALL_COOLDOWN_MS)
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
    const ended = room.handle('b', { t: 'callCancel' }, t + 20)
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

describe('room: invitations («Я онлайн», messages, voice room)', () => {
  const SUB = { endpoint: 'https://push.test/b', keys: { p256dh: 'p', auth: 'a' } }
  const subscribe = (side: Side) => room.handle(side, { t: 'pushSubscribe', sub: SUB }, T0)
  const types = (fx: Effect[], to: Side) => sends(fx, to).map((m) => m.t)

  it('pushes to an absent friend by the rules, with the cooldown and then the exhausted state', () => {
    room.connect('a', T0)
    subscribe('b')
    const first = room.handle('a', { t: 'ping' }, T0)
    expect(pushes(first, 'b')).toEqual([{ kind: 'ping' }])
    expect(lastView(first, 'a')!.ping).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
    expect(pushes(room.handle('a', { t: 'ping' }, T0 + 1), 'b')).toEqual([])
    const fx = room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'ping' }])
    expect(lastView(fx, 'a')!.ping.kind).toBe('exhausted')
  })

  it('the sender cannot tell whether the friend is here: same budget, same views, no result frame', () => {
    const run = (friendHere: boolean, muted: boolean, subscribed: boolean) => {
      const r = new RoomCore()
      r.setPaired('a')
      r.setPaired('b')
      r.connect('a', T0)
      if (subscribed) r.handle('b', { t: 'pushSubscribe', sub: SUB }, T0)
      if (friendHere) r.connect('b', T0)
      if (muted) r.handle('b', { t: 'pushMute', muted: true }, T0)
      const fx = [...r.handle('a', { t: 'ping' }, T0 + 1), ...r.handle('a', { t: 'wrote' }, T0 + CALL_COOLDOWN_MS + 1)]
      const toA = sends(fx, 'a').filter((m) => m.t !== 'view')
      const views = sends(fx, 'a').flatMap((m) => (m.t === 'view' ? [{ ...m.view, peerPresent: null }] : []))
      return { toA, views, pushed: pushes(fx, 'b').length, state: r.state.sides.a.ping }
    }
    const away = run(false, false, true)
    expect(away.pushed).toBe(2)
    for (const other of [run(true, false, true), run(false, true, true), run(false, false, false)]) {
      expect(other.pushed).toBe(0)
      expect(other.toA).toEqual(away.toA)
      expect(other.views).toEqual(away.views)
      expect(other.state).toEqual(away.state)
    }
    expect(away.toA).toEqual([])
  })

  it('a ping to a friend who has not paired does nothing', () => {
    const solo = new RoomCore()
    solo.setPaired('a')
    solo.connect('a', T0)
    const fx = solo.handle('a', { t: 'ping' }, T0)
    expect(types(fx, 'a')).toEqual(['view'])
    expect(solo.state.sides.a.ping.pushesSent).toBe(0)
  })

  it('a reply from the friend resets the budget', () => {
    room.connect('a', T0)
    subscribe('b')
    room.handle('a', { t: 'ping' }, T0)
    room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS)
    expect(room.view('a', T0 + CALL_COOLDOWN_MS + 1).ping.kind).toBe('exhausted')
    room.connect('b', T0 + CALL_COOLDOWN_MS + 1)
    room.handle('b', { t: 'wrote' }, T0 + CALL_COOLDOWN_MS + 2)
    expect(room.view('a', T0 + CALL_COOLDOWN_MS + 3).ping).toEqual({ kind: 'ready' })
  })

  it('a message to an absent friend sends a content-free invitation', () => {
    room.connect('a', T0)
    subscribe('b')
    const fx = room.handle('a', { t: 'wrote' }, T0)
    expect(pushes(fx, 'b')).toEqual([{ kind: 'message' }])
    // More messages inside the cooldown do not push again.
    expect(pushes(room.handle('a', { t: 'wrote' }, T0 + 3), 'b')).toEqual([])
  })

  it('button, message and voice room entry share one budget', () => {
    room.connect('a', T0)
    subscribe('b')
    expect(pushes(room.handle('a', { t: 'wrote' }, T0), 'b')).toEqual([{ kind: 'message' }])
    expect(room.view('a', T0 + 1).ping).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
    expect(pushes(room.handle('a', { t: 'ping' }, T0 + 1), 'b')).toEqual([])
    const call = room.handle('a', { t: 'call' }, T0 + CALL_COOLDOWN_MS)
    expect(pushes(call, 'b')).toEqual([{ kind: 'call' }])
    expect(lastView(call, 'a')!.ping.kind).toBe('exhausted')
    room.handle('a', { t: 'callCancel' }, T0 + CALL_COOLDOWN_MS + 1)
    expect(pushes(room.handle('a', { t: 'call' }, T0 + 3 * CALL_COOLDOWN_MS), 'b')).toEqual([])
  })

  it('a voice room entry while she is here spends the invitation; it is pushed if she leaves while it waits', () => {
    room.connect('a', T0)
    room.connect('b', T0)
    subscribe('b')
    expect(pushes(room.handle('a', { t: 'call' }, T0), 'b')).toEqual([])
    expect(room.view('a', T0 + 1).ping).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
    expect(pushes(room.disconnect('b', T0 + 5), 'b')).toEqual([{ kind: 'call' }])
  })

  it('a muted device gets no pushes at all', () => {
    room.connect('a', T0)
    subscribe('b')
    room.handle('b', { t: 'pushMute', muted: true }, T0)
    expect(room.state.sides.b.pushMuted).toBe(true)
    expect(pushes(room.handle('a', { t: 'ping' }, T0), 'b')).toEqual([])
    room.handle('b', { t: 'pushMute', muted: false }, T0 + 1)
    expect(pushes(room.handle('a', { t: 'ping' }, T0 + CALL_COOLDOWN_MS), 'b')).toEqual([{ kind: 'ping' }])
  })

  it('state saved before the mute flag existed loads as not muted', () => {
    const saved = structuredClone(room.state) as unknown as { sides: Record<Side, Record<string, unknown>> }
    delete saved.sides.b.pushMuted
    const restored = new RoomCore(saved as never)
    restored.connect('a', T0)
    restored.handle('b', { t: 'pushSubscribe', sub: SUB }, T0)
    expect(pushes(restored.handle('a', { t: 'ping' }, T0), 'b')).toEqual([{ kind: 'ping' }])
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
