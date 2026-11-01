// The contract between the UI and everything below it.
// The UI only reads `state` (Vue-reactive) and calls actions. It never touches
// sockets, WebRTC or crypto. A fake implementation (session/fake.ts) drives the UI in dev.

import type { CallEndReason, RoomView } from '@shared/protocol'
import type { Side } from '@shared/types'
import type { ChatMessage } from '../messages/store'
import type { StickerId } from '../stickers/catalog'

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
  connection: Connection
  /**
   * Server-computed room state (buttons, call state). Null before first connect. It carries
   * the friend's presence for the session's own use (the direct link); the UI never shows it.
   */
  view: RoomView | null
  /** Live messages (each disappears 1 hour after it was sent). */
  messages: ChatMessage[]
  /** Ids of our messages still waiting in the outbox (not handed to the friend yet). */
  pendingIds: string[]
  /** The direct channel to the friend is open, so messages go out right now. */
  directOpen: boolean
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
  createPair(input: { adminSecret: string }): Promise<{ link: string }>
  /** Device 'b': joins using the secret from the pairing link's fragment. */
  joinPair(input: { secret: Uint8Array }): Promise<void>
  /** Must be called from a tap (iOS requirement). */
  enableNotifications(): Promise<NotificationResult>

  // --- chat ---
  sendText(text: string): void
  /** Sends a sticker at once: a chat message like text (outbox, ack, 1-hour life). */
  sendSticker(id: StickerId): void
  /**
   * «онлайн»: spends an invitation from the shared budget; the server pushes «онлайн» to the
   * friend only if she is away. Nothing comes back: the button's view is the feedback, and it
   * looks the same whether or not she is in the app.
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
  dismissError(): void
}
