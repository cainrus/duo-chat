// The pair's room logic, free of Cloudflare APIs so it can be unit-tested.
// The Durable Object (src/server/room/durable.ts) owns sockets, storage, alarms and push delivery;
// it feeds events in and executes the returned effects.

import { otherSide, type CallKind, type Side } from '@shared/types'
import type { ClientToServer, PushPayload, PushSubscriptionJSONLike, RoomView, ServerToClient } from '@shared/protocol'
import {
  callButtonView,
  callChangesAt,
  canCall,
  initialCallAttempts,
  onCallAnswered,
  onCalledBack,
  onCallPlaced,
  onCallUnanswered,
  type CallAttemptState,
  type UnansweredReason,
} from '../rules/callAttempts'
import { decidePing, initialPingPushes, onPingReply, pingButtonView, pingChangesAt, type PingPushState } from '../rules/pingPushes'
import { initialPresence, isPresent, presenceExpiresAt, setActive, type PresenceState } from '../rules/presence'

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

const SIDES: readonly Side[] = ['a', 'b']

function initialSide(): SideState {
  return {
    paired: false,
    connected: false,
    visible: false,
    presence: initialPresence(),
    call: initialCallAttempts(),
    ping: initialPingPushes(),
    pushSub: null,
  }
}

export class RoomCore {
  #s: RoomState

  constructor(state: RoomState = RoomCore.initialState()) {
    this.#s = state
  }

  static initialState(): RoomState {
    return { sides: { a: initialSide(), b: initialSide() }, pendingCall: null, activeCall: null }
  }

  /** Serializable snapshot for Durable Object storage. */
  get state(): RoomState {
    return this.#s
  }

  /** A device claimed its slot (pairing). */
  setPaired(side: Side): void {
    this.#s.sides[side].paired = true
  }

  /** The push service said the subscription is gone (404/410). */
  clearPushSub(side: Side): void {
    this.#s.sides[side].pushSub = null
  }

