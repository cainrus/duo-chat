// The real DuoSession: wires the device config, the message store, the server link and the
// direct (WebRTC) link to the friend, and keeps `state` in sync for the UI.
//
// What goes where:
// - server (ServerLink): presence, call/ping rules, sealed WebRTC signaling. Never chat text.
// - friend (PeerLink data channel): chat messages and profiles (name + avatar).
// - device (IndexedDB): pairing record (device/config.ts) and unexpired messages.
//
// Everything that touches the browser or the network is injectable (LiveDeps), so the flows
// are unit-tested with fakes (live.test.ts).

import { markRaw, reactive, watch } from 'vue'
import type { CallEndReason, PushSubscriptionJSONLike, RoomView, ServerToClient } from '@shared/protocol'
import type { CallKind, Side } from '@shared/types'
import { decodeSecret, derivePairKeys, encodeSecret, generatePairSecret, pairingLink } from '../crypto/pair'
import { deviceConfigStore, isProfile, type DeviceConfig, type DeviceConfigStore } from '../device/config'
import { idbPersistence } from '../messages/idbPersistence'
import { MessageStore, MAX_MESSAGE_LENGTH, type MessagePersistence } from '../messages/store'
import { connectServerLink, type LinkStatus, type ServerLink } from '../net/serverLink'
import { parseCallPushUrl } from '../push/notification'
import { currentSubscription, requestNotifications } from '../push/subscribe'
import { PeerLink, type DataFrame } from '../rtc/peerLink'
import type { Connection, DuoSession, DuoState, NotificationResult, Profile } from './types'

/** The part of PeerLink the session uses (a fake implements it in tests). */
export type PeerLinkLike = Pick<
  PeerLink,
  'connect' | 'close' | 'dataOpen' | 'sendData' | 'onData' | 'onDataOpen' | 'setLocalStream' | 'onRemoteStream'
>

/** Browser page hooks: visibility, the launch URL, messages from the service worker. */
export type PageEnv = {
  isVisible(): boolean
  /** visibilitychange, pagehide (false) and pageshow. */
  onVisibility(cb: (visible: boolean) => void): () => void
  /** The query string the app was opened with (once); removes it from the address bar. */
  takeLaunchSearch(): string
  /** The service worker forwards a notification click to an open window. */
  onNotificationClick(cb: (url: string) => void): () => void
}

export type LiveDeps = {
  apiBase: string
  wsBase: string
  /** Origin used in the pairing link. */
  origin: string
  fetch: typeof fetch
  config: DeviceConfigStore
  messages: MessagePersistence
  connectServerLink(opts: { wsBase: string; roomId: string; deviceToken: string }): ServerLink
  createPeerLink(opts: {
    self: Side
    signalingKey: CryptoKey
    link: ServerLink
    getIceServers: () => Promise<RTCIceServer[]>
  }): PeerLinkLike
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  page: PageEnv | null
  push: {
    request(onSubscription: (sub: PushSubscriptionJSONLike) => void): Promise<NotificationResult>
    current(): Promise<PushSubscriptionJSONLike | null>
  }
  now(): number
}

export type LiveOptions = { apiBase?: string; wsBase?: string; deps?: Partial<LiveDeps> }

export type LiveSession = DuoSession & {
  /** Resolves once the stored pairing (if any) is loaded and `state.phase` is final. */
  readonly ready: Promise<void>
  /** Closes the links and timers (tests, hot reload). */
  dispose(): void
}

// ---------- copy (Russian, short) ----------

const T = {
  network: 'Нет связи с сервером. Проверьте интернет.',
  adminSecret: 'Неверный пароль взрослого.',
  pairFull: 'Эта ссылка уже использована. Создайте новую пару на первом устройстве.',
  noRoom: 'Ссылка не подходит. Попросите новую.',
  server: 'Сервер не ответил. Попробуйте ещё раз.',
  revoked: 'Это устройство отключено от пары. Свяжите заново.',
  notAllowed: 'Сейчас нельзя.',
  tooLong: `Слишком длинное сообщение (до ${MAX_MESSAGE_LENGTH} знаков).`,
  mediaDenied: 'Нет доступа к микрофону или камере. Разрешите в настройках.',
  mediaMissing: 'Не нашли микрофон или камеру.',
  mediaBusy: 'Микрофон или камера заняты другим приложением.',
  media: 'Не получилось включить микрофон или камеру.',
  notPaired: 'Сначала свяжите устройства.',
} as const

