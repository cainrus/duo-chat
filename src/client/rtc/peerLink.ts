// The direct device-to-device connection: one RTCPeerConnection per presence session,
// always with a data channel (chat), plus media tracks during calls.
// Signaling payloads are sealed with the pair key and relayed by the server as opaque blobs.
// Negotiation: "perfect negotiation" pattern; side 'b' is polite.

import type { Side } from '@shared/types'
import { otherSide } from '@shared/types'
import type { ChatMessage } from '../messages/store'
import type { Profile } from '../session/types'
import type { ServerLink } from '../net/serverLink'
import { open, seal } from '../crypto/pair'

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
  /** Tear down and restart a connection whose data channel has not opened by then. */
  connectTimeoutMs?: number
  /**
   * A peer's `restart` keeps our not-yet-open connection only while it is younger than this
   * (both sides connecting at once); an older one is stuck (a lost offer or answer) and is rebuilt.
   */
  restartGraceMs?: number
  now?: () => number
}

/** A connection whose data channel has not opened within this time is started over. */
export const CONNECT_TIMEOUT_MS = 15_000
/** See PeerLinkOptions.restartGraceMs. */
export const RESTART_GRACE_MS = 3_000

const CHANNEL_LABEL = 'chat'

const debug = (...args: unknown[]) => console.debug('[peerLink]', ...args)

/**
 * Lifecycle (how `restart` is used, on top of MDN perfect negotiation):
 * - Every fresh connection started by this side (connect(), or recovery after the
 *   connection failed) first sends `restart`, then negotiates. The peer drops a connection
 *   that was ever established (it belongs to an older session, e.g. before a reload) and
 *   starts a fresh one without sending `restart` back; a connection that never opened is
 *   kept while it is young (RESTART_GRACE_MS), so two sides connecting at once do not tear
 *   each other down; an older one that never opened is stuck and is rebuilt.
 * - A connection whose data channel has not opened within CONNECT_TIMEOUT_MS (an offer or
 *   answer got lost) is torn down and started over, announcing `restart`.
 * - An incoming offer when there is no connection creates one (the peer got there first).
 *   The polite side also recovers from an offer its connection rejects (a stale connection
 *   meeting a fresh peer) by starting over and applying the offer to the new connection.
 */
export class PeerLink {
  private readonly self: Side
  private readonly peer: Side
  private readonly polite: boolean
  private readonly key: CryptoKey
  private readonly link: ServerLink
  private readonly getIceServers: () => Promise<RTCIceServer[]>
  private readonly Impl: typeof RTCPeerConnection
  private readonly connectTimeoutMs: number
  private readonly restartGraceMs: number
  private readonly now: () => number

  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  /** Bumped on every teardown; async work started for an older connection bails out. */
  private gen = 0
  /** A connection is being created (waiting for ICE servers). */
  private creating = false
  /** The data channel of the current connection has opened at least once. */
  private everOpen = false
  private open = false
  /** When the current connection was created. */
  private createdAt = 0
  private connectTimer: ReturnType<typeof setTimeout> | null = null

  private makingOffer = false
  private ignoreOffer = false
  private pendingCandidates: RTCIceCandidateInit[] = []

  private localStream: MediaStream | null = null
  private readonly senders = new Map<string, RTCRtpSender>()
  private remoteStream: MediaStream | null = null

  /** Serializes connection creation and incoming signals. */
  private inbox: Promise<void> = Promise.resolve()
  /** Keeps outgoing signals in order across the async sealing. */
  private outbox: Promise<void> = Promise.resolve()

  private readonly dataCbs = new Set<(frame: DataFrame) => void>()
  private readonly openCbs = new Set<(open: boolean) => void>()
  private readonly remoteCbs = new Set<(stream: MediaStream | null) => void>()

