// Durable Object: one instance per pair (id = roomId).
// Owns: device tokens (slots a/b), WebSockets (hibernation API), RoomCore state in storage,
// alarms (RoomCore.nextAlarmAt), Web Push delivery for 'push' effects.
// All product rules live in RoomCore; this file only moves bytes in and out.

import { DurableObject } from 'cloudflare:workers'
import { INVITE_TTL_MS } from '@shared/constants'
import type { PushPayload, ServerToClient } from '@shared/protocol'
import type { Side } from '@shared/types'
import { generateDeviceToken, hashToken, verifyToken } from '../auth'
import { sendWebPush } from '../push/webPush'
import type { Env } from '../worker'
import { RoomCore, type Effect, type RoomState } from './core'
import { parseClientFrame } from './frames'

/** SHA-256 hashes of the two device tokens; the tokens themselves are never stored. */
export type TokenHashes = Record<Side, string | null>

export type ClaimResult = { ok: true; side: Side; deviceToken: string } | { ok: false; status: 404 | 409 }

/** What the Worker calls on the room (Workers RPC + fetch for the WebSocket upgrade). */
export interface RoomRpc {
  claim(side: Side): Promise<ClaimResult>
  wipe(): Promise<void>
  sideForToken(token: string): Promise<Side | null>
  fetch(request: Request): Promise<Response>
}

/** Per-socket data that survives hibernation. `side` is null until a valid `hello`. */
type Attachment = { side: Side | null; openedAt: number }

/** A socket that has not said a valid `hello` by then is closed. */
export const HELLO_TIMEOUT_MS = 10_000
const OPEN = 1
const SIDES: readonly Side[] = ['a', 'b']

