// Owner's rules for inviting the friend: the ping button, a message to an absent friend and
// entering the voice room all share ONE push budget per sender. Pure functions.
// Spec: "Invitations: ping, messages, voice room (owner's rules)".

import { CALL_COOLDOWN_MS, LOCK_MS, PING_PUSHES_PER_ROUND } from '@shared/constants'
import type { PingButtonView } from '@shared/types'

export type PingPushState = {
  pushesSent: number
  lastPushAt: number | null
  /** Set when the second push of a round was sent; pushes resume LOCK_MS later. */
  exhaustedSince: number | null
  /**
   * Last ping that could not push (the friend has no subscription or muted pushes): it costs
   * nothing, but the button still pauses for CALL_COOLDOWN_MS. Optional: older state lacks it.
   */
  lastHeldAt?: number | null
}

export function initialPingPushes(): PingPushState {
  return { pushesSent: 0, lastPushAt: null, exhaustedSince: null, lastHeldAt: null }
}

/** The daily cap lifts LOCK_MS after it started. */
function normalize(s: PingPushState, now: number): PingPushState {
  if (s.exhaustedSince !== null && now >= s.exhaustedSince + LOCK_MS) return { ...initialPingPushes(), lastHeldAt: s.lastHeldAt ?? null }
  return s
}

/** End of the pause after the last push or held ping, if it is still running. */
function pauseUntil(s: PingPushState, now: number): number | null {
  const ends = [s.lastPushAt, s.lastHeldAt ?? null]
    .filter((t): t is number => t !== null)
    .map((t) => t + CALL_COOLDOWN_MS)
    .filter((t) => t > now)
  return ends.length ? Math.max(...ends) : null
}

/** A ping that could not push (no subscription, muted): nothing is spent, the button pauses. */
export function onPingHeld(s: PingPushState, now: number): PingPushState {
  return { ...s, lastHeldAt: now }
}

/**
 * An invitation to an absent friend (ping, message or voice room entry): first push, the next
 * after CALL_COOLDOWN_MS, then nothing until LOCK_MS after the second.
 */
export function decideInvite(s: PingPushState, now: number): { state: PingPushState; push: boolean } {
  const n = normalize(s, now)
  if (n.exhaustedSince !== null) return { state: n, push: false }
  if (pauseUntil(n, now) !== null) return { state: n, push: false }
  const pushesSent = n.pushesSent + 1
  return {
    state: { ...n, pushesSent, lastPushAt: now, exhaustedSince: pushesSent >= PING_PUSHES_PER_ROUND ? now : null },
    push: true,
  }
}

/** The pinged side replied (message, ping or call): the counter starts over. */
export function onPingReply(): PingPushState {
  return initialPingPushes()
}

/** What the ping button shows (it is hidden while the friend is in the app). */
export function pingButtonView(s: PingPushState, now: number): PingButtonView {
  const n = normalize(s, now)
  if (n.exhaustedSince !== null) return { kind: 'exhausted', until: n.exhaustedSince + LOCK_MS }
  const until = pauseUntil(n, now)
  return until !== null ? { kind: 'cooldown', until } : { kind: 'ready' }
}

/** The earliest time after `now` when the ping button view changes on its own, or null. */
export function pingChangesAt(s: PingPushState, now: number): number | null {
  const times = [
    s.exhaustedSince !== null ? s.exhaustedSince + LOCK_MS : null,
    s.lastPushAt !== null ? s.lastPushAt + CALL_COOLDOWN_MS : null,
    s.lastHeldAt != null ? s.lastHeldAt + CALL_COOLDOWN_MS : null,
  ].filter((t): t is number => t !== null && t > now)
  return times.length ? Math.min(...times) : null
}
