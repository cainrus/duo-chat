// The pair's room logic, free of Cloudflare APIs so it can be unit-tested.
// The Durable Object (src/server/room/durable.ts) owns sockets, storage, alarms and push delivery;
// it feeds events in and executes the returned effects.

import { otherSide, type Side } from '@shared/types'
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
} from '../rules/callAttempts'
import {
  decideInvite,
  initialPingPushes,
  onPingHeld,
  onPingReply,
  pingButtonView,
  pingChangesAt,
  type PingPushState,
} from '../rules/pingPushes'
import { initialPresence, isPresent, presenceExpiresAt, setActive, type PresenceState } from '../rules/presence'

export type SideState = {
  paired: boolean
  connected: boolean
  visible: boolean
  presence: PresenceState
  call: CallAttemptState
  ping: PingPushState
  pushSub: PushSubscriptionJSONLike | null
  /** This device asked for no pushes at all. Optional: older saved state lacks it. */
  pushMuted?: boolean
}

export type RoomState = {
  sides: Record<Side, SideState>
  /**
   * `from` waits for the other side in the call ("voice room" model): no ring timeout; it ends
   * when `from` cancels, hides the app or disconnects, or the other side joins.
   * `pushed`: the callee already got the push for this call (at most one per call).
   * Optional so that state persisted before the field existed still loads.
   */
  pendingCall: { from: Side; pushed?: boolean } | null
  /** A call is connected. (State saved before calls became voice-only holds `{ kind }`: still truthy.) */
  activeCall: boolean
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
    pushMuted: false,
  }
}

export class RoomCore {
  #s: RoomState

  constructor(state: RoomState = RoomCore.initialState()) {
    this.#s = state
  }

  static initialState(): RoomState {
    return { sides: { a: initialSide(), b: initialSide() }, pendingCall: null, activeCall: false }
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
    const s = this.#s.sides[side]
    s.connected = true
    s.visible = true
    this.#updatePresence(side, now)
    return this.#views(now)
  }