  constructor(opts: PeerLinkOptions) {
    this.self = opts.self
    this.peer = otherSide(opts.self)
    this.polite = opts.self === 'b'
    this.key = opts.signalingKey
    this.link = opts.link
    this.getIceServers = opts.getIceServers
    this.Impl = opts.RTCPeerConnectionImpl ?? globalThis.RTCPeerConnection
    this.connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.restartGraceMs = opts.restartGraceMs ?? RESTART_GRACE_MS
    this.now = opts.now ?? (() => Date.now())
    this.link.onMessage((msg) => {
      if (msg.t === 'signal') this.enqueue(() => this.receive(msg.env))
    })
  }

  /** Make sure a connection with an open data channel is being established. Idempotent. */
  connect(): void {
    if (this.creating || this.alive()) return
    this.creating = true
    const gen = ++this.gen
    this.enqueue(() => this.start(gen, true))
  }

  /** Tear down the connection (peer left). */
  close(): void {
    this.gen++
    this.creating = false
    this.teardown()
  }

  get dataOpen(): boolean {
    return this.open
  }

  /** False when the data channel is not open (the caller keeps the frame for later). */
  sendData(frame: DataFrame): boolean {
    const ch = this.channel
    if (!this.open || !ch || ch.readyState !== 'open') return false
    try {
      ch.send(JSON.stringify(frame))
      return true
    } catch (err) {
      debug('send failed', err)
      return false
    }
  }

  onData(cb: (frame: DataFrame) => void): () => void {
    this.dataCbs.add(cb)
    return () => this.dataCbs.delete(cb)
  }

  onDataOpen(cb: (open: boolean) => void): () => void {
    this.openCbs.add(cb)
    return () => this.openCbs.delete(cb)
  }

