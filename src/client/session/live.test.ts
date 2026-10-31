import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_TTL_MS, VIDEO_UNLOCK_MS } from '@shared/constants'
import type { ClientToServer, PushSubscriptionJSONLike, RoomView, ServerToClient } from '@shared/protocol'
import type { Side } from '@shared/types'
import { derivePairKeys, generatePairSecret, secretFromHash } from '../crypto/pair'
import type { DeviceConfig, DeviceConfigStore } from '../device/config'
import type { MessagePersistence, StoredMessage } from '../messages/store'
import type { LinkStatus, ServerLink } from '../net/serverLink'
import type { DataFrame } from '../rtc/peerLink'
import { ACK_RESEND_MS, createLiveSession, DIRECT_RETRY_MS, ERROR_TTL_MS, type LiveDeps, type LiveSession, type PageEnv, type PeerLinkLike } from './live'
import type { Profile } from './types'

// ---------- fakes ----------

type Out = Exclude<ClientToServer, { t: 'hello' }>

class FakeLink implements ServerLink {
  status: LinkStatus = 'connecting'
  readonly sent: Out[] = []
  visible: boolean[] = []
  closed = false
  private msgCbs = new Set<(m: ServerToClient) => void>()
  private statusCbs = new Set<(s: LinkStatus) => void>()
  constructor(readonly opts: { wsBase: string; roomId: string; deviceToken: string }) {}
  send(m: Out) {
    this.sent.push(m)
  }
  onMessage(cb: (m: ServerToClient) => void) {
    this.msgCbs.add(cb)
    return () => this.msgCbs.delete(cb)
  }
  onStatus(cb: (s: LinkStatus) => void) {
    this.statusCbs.add(cb)
    return () => this.statusCbs.delete(cb)
  }
  setVisible(v: boolean) {
    this.visible.push(v)
  }
  close() {
    this.closed = true
  }
  deliver(m: ServerToClient) {
    for (const cb of [...this.msgCbs]) cb(m)
  }
  setStatus(s: LinkStatus) {
    this.status = s
    for (const cb of [...this.statusCbs]) cb(s)
  }
  sentOf<T extends Out['t']>(t: T) {
    return this.sent.filter((m) => m.t === t)
  }
}

class FakePeer implements PeerLinkLike {
  dataOpen = false
  connects = 0
  closes = 0
  /** Frames handed to the data channel. */
  readonly out: DataFrame[] = []
  localStreams: (MediaStream | null)[] = []
  /** Track kinds of each setLocalStream call, as they were at that moment. */
  localKinds: string[][] = []
  /** When set, sendData fails after this many frames. */
  capacity = Infinity
  private dataCbs = new Set<(f: DataFrame) => void>()
  private openCbs = new Set<(o: boolean) => void>()
  private remoteCbs = new Set<(s: MediaStream | null) => void>()
  constructor(readonly opts: { self: Side; getIceServers: () => Promise<RTCIceServer[]> }) {}
  connect() {
    this.connects++
  }
  close() {
    this.closes++
    this.setOpen(false)
  }
  sendData(f: DataFrame) {
    if (!this.dataOpen || this.out.length >= this.capacity) return false
    this.out.push(structuredClone(f))
    return true
  }
  onData(cb: (f: DataFrame) => void) {
    this.dataCbs.add(cb)
    return () => this.dataCbs.delete(cb)
  }
  onDataOpen(cb: (o: boolean) => void) {
    this.openCbs.add(cb)
    return () => this.openCbs.delete(cb)
  }
  setLocalStream(s: MediaStream | null) {
    this.localStreams.push(s)
    this.localKinds.push(s ? s.getTracks().map((t) => t.kind) : [])
  }
  onRemoteStream(cb: (s: MediaStream | null) => void) {
    this.remoteCbs.add(cb)
    return () => this.remoteCbs.delete(cb)
  }
  setOpen(o: boolean) {
    if (this.dataOpen === o) return
    this.dataOpen = o
    for (const cb of [...this.openCbs]) cb(o)
  }
  receive(f: DataFrame) {
    for (const cb of [...this.dataCbs]) cb(f)
  }
  remote(s: MediaStream | null) {
    for (const cb of [...this.remoteCbs]) cb(s)
  }
}

class Track {
  enabled = true
  readyState: 'live' | 'ended' = 'live'
  constructor(readonly kind: 'audio' | 'video') {}
  stop() {
    this.readyState = 'ended'
  }
}

