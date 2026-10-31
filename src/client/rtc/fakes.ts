// Test doubles for WebRTC and the server link. Test-only: imported by *.test.ts.
//
// FakeRTCPeerConnection models just enough of the real thing to exercise perfect negotiation:
// - signaling states stable / have-local-offer / have-remote-offer, implicit rollback when a
//   remote offer arrives in have-local-offer, InvalidStateError for an answer in stable;
// - `negotiationneeded` (async, only in stable) after createDataChannel / addTrack /
//   removeTrack / restartIce, and again on returning to stable while still needed;
// - "SDP" is JSON naming the connection (its "DTLS identity"), its data channel and tracks;
//   a renegotiation offer or answer from a different connection is rejected, as a real
//   browser rejects a changed fingerprint;
// - one host candidate per gathering; candidates for another connection are rejected;
// - the pair connects once both sides are stable with each other and have a candidate;
//   then data channels pair up (ondatachannel on the remote side, then onopen on both).

import type { ClientToServer, ServerToClient } from '@shared/protocol'
import type { SealedEnvelope, Side } from '@shared/types'
import type { LinkStatus, ServerLink } from '../net/serverLink'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

let nextId = 1
const registry = new Map<string, FakeRTCPeerConnection>()

type FakeSdp = {
  session: string
  app: boolean
  tracks: { id: string; kind: string; streamId: string }[]
  iceGen: number
}

const parseSdp = (sdp: string | undefined): FakeSdp => {
  const v = JSON.parse(sdp ?? '') as FakeSdp
  if (typeof v.session !== 'string') throw new Error('bad fake sdp')
  return v
}

const domError = (name: string, message: string) => Object.assign(new Error(message), { name })

export class FakeMediaStreamTrack {
  readonly id = `track${nextId++}`
  constructor(readonly kind: 'audio' | 'video') {}
}

export class FakeMediaStream {
  readonly id: string
  private tracks: FakeMediaStreamTrack[]
  onremovetrack: ((ev: { track: FakeMediaStreamTrack }) => void) | null = null
  constructor(tracks: FakeMediaStreamTrack[] = [], id = `stream${nextId++}`) {
    this.tracks = [...tracks]
    this.id = id
  }
  getTracks() {
    return [...this.tracks]
  }
  addTrack(t: FakeMediaStreamTrack) {
    this.tracks.push(t)
  }
  removeTrack(t: FakeMediaStreamTrack) {
    this.tracks = this.tracks.filter((x) => x !== t)
  }
}

export const fakeStream = (...kinds: ('audio' | 'video')[]) =>
  new FakeMediaStream(kinds.map((k) => new FakeMediaStreamTrack(k))) as unknown as MediaStream

export class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting'
  peer: FakeDataChannel | null = null
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  readonly ordered: boolean
  constructor(
    readonly label: string,
    init: RTCDataChannelInit = {},
  ) {
    this.ordered = init.ordered ?? true
  }
  send(data: string) {
    if (this.readyState !== 'open') throw domError('InvalidStateError', 'channel not open')
    const peer = this.peer
    setTimeout(() => {
      if (peer?.readyState === 'open') peer.onmessage?.({ data })
    }, 0)
  }
  close() {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.onclose?.({})
    const peer = this.peer
    if (peer) setTimeout(() => peer.close(), 0)
  }
  /** Test hook: the peer sends raw data. */
  inject(data: unknown) {
    this.onmessage?.({ data })
  }
}

class FakeSender {
  constructor(
    public track: FakeMediaStreamTrack | null,
    readonly sdpId: string,
    readonly streamId: string,
  ) {}
  replaceTrack(t: FakeMediaStreamTrack | null) {
    this.track = t
    return Promise.resolve()
  }
}

