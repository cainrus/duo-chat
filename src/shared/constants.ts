// Product rules from the design spec. Change timings here only.

/**
 * Pause after an unanswered call attempt before the next one (and between ping pushes).
 * A call itself has no ring timeout: the caller waits in the "room" while her app is visible.
 */
export const CALL_COOLDOWN_MS = 60_000

/**
 * After this side's call switch goes OFF -> AUDIO, the VIDEO position stays locked this long,
 * so a mis-tap never lands a kid in video.
 */
export const VIDEO_UNLOCK_MS = 3_000

/** "Nobody's home" lock for calls, and the daily cap window for ping pushes. */
export const LOCK_MS = 24 * 60 * 60_000

/** A side still counts as present this long after the app was hidden or disconnected. */
export const PRESENCE_GRACE_MS = 60_000

/** Every chat message lives exactly this long from the moment it was sent. */
export const MESSAGE_TTL_MS = 60 * 60_000

/**
 * How long an invitation push (ping, message, voice room entry) stays deliverable and valid.
 * Web Push TTL for all of them, and the notification's `data.expiresAt` for ping and message.
 * A call (voice room) can wait as long as the caller stays, so its notification has no expiry
 * of its own; a click after the caller left shows the missed-call card.
 */
export const INVITE_TTL_MS = MESSAGE_TTL_MS

/** Call attempts per round before "nobody's home". */
export const CALL_ATTEMPTS_PER_ROUND = 2

/** Invitation pushes (ping, message, voice room entry share them) per round before the daily cap. */
export const PING_PUSHES_PER_ROUND = 2