class Stream {
  private tracks: Track[]
  constructor(tracks: Track[]) {
    this.tracks = tracks
  }
  getTracks() {
    return [...this.tracks]
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  addTrack(t: Track) {
    this.tracks.push(t)
  }
  removeTrack(t: Track) {
    this.tracks = this.tracks.filter((x) => x !== t)
  }
}

const memoryConfig = (initial: DeviceConfig | null = null) => {
  let value = initial ? structuredClone(initial) : null
  const store: DeviceConfigStore & { value: () => DeviceConfig | null } = {
    load: async () => (value ? structuredClone(value) : null),
    save: async (c) => {
      value = structuredClone(c)
    },
    clear: async () => {
      value = null
    },
    value: () => value,
  }
  return store
}

const memoryMessages = (initial: StoredMessage[] = []): MessagePersistence & { saved: StoredMessage[] } => {
  const p = {
    saved: structuredClone(initial),
    load: async () => structuredClone(p.saved),
    save: async (all: StoredMessage[]) => {
      p.saved = structuredClone(all)
    },
  }
  return p
}

const ME: Profile = { name: 'Маша', avatar: 'bunny' }
const FRIEND: Profile = { name: 'Соня', avatar: 'fox' }
const T0 = 1_800_000_000_000

const view = (over: Partial<RoomView> = {}): RoomView => ({
  self: 'a',
  peerPaired: true,
  peerPresent: true,
  call: { kind: 'ready' },
  ping: { kind: 'ready' },
  incoming: false,
  outgoing: null,
  inCall: false,
  ...over,
})

type Harness = {
  session: LiveSession
  links: FakeLink[]
  peers: FakePeer[]
  config: ReturnType<typeof memoryConfig>
  messages: ReturnType<typeof memoryMessages>
  fetchCalls: { url: string; init?: RequestInit }[]
  media: { constraints: MediaStreamConstraints[]; streams: Stream[]; fail: Error | null }
  page: { visible: boolean; emit: (v: boolean) => void; leave: () => void; search: string; click: (url: string) => void }
  push: { subs: PushSubscriptionJSONLike[] }
  clock: { now: number }
  link: () => FakeLink
  peer: () => FakePeer
}

async function paired(side: Side = 'a') {
  const secret = generatePairSecret()
  const { encodeSecret } = await import('../crypto/pair')
  const config: DeviceConfig = { secret: encodeSecret(secret), side, deviceToken: 'tok-' + side, me: ME, peer: null }
  return { secret, config }
}

function harness(opts: {
  config?: DeviceConfig | null
  messages?: StoredMessage[]
  search?: string
  fetch?: (url: string, init?: RequestInit) => Response
  currentSub?: PushSubscriptionJSONLike | null
} = {}): Harness {
  const links: FakeLink[] = []
  const peers: FakePeer[] = []
  const config = memoryConfig(opts.config ?? null)
  const messages = memoryMessages(opts.messages)
  const fetchCalls: Harness['fetchCalls'] = []
  const media: Harness['media'] = { constraints: [], streams: [], fail: null }
  const clock = { now: T0 }
  const visCbs = new Set<(v: boolean) => void>()
  const clickCbs = new Set<(u: string) => void>()
  const leaveCbs = new Set<() => void>()
  const pageState = {
    visible: true,
    search: opts.search ?? '',
    emit: (v: boolean) => {
      pageState.visible = v
      for (const cb of visCbs) cb(v)
    },
    click: (u: string) => {
      for (const cb of clickCbs) cb(u)
    },
    /** pagehide: the browser fires it, then the page is hidden. */
    leave: () => {
      for (const cb of leaveCbs) cb()
      pageState.emit(false)
    },
  }
  const page: PageEnv = {
    isVisible: () => pageState.visible,
    onVisibility: (cb) => {
      visCbs.add(cb)
      return () => visCbs.delete(cb)
    },
    takeLaunchSearch: () => {
      const s = pageState.search
      pageState.search = ''
      return s
    },
    onNotificationClick: (cb) => {
      clickCbs.add(cb)
      return () => clickCbs.delete(cb)
    },
    onLeave: (cb) => {
      leaveCbs.add(cb)
      return () => leaveCbs.delete(cb)
    },
  }
  const push = { subs: [] as PushSubscriptionJSONLike[] }
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (opts.fetch) return opts.fetch(url, init)
    if (url.endsWith('/claim')) {
      const side = JSON.parse(String(init?.body)).side as Side
      return new Response(JSON.stringify({ side, deviceToken: 'token-' + side }), { status: 200 })
    }
    if (url.endsWith('/ice')) return new Response(JSON.stringify({ iceServers: [{ urls: 'turn:x' }] }), { status: 200 })
    return new Response('nope', { status: 404 })
  }) as typeof fetch

  const deps: Partial<LiveDeps> = {
    apiBase: 'https://duo.test',
    wsBase: 'wss://duo.test',
    origin: 'https://duo.test',
    fetch: fetcher,
    config,
    messages,
    connectServerLink: (o) => {
      const l = new FakeLink(o)
      links.push(l)
      return l
    },
    createPeerLink: (o) => {
      const p = new FakePeer(o)
      peers.push(p)
      return p
    },
    getUserMedia: async (c) => {
      media.constraints.push(c)
      if (media.fail) throw media.fail
      const tracks: Track[] = []
      if (c.audio) tracks.push(new Track('audio'))
      if (c.video) tracks.push(new Track('video'))
      const s = new Stream(tracks)
      media.streams.push(s)
      return s as unknown as MediaStream
    },
    page,
    push: {
      request: async (onSub) => {
        const sub = { endpoint: 'https://push.test/1', keys: { p256dh: 'p', auth: 'a' } }
        push.subs.push(sub)
        onSub(sub)
        return 'granted'
      },
      current: async () => opts.currentSub ?? null,
    },
    now: () => clock.now,
  }
  const session = createLiveSession({ deps })
  return {
    session,
    links,
    peers,
    config,
    messages,
    fetchCalls,
    media,
    page: pageState,
    push,
    clock,
    link: () => links.at(-1)!,
    peer: () => peers.at(-1)!,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

let h: Harness | null = null
afterEach(() => {
  h?.session.dispose()
  h = null
  vi.useRealTimers()
})

// ---------- tests ----------

describe('live session: pairing', () => {
  it('starts in setup when the device is not paired', async () => {
    h = harness()
    await h.session.ready
    expect(h.session.state.phase).toBe('setup')
    expect(h.links).toHaveLength(0)
  })

  it('createPair claims slot a with the admin secret, saves the config and returns the link', async () => {
    h = harness()
    const { link } = await h.session.createPair({ adminSecret: 'adm1n', me: ME })
    const claim = h.fetchCalls.find((c) => c.url.endsWith('/claim'))!
    expect(claim.init?.method).toBe('POST')
    expect(JSON.parse(String(claim.init?.body))).toEqual({ side: 'a' })
    expect((claim.init?.headers as Record<string, string>).Authorization).toBe('Bearer adm1n')

    expect(link.startsWith('https://duo.test/#pair=')).toBe(true)
    const secret = secretFromHash(link.slice(link.indexOf('#')))!
    const { roomId } = await derivePairKeys(secret)
    expect(claim.url).toBe(`https://duo.test/api/rooms/${roomId}/claim`)
    // The secret never goes to the server.
    expect(claim.url + String(claim.init?.body)).not.toContain(link.split('#pair=')[1])

    expect(h.config.value()).toMatchObject({ side: 'a', deviceToken: 'token-a', me: ME, peer: null })
    expect(h.session.state.phase).toBe('ready')
    expect(h.session.state.self).toBe('a')
    expect(h.session.state.me).toEqual(ME)
    expect(h.link().opts).toEqual({ wsBase: 'wss://duo.test', roomId, deviceToken: 'token-a' })
    expect(h.link().visible).toEqual([true])
  })

  it('joinPair claims slot b without auth', async () => {
    h = harness()
    const secret = generatePairSecret()
    await h.session.joinPair({ secret, me: ME })
    const claim = h.fetchCalls.find((c) => c.url.endsWith('/claim'))!
    expect(JSON.parse(String(claim.init?.body))).toEqual({ side: 'b' })
    expect((claim.init?.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(h.session.state.self).toBe('b')
    expect(h.peer().opts.self).toBe('b')
  })

  it('pairing errors are thrown in Russian and leave the device in setup', async () => {
    h = harness({ fetch: () => new Response('full', { status: 409 }) })
    await expect(h.session.joinPair({ secret: generatePairSecret(), me: ME })).rejects.toThrow(/уже использована/)
    expect(h.session.state.phase).toBe('setup')
    expect(h.config.value()).toBeNull()
  })

  it('a stored pairing starts the session on load', async () => {
    const { config } = await paired('b')
    h = harness({ config: { ...config, peer: FRIEND } })
    await h.session.ready
    expect(h.session.state).toMatchObject({ phase: 'ready', self: 'b', me: ME, peer: FRIEND })
    expect(h.link().opts.deviceToken).toBe('tok-b')
  })

  it('a revoked device goes back to setup and forgets the pairing', async () => {
    const { config } = await paired()
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'error', code: 'unauthorized' })
    await flush()
    expect(h.session.state.phase).toBe('setup')
    expect(h.session.state.error).toMatch(/отключено/)
    expect(h.link().closed).toBe(true)
    expect(h.config.value()).toBeNull()
  })
})

describe('live session: server link', () => {
  let config: DeviceConfig
  beforeEach(async () => {
    config = (await paired()).config
  })

  it('maps link status to connection and views to state', async () => {
    h = harness({ config })
    await h.session.ready
    expect(h.session.state.connection).toBe('connecting')
    h.link().setStatus('open')
    expect(h.session.state.connection).toBe('online')
    const v = view({ ping: { kind: 'exhausted', until: T0 + 5 } })
    h.link().deliver({ t: 'view', view: v })
    expect(h.session.state.view).toEqual(v)
    h.link().setStatus('closed')
    expect(h.session.state.connection).toBe('offline')
  })

  it('reports visibility changes', async () => {
    h = harness({ config })
    await h.session.ready
    h.page.emit(false)
    h.page.emit(true)
    expect(h.link().visible).toEqual([true, false, true])
  })

  it('nudge sets nudgeAt; ping sends a ping frame', async () => {
    h = harness({ config })
    await h.session.ready
    h.clock.now = T0 + 42
    h.link().deliver({ t: 'nudge' })
    expect(h.session.state.nudgeAt).toBe(T0 + 42)
    h.session.ping()
    expect(h.link().sentOf('ping')).toHaveLength(1)
    expect(h.session.state.lastPing).toBeNull()
    h.clock.now = T0 + 50
    h.link().deliver({ t: 'pingResult', result: 'held' })
    expect(h.session.state.lastPing).toEqual({ result: 'held', at: T0 + 50 })
  })

  it('connects the direct link while the friend is present and closes it when she is gone', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view({ peerPresent: false }) })
    expect(h.peer().connects).toBe(0)
    h.link().deliver({ t: 'view', view: view() })
    expect(h.peer().connects).toBe(1)
    h.peer().setOpen(true)
    expect(h.session.state.directOpen).toBe(true)
    h.link().deliver({ t: 'view', view: view({ peerPresent: false }) })
    expect(h.peer().closes).toBe(1)
    expect(h.session.state.directOpen).toBe(false)
    // Not closed again while she stays away.
    h.link().deliver({ t: 'view', view: view({ peerPresent: false }) })
    expect(h.peer().closes).toBe(1)
  })

  it('keeps calling connect() while the friend is here and the direct link is not open', async () => {
    vi.useFakeTimers({ now: T0 })
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    expect(h.peer().connects).toBe(1)
    vi.advanceTimersByTime(DIRECT_RETRY_MS)
    expect(h.peer().connects).toBe(2)
    vi.advanceTimersByTime(DIRECT_RETRY_MS)
    expect(h.peer().connects).toBe(3)
    h.peer().setOpen(true)
    vi.advanceTimersByTime(3 * DIRECT_RETRY_MS)
    expect(h.peer().connects).toBe(3)
    h.peer().setOpen(false)
    h.link().deliver({ t: 'view', view: view({ peerPresent: false }) })
    vi.advanceTimersByTime(3 * DIRECT_RETRY_MS)
    expect(h.peer().connects).toBe(3)
  })

  it('closes the direct link when the page goes away, and reconnects when it is shown again', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    h.peer().setOpen(true)
    const connects = h.peer().connects
    h.page.leave()
    // The friend's channel closes now instead of after ICE gives up (~15 s).
    expect(h.peer().closes).toBe(1)
    expect(h.session.state.directOpen).toBe(false)
    // Restored from the back/forward cache (pageshow): connect again without waiting.
    h.page.emit(true)
    expect(h.peer().connects).toBe(connects + 1)
  })

  it('merely hidden (another tab) keeps the direct link', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    h.peer().setOpen(true)
    h.page.emit(false)
    expect(h.peer().closes).toBe(0)
    expect(h.session.state.directOpen).toBe(true)
  })

  it('does not connect to a friend who has not paired yet', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view({ peerPaired: false, peerPresent: false }) })
    expect(h.peer().connects).toBe(0)
  })

  it('fetches ICE servers with the device token', async () => {
    h = harness({ config })
    await h.session.ready
    const servers = await h.peer().opts.getIceServers()
    expect(servers).toEqual([{ urls: 'turn:x' }])
    const call = h.fetchCalls.find((c) => c.url.endsWith('/ice'))!
    expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-a')
  })

  it('re-sends an existing push subscription on start; enableNotifications sends a new one', async () => {
    const sub = { endpoint: 'https://push.test/old', keys: { p256dh: 'p', auth: 'a' } }
    h = harness({ config, currentSub: sub })
    await h.session.ready
    await flush()
    expect(h.link().sentOf('pushSubscribe')).toEqual([{ t: 'pushSubscribe', sub }])
    expect(await h.session.enableNotifications()).toBe('granted')
    expect(h.link().sentOf('pushSubscribe')).toHaveLength(2)
  })

  it('a subscription made before pairing is sent once the link exists', async () => {
    h = harness()
    await h.session.ready
    expect(await h.session.enableNotifications()).toBe('granted')
    await h.session.joinPair({ secret: generatePairSecret(), me: ME })
    expect(h.link().sentOf('pushSubscribe')).toEqual([{ t: 'pushSubscribe', sub: h.push.subs[0] }])
  })
})

