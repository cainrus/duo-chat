// Product rules from the design spec. Change timings here only.

/** Pause after a call attempt (and between ping pushes). */
export const CALL_COOLDOWN_MS = 2 * 60_000

/** "Nobody's home" lock for calls, and the daily cap window for ping pushes. */
export const LOCK_MS = 24 * 60 * 60_000

/** A side still counts as present this long after the app was hidden or disconnected. */
export const PRESENCE_GRACE_MS = 60_000

/** Every chat message lives exactly this long from the moment it was sent. */
export const MESSAGE_TTL_MS = 60 * 60_000

/** Call attempts per round before "nobody's home". */
export const CALL_ATTEMPTS_PER_ROUND = 2

/** Pushes per ping round before the daily cap. */
export const PING_PUSHES_PER_ROUND = 2
