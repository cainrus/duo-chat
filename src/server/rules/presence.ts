// Presence: a side is present while active (connected AND visible),
// and for PRESENCE_GRACE_MS after it stopped being active.

import { PRESENCE_GRACE_MS } from '@shared/constants'

export type PresenceState = { active: boolean; inactiveSince: number | null }

export function initialPresence(): PresenceState {
  return { active: false, inactiveSince: null }
}

/** Record the side's activity (connected && visible) at `now`. Idempotent for the same value. */
export function setActive(p: PresenceState, active: boolean, now: number): PresenceState {
  if (active) return p.active ? p : { active: true, inactiveSince: null }
  // Going inactive starts the grace once; repeated reports keep the original start.
  return p.active ? { active: false, inactiveSince: now } : p
}

export function isPresent(p: PresenceState, now: number): boolean {
  if (p.active) return true
  return p.inactiveSince !== null && now < p.inactiveSince + PRESENCE_GRACE_MS
}

/** When the side will turn absent if nothing happens, or null if that is not pending. */
export function presenceExpiresAt(p: PresenceState): number | null {
  if (p.active || p.inactiveSince === null) return null
  return p.inactiveSince + PRESENCE_GRACE_MS
}