export class PairRoom extends DurableObject<Env> implements RoomRpc {
  #core = new RoomCore()
  #tokens: TokenHashes = { a: null, b: null }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<unknown>(['room', 'tokens'])
      const room = stored.get('room') as RoomState | undefined
      const tokens = stored.get('tokens') as TokenHashes | undefined
      if (room) this.#core = new RoomCore(room)
      if (tokens) this.#tokens = tokens
      await this.#reconcile()
    })
  }

  // ---------- RPC from the Worker ----------

  async claim(side: Side): Promise<ClaimResult> {
    if (side === 'b' && !this.#tokens.a) return { ok: false, status: 404 }
    if (this.#tokens[side]) return { ok: false, status: 409 }
    const deviceToken = generateDeviceToken()
    this.#tokens[side] = await hashToken(deviceToken)
    this.#core.setPaired(side)
    // alarm() = due transitions + a fresh view for whoever is connected (the peer now sees "paired").
    await this.#run(this.#core.alarm(Date.now()))
    return { ok: true, side, deviceToken }
  }

  /** Admin reset: revokes both devices and forgets everything. */
  async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4001, 'room deleted')
      } catch {
        // already closing
      }
    }
    this.#core = new RoomCore()
    this.#tokens = { a: null, b: null }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  async sideForToken(token: string): Promise<Side | null> {
    // Check both slots every time so the answer time does not depend on which one matched.
    const [a, b] = await Promise.all([verifyToken(token, this.#tokens.a), verifyToken(token, this.#tokens.b)])
    return a ? 'a' : b ? 'b' : null
  }

  /** WebSocket upgrade, forwarded by the Worker. Authentication happens in the first frame. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 })
    if (!this.#tokens.a) return new Response('no such room', { status: 404 })
    const pair = new WebSocketPair()
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ side: null, openedAt: Date.now() } satisfies Attachment)
    await this.#persist(Date.now())
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // ---------- WebSocket hibernation handlers ----------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = attachment(ws)
    if (!att) return
    const now = Date.now()
    const frame = parseClientFrame(message)

    if (att.side === null) {
      const side = frame?.t === 'hello' ? await this.sideForToken(frame.deviceToken) : null
      if (!side) {
        sendTo(ws, { t: 'error', code: frame?.t === 'hello' ? 'unauthorized' : 'bad-request' })
        closeQuietly(ws, 4401, 'unauthorized')
        return
      }
      // One socket per side: a reconnect replaces the old socket without a disconnect in between.
      for (const old of this.#socketsOf(side)) {
        old.serializeAttachment({ side: null, openedAt: 0 } satisfies Attachment)
        closeQuietly(old, 4000, 'replaced')
      }
      ws.serializeAttachment({ side, openedAt: att.openedAt } satisfies Attachment)
      await this.#run(this.#core.connect(side, now))
      return
    }

    if (!frame || frame.t === 'hello') {
      sendTo(ws, { t: 'error', code: 'bad-request' })
      return
    }
    await this.#run(this.#core.handle(att.side, frame, now))
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.#socketGone(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.#socketGone(ws)
  }

  override async alarm(): Promise<void> {
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachment(ws)
      if (att && att.side === null && now >= att.openedAt + HELLO_TIMEOUT_MS) closeQuietly(ws, 4408, 'hello timeout')
    }
    await this.#run(this.#core.alarm(now))
  }

  // ---------- internals ----------

  async #socketGone(ws: WebSocket): Promise<void> {
    const side = attachment(ws)?.side
    closeQuietly(ws, 1000, 'bye')
    if (!side) return
    // Another socket of the same side may already be live (fast reconnect).
    if (this.#socketsOf(side).some((s) => s !== ws)) return
    await this.#run(this.#core.disconnect(side, Date.now()))
  }

  /**
   * After an eviction or restart the stored state may still say "connected" for a socket that died
   * with the old instance. Live sockets (they survive hibernation) are the truth.
   */
  async #reconcile(): Promise<void> {
    const now = Date.now()
    const fx: Effect[] = []
    for (const side of SIDES) {
      const live = this.#socketsOf(side).length > 0
      const flagged = this.#core.state.sides[side].connected
      if (flagged && !live) fx.push(...this.#core.disconnect(side, now))
      else if (!flagged && live) fx.push(...this.#core.connect(side, now))
    }
    if (fx.length) await this.#run(fx)
  }

  #socketsOf(side: Side): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN && attachment(ws)?.side === side)
  }

  /** Executes the core's effects, then persists state and the next alarm. */
  async #run(effects: Effect[]): Promise<void> {
    for (const e of effects) {
      if (e.type === 'send') for (const ws of this.#socketsOf(e.to)) sendTo(ws, e.msg)
      else this.ctx.waitUntil(this.#push(e.to, e.payload))
    }
    await this.#persist(Date.now())
  }

  async #push(to: Side, payload: PushPayload): Promise<void> {
    const sub = this.#core.state.sides[to].pushSub
    if (!sub) return
    try {
      const r = await sendWebPush(
        sub,
        payload,
        { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT },
        // Every invitation (ping, message, voice room) stays deliverable for INVITE_TTL_MS.
        { ttlSeconds: INVITE_TTL_MS / 1000, urgency: 'high' },
      )
      if (r.gone && this.#core.state.sides[to].pushSub?.endpoint === sub.endpoint) {
        this.#core.clearPushSub(to)
        await this.#persist(Date.now())
      } else if (!r.ok) {
        console.warn(`push to ${to} failed: HTTP ${r.status}`)
      }
    } catch (err) {
      console.warn(`push to ${to} failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  async #persist(now: number): Promise<void> {
    await this.ctx.storage.put({ room: this.#core.state, tokens: this.#tokens })
    const times: number[] = []
    const next = this.#core.nextAlarmAt(now)
    if (next !== null) times.push(next)
    for (const ws of this.ctx.getWebSockets()) {
      const att = attachment(ws)
      if (att && att.side === null && att.openedAt > 0) times.push(att.openedAt + HELLO_TIMEOUT_MS)
    }
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times))
    else await this.ctx.storage.deleteAlarm()
  }
}

function attachment(ws: WebSocket): Attachment | null {
  return (ws.deserializeAttachment() as Attachment | null) ?? null
}

function sendTo(ws: WebSocket, msg: ServerToClient): void {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // socket closing; the close handler will run
  }
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason)
  } catch {
    // already closed
  }
}
