/** The two device slots of a pair. 'a' is the device that created the pair. */
export type Side = 'a' | 'b'

export const otherSide = (s: Side): Side => (s === 'a' ? 'b' : 'a')

/** What the call button should show. Computed on the server, rendered by the client. */
export type CallButtonView =
  | { kind: 'ready' }
  | { kind: 'cooldown'; until: number }
  | { kind: 'nobodyHome'; until: number }

/**
 * What the ping button should show (it is hidden while the friend is in the app). cooldown:
 * the next ping is not allowed before `until`. exhausted: no more pushes until `until`.
 * Both are shown disabled, so a kid sees the wait instead of tapping again and again.
 */
export type PingButtonView =
  | { kind: 'ready' }
  | { kind: 'cooldown'; until: number }
  | { kind: 'exhausted'; until: number }

/** Encrypted, authenticated blob. The server relays it and cannot read it. */
export type SealedEnvelope = { v: 1; iv: string; ct: string }
