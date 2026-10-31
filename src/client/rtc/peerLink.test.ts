import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SealedEnvelope, Side } from '@shared/types'
import { PeerLink, type DataFrame, type SignalPayload } from './peerLink'
import {
  FakeDataChannel,
  FakeMediaStream,
  FakeRTCPeerConnection,
  FakeRTCPeerConnectionImpl,
  FakeServerLink,
  fakeStream,
  relayPair,
} from './fakes'

// Trivial "sealing": JSON in `ct`, the sender's side in `iv`. `open` enforces the sender,
// like the real AAD binding does.
vi.mock('../crypto/pair', () => ({
  seal: async (_key: CryptoKey, from: Side, payload: unknown): Promise<SealedEnvelope> => ({
    v: 1,
    iv: `from-${from}`,
    ct: JSON.stringify(payload),
  }),
  open: async (_key: CryptoKey, expectedFrom: Side, env: SealedEnvelope): Promise<unknown> => {
    if (!env || env.v !== 1 || env.iv !== `from-${expectedFrom}`) throw new Error('cannot open')
    return JSON.parse(env.ct)
  },
}))

const key = {} as CryptoKey
const unsealed = (env: SealedEnvelope) => JSON.parse(env.ct) as SignalPayload
const sealFrom = (from: Side, payload: unknown): SealedEnvelope => ({ v: 1, iv: `from-${from}`, ct: JSON.stringify(payload) })

const make = (
  self: Side,
  link: FakeServerLink,
  iceServers: RTCIceServer[] = [{ urls: 'stun:x' }],
  extra: Partial<ConstructorParameters<typeof PeerLink>[0]> = {},
) =>
  new PeerLink({
    self,
    signalingKey: key,
    link,
    getIceServers: async () => iceServers,
    RTCPeerConnectionImpl: FakeRTCPeerConnectionImpl,
    ...extra,
  })

type Watched = { peer: PeerLink; frames: DataFrame[]; opens: boolean[]; remotes: (MediaStream | null)[] }
const watch = (peer: PeerLink): Watched => {
  const w: Watched = { peer, frames: [], opens: [], remotes: [] }
  peer.onData((f) => w.frames.push(f))
  peer.onDataOpen((o) => w.opens.push(o))
  peer.onRemoteStream((s) => w.remotes.push(s))
  return w
}

const setup = () => {
  const links = relayPair()
  const a = watch(make('a', links.a))
  const b = watch(make('b', links.b))
  return { links, a, b }
}

const until = (cond: () => boolean, timeout = 2000) =>
  vi.waitFor(
    () => {
      if (!cond()) throw new Error('not yet')
    },
    { timeout, interval: 2 },
  )
const settle = async (n = 30) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

const pcs = () => FakeRTCPeerConnection.instances
const signals = (link: FakeServerLink) =>
  link.sent.filter((m): m is { t: 'signal'; env: SealedEnvelope } => m.t === 'signal').map((m) => unsealed(m.env))
const offers = (link: FakeServerLink) =>
  signals(link).filter((s) => s.kind === 'description' && s.description.type === 'offer').length

const msg = (from: Side, text: string): DataFrame => ({ t: 'msg', m: { id: text, from, text, sentAt: 1 } })

let debugSpy: { mock: { calls: unknown[][] }; mockRestore(): void }
beforeEach(() => {
  FakeRTCPeerConnection.reset()
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  debugSpy.mockRestore()
})