function mediaError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return T.mediaDenied
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return T.mediaMissing
  if (name === 'NotReadableError' || name === 'AbortError') return T.mediaBusy
  return T.media
}

/** A shown error clears itself after this long. */
export const ERROR_TTL_MS = 8_000

/** While the friend is here but the direct link is not open, connect() is repeated this often. */
export const DIRECT_RETRY_MS = 5_000

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const VIDEO: MediaTrackConstraints = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }

// ---------- browser defaults ----------

function browserPage(): PageEnv | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  return {
    isVisible: () => document.visibilityState === 'visible',
    onVisibility(cb) {
      const onChange = () => cb(document.visibilityState === 'visible')
      const onHide = () => cb(false)
      document.addEventListener('visibilitychange', onChange)
      window.addEventListener('pagehide', onHide)
      window.addEventListener('pageshow', onChange)
      return () => {
        document.removeEventListener('visibilitychange', onChange)
        window.removeEventListener('pagehide', onHide)
        window.removeEventListener('pageshow', onChange)
      }
    },
    takeLaunchSearch() {
      const search = location.search
      if (search && parseCallPushUrl(search)) history.replaceState(history.state, '', location.pathname + location.hash)
      return search
    },
    onNotificationClick(cb) {
      const sw = navigator.serviceWorker
      if (!sw) return () => {}
      const onMessage = (ev: MessageEvent) => {
        const d = ev.data as { t?: unknown; url?: unknown } | null
        if (d?.t === 'notification-click' && typeof d.url === 'string') cb(d.url)
      }
      sw.addEventListener('message', onMessage)
      return () => sw.removeEventListener('message', onMessage)
    },
  }
}

function defaultDeps(opts: LiveOptions): LiveDeps {
  // Tests may build default deps outside a browser; they override origin anyway.
  const origin = globalThis.location?.origin ?? ''
  const apiBase = (opts.apiBase ?? '').replace(/\/+$/, '')
  const wsBase = (opts.wsBase ?? (apiBase || origin).replace(/^http/, 'ws')).replace(/\/+$/, '')
  const fetcher: typeof fetch = (...args) => globalThis.fetch(...args)
  return {
    apiBase,
    wsBase,
    origin,
    fetch: fetcher,
    config: deviceConfigStore(),
    messages: idbPersistence(),
    connectServerLink: (o) => connectServerLink(o),
    createPeerLink: (o) => new PeerLink(o),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    page: browserPage(),
    push: {
      request: (onSub) => requestNotifications({ apiBase, fetch: fetcher }, onSub),
      current: () => currentSubscription({ apiBase, fetch: fetcher }),
    },
    now: () => Date.now(),
  }
}

// ---------- the session ----------

type Runtime = {
  config: DeviceConfig
  roomId: string
  link: ServerLink
  peer: PeerLinkLike
  store: MessageStore
  /** Undo callbacks for every subscription of this runtime. */
  offs: (() => void)[]
  /** We asked for a direct connection (peer present and paired). */
  peerWanted: boolean
}

/** Local media of the current (or starting) call. */
type CallMedia = {
  stream: MediaStream
  /** The server confirmed the call (outgoing ringing or connected). */
  confirmed: boolean
  /** Handed to the PeerLink (only once the call is connected). */
  attached: boolean
}

