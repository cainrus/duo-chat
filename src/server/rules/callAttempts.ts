// Owner's anti-spam rules for calling. Pure functions, no I/O, `now` is passed in.
// Spec: docs/superpowers/specs/2026-10-31-duo-chat-design.md, "Call attempt rules".

import { CALL_ATTEMPTS_PER_ROUND, CALL_COOLDOWN_MS, LOCK_MS } from '@shared/constants'
import type { CallButtonView } from '@shared/types'

export type CallAttemptState = {
  /** Calls left before "nobody's home". Starts at CALL_ATTEMPTS_PER_ROUND. */
  attemptsLeft: number
  /** Button is in cooldown until this time (a call may be ringing). */
  cooldownUntil: number | null
  /** "Nobody's home" since this time; lifts on a callback or after LOCK_MS. */
  lockedSince: number | null
}

export type UnansweredReason = 'timeout' | 'cancelled'

export function initialCallAttempts(): CallAttemptState {
  return { attemptsLeft: CALL_ATTEMPTS_PER_ROUND, cooldownUntil: null, lockedSince: null }
}

/** Applies time-based transitions (24h lock expiry, finished cooldown). */
export function normalizeCallAttempts(s: CallAttemptState, now: number): CallAttemptState {
  // Rule 5: any lock lifts 24h after it started, with the full two attempts.
  if (s.lockedSince !== null && now >= s.lockedSince + LOCK_MS) return initialCallAttempts()
  if (s.cooldownUntil !== null && now >= s.cooldownUntil) return { ...s, cooldownUntil: null }
  return s
}

export function canCall(s: CallAttemptState, now: number): boolean {
  const n = normalizeCallAttempts(s, now)
  return n.lockedSince === null && n.cooldownUntil === null && n.attemptsLeft > 0
}

/** Throws if !canCall. Uses one attempt and starts the cooldown. */
export function onCallPlaced(s: CallAttemptState, now: number): CallAttemptState {
  if (!canCall(s, now)) throw new Error('call not allowed now')
  const n = normalizeCallAttempts(s, now)
  return { attemptsLeft: n.attemptsLeft - 1, cooldownUntil: now + CALL_COOLDOWN_MS, lockedSince: null }
}

/**
 * The pending call ended without being accepted.
 * 'cancelled' ends the cooldown at `now`; 'timeout' happens at cooldown end.
 * With no attempts left the button locks ("nobody's home").
 */
export function onCallUnanswered(
  s: CallAttemptState,
  now: number,
  _reason: UnansweredReason,
): CallAttemptState {
  // Every reason ends the cooldown at `now` (a timeout is called exactly at its end).
  const n = { ...normalizeCallAttempts(s, now), cooldownUntil: null }
  return n.attemptsLeft <= 0 ? { ...n, lockedSince: now } : n
}

/** A call involving this side connected: everything resets. */
export function onCallAnswered(): CallAttemptState {
  return initialCallAttempts()
}

/** The other side called this side (accepted or not). Lifts a lock and grants one attempt. */
export function onCalledBack(s: CallAttemptState, now: number): CallAttemptState {
  const n = normalizeCallAttempts(s, now)
  if (n.lockedSince === null) return s
  return { attemptsLeft: 1, cooldownUntil: null, lockedSince: null }
}

export function callButtonView(s: CallAttemptState, now: number): CallButtonView {
  const n = normalizeCallAttempts(s, now)
  if (n.lockedSince !== null) return { kind: 'nobodyHome', until: n.lockedSince + LOCK_MS }
  if (n.cooldownUntil !== null) return { kind: 'cooldown', until: n.cooldownUntil }
  // Out of attempts but the last call's end is not processed yet: it is about to lock.
  if (n.attemptsLeft <= 0) return { kind: 'nobodyHome', until: now + LOCK_MS }
  return { kind: 'ready' }
}

/** When the call button view changes on its own, or null. */
export function callChangesAt(s: CallAttemptState): number | null {
  if (s.lockedSince !== null) return s.lockedSince + LOCK_MS
  return s.cooldownUntil
}