describe('PeerLink: connecting', () => {
  it('opens the data channel and round-trips frames both ways', async () => {
    const { a, b } = setup()
    expect(a.peer.dataOpen).toBe(false)
    expect(a.peer.sendData(msg('a', 'early'))).toBe(false)
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    expect(a.opens).toEqual([true])
    expect(b.opens).toEqual([true])

    expect(a.peer.sendData(msg('a', 'hi'))).toBe(true)
    expect(b.peer.sendData({ t: 'profile', p: { name: 'Аня', avatar: 'cat' } })).toBe(true)
    await until(() => a.frames.length === 1 && b.frames.length === 1)
    expect(b.frames).toEqual([msg('a', 'hi')])
    expect(a.frames).toEqual([{ t: 'profile', p: { name: 'Аня', avatar: 'cat' } }])
  })

  it("lets 'a' create the ordered 'chat' channel and passes the ICE servers", async () => {
    const { a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    const [pcA, pcB] = pcs()
    expect(pcs()).toHaveLength(2)
    expect(pcA!.createdChannels.map((c) => [c.label, c.ordered])).toEqual([['chat', true]])
    expect(pcB!.createdChannels).toEqual([])
    expect(pcA!.config.iceServers).toEqual([{ urls: 'stun:x' }])
  })

  it('sends signaling only as sealed {t:"signal", env} frames, restart first', async () => {
    const { links, a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    for (const link of [links.a, links.b]) {
      expect(link.sent.length).toBeGreaterThan(0)
      for (const frame of link.sent) {
        expect(Object.keys(frame).sort()).toEqual(['env', 't'])
        expect(frame.t).toBe('signal')
        if (frame.t === 'signal') {
          expect(Object.keys(frame.env).sort()).toEqual(['ct', 'iv', 'v'])
          expect(frame.env.iv).toBe(`from-${link.side}`)
        }
      }
      expect(signals(link)[0]).toEqual({ kind: 'restart' })
    }
    const kinds = signals(links.a).map((s) => s.kind)
    expect(kinds).toContain('description')
    expect(kinds).toContain('candidate')
  })

  it('connect() is idempotent', async () => {
    const { links, a, b } = setup()
    a.peer.connect()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    a.peer.connect()
    b.peer.connect()
    await settle()
    expect(pcs()).toHaveLength(2)
    expect(offers(links.a)).toBe(1)
  })

  it("connects when only 'a' calls connect (b answers the offer)", async () => {
    const { a, b } = setup()
    a.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    expect(pcs()).toHaveLength(2)
  })

  it("connects when only 'b' calls connect (restart wakes 'a')", async () => {
    const { a, b } = setup()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    expect(pcs()).toHaveLength(2)
  })

  it('works when getIceServers fails', async () => {
    const links = relayPair()
    const a = new PeerLink({
      self: 'a',
      signalingKey: key,
      link: links.a,
      getIceServers: () => Promise.reject(new Error('offline')),
      RTCPeerConnectionImpl: FakeRTCPeerConnectionImpl,
    })
    const b = make('b', links.b)
    a.connect()
    b.connect()
    await until(() => a.dataOpen && b.dataOpen)
    expect(pcs()[0]!.config.iceServers).toEqual([])
  })
})

describe('PeerLink: perfect negotiation', () => {
  it('converges on glare: both offer at once, polite b rolls back, impolite a ignores', async () => {
    const { links, a, b } = setup()
    // b has media, so both sides want to negotiate right away.
    b.peer.setLocalStream(fakeStream('audio'))
    links.a.hold()
    links.b.hold()
    a.peer.connect()
    b.peer.connect()
    await until(() => offers(links.a) === 1 && offers(links.b) === 1)
    links.a.release()
    links.b.release()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    await until(() => a.remotes.length === 1)
    const [pcA, pcB] = pcs()
    expect(pcB!.rollbacks).toBe(1)
    expect(pcA!.rollbacks).toBe(0)
    expect(pcA!.signalingState).toBe('stable')
    expect(pcB!.signalingState).toBe('stable')
    expect((a.remotes[0] as unknown as FakeMediaStream).getTracks().map((t) => t.kind)).toEqual(['audio'])
    expect(a.peer.sendData(msg('a', 'after glare'))).toBe(true)
    await until(() => b.frames.length === 1)
  })

  it('converges on glare with media on both sides', async () => {
    const { links, a, b } = setup()
    a.peer.setLocalStream(fakeStream('audio', 'video'))
    b.peer.setLocalStream(fakeStream('audio', 'video'))
    links.a.hold()
    links.b.hold()
    a.peer.connect()
    b.peer.connect()
    await until(() => offers(links.a) >= 1 && offers(links.b) >= 1)
    links.b.release()
    links.a.release()
    await until(() => a.peer.dataOpen && b.peer.dataOpen && a.remotes.length === 1 && b.remotes.length === 1)
    await settle()
    expect(pcs().every((pc) => pc.signalingState === 'stable')).toBe(true)
    expect((b.remotes[0] as unknown as FakeMediaStream).getTracks()).toHaveLength(2)
    expect((a.remotes[0] as unknown as FakeMediaStream).getTracks()).toHaveLength(2)
  })

  it('setLocalStream renegotiates; replacing a track does not; null removes the remote stream', async () => {
    const { links, a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    await settle()
    const before = offers(links.a)

    const cam1 = fakeStream('audio', 'video')
    a.peer.setLocalStream(cam1)
    await until(() => b.remotes.length === 1)
    expect(offers(links.a)).toBe(before + 1)
    const remote = b.remotes[0] as unknown as FakeMediaStream
    expect(remote.getTracks().map((t) => t.kind).sort()).toEqual(['audio', 'video'])

    // Switch camera: same kinds, new tracks -> replaceTrack, no new offer.
    const cam2 = new FakeMediaStream([
      (cam1 as unknown as FakeMediaStream).getTracks()[0]!,
      ...(fakeStream('video') as unknown as FakeMediaStream).getTracks(),
    ])
    a.peer.setLocalStream(cam2 as unknown as MediaStream)
    await settle()
    expect(offers(links.a)).toBe(before + 1)
    const pcA = pcs()[0]!
    expect(pcA.getSenders().map((s) => s.track)).toEqual(cam2.getTracks())

    // Camera off: drop video only -> renegotiation, remote stream keeps audio.
    a.peer.setLocalStream(new FakeMediaStream([cam2.getTracks()[0]!]) as unknown as MediaStream)
    await until(() => offers(links.a) === before + 2)
    await settle()
    expect(remote.getTracks().map((t) => t.kind)).toEqual(['audio'])
    expect(b.remotes).toHaveLength(1)

    // Hang up.
    a.peer.setLocalStream(null)
    await until(() => b.remotes.length === 2)
    expect(b.remotes[1]).toBeNull()
    expect(a.peer.dataOpen && b.peer.dataOpen).toBe(true)
  })

  it('the polite side can renegotiate too (b adds media later)', async () => {
    const { links, a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    b.peer.setLocalStream(fakeStream('audio'))
    await until(() => a.remotes.length === 1)
    expect(offers(links.b)).toBe(1)
  })

  it('applies local media set before connecting', async () => {
    const { a, b } = setup()
    a.peer.setLocalStream(fakeStream('video'))
    a.peer.connect()
    await until(() => b.remotes.length === 1 && b.peer.dataOpen)
  })
})

describe('PeerLink: hostile or broken input', () => {
  it('drops envelopes that do not open, malformed payloads and bad frames', async () => {
    const { links, a, b } = setup()
    const offer = { kind: 'description', description: { type: 'offer', sdp: '{}' } }
    // Reflected: sealed by b itself (the server bounced b's own envelope back).
    links.b.deliver({ t: 'signal', env: sealFrom('b', offer) })
    // Garbage.
    links.b.deliver({ t: 'signal', env: { v: 1, iv: 'x', ct: 'y' } })
    links.b.deliver({ t: 'signal', env: null as unknown as SealedEnvelope })
    // Opens, but not a signal.
    links.b.deliver({ t: 'signal', env: sealFrom('a', { kind: 'nope' }) })
    links.b.deliver({ t: 'signal', env: sealFrom('a', 42) })
    links.b.deliver({ t: 'signal', env: sealFrom('a', { kind: 'description', description: { type: 'bogus' } }) })
    links.b.deliver({ t: 'signal', env: sealFrom('a', { kind: 'candidate', candidate: { candidate: 7 } }) })
    links.b.deliver({ t: 'signal', env: { v: 1, iv: 'from-a', ct: 'not json' } })
    // A candidate with nothing to apply it to.
    links.b.deliver({ t: 'signal', env: sealFrom('a', { kind: 'candidate', candidate: { candidate: 'c' } }) })
    await settle()
    expect(pcs()).toHaveLength(0)
    expect(links.b.sent).toEqual([])
    expect(debugSpy).toHaveBeenCalled()

    // Still works afterwards.
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)

    // Malformed data channel frames are dropped.
    const remote = pcs()[1]!
    const ch = (remote as unknown as { remoteChannels: FakeDataChannel[] }).remoteChannels[0]!
    ch.inject('nope')
    ch.inject(JSON.stringify({ t: 'msg' }))
    ch.inject(JSON.stringify({ t: 'other', m: {} }))
    ch.inject(new ArrayBuffer(4))
    ch.inject(JSON.stringify({ t: 'ack', ids: 'x' }))
    ch.inject(JSON.stringify({ t: 'ack', ids: [1] }))
    ch.inject(JSON.stringify(msg('a', 'ok')))
    ch.inject(JSON.stringify({ t: 'ack', ids: ['ok'], extra: 1 }))
    expect(b.frames).toEqual([msg('a', 'ok'), { t: 'ack', ids: ['ok'] }])
  })

  it('a stale answer in stable is ignored without breaking the connection', async () => {
    const { links, a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    const answer = signals(links.b).find((s) => s.kind === 'description')!
    links.a.deliver({ t: 'signal', env: sealFrom('b', answer) })
    await settle()
    expect(a.peer.dataOpen).toBe(true)
    expect(a.peer.sendData(msg('a', 'still here'))).toBe(true)
    await until(() => b.frames.length === 1)
  })
})

describe('PeerLink: lifecycle', () => {
  it('close() reports closed, the peer sees the channel close, and both can reconnect', async () => {
    const { a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    b.peer.setLocalStream(fakeStream('audio'))
    await until(() => a.remotes.length === 1)

    a.peer.close()
    expect(a.peer.dataOpen).toBe(false)
    expect(a.opens).toEqual([true, false])
    expect(a.remotes.at(-1)).toBeNull()
    expect(a.peer.sendData(msg('a', 'x'))).toBe(false)
    await until(() => !b.peer.dataOpen)
    expect(pcs()[0]!.closed).toBe(true)

    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    expect(pcs()).toHaveLength(4)
    expect(pcs().filter((pc) => !pc.closed)).toHaveLength(2)
    // b's media is carried over to the new connection.
    await until(() => a.remotes.length === 3)
  })

  it("recovers when 'a' reloads (restart makes b start over)", async () => {
    const links = relayPair()
    const a1 = make('a', links.a)
    const b = watch(make('b', links.b))
    a1.connect()
    b.peer.connect()
    await until(() => a1.dataOpen && b.peer.dataOpen)
    pcs()[0]!.crash() // page gone, b does not notice

    const a2Link = new FakeServerLink('a')
    a2Link.partner = links.b
    links.b.partner = a2Link
    const a2 = watch(make('a', a2Link))
    a2.peer.connect()
    await until(() => a2.peer.dataOpen && b.peer.dataOpen && b.opens.length === 3)
    expect(b.opens).toEqual([true, false, true])
    expect(a2.peer.sendData(msg('a', 'back'))).toBe(true)
    await until(() => b.frames.length === 1)
  })

  it("recovers when 'a' reloads and the restart is lost (b rebuilds on the rejected offer)", async () => {
    const links = relayPair()
    const a1 = make('a', links.a)
    const b = watch(make('b', links.b))
    a1.connect()
    b.peer.connect()
    await until(() => a1.dataOpen && b.peer.dataOpen)
    pcs()[0]!.crash()

    const a2Link = new FakeServerLink('a')
    a2Link.partner = links.b
    links.b.partner = a2Link
    a2Link.drop = (env) => unsealed(env).kind === 'restart'
    const a2 = watch(make('a', a2Link))
    a2.peer.connect()
    await until(() => a2.peer.dataOpen && b.peer.dataOpen && b.opens.length === 3)
    expect(debugSpy.mock.calls.some((c: unknown[]) => String(c[1]).includes('offer rejected'))).toBe(true)
  })

  it("recovers when 'b' reloads (restart makes 'a' start over)", async () => {
    const links = relayPair()
    const a = watch(make('a', links.a))
    const b1 = make('b', links.b)
    a.peer.connect()
    b1.connect()
    await until(() => a.peer.dataOpen && b1.dataOpen)
    pcs()[1]!.crash()

    const b2Link = new FakeServerLink('b')
    b2Link.partner = links.a
    links.a.partner = b2Link
    const b2 = watch(make('b', b2Link))
    b2.peer.connect()
    await until(() => b2.peer.dataOpen && a.opens.length === 3)
    expect(a.opens).toEqual([true, false, true])
  })

  it('starts over when the connection fails', async () => {
    const { a, b } = setup()
    a.peer.connect()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
    pcs()[0]!.fail()
    await until(() => a.opens.length === 3 && a.peer.dataOpen && b.peer.dataOpen)
    expect(pcs().filter((pc) => !pc.closed)).toHaveLength(2)
    expect(a.peer.sendData(msg('a', 'again'))).toBe(true)
    await until(() => b.frames.length === 1)
  })

  const dropFirstAnswer = (link: FakeServerLink) => {
    let dropped = false
    link.drop = (env) => {
      const s = unsealed(env)
      if (dropped || s.kind !== 'description' || s.description.type !== 'answer') return false
      dropped = true
      return true
    }
    return () => dropped
  }

  it('recovers after the connect timeout when an answer is lost', async () => {
    const links = relayPair()
    const a = watch(make('a', links.a, undefined, { connectTimeoutMs: 150 }))
    const b = watch(make('b', links.b, undefined, { connectTimeoutMs: 150 }))
    const dropped = dropFirstAnswer(links.b)
    a.peer.connect()
    b.peer.connect()
    await until(() => dropped())
    await settle()
    expect(a.peer.dataOpen || b.peer.dataOpen).toBe(false)
    await until(() => a.peer.dataOpen && b.peer.dataOpen, 3000)
    expect(signals(links.a).filter((s) => s.kind === 'restart').length).toBeGreaterThanOrEqual(1)
    expect(a.peer.sendData(msg('a', 'recovered'))).toBe(true)
    await until(() => b.frames.length === 1)
  })

  it("a peer's restart rebuilds an older connection that never opened", async () => {
    const links = relayPair()
    // Long connect timeouts: only the restart can unstick 'a'.
    const a = watch(make('a', links.a, undefined, { restartGraceMs: 50 }))
    const b = watch(make('b', links.b, undefined, { restartGraceMs: 50 }))
    const dropped = dropFirstAnswer(links.b)
    a.peer.connect()
    b.peer.connect()
    await until(() => dropped())
    await new Promise((r) => setTimeout(r, 100))
    expect(a.peer.dataOpen).toBe(false)
    // 'b' starts over (e.g. after a reload); 'a' must not keep its stuck connection.
    b.peer.close()
    b.peer.connect()
    await until(() => a.peer.dataOpen && b.peer.dataOpen)
  })

  it("a peer's restart re-sends our young connection's offer that got lost while she was away", async () => {
    const links = relayPair()
    const a = watch(make('a', links.a, undefined, { connectTimeoutMs: 5_000, offerResendMs: 200 }))
    const b1 = make('b', links.b)
    a.peer.connect()
    b1.connect()
    await until(() => a.peer.dataOpen && b1.dataOpen)
    // 'b' leaves (pagehide closes her link); 'a' sees the channel close and connects again,
    // but nobody is there: the restart, the offer and the candidates are lost.
    links.a.partner = null
    b1.close()
    await until(() => !a.peer.dataOpen)
    a.peer.connect()
    await until(() => pcs().at(-1)!.signalingState === 'have-local-offer')
    const pcA = pcs().at(-1)!
    await settle()
    // She is back a moment later (well within the restart grace) and starts fresh.
    const b2Link = new FakeServerLink('b')
    b2Link.partner = links.a
    links.a.partner = b2Link
    const b2 = watch(make('b', b2Link))
    b2.peer.connect()
    // Far sooner than the connect timeout, on the same young connection.
    await until(() => a.peer.dataOpen && b2.peer.dataOpen, 1_500)
    expect(pcA.closed).toBe(false)
    expect(a.peer.sendData(msg('a', 'снова'))).toBe(true)
    await until(() => b2.frames.length === 1)
  })

  it('close() while the ICE servers are loading creates nothing', async () => {
    const links = relayPair()
    let resolve!: (v: RTCIceServer[]) => void
    const a = new PeerLink({
      self: 'a',
      signalingKey: key,
      link: links.a,
      getIceServers: () => new Promise((r) => (resolve = r)),
      RTCPeerConnectionImpl: FakeRTCPeerConnectionImpl,
    })
    a.connect()
    await settle(3)
    a.close()
    resolve([])
    await settle()
    expect(pcs()).toHaveLength(0)
  })
})
