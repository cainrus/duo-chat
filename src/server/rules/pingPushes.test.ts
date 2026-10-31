import { describe, expect, it } from 'vitest'
import { CALL_COOLDOWN_MS, LOCK_MS } from '@shared/constants'
import { decideInvite, initialPingPushes, onPingHeld, onPingReply, pingButtonView, pingChangesAt } from './pingPushes'

const T0 = 5_000_000

describe('invitation budget (ping, message, voice room share it)', () => {
  it('first invitation pushes, the next one inside the cooldown does not; the button shows the cooldown', () => {
    const first = decideInvite(initialPingPushes(), T0)
    expect(first.push).toBe(true)
    const second = decideInvite(first.state, T0 + CALL_COOLDOWN_MS - 1)
    expect(second.push).toBe(false)
    expect(pingButtonView(second.state, T0 + 1)).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
    expect(pingChangesAt(second.state, T0 + 1)).toBe(T0 + CALL_COOLDOWN_MS)
    expect(pingButtonView(second.state, T0 + CALL_COOLDOWN_MS)).toEqual({ kind: 'ready' })
  })

  it('allows a second push after the cooldown, then nothing until the next day', () => {
    const first = decideInvite(initialPingPushes(), T0)
    const t2 = T0 + CALL_COOLDOWN_MS
    const second = decideInvite(first.state, t2)
    expect(second.push).toBe(true)
    expect(pingButtonView(second.state, t2)).toEqual({ kind: 'exhausted', until: t2 + LOCK_MS })
    expect(decideInvite(second.state, t2 + 60 * 60_000).push).toBe(false)
    expect(decideInvite(second.state, t2 + LOCK_MS).push).toBe(true)
  })

  it('a reply resets the counter', () => {
    const first = decideInvite(initialPingPushes(), T0)
    const second = decideInvite(first.state, T0 + CALL_COOLDOWN_MS)
    const reset = onPingReply()
    expect(reset).toEqual(initialPingPushes())
    expect(decideInvite(reset, second.state.lastPushAt! + 1).push).toBe(true)
  })
})

describe('a ping that could not push', () => {
  it('spends nothing, but the button pauses like after a push', () => {
    const held = onPingHeld(initialPingPushes(), T0)
    expect(held.pushesSent).toBe(0)
    expect(pingButtonView(held, T0 + 1)).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
    expect(pingChangesAt(held, T0 + 1)).toBe(T0 + CALL_COOLDOWN_MS)
    expect(pingButtonView(held, T0 + CALL_COOLDOWN_MS)).toEqual({ kind: 'ready' })
  })

  it('state saved before the field existed still loads', () => {
    const old = { pushesSent: 0, lastPushAt: null, exhaustedSince: null }
    expect(pingButtonView(old, T0)).toEqual({ kind: 'ready' })
    expect(decideInvite(old, T0).push).toBe(true)
  })
})