describe('live session: messages', () => {
  let config: DeviceConfig
  beforeEach(async () => {
    config = (await paired()).config
  })

  it('queues while the friend is away and flushes the outbox when the data channel opens', async () => {
    h = harness({ config })
    await h.session.ready
    h.session.sendText(' привет ')
    h.clock.now++
    h.session.sendText('🦄')
    expect(h.session.state.messages.map((m) => m.text)).toEqual(['привет', '🦄'])
    expect(h.peer().out).toEqual([])
    expect(h.link().sentOf('replied')).toHaveLength(2)

    expect(h.session.state.pendingIds).toEqual(h.session.state.messages.map((m) => m.id))

    h.peer().setOpen(true)
    expect(h.peer().out[0]).toEqual({ t: 'profile', p: ME })
    expect(h.peer().out.slice(1).map((f) => f.t === 'msg' && f.m.text)).toEqual(['привет', '🦄'])
    // Handed to the channel is not delivered: still pending until the friend acks.
    expect(h.session.state.pendingIds).toEqual(h.session.state.messages.map((m) => m.id))
    h.peer().receive({ t: 'ack', ids: h.session.state.messages.map((m) => m.id) })
    expect(h.session.state.pendingIds).toEqual([])
    // Acked: reopening does not resend.
    h.peer().setOpen(false)
    h.peer().setOpen(true)
    expect(h.peer().out.filter((f) => f.t === 'msg')).toHaveLength(2)
  })

  it('keeps what did not fit for the next open', async () => {
    h = harness({ config })
    await h.session.ready
    h.session.sendText('one')
    h.clock.now++
    h.session.sendText('two')
    h.peer().capacity = 2 // profile + one message
    h.peer().setOpen(true)
    expect(h.peer().out.filter((f) => f.t === 'msg')).toHaveLength(1)
    h.peer().receive({ t: 'ack', ids: [h.session.state.messages[0]!.id] })
    expect(h.session.state.pendingIds).toEqual([h.session.state.messages[1]!.id])
    h.peer().capacity = Infinity
    h.peer().setOpen(false)
    h.peer().setOpen(true)
    expect(h.peer().out.filter((f) => f.t === 'msg').map((f) => f.t === 'msg' && f.m.text)).toEqual(['one', 'two'])
  })

  it('sends at once when the channel is open, and always tells the server "replied"', async () => {
    h = harness({ config })
    await h.session.ready
    h.peer().setOpen(true)
    h.session.sendText('hi')
    expect(h.peer().out.at(-1)).toMatchObject({ t: 'msg', m: { text: 'hi', from: 'a', sentAt: T0 } })
    expect(h.session.state.pendingIds).toEqual([h.session.state.messages[0]!.id])
    h.peer().receive({ t: 'ack', ids: [h.session.state.messages[0]!.id] })
    expect(h.session.state.pendingIds).toEqual([])
    expect(h.link().sentOf('replied')).toHaveLength(1)
  })

  it('a message sent into a channel that silently died stays pending and goes again on the next open', async () => {
    h = harness({ config })
    await h.session.ready
    h.peer().setOpen(true)
    h.session.sendText('потеряется')
    const id = h.session.state.messages[0]!.id
    // The friend's page is gone; our channel still looked open, the frame vanished.
    expect(h.session.state.pendingIds).toEqual([id])
    h.peer().setOpen(false)
    expect(h.session.state.pendingIds).toEqual([id])
    h.peer().setOpen(true)
    const msgs = () => h!.peer().out.filter((f) => f.t === 'msg')
    expect(msgs()).toHaveLength(2)
    expect(msgs()[1]).toMatchObject({ t: 'msg', m: { id, text: 'потеряется' } })
    h.peer().receive({ t: 'ack', ids: [id] })
    expect(h.session.state.pendingIds).toEqual([])
    h.peer().setOpen(false)
    h.peer().setOpen(true)
    expect(msgs()).toHaveLength(2)
  })

  it('resends unacked messages while the channel stays open', async () => {
    vi.useFakeTimers({ now: T0 })
    h = harness({ config })
    await h.session.ready
    h.peer().setOpen(true)
    h.session.sendText('эй')
    const id = h.session.state.messages[0]!.id
    const msgs = () => h!.peer().out.filter((f) => f.t === 'msg')
    expect(msgs()).toHaveLength(1)
    h.clock.now += ACK_RESEND_MS - 1
    vi.advanceTimersByTime(ACK_RESEND_MS - 1)
    expect(msgs()).toHaveLength(1)
    h.clock.now += 1
    vi.advanceTimersByTime(1)
    expect(msgs()).toHaveLength(2)
    h.peer().receive({ t: 'ack', ids: [id] })
    h.clock.now += ACK_RESEND_MS * 3
    vi.advanceTimersByTime(ACK_RESEND_MS * 3)
    expect(msgs()).toHaveLength(2)
    expect(h.session.state.pendingIds).toEqual([])
  })

  it('acks every message it receives, duplicates and expired ones too, but not malformed ones', async () => {
    h = harness({ config })
    await h.session.ready
    h.peer().setOpen(true)
    const acks = () => h!.peer().out.filter((f) => f.t === 'ack').flatMap((f) => (f.t === 'ack' ? f.ids : []))
    h.peer().receive({ t: 'msg', m: { id: 'm1', from: 'b', text: 'йо', sentAt: T0 } })
    h.peer().receive({ t: 'msg', m: { id: 'm1', from: 'b', text: 'йо', sentAt: T0 } })
    h.peer().receive({ t: 'msg', m: { id: 'old', from: 'b', text: 'old', sentAt: T0 - MESSAGE_TTL_MS - 1 } })
    h.peer().receive({ t: 'msg', m: { id: 42, from: 'b', text: 'bad', sentAt: T0 } as unknown as never })
    expect(acks()).toEqual(['m1', 'm1', 'old'])
    expect(h.session.state.messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('an ack for an unknown or foreign id changes nothing', async () => {
    h = harness({ config })
    await h.session.ready
    h.peer().setOpen(true)
    h.session.sendText('мой')
    h.peer().receive({ t: 'ack', ids: ['nope'] })
    expect(h.session.state.pendingIds).toEqual([h.session.state.messages[0]!.id])
  })

  it('ignores empty text and reports too long text', async () => {
    h = harness({ config })
    await h.session.ready
    h.session.sendText('   ')
    h.session.sendText('x'.repeat(5000))
    expect(h.session.state.messages).toEqual([])
    expect(h.link().sentOf('replied')).toHaveLength(0)
    expect(h.session.state.error).toMatch(/длинное/)
    h.session.dismissError()
    expect(h.session.state.error).toBeNull()
  })

  it('receives messages and the friend profile (saved to the device config)', async () => {
    h = harness({ config })
    await h.session.ready
    h.peer().receive({ t: 'msg', m: { id: 'm1', from: 'b', text: 'йо', sentAt: T0 - 1000 } })
    h.peer().receive({ t: 'msg', m: { id: 'm2', from: 'a', text: 'spoof', sentAt: T0 } })
    expect(h.session.state.messages.map((m) => m.text)).toEqual(['йо'])
    h.peer().receive({ t: 'profile', p: FRIEND })
    expect(h.session.state.peer).toEqual(FRIEND)
    await flush()
    expect(h.config.value()?.peer).toEqual(FRIEND)
    h.peer().receive({ t: 'profile', p: { name: 'x', avatar: 'dragon' } as unknown as Profile })
    expect(h.session.state.peer).toEqual(FRIEND)
  })

  it("answers the friend's first profile on a channel with ours, once per open", async () => {
    h = harness({ config })
    await h.session.ready
    const profiles = () => h!.peer().out.filter((f) => f.t === 'profile')
    h.peer().setOpen(true)
    expect(profiles()).toEqual([{ t: 'profile', p: ME }])
    h.peer().receive({ t: 'profile', p: FRIEND })
    expect(profiles()).toHaveLength(2)
    h.peer().receive({ t: 'profile', p: FRIEND })
    expect(profiles()).toHaveLength(2)
    // A new channel: open sends it, and the first profile from her is answered again.
    h.peer().setOpen(false)
    h.peer().setOpen(true)
    expect(profiles()).toHaveLength(3)
    h.peer().receive({ t: 'profile', p: FRIEND })
    expect(profiles()).toHaveLength(4)
    expect(profiles().every((f) => f.t === 'profile' && f.p.name === ME.name)).toBe(true)
  })

  it('sends the profile again when it changes while the channel is open', async () => {
    h = harness({ config })
    await h.session.ready
    const profiles = () => h!.peer().out.filter((f) => f.t === 'profile')
    h.session.state.me = { name: 'Маша', avatar: 'cat' }
    expect(profiles()).toEqual([])
    h.peer().setOpen(true)
    expect(profiles()).toEqual([{ t: 'profile', p: { name: 'Маша', avatar: 'cat' } }])
    h.session.state.me = { name: 'Мария', avatar: 'cat' }
    expect(profiles().at(-1)).toEqual({ t: 'profile', p: { name: 'Мария', avatar: 'cat' } })
    expect(profiles()).toHaveLength(2)
  })

  it('removes a message when its hour is over', async () => {
    vi.useFakeTimers({ now: T0 })
    h = harness({ config })
    h.clock.now = T0
    await h.session.ready
    h.session.sendText('скоро исчезнет')
    expect(h.session.state.messages).toHaveLength(1)
    h.clock.now = T0 + MESSAGE_TTL_MS
    vi.advanceTimersByTime(MESSAGE_TTL_MS)
    expect(h.session.state.messages).toEqual([])
  })

  it('loads unexpired messages from the device', async () => {
    const stored: StoredMessage[] = [
      { id: 'old', from: 'b', text: 'old', sentAt: T0 - MESSAGE_TTL_MS - 1, expiresAt: T0 - 1, pending: false },
      { id: 'new', from: 'b', text: 'new', sentAt: T0 - 10, expiresAt: T0 - 10 + MESSAGE_TTL_MS, pending: false },
    ]
    h = harness({ config, messages: stored })
    await h.session.ready
    expect(h.session.state.messages.map((m) => m.id)).toEqual(['new'])
  })
})

describe('live session: call switch', () => {
  let config: DeviceConfig
  beforeEach(async () => {
    config = (await paired()).config
  })

  async function ready() {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    return h
  }

  /** The server reports the call connected; waits for the microphone. */
  async function connected(h: Harness) {
    h.link().deliver({ t: 'view', view: view({ inCall: true }) })
    await flush()
  }

  const ended = (s: Stream) => s.getTracks().every((t) => t.readyState === 'ended')

  it('caller: AUDIO calls; ringing opens no microphone; connected opens audio only; the end stops it and resets both switches', async () => {
    const h = await ready()
    await h.session.setMode('audio')
    expect(h.link().sentOf('call')).toEqual([{ t: 'call' }])
    expect(h.session.state.myMode).toBe('audio')
    expect(h.session.state.videoUnlockAt).toBe(T0 + VIDEO_UNLOCK_MS)
    h.link().deliver({ t: 'view', view: view({ outgoing: { until: T0 + 1 } }) })
    await flush()
    // No mic light while it only rings.
    expect(h.media.constraints).toEqual([])
    expect(h.session.state.media.local).toBeNull()
    expect(h.session.state.peerMode).toBe('off')

    await connected(h)
    expect(h.media.constraints).toEqual([{ audio: expect.anything(), video: false }])
    const stream = h.media.streams[0]!
    expect(h.session.state.media.local).toBe(stream)
    expect(h.session.state).toMatchObject({ myMode: 'audio', peerMode: 'audio' })
    expect(h.session.state.media.videoOn).toBe(false)
    expect(h.peer().localKinds).toEqual([['audio']])

    h.link().deliver({ t: 'callEnded', reason: 'hangup' })
    expect(ended(stream)).toBe(true)
    expect(h.peer().localStreams.at(-1)).toBeNull()
    expect(h.session.state.media.local).toBeNull()
    expect(h.session.state).toMatchObject({ myMode: 'off', peerMode: 'off', videoUnlockAt: null })
    expect(h.session.state.lastCallEnded).toBe('hangup')
    h.session.dismissCallEnded()
    expect(h.session.state.lastCallEnded).toBeNull()
  })

  it('callee: her call shows her on AUDIO; our AUDIO joins without the mic; the mic opens once connected; OFF ends it', async () => {
    const h = await ready()
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    expect(h.session.state.peerMode).toBe('audio')
    await h.session.setMode('audio')
    expect(h.link().sentOf('callAccept')).toHaveLength(1)
    expect(h.link().sentOf('call')).toEqual([])
    await flush()
    expect(h.media.constraints).toEqual([])

    await connected(h)
    const stream = h.media.streams[0]!
    expect(h.peer().localStreams).toEqual([stream])
    expect(h.session.state.missedCall).toBeNull()

    await h.session.setMode('off')
    expect(h.link().sentOf('callEnd')).toHaveLength(1)
    expect(ended(stream)).toBe(true)
    expect(h.session.state.myMode).toBe('off')
    h.link().deliver({ t: 'callEnded', reason: 'hangup' })
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.missedCall).toBeNull()
    expect(h.session.state.peerMode).toBe('off')
  })

  it('her call that stops ringing puts her back to OFF', async () => {
    const h = await ready()
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    h.link().deliver({ t: 'callEnded', reason: 'timeout' })
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.peerMode).toBe('off')
  })

  it('OFF while ringing cancels; it never touched the mic', async () => {
    const h = await ready()
    await h.session.setMode('audio')
    h.link().deliver({ t: 'view', view: view({ outgoing: { until: T0 + 1 } }) })
    await h.session.setMode('off')
    expect(h.link().sentOf('callCancel')).toHaveLength(1)
    expect(h.session.state.myMode).toBe('off')
    expect(h.media.constraints).toEqual([])
  })

  it('our call that rings out unanswered puts our switch back to OFF', async () => {
    const h = await ready()
    await h.session.setMode('audio')
    h.link().deliver({ t: 'view', view: view({ outgoing: { until: T0 + 1 } }) })
    h.link().deliver({ t: 'callEnded', reason: 'timeout' })
    h.link().deliver({ t: 'view', view: view({ call: { kind: 'ready' } }) })
    expect(h.session.state).toMatchObject({ myMode: 'off', videoUnlockAt: null })
  })

  it('a refused call puts our switch back to OFF', async () => {
    const h = await ready()
    await h.session.setMode('audio')
    h.link().deliver({ t: 'error', code: 'not-allowed' })
    expect(h.session.state.myMode).toBe('off')
    expect(h.session.state.error).toBeTruthy()
  })

  it('from OFF, VIDEO is not allowed', async () => {
    const h = await ready()
    await h.session.setMode('video')
    expect(h.link().sentOf('call')).toEqual([])
    expect(h.session.state.myMode).toBe('off')
  })

  it('VIDEO stays locked for VIDEO_UNLOCK_MS after OFF -> AUDIO', async () => {
    const h = await ready()
    await h.session.setMode('audio')
    h.clock.now = T0 + VIDEO_UNLOCK_MS - 1
    await h.session.setMode('video')
    expect(h.session.state.myMode).toBe('audio')
    h.clock.now = T0 + VIDEO_UNLOCK_MS
    await h.session.setMode('video')
    expect(h.session.state.myMode).toBe('video')
  })

  it('does not call while the button is locked, or before she has paired', async () => {
    const h = await ready()
    h.link().deliver({ t: 'view', view: view({ call: { kind: 'cooldown', until: T0 + 1 } }) })
    await h.session.setMode('audio')
    h.link().deliver({ t: 'view', view: view({ call: { kind: 'nobodyHome', until: T0 + 1 } }) })
    await h.session.setMode('audio')
    h.link().deliver({ t: 'view', view: view({ peerPaired: false }) })
    await h.session.setMode('audio')
    expect(h.link().sentOf('call')).toEqual([])
    expect(h.session.state.myMode).toBe('off')
  })

  it('a call that ends without a callEnded frame (socket dropped) still stops tracks', async () => {
    const h = await ready()
    await connected(h)
    h.link().deliver({ t: 'view', view: view() })
    expect(ended(h.media.streams[0]!)).toBe(true)
    expect(h.session.state.media.local).toBeNull()
    expect(h.session.state.myMode).toBe('off')
  })

  it('a call that ends while the mic is being opened releases it at once', async () => {
    const h = await ready()
    h.link().deliver({ t: 'view', view: view({ inCall: true }) })
    h.link().deliver({ t: 'view', view: view() })
    await flush()
    expect(ended(h.media.streams[0]!)).toBe(true)
    expect(h.peer().localStreams).toEqual([])
    expect(h.session.state.media.local).toBeNull()
  })

  it('mic denied when the call connects: a short Russian error and the call ends cleanly', async () => {
    const h = await ready()
    h.media.fail = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    await connected(h)
    expect(h.session.state.error).toMatch(/Нет доступа/)
    expect(h.link().sentOf('callEnd')).toHaveLength(1)
    expect(h.session.state.myMode).toBe('off')
    expect(h.peer().localStreams).toEqual([])
    // Another view of the same call does not ask again.
    await connected(h)
    expect(h.media.constraints).toHaveLength(1)
  })

  it('a media error clears once the mic works, and on dismiss', async () => {
    const h = await ready()
    h.media.fail = Object.assign(new Error('busy'), { name: 'NotReadableError' })
    await connected(h)
    expect(h.session.state.error).toMatch(/заняты/)
    h.link().deliver({ t: 'callEnded', reason: 'hangup' })
    h.link().deliver({ t: 'view', view: view() })

    h.media.fail = null
    await connected(h)
    expect(h.session.state.error).toBeNull()
    await h.session.setMode('off')
    h.link().deliver({ t: 'view', view: view() })

    h.media.fail = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    await connected(h)
    expect(h.session.state.error).toMatch(/Нет доступа/)
    h.session.dismissError()
    expect(h.session.state.error).toBeNull()
  })

  it('an error clears itself after a few seconds', async () => {
    vi.useFakeTimers({ now: T0 })
    const h = await ready()
    h.media.fail = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    h.link().deliver({ t: 'view', view: view({ inCall: true }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.session.state.error).toMatch(/Нет доступа/)
    vi.advanceTimersByTime(ERROR_TTL_MS - 1)
    expect(h.session.state.error).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(h.session.state.error).toBeNull()
  })

  it('remote stream goes to state', async () => {
    const h = await ready()
    const remote = new Stream([new Track('audio')]) as unknown as MediaStream
    h.peer().remote(remote)
    expect(h.session.state.media.remote).toBe(remote)
  })
})

describe('live session: video needs both switches on VIDEO', () => {
  let config: DeviceConfig
  beforeEach(async () => {
    config = (await paired()).config
  })

  /** Joined her call (so VIDEO unlocks after VIDEO_UNLOCK_MS), channel open, connected. */
  async function inCall() {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    h.peer().setOpen(true)
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    await h.session.setMode('audio')
    h.link().deliver({ t: 'view', view: view({ inCall: true }) })
    await flush()
    h.clock.now = T0 + VIDEO_UNLOCK_MS
    return h
  }

  const modeFrames = (h: Harness) => h.peer().out.filter((f) => f.t === 'mode')

  it('only ours on VIDEO: she is told, the camera stays closed, the call stays voice', async () => {
    const h = await inCall()
    await h.session.setMode('video')
    expect(modeFrames(h).at(-1)).toEqual({ t: 'mode', mode: 'video' })
    expect(h.media.constraints).toHaveLength(1) // the mic only
    expect(h.session.state).toMatchObject({ myMode: 'video', peerMode: 'audio' })
    expect(h.session.state.media.videoOn).toBe(false)
    expect(h.peer().localKinds.at(-1)).toEqual(['audio'])
  })

  it('only hers on VIDEO: the camera stays closed too', async () => {
    const h = await inCall()
    h.peer().receive({ t: 'mode', mode: 'video' })
    await flush()
    expect(h.session.state).toMatchObject({ myMode: 'audio', peerMode: 'video' })
    expect(h.session.state.media.videoOn).toBe(false)
    expect(h.media.constraints).toHaveLength(1)
  })

  it('both on VIDEO: the camera opens and the track is added; either back to AUDIO: it stops and is removed', async () => {
    const h = await inCall()
    const stream = h.media.streams[0]!
    await h.session.setMode('video')
    h.peer().receive({ t: 'mode', mode: 'video' })
    await flush()
    expect(h.media.constraints[1]).toMatchObject({ audio: false, video: { facingMode: 'user' } })
    expect(stream.getVideoTracks()).toHaveLength(1)
    expect(h.peer().localKinds.at(-1)).toEqual(['audio', 'video'])
    expect(h.session.state.media.videoOn).toBe(true)

    // She goes back to AUDIO: our camera light goes off, voice again; our switch stays on VIDEO.
    const cam = stream.getVideoTracks()[0]!
    h.peer().receive({ t: 'mode', mode: 'audio' })
    await flush()
    expect(cam.readyState).toBe('ended')
    expect(stream.getVideoTracks()).toHaveLength(0)
    expect(h.peer().localKinds.at(-1)).toEqual(['audio'])
    expect(h.session.state).toMatchObject({ myMode: 'video', peerMode: 'audio' })
    expect(h.session.state.media.videoOn).toBe(false)

    // VIDEO again, then we go back to AUDIO.
    h.peer().receive({ t: 'mode', mode: 'video' })
    await flush()
    expect(h.session.state.media.videoOn).toBe(true)
    const cam2 = stream.getVideoTracks()[0]!
    await h.session.setMode('audio')
    expect(modeFrames(h).at(-1)).toEqual({ t: 'mode', mode: 'audio' })
    expect(cam2.readyState).toBe('ended')
    expect(stream.getVideoTracks()).toHaveLength(0)
    expect(h.session.state.media.videoOn).toBe(false)
    expect(h.link().sentOf('callEnd')).toEqual([]) // still in the call
  })

  it('OFF from VIDEO ends everything: callEnd, camera and mic stopped', async () => {
    const h = await inCall()
    const stream = h.media.streams[0]!
    await h.session.setMode('video')
    h.peer().receive({ t: 'mode', mode: 'video' })
    await flush()
    await h.session.setMode('off')
    expect(h.link().sentOf('callEnd')).toHaveLength(1)
    expect(stream.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
    expect(h.session.state.media).toMatchObject({ local: null, videoOn: false })
    expect(h.session.state.myMode).toBe('off')
  })

  it('a camera that is turned away while it is still opening is released, not added', async () => {
    const h = await inCall()
    h.peer().receive({ t: 'mode', mode: 'video' })
    const turningOn = h.session.setMode('video')
    h.peer().receive({ t: 'mode', mode: 'audio' })
    await turningOn
    await flush()
    const cam = h.media.streams[1]!
    expect(cam.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
    expect(h.media.streams[0]!.getVideoTracks()).toHaveLength(0)
    expect(h.session.state.media.videoOn).toBe(false)
  })

  it('camera denied: an error, and our switch steps back to AUDIO', async () => {
    const h = await inCall()
    h.peer().receive({ t: 'mode', mode: 'video' })
    h.media.fail = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    await h.session.setMode('video')
    expect(h.session.state.error).toMatch(/Нет доступа/)
    expect(h.session.state.myMode).toBe('audio')
    expect(modeFrames(h).at(-1)).toEqual({ t: 'mode', mode: 'audio' })
  })

  it('both switches reset to OFF when the call ends', async () => {
    const h = await inCall()
    await h.session.setMode('video')
    h.peer().receive({ t: 'mode', mode: 'video' })
    await flush()
    const stream = h.media.streams[0]!
    h.link().deliver({ t: 'callEnded', reason: 'hangup' })
    expect(stream.getTracks().every((t) => t.readyState === 'ended')).toBe(true)
    expect(h.session.state).toMatchObject({ myMode: 'off', peerMode: 'off', videoUnlockAt: null })
    expect(h.session.state.media.videoOn).toBe(false)
  })

  it('sends our switch when the call connects and again when the data channel reopens', async () => {
    const h = await inCall()
    expect(modeFrames(h)).toEqual([{ t: 'mode', mode: 'audio' }])
    await h.session.setMode('video')
    h.peer().setOpen(false)
    h.peer().setOpen(true)
    expect(modeFrames(h).at(-1)).toEqual({ t: 'mode', mode: 'video' })
  })

  it('outside a call: no mode frames sent or taken', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    h.peer().setOpen(true)
    h.peer().receive({ t: 'mode', mode: 'video' })
    expect(modeFrames(h)).toEqual([])
    expect(h.session.state.peerMode).toBe('off')
  })
})

describe('live session: missed calls', () => {
  let config: DeviceConfig
  beforeEach(async () => {
    config = (await paired()).config
  })

  it('a ringing call the friend cancelled is missed; a new call clears it', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    h.clock.now = T0 + 7
    h.link().deliver({ t: 'callEnded', reason: 'cancelled' })
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.missedCall).toEqual({ at: T0 + 7 })
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    expect(h.session.state.missedCall).toBeNull()
  })

  it('a call that rang out without us joining is missed', async () => {
    h = harness({ config })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    h.clock.now = T0 + 60_000
    h.link().deliver({ t: 'callEnded', reason: 'timeout' })
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.missedCall).toEqual({ at: T0 + 60_000 })
  })

  it('opened from a call notification after the call is gone: missed', async () => {
    h = harness({ config, search: `?from=call-push&at=${T0 - 5000}` })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.missedCall).toEqual({ at: T0 - 5000 })
    h.session.dismissMissedCall()
    expect(h.session.state.missedCall).toBeNull()
  })

  it('opened from a call notification while it still rings: not missed', async () => {
    h = harness({ config, search: `?from=call-push&at=${T0}` })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view({ incoming: true }) })
    expect(h.session.state.missedCall).toBeNull()
  })

  it('a notification click forwarded to an open window is checked on the next view', async () => {
    h = harness({ config })
    await h.session.ready
    h.page.click(`/?from=call-push&at=${T0}`)
    h.link().deliver({ t: 'view', view: view() })
    expect(h.session.state.missedCall).toEqual({ at: T0 })
  })

  it('starting a call clears a missed call', async () => {
    h = harness({ config, search: `?from=call-push&at=${T0}` })
    await h.session.ready
    h.link().deliver({ t: 'view', view: view() })
    await h.session.setMode('audio')
    expect(h.session.state.missedCall).toBeNull()
  })
})