  /** Add, replace or remove local media; renegotiates as needed. */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream
    if (this.pc) this.applyLocalStream(this.pc)
  }

  onRemoteStream(cb: (stream: MediaStream | null) => void): () => void {
    this.remoteCbs.add(cb)
    return () => this.remoteCbs.delete(cb)
  }

  // ---------- connection ----------

  private alive(): boolean {
    const pc = this.pc
    if (!pc) return false
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') return false
    // Established before, channel gone: the peer left or reloaded.
    if (this.everOpen && !this.open) return false
    return true
  }

  private enqueue(task: () => Promise<void>): void {
    this.inbox = this.inbox.then(task).catch((err) => debug('task failed', err))
  }

  /** Runs inside the inbox. Replaces any current connection with a fresh one. */
  private async start(gen: number, announce: boolean): Promise<void> {
    if (gen !== this.gen) return
    this.teardown()
    if (announce) this.signal({ kind: 'restart' })
    let iceServers: RTCIceServer[] = []
    try {
      iceServers = await this.getIceServers()
    } catch (err) {
      debug('no ICE servers, trying without', err)
    }
    if (gen !== this.gen) return
    this.creating = false
    const pc = new this.Impl({ iceServers })
    this.pc = pc
    this.createdAt = this.now()
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (this.pc !== pc || this.everOpen || this.creating) return
      debug('data channel did not open in time, starting over')
      this.creating = true
      const next = ++this.gen
      this.enqueue(() => this.start(next, true))
    }, this.connectTimeoutMs)

    pc.onnegotiationneeded = async () => {
      if (this.pc !== pc) return
      try {
        this.makingOffer = true
        await pc.setLocalDescription()
        if (this.pc !== pc || !pc.localDescription) return
        this.signal({ kind: 'description', description: descriptionInit(pc.localDescription) })
      } catch (err) {
        debug('offer failed', err)
      } finally {
        if (this.pc === pc) this.makingOffer = false
      }
    }
    pc.onicecandidate = (ev) => {
      if (this.pc !== pc) return
      const c = ev.candidate
      this.signal({ kind: 'candidate', candidate: c ? candidateInit(c) : null })
    }
    pc.ondatachannel = (ev) => {
      if (this.pc !== pc) return
      if (ev.channel.label === CHANNEL_LABEL) this.attachChannel(pc, ev.channel)
    }
    pc.ontrack = (ev) => {
      if (this.pc !== pc) return
      const stream = ev.streams[0]
      if (!stream) return
      stream.onremovetrack = () => {
        if (this.remoteStream === stream && stream.getTracks().length === 0) this.setRemote(null)
      }
      if (this.remoteStream !== stream) this.setRemote(stream)
    }
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.connectionState === 'failed') {
        debug('connection failed, starting over')
        this.creating = true
        const next = ++this.gen
        this.enqueue(() => this.start(next, true))
      }
    }

    if (!this.polite) this.attachChannel(pc, pc.createDataChannel(CHANNEL_LABEL, { ordered: true }))
    this.applyLocalStream(pc)
  }

  private teardown(): void {
    const pc = this.pc
    const ch = this.channel
    this.pc = null
    this.channel = null
    if (this.connectTimer !== null) clearTimeout(this.connectTimer)
    this.connectTimer = null
    this.everOpen = false
    this.makingOffer = false
    this.ignoreOffer = false
    this.pendingCandidates = []
    this.senders.clear()
    if (ch) {
      ch.onopen = null
      ch.onclose = null
      ch.onmessage = null
      try {
        ch.close()
      } catch {
        /* ignore */
      }
    }
    if (pc) {
      pc.onnegotiationneeded = null
      pc.onicecandidate = null
      pc.ondatachannel = null
      pc.ontrack = null
      pc.oniceconnectionstatechange = null
      pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        /* ignore */
      }
    }
    this.setOpen(false)
    this.setRemote(null)
  }

  private attachChannel(pc: RTCPeerConnection, ch: RTCDataChannel): void {
    if (this.channel && this.channel !== ch) {
      this.channel.onopen = null
      this.channel.onclose = null
      this.channel.onmessage = null
    }
    this.channel = ch
    const current = () => this.pc === pc && this.channel === ch
    const onOpen = () => {
      if (!current()) return
      this.everOpen = true
      this.setOpen(true)
    }
    ch.onopen = onOpen
    ch.onclose = () => {
      if (current()) this.setOpen(false)
    }
    ch.onmessage = (ev: MessageEvent) => {
      if (!current()) return
      const frame = parseFrame(ev.data)
      if (!frame) {
        debug('dropped malformed data frame')
        return
      }
      for (const cb of [...this.dataCbs]) cb(frame)
    }
    if (ch.readyState === 'open') onOpen()
  }

  private applyLocalStream(pc: RTCPeerConnection): void {
    const tracks = this.localStream?.getTracks() ?? []
    const kinds = new Set<string>()
    for (const track of tracks) {
      if (kinds.has(track.kind)) continue
      kinds.add(track.kind)
      const sender = this.senders.get(track.kind)
      if (sender) {
        if (sender.track !== track) {
          sender.replaceTrack(track).catch((err) => debug('replaceTrack failed', err))
        }
      } else {
        this.senders.set(track.kind, pc.addTrack(track, this.localStream!))
      }
    }
    for (const [kind, sender] of [...this.senders]) {
      if (kinds.has(kind)) continue
      this.senders.delete(kind)
      try {
        pc.removeTrack(sender)
      } catch (err) {
        debug('removeTrack failed', err)
      }
    }
  }

  // ---------- signaling ----------

  private signal(payload: SignalPayload): void {
    const gen = this.gen
    this.outbox = this.outbox
      .then(async () => {
        const env = await seal(this.key, this.self, payload)
        // Stale offers and candidates would only confuse the peer; `restart` always goes.
        if (payload.kind !== 'restart' && gen !== this.gen) return
        this.link.send({ t: 'signal', env })
      })
      .catch((err) => debug('seal failed', err))
  }

  private async receive(env: unknown): Promise<void> {
    let payload: SignalPayload | null
    try {
      payload = parseSignal(await open(this.key, this.peer, env as Parameters<typeof open>[2]))
    } catch (err) {
      debug('dropped envelope that does not open', err)
      return
    }
    if (!payload) {
      debug('dropped malformed signal')
      return
    }
    switch (payload.kind) {
      case 'restart':
        return this.onRestart()
      case 'description':
        return this.onDescription(payload.description, true)
      case 'candidate':
        return this.onCandidate(payload.candidate)
    }
  }

  private async onRestart(): Promise<void> {
    if (this.creating) return
    // A young connection that never opened is already fresh: keep it (both sides connecting
    // at once). An older one is stuck (its offer or answer was lost): rebuild.
    if (this.pc && !this.everOpen && this.now() - this.createdAt < this.restartGraceMs) return
    await this.start(++this.gen, false)
  }

  private async onDescription(description: RTCSessionDescriptionInit, mayRecover: boolean): Promise<void> {
    if (!this.pc) {
      if (description.type !== 'offer') return
      await this.start(++this.gen, false)
    }
    const pc = this.pc
    if (!pc) return
    const offerCollision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable')
    this.ignoreOffer = !this.polite && offerCollision
    if (this.ignoreOffer) {
      debug('ignoring colliding offer (impolite)')
      return
    }
    try {
      await pc.setRemoteDescription(description)
    } catch (err) {
      if (this.pc !== pc) return
      if (description.type === 'offer' && this.polite && mayRecover) {
        debug('offer rejected, starting a fresh connection for it', err)
        await this.start(++this.gen, false)
        return this.onDescription(description, false)
      }
      debug('setRemoteDescription failed', err)
      return
    }
    if (this.pc !== pc) return
    const queued = this.pendingCandidates
    this.pendingCandidates = []
    for (const c of queued) await this.addCandidate(pc, c)
    if (description.type === 'offer') {
      await pc.setLocalDescription()
      if (this.pc !== pc || !pc.localDescription) return
      this.signal({ kind: 'description', description: descriptionInit(pc.localDescription) })
    }
  }

  private async onCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    const pc = this.pc
    if (!pc) return
    if (candidate === null) return // end of candidates: nothing to do
    if (!pc.remoteDescription) {
      this.pendingCandidates.push(candidate)
      return
    }
    await this.addCandidate(pc, candidate)
  }

  private async addCandidate(pc: RTCPeerConnection, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await pc.addIceCandidate(candidate)
    } catch (err) {
      if (!this.ignoreOffer) debug('addIceCandidate failed', err)
    }
  }

  // ---------- events ----------

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    for (const cb of [...this.openCbs]) cb(open)
  }

  private setRemote(stream: MediaStream | null): void {
    if (this.remoteStream === stream) return
    this.remoteStream = stream
    for (const cb of [...this.remoteCbs]) cb(stream)
  }
}