  /** An authenticated socket for `side` opened. The app starts visible. */
  connect(side: Side, now: number): Effect[] {
    const fx = this.#tick(now)
    const s = this.#s.sides[side]
    s.connected = true
    s.visible = true
    this.#updatePresence(side, now)
    return [...fx, ...this.#views(now)]
  }

  disconnect(side: Side, now: number): Effect[] {
    const fx = this.#tick(now)
    const s = this.#s.sides[side]
    s.connected = false
    this.#updatePresence(side, now)
    // The caller left: the ringing stops (it still counts as an attempt).
    if (this.#s.pendingCall?.from === side) fx.push(...this.#endPending('cancelled', now))
    // A dropped socket during a call ends it for the peer.
    if (this.#s.activeCall) fx.push(...this.#endActive())
    return [...fx, ...this.#views(now)]
  }

  handle(side: Side, msg: RoomInput, now: number): Effect[] {
    const fx = this.#tick(now)
    const peer = otherSide(side)
    const me = this.#s.sides[side]
    const them = this.#s.sides[peer]
    const pending = this.#s.pendingCall

    switch (msg.t) {
      // These two change no view; views go out only if the tick itself changed something.
      case 'signal': {
        const views = fx.length ? this.#views(now) : []
        return [...fx, ...this.#send(peer, { t: 'signal', env: msg.env }), ...views]
      }

      case 'pushSubscribe': {
        me.pushSub = msg.sub
        return fx.length ? [...fx, ...this.#views(now)] : fx
      }

      case 'visibility':
        me.visible = msg.visible
        this.#updatePresence(side, now)
        if (!msg.visible && pending?.from === side) fx.push(...this.#endPending('cancelled', now))
        break

      case 'call': {
        if (!them.paired || this.#s.activeCall) {
          fx.push(...this.#send(side, { t: 'error', code: 'not-allowed' }))
          break
        }
        if (pending?.from === peer) {
          // Both called at the same moment: merge into one connected call (counts as answered).
          this.#answer(pending.kind)
          break
        }
        if (pending?.from === side || !canCall(me.call, now)) {
          fx.push(...this.#send(side, { t: 'error', code: 'not-allowed' }))
          break
        }
        me.call = onCallPlaced(me.call, now)
        this.#s.pendingCall = { from: side, kind: msg.kind, until: me.call.cooldownUntil! }
        them.call = onCalledBack(them.call, now)
        them.ping = onPingReply()
        if (!this.#reachable(peer, now)) fx.push({ type: 'push', to: peer, payload: { kind: 'call', callKind: msg.kind } })
        break
      }

      case 'callCancel':
        if (pending?.from === side) fx.push(...this.#endPending('cancelled', now))
        break

      case 'callAccept':
        if (pending?.from === peer) this.#answer(pending.kind)
        break

      case 'callDecline':
        if (pending?.from === peer) fx.push(...this.#endPending('declined', now))
        break

      case 'callEnd':
        // Lenient: "end" on a ringing screen means cancel (caller) or decline (callee).
        if (this.#s.activeCall) fx.push(...this.#endActive())
        else if (pending?.from === side) fx.push(...this.#endPending('cancelled', now))
        else if (pending?.from === peer) fx.push(...this.#endPending('declined', now))
        break

      case 'ping': {
        if (!them.paired) break
        them.ping = onPingReply()
        const r = decidePing(me.ping, now, this.#reachable(peer, now))
        me.ping = r.state
        if (r.decision === 'nudge') fx.push(...this.#send(peer, { t: 'nudge' }))
        else if (r.decision === 'push') fx.push({ type: 'push', to: peer, payload: { kind: 'ping' } })
        break
      }

      case 'replied':
        them.ping = onPingReply()
        break
    }
    return [...fx, ...this.#views(now)]
  }

  /** Time-driven transitions: call timeout, presence grace expiry. */
  alarm(now: number): Effect[] {
    return [...this.#tick(now), ...this.#views(now)]
  }

  /** Earliest time `alarm` has something to do, or null. */
  nextAlarmAt(now: number): number | null {
    const times: number[] = []
    // An overdue call still needs processing, so it counts even if in the past.
    if (this.#s.pendingCall) times.push(this.#s.pendingCall.until)
    for (const side of SIDES) {
      const s = this.#s.sides[side]
      for (const t of [presenceExpiresAt(s.presence), callChangesAt(s.call), pingChangesAt(s.ping)]) {
        if (t !== null && t > now) times.push(t)
      }
    }
    return times.length ? Math.min(...times) : null
  }

  view(side: Side, now: number): RoomView {
    const peer = otherSide(side)
    const s = this.#s.sides[side]
    const p = this.#s.sides[peer]
    const pending = this.#s.pendingCall
    return {
      self: side,
      peerPaired: p.paired,
      peerPresent: isPresent(p.presence, now),
      call: callButtonView(s.call, now),
      ping: pingButtonView(s.ping, now),
      incoming: pending?.from === peer ? { kind: pending.kind } : null,
      outgoing: pending?.from === side ? { kind: pending.kind, until: pending.until } : null,
      inCall: this.#s.activeCall ? { kind: this.#s.activeCall.kind } : null,
    }
  }

  // ---------- internals ----------

  /** Push decisions: the recipient can be reached in the app only if present AND its socket is open. */
  #reachable(side: Side, now: number): boolean {
    const s = this.#s.sides[side]
    return s.connected && isPresent(s.presence, now)
  }

  #updatePresence(side: Side, now: number): void {
    const s = this.#s.sides[side]
    s.presence = setActive(s.presence, s.connected && s.visible, now)
  }

  /** Process an overdue ringing call (it ends unanswered at its own `until`). */
  #tick(now: number): Effect[] {
    const pending = this.#s.pendingCall
    if (pending && now >= pending.until) return this.#endPending('timeout', pending.until)
    return []
  }

  #endPending(reason: UnansweredReason, at: number): Effect[] {
    const pending = this.#s.pendingCall
    if (!pending) return []
    this.#s.pendingCall = null
    const caller = this.#s.sides[pending.from]
    caller.call = onCallUnanswered(caller.call, at, reason)
    return this.#sendBoth({ t: 'callEnded', reason })
  }

  #answer(kind: CallKind): void {
    this.#s.pendingCall = null
    this.#s.activeCall = { kind }
    for (const side of SIDES) {
      this.#s.sides[side].call = onCallAnswered()
      this.#s.sides[side].ping = onPingReply()
    }
  }

  #endActive(): Effect[] {
    this.#s.activeCall = null
    return this.#sendBoth({ t: 'callEnded', reason: 'hangup' })
  }

  /** Only connected sides get frames; nothing is queued for an absent socket. */
  #send(to: Side, msg: ServerToClient): Effect[] {
    return this.#s.sides[to].connected ? [{ type: 'send', to, msg }] : []
  }

  #sendBoth(msg: ServerToClient): Effect[] {
    return SIDES.flatMap((side) => this.#send(side, msg))
  }

  #views(now: number): Effect[] {
    return SIDES.flatMap((side) => this.#send(side, { t: 'view', view: this.view(side, now) }))
  }
}
