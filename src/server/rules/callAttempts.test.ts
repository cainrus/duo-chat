import { describe, expect, it } from 'vitest'
import { CALL_COOLDOWN_MS, LOCK_MS } from '@shared/constants'
import {
  callButtonView,
  canCall,
  initialCallAttempts,
  onCallAnswered,
  onCallPlaced,
  onCalledBack,
  onCallUnanswered,
  type CallAttemptState,
} from './callAttempts'

const T0 = 1_000_000

/** Place a call at `at` and let it time out at the end of the cooldown. */
function unansweredCall(s: CallAttemptState, at: number): { s: CallAttemptState; endedAt: number } {
  const placed = onCallPlaced(s, at)
  const endedAt = at + CALL_COOLDOWN_MS
  return { s: onCallUnanswered(placed, endedAt, 'timeout'), endedAt }
}

describe('call attempts', () => {
  it('starts ready with two attempts', () => {
    const s = initialCallAttempts()
    expect(s.attemptsLeft).toBe(2)
    expect(canCall(s, T0)).toBe(true)
    expect(callButtonView(s, T0)).toEqual({ kind: 'ready' })
  })

  it('locks the button for the cooldown after a call', () => {
    const s = onCallPlaced(initialCallAttempts(), T0)
    expect(canCall(s, T0 + 1)).toBe(false)
    expect(callButtonView(s, T0 + 1)).toEqual({ kind: 'cooldown', until: T0 + CALL_COOLDOWN_MS })
  })

  it('allows exactly one more call after the first one times out', () => {
    const { s, endedAt } = unansweredCall(initialCallAttempts(), T0)
    expect(s.attemptsLeft).toBe(1)
    expect(canCall(s, endedAt)).toBe(true)
    expect(callButtonView(s, endedAt)).toEqual({ kind: 'ready' })
  })

  it('shows "nobody\'s home" after the second unanswered call, for 24 hours', () => {
    const first = unansweredCall(initialCallAttempts(), T0)
    const second = unansweredCall(first.s, first.endedAt)
    expect(canCall(second.s, second.endedAt)).toBe(false)
    expect(callButtonView(second.s, second.endedAt)).toEqual({
      kind: 'nobodyHome',
      until: second.endedAt + LOCK_MS,
    })
    expect(canCall(second.s, second.endedAt + LOCK_MS - 1)).toBe(false)
  })

  it('lifts the lock after 24 hours with two fresh attempts', () => {
    const first = unansweredCall(initialCallAttempts(), T0)
    const second = unansweredCall(first.s, first.endedAt)
    const later = second.endedAt + LOCK_MS
    expect(canCall(second.s, later)).toBe(true)
    expect(callButtonView(second.s, later)).toEqual({ kind: 'ready' })
    const afterOne = unansweredCall(second.s, later)
    expect(canCall(afterOne.s, afterOne.endedAt)).toBe(true)
  })

  it('a callback lifts the lock and grants a single attempt', () => {
    const first = unansweredCall(initialCallAttempts(), T0)
    const second = unansweredCall(first.s, first.endedAt)
    const t = second.endedAt + 10 * 60_000
    const unlocked = onCalledBack(second.s, t)
    expect(canCall(unlocked, t)).toBe(true)
    expect(unlocked.attemptsLeft).toBe(1)
    const again = unansweredCall(unlocked, t)
    expect(callButtonView(again.s, again.endedAt)).toEqual({
      kind: 'nobodyHome',
      until: again.endedAt + LOCK_MS,
    })
  })

  it('a callback while not locked changes nothing', () => {
    const s = onCallPlaced(initialCallAttempts(), T0)
    expect(onCalledBack(s, T0 + 1)).toEqual(s)
  })

  it('cancelling counts as an attempt', () => {
    const placed = onCallPlaced(initialCallAttempts(), T0)
    const cancelled = onCallUnanswered(placed, T0 + 3_000, 'cancelled')
    expect(cancelled.attemptsLeft).toBe(1)
    const second = onCallUnanswered(onCallPlaced(cancelled, T0 + 3_000), T0 + 5_000, 'cancelled')
    expect(callButtonView(second, T0 + 5_000).kind).toBe('nobodyHome')
  })

  it('an answered call resets everything', () => {
    expect(onCallAnswered()).toEqual(initialCallAttempts())
  })

  it('refuses to place a call when not allowed', () => {
    const s = onCallPlaced(initialCallAttempts(), T0)
    expect(() => onCallPlaced(s, T0 + 1)).toThrow()
  })
})
