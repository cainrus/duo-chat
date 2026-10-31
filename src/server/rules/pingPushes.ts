// Owner's rules for the "come to the chat" button. Pure functions.
// Spec: "Ping button (owner's rules)".

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
  throw new Error('not implemented')
}

export function decidePing(
  _s: PingPushState,
  _now: number,
  _recipientPresent: boolean,
): { state: PingPushState; decision: PingDecision } {
  throw new Error('not implemented')
}

/** The pinged side replied (message, ping or call): the counter starts over. */
export function onPingReply(): PingPushState {
  throw new Error('not implemented')
}

export function pingButtonView(_s: PingPushState, _now: number): PingButtonView {
  throw new Error('not implemented')
}
