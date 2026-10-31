// The direct device-to-device connection: one RTCPeerConnection per presence session,
// always with a data channel (chat), plus media tracks during calls.
// Signaling payloads are sealed with the pair key and relayed by the server as opaque blobs.
// Negotiation: "perfect negotiation" pattern; side 'b' is polite.

import type { Side } from '@shared/types'
import type { ChatMessage } from '../messages/store'
import type { Profile } from '../session/types'
import type { ServerLink } from '../net/serverLink'

/** Frames on the data channel (JSON). */
export type DataFrame = { t: 'msg'; m: ChatMessage } | { t: 'profile'; p: Profile }

/** Inside the sealed envelope. */
export type SignalPayload =
  | { kind: 'description'; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit | null }
  /** Ask the peer to tear down and start a fresh connection (e.g. after a reload). */
  | { kind: 'restart' }

export type PeerLinkOptions = {
  self: Side
  signalingKey: CryptoKey
  link: ServerLink
  getIceServers: () => Promise<RTCIceServer[]>
  RTCPeerConnectionImpl?: typeof RTCPeerConnection
}

export class PeerLink {
  constructor(_opts: PeerLinkOptions) {
    throw new Error('not implemented')
  }

  /** Make sure a connection with an open data channel is being established. Idempotent. */
  connect(): void {
    throw new Error('not implemented')
  }

  /** Tear down the connection (peer left). */
  close(): void {
    throw new Error('not implemented')
  }

  get dataOpen(): boolean {
    throw new Error('not implemented')
  }

  /** False when the data channel is not open (the caller keeps the frame for later). */
  sendData(_frame: DataFrame): boolean {
    throw new Error('not implemented')
  }

  onData(_cb: (frame: DataFrame) => void): () => void {
    throw new Error('not implemented')
  }

  onDataOpen(_cb: (open: boolean) => void): () => void {
    throw new Error('not implemented')
  }

  /** Add, replace or remove local media; renegotiates as needed. */
  setLocalStream(_stream: MediaStream | null): void {
    throw new Error('not implemented')
  }

  onRemoteStream(_cb: (stream: MediaStream | null) => void): () => void {
    throw new Error('not implemented')
  }
}
