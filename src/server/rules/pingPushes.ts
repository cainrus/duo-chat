// Owner's rules for inviting the friend: the «Я онлайн» button, a message and entering the
// voice room all share ONE invitation budget per sender. Pure functions. The budget is spent
// the same way whether or not the friend is in the app (only absent friends get the push), so
// the sender's button never reveals her presence.
// Spec: "Invitations: ping, messages, voice room (owner's rules)".

import { CALL_COOLDOWN_MS, LOCK_MS, PING_PUSHES_PER_ROUND } from '@shared/constants'
import type { PingButtonView } from '@shared/types'

export type PingPushState = {
  pushesSent: number
  lastPushAt: number | null
  /** Set when the second push of a round was sent; pushes resume LOCK_MS later. */
  exhaustedSince: number | null
}

export function initialPingPushes(): PingPushState {
  return { pushesSent: 0, lastPushAt: null, exhaustedSince: null }
}

/** The daily cap lifts LOCK_MS after it started. */
function normalize(s: PingPushState, now: number): PingPushState {
  if (s.exhaustedSince !== null && now >= s.exhaustedSince + LOCK_MS) return initialPingPushes()
  return s
}

/** End of the pause after the last invitation, if it is still running. */
function pauseUntil(s: PingPushState, now: number): number | null {
  const end = s.lastPushAt !== null ? s.lastPushAt + CALL_COOLDOWN_MS : null
  return end !== null && end > now ? end : null
}

/**
 * An invitation (button, message or voice room entry): the first is granted, the next after
 * CALL_COOLDOWN_MS, then nothing until LOCK_MS after the second. A granted invitation becomes a
 * push only if the friend is away and can get pushes; it is spent either way.
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

/** What the «Я онлайн» button shows. The same whether or not the friend is in the app. */
export function pingButtonView(s: PingPushState, now: number): PingButtonView {
  const n = normalize(s, now)
  if (n.exhaustedSince !== null) return { kind: 'exhausted', until: n.exhaustedSince + LOCK_MS }
  const until = pauseUntil(n, now)
  return until !== null ? { kind: 'cooldown', until } : { kind: 'ready' }
}

/** The earliest time after `now` when the ping button view changes on its own, or null. */
export function pingChangesAt(s: PingPushState, now: number): number | null {
  // While the daily cap holds, only its end changes the view.
  const t = s.exhaustedSince !== null ? s.exhaustedSince + LOCK_MS : s.lastPushAt !== null ? s.lastPushAt + CALL_COOLDOWN_MS : null
  return t !== null && t > now ? t : null
}
