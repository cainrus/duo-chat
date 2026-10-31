// Presence: a side is present while active (connected AND visible),
// and for PRESENCE_GRACE_MS after it stopped being active.

export type PresenceState = { active: boolean; inactiveSince: number | null }

export function initialPresence(): PresenceState {
  throw new Error('not implemented')
}

/** Record the side's activity (connected && visible) at `now`. Idempotent for the same value. */
export function setActive(_p: PresenceState, _active: boolean, _now: number): PresenceState {
  throw new Error('not implemented')
}

export function isPresent(_p: PresenceState, _now: number): boolean {
  throw new Error('not implemented')
}

/** When the side will turn absent if nothing happens, or null if that is not pending. */
export function presenceExpiresAt(_p: PresenceState): number | null {
  throw new Error('not implemented')
}
