// The contract between the UI and everything below it.
// The UI only reads `state` (Vue-reactive) and calls actions. It never touches
// sockets, WebRTC or crypto. A fake implementation (session/fake.ts) drives the UI in dev.

import type { CallEndReason, PingResult, RoomView } from '@shared/protocol'
import type { Side } from '@shared/types'
import type { ChatMessage } from '../messages/store'

export const AVATARS = ['cat', 'fox', 'bunny', 'bear', 'panda', 'owl', 'unicorn', 'frog'] as const
export type AvatarId = (typeof AVATARS)[number]

/** Lives only on the devices; exchanged over the data channel, never sent to the server. */
export type Profile = { name: string; avatar: AvatarId }

export type Connection = 'offline' | 'connecting' | 'online'

/**
 * One call switch per side: OFF | AUDIO | VIDEO. Each side sets only its own; what the two get
 * is the lower of both (video needs both on VIDEO). AUDIO while the friend is OFF calls her;
 * AUDIO while she calls joins. OFF from a ringing or connected call ends it for both.
 */
export type CallMode = 'off' | 'audio' | 'video'
export const CALL_MODES: readonly CallMode[] = ['off', 'audio', 'video']

export type DuoState = {
  /** 'setup' until this device is paired. */
  phase: 'setup' | 'ready'
  /** This device's slot, known locally from pairing (does not wait for the server). */
  self: Side | null
  /**
   * A call towards us ended without being answered (the friend gave up, it timed out,
   * or the app was opened from a call notification after the call was gone).
   * Cleared by dismissMissedCall() or when a new call starts.
   */
  missedCall: { at: number } | null
  connection: Connection
  me: Profile | null
  /** Learned from the peer over the data channel; null until first contact. */
  peer: Profile | null
  /** Server-computed room state (buttons, presence, call state). Null before first connect. */
  view: RoomView | null
  /** Live messages (each disappears 1 hour after it was sent). */
  messages: ChatMessage[]
  /** Ids of our messages still waiting in the outbox (not handed to the friend yet). */
  pendingIds: string[]
  /** The direct channel to the friend is open, so messages go out right now. */
  directOpen: boolean
  /**
   * What became of our last ping (from the server): pushed (a
   * notification went out), held (rationed, or she has no notifications). The UI shows a
   * short toast when `at` changes.
   */
  lastPing: { result: PingResult; at: number } | null
  /** The bell: this device asked for no pushes (kept on the device, re-sent on every connect). */
  pushMuted: boolean
  /** The browser allows notifications for this app (permission granted and push supported). */
  notificationsAllowed: boolean
  /** This side's call switch. Back to 'off' whenever the call ends. */
  myMode: CallMode
  /**
   * The friend's call switch: from the server while it rings ('audio' = she is calling us),
   * then from her device over the data channel once connected (never through the server).
   */
  peerMode: CallMode
  /** VIDEO on our switch stays locked until this time (VIDEO_UNLOCK_MS after OFF -> AUDIO). */
  videoUnlockAt: number | null
  /**
   * Media of the connected call. The microphone opens only once the call is connected (both
   * on AUDIO or VIDEO); the camera only while both are on VIDEO.
   */
  media: {
    local: MediaStream | null
    remote: MediaStream | null
    /** Both switches are on VIDEO and our camera is running. */
    videoOn: boolean
  }
  /** Why the last call ended; the UI shows a short note, then calls dismissCallEnded(). */
  lastCallEnded: CallEndReason | null
  /** A short, human-readable problem (Russian), or null. */
  error: string | null
}

export type NotificationResult = 'granted' | 'denied' | 'unsupported'

export interface DuoSession {
  readonly state: DuoState

  // --- setup (an adult does this once per device) ---
  /** Device 'a': creates the pair with the admin secret. Returns the link for device 'b'. */
  createPair(input: { adminSecret: string; me: Profile }): Promise<{ link: string }>
  /** Device 'b': joins using the secret from the pairing link's fragment. */
  joinPair(input: { secret: Uint8Array; me: Profile }): Promise<void>
  /** Must be called from a tap (iOS requirement). */
  enableNotifications(): Promise<NotificationResult>

  // --- chat ---
  sendText(text: string): void
  /**
   * "Come to the chat": an invitation push to a friend who is away (the button is hidden while
   * she is in the app). The server decides push / held by the shared invitation budget.
   */
  ping(): void
  /**
   * The bell: true = this device gets no pushes at all (calls, pings, messages). Turning
   * pushes on when the browser never allowed notifications asks for permission first
   * (call from a tap).
   */
  setPushMuted(muted: boolean): Promise<void>

  // --- calls: one switch (there is no decline: a call nobody joins rings out) ---
  /**
   * Moves our call switch. From OFF only AUDIO is allowed (it calls, or joins her call; not
   * while the call button is locked). VIDEO only from AUDIO and after videoUnlockAt.
   * OFF ends a ringing or connected call for both. Disallowed moves are ignored.
   */
  setMode(mode: CallMode): Promise<void>

  // --- clearing one-shot notes (the UI never writes into state) ---
  dismissCallEnded(): void
  dismissMissedCall(): void
  dismissError(): void
}