  disconnect(side: Side, now: number): Effect[] {
    const fx: Effect[] = []
    const s = this.#s.sides[side]
    s.connected = false
    this.#updatePresence(side, now)
    // The caller left: she stops waiting (it still counts as an attempt).
    if (this.#s.pendingCall?.from === side) fx.push(...this.#endPending(now))
    // A dropped socket during a call ends it for the peer.
    if (this.#s.activeCall) fx.push(...this.#endActive())
    fx.push(...this.#pushRinging(now))
    return [...fx, ...this.#views(now)]
  }

  handle(side: Side, msg: RoomInput, now: number): Effect[] {
    const fx: Effect[] = []
    const peer = otherSide(side)
    const me = this.#s.sides[side]
    const them = this.#s.sides[peer]
    const pending = this.#s.pendingCall

    switch (msg.t) {
      // These two change no view.
      case 'signal':
        return this.#send(peer, { t: 'signal', env: msg.env })

      case 'pushSubscribe':
        me.pushSub = msg.sub
        return []

      case 'pushMute':
        me.pushMuted = msg.muted
        return []

      case 'visibility':
        me.visible = msg.visible
        this.#updatePresence(side, now)
        // Waiting lasts only while the caller's app is visible.
        if (!msg.visible && pending?.from === side) fx.push(...this.#endPending(now))
        break

      case 'call': {
        if (!them.paired || this.#s.activeCall) {
          fx.push(...this.#send(side, { t: 'error', code: 'not-allowed' }))
          break
        }
        if (pending?.from === peer) {
          // Both called at the same moment: merge into one connected call (counts as answered).
          this.#answer()
          break
        }
        if (pending?.from === side || !canCall(me.call, now)) {
          fx.push(...this.#send(side, { t: 'error', code: 'not-allowed' }))
          break
        }
        me.call = onCallPlaced(me.call, now)
        this.#s.pendingCall = { from: side, pushed: false }
        them.call = onCalledBack(them.call, now)
        them.ping = onPingReply()
        fx.push(...this.#pushRinging(now))
        break
      }

      case 'callCancel':
        if (pending?.from === side) fx.push(...this.#endPending(now))
        break

      case 'callAccept':
        if (pending?.from === peer) this.#answer()
        break

      case 'callEnd':
        // Lenient: "end" while waiting means cancel for the caller. There is no decline: the
        // callee simply does not join, and the caller waits as long as she is in the app.
        if (this.#s.activeCall) fx.push(...this.#endActive())
        else if (pending?.from === side) fx.push(...this.#endPending(now))
        break

      case 'ping': {
        if (!them.paired) {
          fx.push(...this.#send(side, { t: 'pingResult', result: 'held' }))
          break
        }
        // She is in the app (the button is hidden then): ignored, nothing is counted.
        if (this.#reachable(peer, now)) break
        them.ping = onPingReply()
        const pushed = this.#invite(side, 'ping', now, fx)
        // She cannot get pushes: nothing is spent, but the button pauses like after a push.
        if (!pushed && (!them.pushSub || them.pushMuted)) me.ping = onPingHeld(me.ping, now)
        fx.push(...this.#send(side, { t: 'pingResult', result: pushed ? 'pushed' : 'held' }))
        break
      }

      case 'wrote':
        them.ping = onPingReply()
        // A message to an absent friend invites her; to a present one nothing.
        if (them.paired && !this.#reachable(peer, now)) this.#invite(side, 'message', now, fx)
        break
    }
    fx.push(...this.#pushRinging(now))
    return [...fx, ...this.#views(now)]
  }

  /** Time-driven transitions: presence grace expiry, cooldown and lock ends. */
  alarm(now: number): Effect[] {
    return [...this.#pushRinging(now), ...this.#views(now)]
  }

  /** Earliest time `alarm` has something to do, or null. */
  nextAlarmAt(now: number): number | null {
    const times: number[] = []
    for (const side of SIDES) {
      const s = this.#s.sides[side]
      for (const t of [presenceExpiresAt(s.presence), callChangesAt(s.call), pingChangesAt(s.ping, now)]) {
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
      incoming: pending?.from === peer,
      outgoing: pending?.from === side,
      inCall: !!this.#s.activeCall,
    }
  }

  // ---------- internals ----------

  /** Push decisions: the recipient can be reached in the app only if present AND its socket is open. */
  #reachable(side: Side, now: number): boolean {
    const s = this.#s.sides[side]
    return s.connected && isPresent(s.presence, now)
  }

  /**
   * One push per ringing call, sent the moment the callee becomes unreachable: right away
   * when the call is placed, or later when the callee's socket drops or its presence grace
   * runs out while the call still rings (a callee who just hid the app would otherwise get
   * an in-app ring nobody sees, and no push).
   */
  #pushRinging(now: number): Effect[] {
    const pending = this.#s.pendingCall
    if (!pending || pending.pushed) return []
    const callee = otherSide(pending.from)
    if (this.#reachable(callee, now)) return []
    pending.pushed = true
    const fx: Effect[] = []
    this.#invite(pending.from, 'call', now, fx)
    return fx
  }

  /**
   * One push budget per sender for every invitation (ping, message, voice room entry). A friend
   * who cannot be pushed (no subscription, or she muted pushes) costs nothing. True if pushed.
   */
  #invite(from: Side, kind: PushPayload['kind'], now: number, fx: Effect[]): boolean {
    const to = otherSide(from)
    const target = this.#s.sides[to]
    if (!target.pushSub || target.pushMuted) return false
    const r = decideInvite(this.#s.sides[from].ping, now)
    this.#s.sides[from].ping = r.state
    if (r.push) fx.push({ type: 'push', to, payload: { kind } })
    return r.push
  }

  #updatePresence(side: Side, now: number): void {
    const s = this.#s.sides[side]
    s.presence = setActive(s.presence, s.connected && s.visible, now)
  }

  /** The caller stopped waiting before the friend joined: an unanswered attempt. */
  #endPending(at: number): Effect[] {
    const pending = this.#s.pendingCall
    if (!pending) return []
    this.#s.pendingCall = null
    const caller = this.#s.sides[pending.from]
    caller.call = onCallUnanswered(caller.call, at)
    return this.#sendBoth({ t: 'callEnded', reason: 'cancelled' })
  }

  #answer(): void {
    this.#s.pendingCall = null
    this.#s.activeCall = true
    for (const side of SIDES) {
      this.#s.sides[side].call = onCallAnswered()
      this.#s.sides[side].ping = onPingReply()
    }
  }

  #endActive(): Effect[] {
    this.#s.activeCall = false
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
