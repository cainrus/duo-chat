// The Durable Object glue, run in Node against a fake Workers runtime:
// hibernation sockets with attachments, KV storage, alarms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALL_COOLDOWN_MS, PRESENCE_GRACE_MS } from '@shared/constants'
import type { ServerToClient } from '@shared/protocol'
import { toBase64url } from '../base64url'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  },
}))

const { PairRoom, HELLO_TIMEOUT_MS } = await import('./durable')
type Room = InstanceType<typeof PairRoom>

class FakeWS {
  readyState = 1
  sent: ServerToClient[] = []
  closed: { code: number; reason: string } | null = null
  #att: unknown = null
  serializeAttachment(v: unknown) {
    this.#att = structuredClone(v)
  }
  deserializeAttachment() {
    return structuredClone(this.#att)
  }
  send(s: string) {
    if (this.readyState !== 1) throw new Error('closed')
    this.sent.push(JSON.parse(s))
  }
  close(code: number, reason: string) {
    this.closed = { code, reason }
    this.readyState = 3
  }
  views() {
    return this.sent.flatMap((m) => (m.t === 'view' ? [m.view] : []))
  }
}

class FakeStorage {
  data = new Map<string, unknown>()
  alarm: number | null = null
  async get(keys: string[]) {
    return new Map(keys.filter((k) => this.data.has(k)).map((k) => [k, structuredClone(this.data.get(k))]))
  }
  async put(entries: Record<string, unknown>) {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v))
  }
  async setAlarm(t: number) {
    this.alarm = t
  }
  async deleteAlarm() {
    this.alarm = null
  }
  async deleteAll() {
    this.data.clear()
  }
}

class FakeCtx {
  storage = new FakeStorage()
  sockets: FakeWS[] = []
  ready: Promise<unknown> = Promise.resolve()
  waits: Promise<unknown>[] = []
  acceptWebSocket(ws: FakeWS) {
    this.sockets.push(ws)
  }
  getWebSockets() {
    return this.sockets.filter((s) => s.readyState !== 3)
  }
  blockConcurrencyWhile(fn: () => Promise<unknown>) {
    this.ready = fn()
    return this.ready
  }
  waitUntil(p: Promise<unknown>) {
    this.waits.push(p)
  }
}

const env = {
  VAPID_PUBLIC_KEY: 'x',
  VAPID_PRIVATE_KEY: 'y',
  VAPID_SUBJECT: 'mailto:a@b.c',
} as never

let now = 1_000_000_000
let ctx: FakeCtx
let room: Room

async function make(existing?: FakeCtx): Promise<Room> {
  ctx = existing ?? new FakeCtx()
  room = new PairRoom(ctx as never, env)
  await ctx.ready
  return room
}

/** Opens a socket through the real upgrade path. */
async function open(): Promise<FakeWS> {
  const res = await room.fetch(new Request('https://room/ws', { headers: { Upgrade: 'websocket' } }))
  expect(res.status).toBe(200) // 101 in Workers; Node's Response cannot carry 101, see the stub below
  return ctx.sockets.at(-1)!
}

async function hello(ws: FakeWS, token: string) {
  await room.webSocketMessage(ws as never, JSON.stringify({ t: 'hello', deviceToken: token }))
}

async function msg(ws: FakeWS, frame: unknown) {
  await room.webSocketMessage(ws as never, JSON.stringify(frame))
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  // Workers' WebSocketPair and a 101 response; Node has neither.
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = new FakeWS()
      1 = new FakeWS()
    },
  )
  const RealResponse = Response
  vi.stubGlobal(
    'Response',
    class extends RealResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
        super(body, init?.status === 101 ? { ...init, status: 200 } : init)
      }
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PairRoom: claiming slots', () => {
  it('gives out slot a, then slot b once, then refuses', async () => {
    await make()
    expect(await room.claim('b')).toEqual({ ok: false, status: 404 })
    const a = await room.claim('a')
    expect(a.ok).toBe(true)
    expect(await room.claim('a')).toEqual({ ok: false, status: 409 })
    const b = await room.claim('b')
    expect(b.ok).toBe(true)
    expect(await room.claim('b')).toEqual({ ok: false, status: 409 })
    if (!a.ok || !b.ok) throw new Error('unreachable')
    expect(await room.sideForToken(a.deviceToken)).toBe('a')
    expect(await room.sideForToken(b.deviceToken)).toBe('b')
    expect(await room.sideForToken('nope')).toBeNull()
  })

  it('stores only token hashes', async () => {
    await make()
    const a = await room.claim('a')
    if (!a.ok) throw new Error('claim failed')
    expect(JSON.stringify([...ctx.storage.data])).not.toContain(a.deviceToken)
  })

  it('wipe revokes both devices and closes sockets', async () => {
    await make()
    const a = await room.claim('a')
    if (!a.ok) throw new Error('claim failed')
    const ws = await open()
    await hello(ws, a.deviceToken)
    await room.wipe()
    expect(ws.closed?.code).toBe(4001)
    expect(await room.sideForToken(a.deviceToken)).toBeNull()
    expect(ctx.storage.data.size).toBe(0)
    expect((await room.claim('a')).ok).toBe(true)
  })
})