function descriptionInit(d: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  return { type: d.type, sdp: d.sdp }
}

function candidateInit(c: RTCIceCandidate): RTCIceCandidateInit {
  if (typeof c.toJSON === 'function') return c.toJSON()
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parseSignal(value: unknown): SignalPayload | null {
  if (!isObject(value)) return null
  switch (value.kind) {
    case 'restart':
      return { kind: 'restart' }
    case 'description': {
      const d = value.description
      if (!isObject(d)) return null
      if (d.type !== 'offer' && d.type !== 'answer' && d.type !== 'pranswer' && d.type !== 'rollback') return null
      if (d.sdp !== undefined && typeof d.sdp !== 'string') return null
      return { kind: 'description', description: { type: d.type, sdp: d.sdp as string | undefined } }
    }
    case 'candidate': {
      const c = value.candidate
      if (c === null) return { kind: 'candidate', candidate: null }
      if (!isObject(c) || typeof c.candidate !== 'string') return null
      return { kind: 'candidate', candidate: c as RTCIceCandidateInit }
    }
    default:
      return null
  }
}

function parseFrame(data: unknown): DataFrame | null {
  if (typeof data !== 'string') return null
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  // Shape only; the message store and the session validate the content.
  if (value.t === 'msg' && isObject(value.m)) return value as DataFrame
  if (value.t === 'profile' && isObject(value.p)) return value as DataFrame
  return null
}