export class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = []

  readonly id = `pc${nextId++}`
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'new'
  iceConnectionState: RTCIceConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null

  onnegotiationneeded: ((ev: unknown) => void) | null = null
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null
  ontrack: ((ev: { track: FakeMediaStreamTrack; streams: FakeMediaStream[] }) => void) | null = null
  oniceconnectionstatechange: ((ev: unknown) => void) | null = null
  onconnectionstatechange: ((ev: unknown) => void) | null = null

  // --- counters for assertions ---
  offersCreated = 0
  answersCreated = 0
  rollbacks = 0
  negotiationNeededFired = 0
  createdChannels: FakeDataChannel[] = []
  closed = false

  private remoteChannels: FakeDataChannel[] = []
  private senders: FakeSender[] = []
  private cfgVer = 0
  private offeredVer = 0
  private negotiatedVer = 0
  private checkScheduled = false
  private iceGen = 0
  private gatheredGen = -1
  private remoteCandidates = 0
  /** Connection this one has completed an offer/answer exchange with. */
  private establishedWith: string | null = null
  private remoteTracks = new Map<string, { track: FakeMediaStreamTrack; stream: FakeMediaStream }>()
  private remoteStreams = new Map<string, FakeMediaStream>()

  constructor(readonly config: RTCConfiguration = {}) {
    FakeRTCPeerConnection.instances.push(this)
    registry.set(this.id, this)
  }

  static reset() {
    FakeRTCPeerConnection.instances = []
    registry.clear()
  }

  createDataChannel(label: string, init?: RTCDataChannelInit) {
    if (this.closed) throw domError('InvalidStateError', 'closed')
    const ch = new FakeDataChannel(label, init)
    this.createdChannels.push(ch)
    if (this.createdChannels.length === 1) this.bump()
    else if (this.connectionState === 'connected') this.pairChannels()
    return ch
  }

  addTrack(track: FakeMediaStreamTrack, stream: FakeMediaStream) {
    if (this.closed) throw domError('InvalidStateError', 'closed')
    const s = new FakeSender(track, track.id, stream.id)
    this.senders.push(s)
    this.bump()
    return s
  }

  removeTrack(sender: FakeSender) {
    if (this.closed) throw domError('InvalidStateError', 'closed')
    this.senders = this.senders.filter((s) => s !== sender)
    this.bump()
  }

  getSenders() {
    return [...this.senders]
  }

  restartIce() {
    this.iceGen++
    this.bump()
  }

  async setLocalDescription(desc?: RTCSessionDescriptionInit) {
    await tick()
    if (this.closed) throw domError('InvalidStateError', 'closed')
    const type = desc?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer')
    if (type === 'offer') {
      if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') {
        throw domError('InvalidStateError', `offer in ${this.signalingState}`)
      }
      this.offersCreated++
      this.offeredVer = this.cfgVer
      this.localDescription = { type: 'offer', sdp: this.sdp() }
      this.signalingState = 'have-local-offer'
    } else if (type === 'answer') {
      if (this.signalingState !== 'have-remote-offer') {
        throw domError('InvalidStateError', `answer in ${this.signalingState}`)
      }
      this.answersCreated++
      this.localDescription = { type: 'answer', sdp: this.sdp() }
      this.signalingState = 'stable'
      this.establishedWith = parseSdp(this.remoteDescription?.sdp).session
      this.afterStable()
    } else {
      throw new Error(`fake: unsupported local type ${type}`)
    }
    this.gather()
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    await tick()
    if (this.closed) throw domError('InvalidStateError', 'closed')
    const sdp = parseSdp(desc.sdp)
    if (this.establishedWith !== null && this.establishedWith !== sdp.session) {
      throw domError('InvalidAccessError', 'remote DTLS fingerprint changed')
    }
    if (desc.type === 'offer') {
      if (this.signalingState === 'have-local-offer') {
        this.rollbacks++
        this.signalingState = 'stable'
      }
      if (this.signalingState !== 'stable') throw domError('InvalidStateError', `offer in ${this.signalingState}`)
      this.remoteDescription = { type: desc.type, sdp: desc.sdp }
      this.signalingState = 'have-remote-offer'
      this.applyRemoteTracks(sdp)
    } else if (desc.type === 'answer') {
      if (this.signalingState !== 'have-local-offer') {
        throw domError('InvalidStateError', `answer in ${this.signalingState}`)
      }
      this.remoteDescription = { type: desc.type, sdp: desc.sdp }
      this.signalingState = 'stable'
      this.establishedWith = sdp.session
      this.negotiatedVer = this.offeredVer
      this.applyRemoteTracks(sdp)
      this.afterStable()
    } else {
      throw new Error(`fake: unsupported remote type ${desc.type}`)
    }
  }

  async addIceCandidate(c?: RTCIceCandidateInit | null) {
    await tick()
    if (this.closed) throw domError('InvalidStateError', 'closed')
    if (!c || !c.candidate) return
    if (!this.remoteDescription) throw domError('InvalidStateError', 'no remote description')
    const session = c.candidate.split(' ')[1]
    if (session !== parseSdp(this.remoteDescription.sdp).session) {
      throw domError('OperationError', 'candidate for another connection')
    }
    this.remoteCandidates++
    this.tryConnect()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.signalingState = 'closed'
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    for (const ch of [...this.createdChannels, ...this.remoteChannels]) ch.close()
  }

  /** Test hook: the page died; nothing reaches the peer (its channel stays "open"). */
  crash() {
    this.closed = true
    this.signalingState = 'closed'
    this.connectionState = 'closed'
    for (const ch of [...this.createdChannels, ...this.remoteChannels]) {
      ch.peer = null
      ch.readyState = 'closed'
    }
  }

  /** Test hook: the transport failed. */
  fail() {
    this.connectionState = 'failed'
    this.iceConnectionState = 'failed'
    this.oniceconnectionstatechange?.({})
    this.onconnectionstatechange?.({})
  }

  // ---------- internals ----------

  private sdp(): string {
    const remoteApp = this.remoteDescription ? parseSdp(this.remoteDescription.sdp).app : false
    const sdp: FakeSdp = {
      session: this.id,
      app: this.createdChannels.length > 0 || remoteApp,
      tracks: this.senders.map((s) => ({ id: s.sdpId, kind: s.track?.kind ?? 'audio', streamId: s.streamId })),
      iceGen: this.iceGen,
    }
    return JSON.stringify(sdp)
  }

  private bump() {
    this.cfgVer++
    this.scheduleCheck()
  }

  private scheduleCheck() {
    if (this.checkScheduled) return
    this.checkScheduled = true
    setTimeout(() => {
      this.checkScheduled = false
      if (this.closed || this.signalingState !== 'stable') return
      if (this.negotiatedVer >= this.cfgVer) return
      this.negotiationNeededFired++
      this.onnegotiationneeded?.({})
    }, 0)
  }

  private afterStable() {
    this.scheduleCheck()
    this.tryConnect()
  }

  private gather() {
    if (this.gatheredGen === this.iceGen) return
    this.gatheredGen = this.iceGen
    const gen = this.iceGen
    setTimeout(() => {
      if (this.closed) return
      const init = { candidate: `candidate ${this.id} ${gen}`, sdpMid: '0', sdpMLineIndex: 0 }
      this.onicecandidate?.({ candidate: { ...init, toJSON: () => init } })
      setTimeout(() => {
        if (!this.closed) this.onicecandidate?.({ candidate: null })
      }, 0)
    }, 0)
  }

  private peer(): FakeRTCPeerConnection | null {
    const p = this.establishedWith ? registry.get(this.establishedWith) : undefined
    return p && !p.closed && p.establishedWith === this.id ? p : null
  }

  private tryConnect() {
    const peer = this.peer()
    if (!peer || this.signalingState !== 'stable' || peer.signalingState !== 'stable') return
    if (this.remoteCandidates === 0 || peer.remoteCandidates === 0) return
    for (const pc of [this, peer]) {
      if (pc.connectionState !== 'connected') {
        pc.connectionState = 'connected'
        pc.iceConnectionState = 'connected'
        pc.oniceconnectionstatechange?.({})
        pc.onconnectionstatechange?.({})
      }
    }
    this.pairChannels()
    peer.pairChannels()
  }

  private pairChannels() {
    const peer = this.peer()
    if (!peer) return
    for (const ch of this.createdChannels) {
      if (ch.peer || ch.readyState !== 'connecting') continue
      const remote = new FakeDataChannel(ch.label, { ordered: ch.ordered })
      ch.peer = remote
      remote.peer = ch
      peer.remoteChannels.push(remote)
      setTimeout(() => {
        if (peer.closed || this.closed) return
        peer.ondatachannel?.({ channel: remote })
        remote.readyState = 'open'
        ch.readyState = 'open'
        remote.onopen?.({})
        ch.onopen?.({})
      }, 0)
    }
  }

  private applyRemoteTracks(sdp: FakeSdp) {
    const listed = new Set(sdp.tracks.map((t) => t.id))
    for (const t of sdp.tracks) {
      if (this.remoteTracks.has(t.id)) continue
      let stream = this.remoteStreams.get(t.streamId)
      if (!stream) {
        stream = new FakeMediaStream([], t.streamId)
        this.remoteStreams.set(t.streamId, stream)
      }
      const track = new FakeMediaStreamTrack(t.kind as 'audio' | 'video')
      stream.addTrack(track)
      this.remoteTracks.set(t.id, { track, stream })
      this.ontrack?.({ track, streams: [stream] })
    }
    for (const [id, { track, stream }] of [...this.remoteTracks]) {
      if (listed.has(id)) continue
      this.remoteTracks.delete(id)
      stream.removeTrack(track)
      stream.onremovetrack?.({ track })
    }
  }
}

