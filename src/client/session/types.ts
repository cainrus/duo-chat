// The contract between the UI and everything below it.
// The UI only reads `state` (Vue-reactive) and calls actions. It never touches
// sockets, WebRTC or crypto. A fake implementation (session/fake.ts) drives the UI in dev.

import type { CallEndReason, RoomView } from '@shared/protocol'
import type { CallKind, Side } from '@shared/types'
import type { ChatMessage } from '../messages/store'

export const AVATARS = ['cat', 'fox', 'bunny', 'bear', 'panda', 'owl', 'unicorn', 'frog'] as const
export type AvatarId = (typeof AVATARS)[number]

/** Lives only on the devices; exchanged over the data channel, never sent to the server. */
export type Profile = { name: string; avatar: AvatarId }

export type Connection = 'offline' | 'connecting' | 'online'

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
  missedCall: { kind: CallKind; at: number } | null
  connection: Connection
  me: Profile | null
  /** Learned from the peer over the data channel; null until first contact. */
  peer: Profile | null
  /** Server-computed room state (buttons, presence, call state). Null before first connect. */
  view: RoomView | null
  /** Live messages (each disappears 1 hour after it was sent). */
  messages: ChatMessage[]
  /** The direct channel to the friend is open, so messages go out right now. */
  directOpen: boolean
  /** Time of the last nudge from the friend; the UI animates when it changes. */
  nudgeAt: number | null
  media: {
    local: MediaStream | null
    remote: MediaStream | null
    micOn: boolean
    camOn: boolean
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
  /** "Come to the chat". Never disabled; the server decides nudge / push / silent. */
  ping(): void

  // --- calls ---
  startCall(kind: CallKind): Promise<void>
  cancelCall(): void
  acceptCall(): Promise<void>
  declineCall(): void
  hangUp(): void
  setMic(on: boolean): void
  /** Turns the camera on/off during a call (voice calls can add video). */
  setCamera(on: boolean): Promise<void>

  // --- clearing one-shot notes (the UI never writes into state) ---
  dismissCallEnded(): void
  dismissMissedCall(): void
  dismissError(): void
}
