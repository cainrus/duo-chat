// Owner's rules for the "come to the chat" button. Pure functions.
// Spec: "Ping button (owner's rules)".

import { CALL_COOLDOWN_MS, LOCK_MS, PING_PUSHES_PER_ROUND } from '@shared/constants'
import type { PingButtonView } from '@shared/types'

export type PingPushState = {
  pushesSent: number
  lastPushAt: number | null
  /** Set when the second push of a round was sent; pushes resume LOCK_MS later. */
  exhaustedSince: number | null
}

/** nudge: peer is present, show it in the app. push: send a Web Push. silent: rationed out. */
export type PingDecision = 'nudge' | 'push' | 'silent'

export function initialPingPushes(): PingPushState {
  return { pushesSent: 0, lastPushAt: null, exhaustedSince: null }
}

/** The daily cap lifts LOCK_MS after it started. */
function normalize(s: PingPushState, now: number): PingPushState {
  if (s.exhaustedSince !== null && now >= s.exhaustedSince + LOCK_MS) return initialPingPushes()
  return s
}

export function decidePing(
  s: PingPushState,
  now: number,
  recipientPresent: boolean,
): { state: PingPushState; decision: PingDecision } {
  // A present friend sees the nudge in the app; nothing is counted.
  if (recipientPresent) return { state: s, decision: 'nudge' }
  const n = normalize(s, now)
  if (n.exhaustedSince !== null) return { state: n, decision: 'silent' }
  if (n.lastPushAt !== null && now < n.lastPushAt + CALL_COOLDOWN_MS) return { state: n, decision: 'silent' }
  const pushesSent = n.pushesSent + 1
  return {
    state: {
      pushesSent,
      lastPushAt: now,
      exhaustedSince: pushesSent >= PING_PUSHES_PER_ROUND ? now : null,
    },
    decision: 'push',
  }
}

/** The pinged side replied (message, ping or call): the counter starts over. */
export function onPingReply(): PingPushState {
  return initialPingPushes()
}

export function pingButtonView(s: PingPushState, now: number): PingButtonView {
  const n = normalize(s, now)
  return n.exhaustedSince !== null ? { kind: 'exhausted', until: n.exhaustedSince + LOCK_MS } : { kind: 'ready' }
}

/** When the ping button view changes on its own, or null. */
export function pingChangesAt(s: PingPushState): number | null {
  return s.exhaustedSince === null ? null : s.exhaustedSince + LOCK_MS
}