export const FakeRTCPeerConnectionImpl = FakeRTCPeerConnection as unknown as typeof RTCPeerConnection

// ---------- server link relay ----------

/**
 * A ServerLink stand-in that relays `signal` frames to its partner, in order, asynchronously.
 * `hold()` buffers deliveries until `release()`; `drop` filters frames out.
 */
export class FakeServerLink implements ServerLink {
  status: LinkStatus = 'open'
  readonly sent: Exclude<ClientToServer, { t: 'hello' }>[] = []
  partner: FakeServerLink | null = null
  drop: ((env: SealedEnvelope) => boolean) | null = null
  private held: SealedEnvelope[] | null = null
  private readonly cbs = new Set<(msg: ServerToClient) => void>()

  constructor(readonly side: Side) {}

  send(msg: Exclude<ClientToServer, { t: 'hello' }>) {
    this.sent.push(msg)
    if (msg.t !== 'signal') return
    if (this.drop?.(msg.env)) return
    if (this.held) {
      this.held.push(msg.env)
      return
    }
    const partner = this.partner
    const env = msg.env
    setTimeout(() => partner?.deliver({ t: 'signal', env }), 0)
  }

  hold() {
    this.held = []
  }

  release() {
    const held = this.held ?? []
    this.held = null
    const partner = this.partner
    setTimeout(() => {
      for (const env of held) partner?.deliver({ t: 'signal', env })
    }, 0)
  }

  /** Deliver a frame as if it came from the server. */
  deliver(msg: ServerToClient) {
    for (const cb of [...this.cbs]) cb(msg)
  }

  onMessage(cb: (msg: ServerToClient) => void) {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }
  onStatus() {
    return () => {}
  }
  setVisible() {}
  close() {}
}

export function relayPair(): { a: FakeServerLink; b: FakeServerLink } {
  const a = new FakeServerLink('a')
  const b = new FakeServerLink('b')
  a.partner = b
  b.partner = a
  return { a, b }
}