describe('PairRoom: sockets', () => {
  let ta: string
  let tb: string
  beforeEach(async () => {
    await make()
    const a = await room.claim('a')
    const b = await room.claim('b')
    if (!a.ok || !b.ok) throw new Error('claim failed')
    ta = a.deviceToken
    tb = b.deviceToken
  })

  it('refuses an upgrade without the websocket header', async () => {
    const res = await room.fetch(new Request('https://room/ws'))
    expect(res.status).toBe(426)
  })

  it('requires a valid hello first', async () => {
    const ws = await open()
    await msg(ws, { t: 'ping' })
    expect(ws.sent).toEqual([{ t: 'error', code: 'bad-request' }])
    expect(ws.closed?.code).toBe(4401)

    const ws2 = await open()
    await hello(ws2, 'wrong-token')
    expect(ws2.sent).toEqual([{ t: 'error', code: 'unauthorized' }])
    expect(ws2.closed?.code).toBe(4401)
  })

  it('sends a view after hello and relays sealed signaling between sides', async () => {
    const wa = await open()
    await hello(wa, ta)
    expect(wa.views().at(-1)).toMatchObject({ self: 'a', peerPaired: true, peerPresent: false })
    const wb = await open()
    await hello(wb, tb)
    expect(wa.views().at(-1)!.peerPresent).toBe(true)
    const env = { v: 1, iv: 'aaa', ct: 'bbb' }
    await msg(wa, { t: 'signal', env })
    expect(wb.sent.at(-1)).toEqual({ t: 'signal', env })
  })

  it('answers a malformed frame with bad-request and keeps the socket', async () => {
    const wa = await open()
    await hello(wa, ta)
    await msg(wa, { t: 'call', kind: 'chat' })
    expect(wa.sent.at(-1)).toEqual({ t: 'error', code: 'bad-request' })
    expect(wa.closed).toBeNull()
  })

  it('a reconnect replaces the old socket without the peer seeing a disconnect', async () => {
    const wb = await open()
    await hello(wb, tb)
    const wa1 = await open()
    await hello(wa1, ta)
    const wa2 = await open()
    await hello(wa2, ta)
    expect(wa1.closed?.code).toBe(4000)
    await room.webSocketClose(wa1 as never)
    expect(wb.views().at(-1)!.peerPresent).toBe(true)
    // Only now is 'a' really gone.
    wa2.readyState = 3
    await room.webSocketClose(wa2 as never)
    expect(ctx.storage.alarm).toBe(now + PRESENCE_GRACE_MS)
  })

  it('persists state and schedules the next alarm', async () => {
    const wa = await open()
    await hello(wa, ta)
    await msg(wa, { t: 'call' })
    await msg(wa, { t: 'callCancel' })
    const stored = ctx.storage.data.get('room') as { sides: { a: { call: { cooldownUntil: number } } } }
    expect(stored.sides.a.call.cooldownUntil).toBe(now + CALL_COOLDOWN_MS)
    // The pause after the attempt ends on its own: an alarm is scheduled for it.
    expect(ctx.storage.alarm).toBe(now + CALL_COOLDOWN_MS)
  })

  it('closes a socket that never says hello', async () => {
    const ws = await open()
    expect(ctx.storage.alarm).toBe(now + HELLO_TIMEOUT_MS)
    now += HELLO_TIMEOUT_MS
    await room.alarm()
    expect(ws.closed?.code).toBe(4408)
  })

  it('on wake, a side flagged connected without a live socket is disconnected (review focus 4)', async () => {
    const wa = await open()
    await hello(wa, ta)
    const wb = await open()
    await hello(wb, tb)
    // The instance dies; b's socket died with it, a's survived (hibernation keeps sockets).
    wb.readyState = 3
    now += 1_000
    const ctx2 = ctx
    await make(ctx2)
    expect(ctx.storage.alarm).toBe(now + PRESENCE_GRACE_MS)
    now += PRESENCE_GRACE_MS
    await room.alarm()
    expect(wa.views().at(-1)!.peerPresent).toBe(false)
  })

  it('delivers a push to an absent side and deletes a subscription the push service calls gone', async () => {
    const raw = async (alg: 'ECDH' | 'ECDSA') => {
      const usages = alg === 'ECDH' ? ['deriveBits'] : ['sign']
      const p = (await crypto.subtle.generateKey({ name: alg, namedCurve: 'P-256' }, true, usages as never)) as CryptoKeyPair
      const pub = toBase64url(new Uint8Array((await crypto.subtle.exportKey('raw', p.publicKey)) as ArrayBuffer))
      const d = ((await crypto.subtle.exportKey('jwk', p.privateKey)) as JsonWebKey).d!
      return { pub, d }
    }
    const vapid = await raw('ECDSA')
    const ua = await raw('ECDH')
    Object.assign(env as object, { VAPID_PUBLIC_KEY: vapid.pub, VAPID_PRIVATE_KEY: vapid.d })
    const calls: string[] = []
    let status = 201
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return new Response(null, { status })
    })

    const wb = await open()
    await hello(wb, tb)
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.pub, auth: toBase64url(new Uint8Array(16)) } }
    await msg(wb, { t: 'pushSubscribe', sub })
    wb.readyState = 3
    await room.webSocketClose(wb as never)

    const wa = await open()
    await hello(wa, ta)
    await msg(wa, { t: 'ping' })
    await Promise.all(ctx.waits)
    expect(calls).toEqual([sub.endpoint])

    status = 410
    now += 3 * 60_000
    await msg(wa, { t: 'call' })
    await Promise.all(ctx.waits)
    expect(calls).toHaveLength(2)
    const stored = ctx.storage.data.get('room') as { sides: { b: { pushSub: unknown } } }
    expect(stored.sides.b.pushSub).toBeNull()
  })
})
