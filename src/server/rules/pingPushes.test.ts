import { describe, expect, it } from 'vitest'
import { CALL_COOLDOWN_MS, LOCK_MS } from '@shared/constants'
import { decidePing, initialPingPushes, onPingReply, pingButtonView } from './pingPushes'

const T0 = 5_000_000

describe('ping pushes', () => {
  it('only nudges a present friend, without counting', () => {
    const s = initialPingPushes()
    const r = decidePing(s, T0, true)
    expect(r.decision).toBe('nudge')
    expect(r.state).toEqual(s)
  })

  it('first ping to an absent friend pushes, the next one inside the cooldown is silent', () => {
    const first = decidePing(initialPingPushes(), T0, false)
    expect(first.decision).toBe('push')
    const second = decidePing(first.state, T0 + CALL_COOLDOWN_MS - 1, false)
    expect(second.decision).toBe('silent')
    expect(pingButtonView(second.state, T0 + 1)).toEqual({ kind: 'ready' })
  })

  it('allows a second push after the cooldown, then nothing until the next day', () => {
    const first = decidePing(initialPingPushes(), T0, false)
    const t2 = T0 + CALL_COOLDOWN_MS
    const second = decidePing(first.state, t2, false)
    expect(second.decision).toBe('push')
    expect(pingButtonView(second.state, t2)).toEqual({ kind: 'exhausted', until: t2 + LOCK_MS })
    const third = decidePing(second.state, t2 + 60 * 60_000, false)
    expect(third.decision).toBe('silent')
    const nextDay = decidePing(third.state, t2 + LOCK_MS, false)
    expect(nextDay.decision).toBe('push')
  })

  it('still nudges a present friend while pushes are used up', () => {
    const first = decidePing(initialPingPushes(), T0, false)
    const second = decidePing(first.state, T0 + CALL_COOLDOWN_MS, false)
    expect(decidePing(second.state, T0 + CALL_COOLDOWN_MS + 1, true).decision).toBe('nudge')
  })

  it('a reply resets the counter', () => {
    const first = decidePing(initialPingPushes(), T0, false)
    const second = decidePing(first.state, T0 + CALL_COOLDOWN_MS, false)
    const reset = onPingReply()
    expect(reset).toEqual(initialPingPushes())
    expect(decidePing(reset, second.state.lastPushAt! + 1, false).decision).toBe('push')
  })
})
