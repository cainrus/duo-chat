// Owner's anti-spam rules for calling. Pure functions, no I/O, `now` is passed in.
// Spec: docs/superpowers/specs/2026-10-31-duo-chat-design.md, "Call attempt rules".

import type { CallButtonView } from '@shared/types'

export type CallAttemptState = {
  /** Calls left before "nobody's home". Starts at CALL_ATTEMPTS_PER_ROUND. */
  attemptsLeft: number
  /** Button is in cooldown until this time (a call may be ringing). */
  cooldownUntil: number | null
  /** "Nobody's home" since this time; lifts on a callback or after LOCK_MS. */
  lockedSince: number | null
}

export type UnansweredReason = 'timeout' | 'declined' | 'cancelled'

export function initialCallAttempts(): CallAttemptState {
  throw new Error('not implemented')
}

/** Applies time-based transitions (24h lock expiry, finished cooldown). */
export function normalizeCallAttempts(_s: CallAttemptState, _now: number): CallAttemptState {
  throw new Error('not implemented')
}

export function canCall(_s: CallAttemptState, _now: number): boolean {
  throw new Error('not implemented')
}

/** Throws if !canCall. Uses one attempt and starts the cooldown. */
export function onCallPlaced(_s: CallAttemptState, _now: number): CallAttemptState {
  throw new Error('not implemented')
}

/**
 * The pending call ended without being accepted.
 * 'declined' and 'cancelled' end the cooldown at `now`; 'timeout' happens at cooldown end.
 * With no attempts left the button locks ("nobody's home").
 */
export function onCallUnanswered(
  _s: CallAttemptState,
  _now: number,
  _reason: UnansweredReason,
): CallAttemptState {
  throw new Error('not implemented')
}

/** A call involving this side connected: everything resets. */
export function onCallAnswered(): CallAttemptState {
  throw new Error('not implemented')
}

/** The other side called this side (accepted or not). Lifts a lock and grants one attempt. */
export function onCalledBack(_s: CallAttemptState, _now: number): CallAttemptState {
  throw new Error('not implemented')
}

export function callButtonView(_s: CallAttemptState, _now: number): CallButtonView {
  throw new Error('not implemented')
}
