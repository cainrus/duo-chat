// Wire protocol between the app and the server (Cloudflare Worker + one Durable Object per pair).
// Everything here is metadata or ciphertext: chat text never goes through the server,
// and WebRTC signaling travels inside SealedEnvelope.

import type { CallButtonView, PingButtonView, SealedEnvelope, Side } from './types'

// ---------- HTTP ----------

/**
 * POST /api/rooms/:roomId/claim
 * Slot 'a' (creating the pair) requires `Authorization: Bearer <ADMIN_SECRET>`.
 * Slot 'b' needs no auth and succeeds once, while slot 'a' is taken and 'b' is free.
 * 409 when the pair is full, 401 for a bad admin secret, 404 for 'b' on an unknown room.
 */
export type ClaimRequest = { side: Side }
export type ClaimResponse = { side: Side; deviceToken: string }

/** DELETE /api/rooms/:roomId with the admin bearer: wipes the room (revokes both devices). */

/**
 * GET /api/rooms/:roomId/ice with `Authorization: Bearer <deviceToken>`:
 * short-lived TURN/STUN servers for RTCPeerConnection.
 */
export type IceResponse = { iceServers: RTCIceServerJSON[] }
export type RTCIceServerJSON = { urls: string | string[]; username?: string; credential?: string }

/** GET /api/vapid-public-key -> { key } (base64url), for PushManager.subscribe. */
export type VapidKeyResponse = { key: string }

// ---------- WebSocket: /api/rooms/:roomId/ws ----------
// The first frame from the client must be `hello`; anything else closes the socket.

export type PushSubscriptionJSONLike = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export type ClientToServer =
  | { t: 'hello'; deviceToken: string }
  /** App visible (foreground) or hidden. Drives presence. */
  | { t: 'visibility'; visible: boolean }
  /** Encrypted WebRTC signaling, relayed to the peer as is. */
  | { t: 'signal'; env: SealedEnvelope }
  /** Calls are always voice; video is switched on device-to-device, never via the server. */
  | { t: 'call' }
  | { t: 'callCancel' }
  | { t: 'callAccept' }
  | { t: 'callEnd' }
  | { t: 'ping' }
  /**
   * This side wrote a chat message (the text itself never comes here). Resets the friend's
   * invitation counter towards us; to an absent friend it may send a content-free invitation
   * push, from the shared budget.
   */
  | { t: 'wrote' }
  /** This device wants no pushes at all (calls, pings, messages). Re-sent on every connect. */
  | { t: 'pushMute'; muted: boolean }
  | { t: 'pushSubscribe'; sub: PushSubscriptionJSONLike }

/** Full UI-relevant state for one side. Sent on connect and after every change. */
export type RoomView = {
  self: Side
  peerPaired: boolean
  peerPresent: boolean
  call: CallButtonView
  ping: PingButtonView
  /** The friend waits for this side in the call (it lasts while her app stays visible). */
  incoming: boolean
  /** This side waits for the friend in the call; ends when we hide the app or switch OFF. */
  outgoing: boolean
  /** A call is connected (accepted and not ended). */
  inCall: boolean
}

export type PingResult = 'pushed' | 'held'

/**
 * cancelled: the caller stopped waiting (switched OFF, hid or closed the app) before the
 * friend joined. hangup: a connected call ended. There is no decline and no ring timeout.
 */
export type CallEndReason = 'cancelled' | 'hangup'

export type ServerToClient =
  | { t: 'view'; view: RoomView }
  | { t: 'signal'; env: SealedEnvelope }
  /**
   * What became of this side's ping (sent only while the friend is away; a ping while she is
   * in the app is ignored): pushed (a Web Push went out), held (rationed by the owner's rules,
   * or the friend cannot get pushes).
   */
  | { t: 'pingResult'; result: PingResult }
  | { t: 'callEnded'; reason: CallEndReason }
  | { t: 'error'; code: 'unauthorized' | 'bad-request' | 'not-allowed' }

/**
 * Web Push payload (JSON). Every kind shows the same invitation («<имя> зовёт тебя 👋»); the
 * kind only decides where a click leads. The service worker adds the peer's name, kept locally.
 */
export type PushPayload = { kind: 'ping' | 'message' | 'call' }