export function createLiveSession(opts: LiveOptions = {}): LiveSession {
  const deps: LiveDeps = { ...defaultDeps(opts), ...opts.deps }

  const state = reactive<DuoState>({
    phase: 'setup',
    self: null,
    missedCall: null,
    connection: 'offline',
    me: null,
    peer: null,
    view: null,
    messages: [],
    pendingIds: [],
    directOpen: false,
    nudgeAt: null,
    media: { local: null, remote: null, micOn: false, camOn: false },
    lastCallEnded: null,
    error: null,
  })

  let rt: Runtime | null = null
  let disposed = false
  let pendingSub: PushSubscriptionJSONLike | null = null
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * We already answered the friend's profile on the current channel. Her profile proves her
   * end is open and listening, so we send ours once more then: the copy we sent on open may
   * have gone out before she was ready for it.
   */
  let profileAnswered = false
  let media: CallMedia | null = null
  /** A call action is waiting for getUserMedia; no second one starts meanwhile. */
  let acquiring = false
  /** The kind of the call ringing towards us, while it rings. */
  let ringing: CallKind | null = null
  /** We accepted or declined the ringing call (so its end is not "missed"). */
  let responded = false
  /** Opened from a call notification: decide "missed" on the next view. */
  let pushedCall: { kind: CallKind; at: number } | null = null

  const pageOffs: (() => void)[] = []

  // ---------- errors ----------

  /** Shows a short error; it clears itself after ERROR_TTL_MS. */
  const setError = (text: string | null) => {
    if (errorTimer !== null) clearTimeout(errorTimer)
    errorTimer = null
    state.error = text
    if (text === null || disposed) return
    errorTimer = setTimeout(() => {
      errorTimer = null
      if (state.error === text) state.error = null
    }, ERROR_TTL_MS)
  }

  // ---------- page ----------

  const page = deps.page
  if (page) {
    pushedCall = parseCallPushUrl(page.takeLaunchSearch())
    pageOffs.push(
      page.onVisibility((visible) => {
        rt?.link.setVisible(visible)
        if (visible && rt) {
          // Timers may have slept with the page.
          rt.store.sweep()
          syncMessages()
        }
      }),
      page.onNotificationClick((url) => {
        const q = url.indexOf('?')
        const pushed = q >= 0 ? parseCallPushUrl(url.slice(q)) : null
        if (pushed) pushedCall = pushed
      }),
    )
  }

  // ---------- messages ----------

  const syncMessages = () => {
    if (!rt) return
    state.messages = rt.store.timeline()
    syncPending()
    scheduleSweep()
  }

  const syncPending = () => {
    const ids = rt ? rt.store.outbox().map((m) => m.id) : []
    if (ids.length !== state.pendingIds.length || ids.some((id, i) => id !== state.pendingIds[i])) state.pendingIds = ids
  }

  const scheduleSweep = () => {
    if (sweepTimer !== null) clearTimeout(sweepTimer)
    sweepTimer = null
    const at = rt?.store.nextExpiryAt()
    if (at == null || disposed) return
    sweepTimer = setTimeout(
      () => {
        sweepTimer = null
        if (!rt) return
        rt.store.sweep()
        syncMessages()
      },
      Math.max(0, at - deps.now()),
    )
  }

  const flushOutbox = () => {
    if (!rt || !rt.peer.dataOpen) return
    const sent: string[] = []
    for (const m of rt.store.outbox()) {
      if (!rt.peer.sendData({ t: 'msg', m })) break
      sent.push(m.id)
    }
    if (sent.length) {
      rt.store.markSent(sent)
      syncPending()
    }
  }

  // ---------- media ----------

  const constraints = (kind: CallKind): MediaStreamConstraints =>
    kind === 'video' ? { audio: AUDIO, video: VIDEO } : { audio: AUDIO, video: false }

  const acquire = async (c: MediaStreamConstraints): Promise<MediaStream | null> => {
    try {
      const stream = markRaw(await deps.getUserMedia(c))
      // The mic and camera work now: an older media error no longer applies.
      setError(null)
      return stream
    } catch (err) {
      setError(mediaError(err))
      return null
    }
  }

  const stopStream = (s: MediaStream) => {
    for (const t of s.getTracks()) t.stop()
  }

  const useMedia = (stream: MediaStream, kind: CallKind) => {
    media = { stream, confirmed: false, attached: false }
    state.media.local = stream
    state.media.micOn = true
    state.media.camOn = kind === 'video'
  }

  const endMedia = () => {
    const m = media
    media = null
    if (m) {
      stopStream(m.stream)
      if (m.attached) rt?.peer.setLocalStream(null)
    }
    state.media.local = null
    state.media.micOn = false
    state.media.camOn = false
  }

  // ---------- server frames ----------

  const onView = (view: RoomView) => {
    const prev = state.view
    state.view = view

    // Missed call: it rang towards us and stopped without us answering.
    if (view.incoming) {
      if (!prev?.incoming) {
        state.missedCall = null
        responded = false
      }
      ringing = view.incoming.kind
    } else if (ringing) {
      if (!view.inCall && !responded) state.missedCall = { kind: ringing, at: deps.now() }
      ringing = null
    }
    if (pushedCall) {
      const p = pushedCall
      pushedCall = null
      if (!view.incoming && !view.inCall) state.missedCall = p
    }

    // Call media follows the server's call state.
    if (media) {
      if (view.outgoing || view.inCall) media.confirmed = true
      if (view.inCall && !media.attached) {
        media.attached = true
        rt?.peer.setLocalStream(media.stream)
      }
      if (media.confirmed && !view.outgoing && !view.inCall) endMedia()
    }

    // The direct link lives while the friend is around.
    if (rt) {
      const want = view.peerPaired && view.peerPresent
      if (want) rt.peer.connect()
      else if (rt.peerWanted) rt.peer.close()
      rt.peerWanted = want
    }
  }

  const onCallEnded = (reason: CallEndReason) => {
    state.lastCallEnded = reason
    if (ringing && !responded && (reason === 'cancelled' || reason === 'timeout')) {
      state.missedCall = { kind: ringing, at: deps.now() }
    }
    ringing = null
    endMedia()
  }

  const onServer = (msg: ServerToClient) => {
    switch (msg.t) {
      case 'view':
        return onView(msg.view)
      case 'nudge':
        state.nudgeAt = deps.now()
        return
      case 'callEnded':
        return onCallEnded(msg.reason)
      case 'error':
        if (msg.code === 'unauthorized') return void revoked()
        if (msg.code === 'not-allowed') {
          setError(T.notAllowed)
          // A call the server refused never got confirmed: release the mic and camera.
          if (media && !media.confirmed) endMedia()
        }
        return
      case 'signal':
        return // PeerLink handles it
    }
  }

  const connectionOf = (s: LinkStatus): Connection => (s === 'open' ? 'online' : s === 'connecting' ? 'connecting' : 'offline')

  /** connect() is idempotent and cheap; repeating it unsticks a link whose setup got lost. */
  const retryDirect = () => {
    const v = state.view
    if (rt && v?.peerPresent && v.peerPaired && !state.directOpen) rt.peer.connect()
  }

  // ---------- data channel ----------

  const onData = (frame: DataFrame) => {
    if (!rt) return
    if (frame.t === 'msg') {
      rt.store.receive(frame.m)
      return
    }
    if (frame.t === 'profile' && isProfile(frame.p)) {
      if (!profileAnswered) {
        profileAnswered = true
        sendProfile()
      }
      const p: Profile = { name: frame.p.name.trim(), avatar: frame.p.avatar }
      if (state.peer?.name === p.name && state.peer.avatar === p.avatar) return
      state.peer = p
      rt.config = { ...rt.config, peer: p }
      void deps.config.save(rt.config).catch((err) => console.debug('[live] cannot save peer', err))
    }
  }

  const sendProfile = () => {
    const me = state.me ?? rt?.config.me
    if (!rt || !me || !rt.peer.dataOpen) return
    rt.peer.sendData({ t: 'profile', p: { name: me.name, avatar: me.avatar } })
  }

  const onDataOpen = (open: boolean) => {
    state.directOpen = open
    profileAnswered = false
    if (!open || !rt) return
    sendProfile()
    flushOutbox()
  }

  // A new name or picture goes to the friend right away.
  const stopMeWatch = watch(
    () => (state.me ? `${state.me.name}\u0000${state.me.avatar}` : null),
    (now, before) => {
      if (now !== null && before !== null) sendProfile()
    },
    { flush: 'sync' },
  )

  // ---------- lifecycle ----------

  const stop = () => {
    const r = rt
    rt = null
    if (sweepTimer !== null) clearTimeout(sweepTimer)
    sweepTimer = null
    if (retryTimer !== null) clearInterval(retryTimer)
    retryTimer = null
    endMedia()
    ringing = null
    if (!r) return
    for (const off of r.offs) off()
    r.peer.close()
    r.link.close()
    state.connection = 'offline'
    state.directOpen = false
    state.pendingIds = []
    state.view = null
    state.media.remote = null
  }

  const start = async (config: DeviceConfig) => {
    const keys = await derivePairKeys(decodeSecret(config.secret))
    const store = new MessageStore({ self: config.side, persistence: deps.messages, now: deps.now })
    await store.init()
    if (disposed) return

    state.self = config.side
    state.me = config.me
    state.peer = config.peer
    state.phase = 'ready'

    const link = deps.connectServerLink({ wsBase: deps.wsBase, roomId: keys.roomId, deviceToken: config.deviceToken })
    const peer = deps.createPeerLink({
      self: config.side,
      signalingKey: keys.signalingKey,
      link,
      getIceServers: () => iceServers(keys.roomId, config.deviceToken),
    })
    const r: Runtime = { config, roomId: keys.roomId, link, peer, store, offs: [], peerWanted: false }
    rt = r
    r.offs.push(
      link.onMessage(onServer),
      link.onStatus((s) => {
        if (rt === r) state.connection = connectionOf(s)
      }),
      store.onChange(syncMessages),
      peer.onData(onData),
      peer.onDataOpen(onDataOpen),
      peer.onRemoteStream((s) => {
        if (rt === r) state.media.remote = s ? markRaw(s) : null
      }),
    )
    state.connection = connectionOf(link.status)
    retryTimer = setInterval(retryDirect, DIRECT_RETRY_MS)
    link.setVisible(page ? page.isVisible() : true)
    syncMessages()

    // Keep the server's push subscription fresh (it can rotate, or was made before pairing).
    if (pendingSub) link.send({ t: 'pushSubscribe', sub: pendingSub })
    else
      void deps.push.current().then(
        (sub) => sub && rt === r && link.send({ t: 'pushSubscribe', sub }),
        () => {},
      )
  }

  const revoked = async () => {
    stop()
    state.phase = 'setup'
    state.self = null
    state.peer = null
    state.messages = []
    setError(T.revoked)
    await deps.config.clear().catch(() => {})
    await deps.messages.save([]).catch(() => {})
  }

  const iceServers = async (roomId: string, deviceToken: string): Promise<RTCIceServer[]> => {
    const res = await deps.fetch(`${deps.apiBase}/api/rooms/${roomId}/ice`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    })
    if (!res.ok) throw new Error(`ice: ${res.status}`)
    const body = (await res.json()) as { iceServers?: RTCIceServer[] }
    return Array.isArray(body.iceServers) ? body.iceServers : []
  }

  const claim = async (roomId: string, side: Side, adminSecret?: string): Promise<string> => {
    let res: Response
    try {
      res = await deps.fetch(`${deps.apiBase}/api/rooms/${roomId}/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSecret ? { Authorization: `Bearer ${adminSecret}` } : {}),
        },
        body: JSON.stringify({ side }),
      })
    } catch {
      throw new Error(T.network)
    }
    if (res.status === 401) throw new Error(T.adminSecret)
    if (res.status === 409) throw new Error(T.pairFull)
    if (res.status === 404) throw new Error(T.noRoom)
    if (!res.ok) throw new Error(T.server)
    const body = (await res.json()) as { deviceToken?: unknown }
    if (typeof body.deviceToken !== 'string') throw new Error(T.server)
    return body.deviceToken
  }

  /** Pairs this device: claims the slot, replaces any older pairing and its messages. */
  const pair = async (secret: Uint8Array, side: Side, me: Profile, adminSecret?: string) => {
    if (!isProfile(me)) throw new Error('Нужно имя и картинка.')
    await ready
    const { roomId } = await derivePairKeys(secret)
    const deviceToken = await claim(roomId, side, adminSecret)
    const config: DeviceConfig = { secret: encodeSecret(secret), side, deviceToken, me: { ...me }, peer: null }
    const replacing = rt !== null
    stop()
    if (replacing) await deps.messages.save([])
    await deps.config.save(config)
    setError(null)
    await start(config)
  }

  const ready: Promise<void> = (async () => {
    try {
      const config = await deps.config.load()
      if (config && !disposed) await start(config)
    } catch (err) {
      console.debug('[live] cannot load the pairing', err)
    }
  })()

  // ---------- actions ----------

  const session: LiveSession = {
    state,
    ready,

    async createPair({ adminSecret, me }) {
      const secret = generatePairSecret()
      await pair(secret, 'a', me, adminSecret)
      return { link: pairingLink(deps.origin, secret) }
    },

    async joinPair({ secret, me }) {
      await pair(secret, 'b', me)
    },

    async enableNotifications() {
      try {
        return await deps.push.request((sub) => {
          pendingSub = sub
          rt?.link.send({ t: 'pushSubscribe', sub })
        })
      } catch (err) {
        console.debug('[live] notifications failed', err)
        return 'unsupported'
      }
    },

    sendText(text) {
      if (!rt) {
        setError(T.notPaired)
        return
      }
      try {
        rt.store.compose(text)
      } catch (err) {
        if ((err as Error).message === 'message too long') setError(T.tooLong)
        return
      }
      flushOutbox()
      rt.link.send({ t: 'replied' })
    },

    ping() {
      rt?.link.send({ t: 'ping' })
    },

    async startCall(kind) {
      const r = rt
      const v = state.view
      if (!r || !v || acquiring || media) return
      if (v.outgoing || v.inCall || v.incoming || v.call.kind !== 'ready') return
      state.missedCall = null
      acquiring = true
      const stream = await acquire(constraints(kind))
      acquiring = false
      if (!stream) return
      if (rt !== r || state.view?.outgoing || state.view?.inCall || state.view?.incoming) {
        stopStream(stream)
        return
      }
      useMedia(stream, kind)
      r.link.send({ t: 'call', kind })
    },

    cancelCall() {
      rt?.link.send({ t: 'callCancel' })
      endMedia()
    },

    async acceptCall() {
      const r = rt
      const incoming = state.view?.incoming
      if (!r || !incoming || acquiring || media) return
      state.missedCall = null
      responded = true
      acquiring = true
      const stream = await acquire(constraints(incoming.kind))
      acquiring = false
      if (!stream) {
        responded = false
        return
      }
      if (rt !== r || !state.view?.incoming) {
        // The friend gave up while we were asked for the mic.
        stopStream(stream)
        return
      }
      useMedia(stream, incoming.kind)
      r.link.send({ t: 'callAccept' })
    },

    declineCall() {
      if (!state.view?.incoming) return
      responded = true
      rt?.link.send({ t: 'callDecline' })
    },

    hangUp() {
      rt?.link.send({ t: 'callEnd' })
      endMedia()
    },

    setMic(on) {
      const m = media
      if (!m) return
      for (const t of m.stream.getAudioTracks()) t.enabled = on
      state.media.micOn = on
    },

    async setCamera(on) {
      const m = media
      if (!m) return
      if (!on) {
        // Stop the camera (its light goes off), not just mute it.
        for (const t of m.stream.getVideoTracks()) {
          t.stop()
          m.stream.removeTrack(t)
        }
        state.media.camOn = false
        if (m.attached) rt?.peer.setLocalStream(m.stream)
        return
      }
      if (m.stream.getVideoTracks().some((t) => t.readyState === 'live')) {
        for (const t of m.stream.getVideoTracks()) t.enabled = true
        state.media.camOn = true
        return
      }
      if (acquiring) return
      acquiring = true
      const cam = await acquire({ audio: false, video: VIDEO })
      acquiring = false
      if (!cam) return
      const track = cam.getVideoTracks()[0]
      if (media !== m || !track) {
        stopStream(cam)
        return
      }
      m.stream.addTrack(track)
      state.media.camOn = true
      if (m.attached) rt?.peer.setLocalStream(m.stream)
    },

    dismissCallEnded() {
      state.lastCallEnded = null
    },
    dismissMissedCall() {
      state.missedCall = null
    },
    dismissError() {
      setError(null)
    },

    dispose() {
      disposed = true
      stopMeWatch()
      if (errorTimer !== null) clearTimeout(errorTimer)
      errorTimer = null
      for (const off of pageOffs) off()
      stop()
    },
  }
  return session
}
