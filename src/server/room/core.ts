// The pair's room logic, free of Cloudflare APIs so it can be unit-tested.
// The Durable Object (src/server/room/durable.ts) owns sockets, storage, alarms and push delivery;
// it feeds events in and executes the returned effects.

import type { CallKind, Side } from '@shared/types'
import type { ClientToServer, PushPayload, PushSubscriptionJSONLike, RoomView, ServerToClient } from '@shared/protocol'
import type { CallAttemptState } from '../rules/callAttempts'
import type { PingPushState } from '../rules/pingPushes'
import type { PresenceState } from '../rules/presence'

export type SideState = {
  paired: boolean
  connected: boolean
  visible: boolean
  presence: PresenceState
  call: CallAttemptState
  ping: PingPushState
  pushSub: PushSubscriptionJSONLike | null
}

export type RoomState = {
  sides: Record<Side, SideState>
  /** A call ringing from `from` to the other side, ending unanswered at `until`. */
  pendingCall: { from: Side; kind: CallKind; until: number } | null
  activeCall: { kind: CallKind } | null
}

export type Effect =
  | { type: 'send'; to: Side; msg: ServerToClient }
  /** Deliver a Web Push to `to` (the DO skips it when there is no subscription). */
  | { type: 'push'; to: Side; payload: PushPayload }

/** Client frames the core handles. `hello` is authenticated by the DO before `connect`. */
export type RoomInput = Exclude<ClientToServer, { t: 'hello' }>

export class RoomCore {
  constructor(_state: RoomState = RoomCore.initialState()) {
    throw new Error('not implemented')
  }

  static initialState(): RoomState {
    throw new Error('not implemented')
  }

  /** Serializable snapshot for Durable Object storage. */
  get state(): RoomState {
    throw new Error('not implemented')
  }

  /** A device claimed its slot (pairing). */
  setPaired(_side: Side): void {
    throw new Error('not implemented')
  }

  /** An authenticated socket for `side` opened. The app starts visible. */
  connect(_side: Side, _now: number): Effect[] {
    throw new Error('not implemented')
  }

  disconnect(_side: Side, _now: number): Effect[] {
    throw new Error('not implemented')
  }

  handle(_side: Side, _msg: RoomInput, _now: number): Effect[] {
    throw new Error('not implemented')
  }

  /** Time-driven transitions: call timeout, presence grace expiry. */
  alarm(_now: number): Effect[] {
    throw new Error('not implemented')
  }

  /** Earliest time `alarm` has something to do, or null. */
  nextAlarmAt(_now: number): number | null {
    throw new Error('not implemented')
  }

  view(_side: Side, _now: number): RoomView {
    throw new Error('not implemented')
  }
}
