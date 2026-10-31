// The real DuoSession: wires the device config, the message store, the server link and the
// direct (WebRTC) link to the friend, and keeps `state` in sync for the UI.
//
// What goes where:
// - server (ServerLink): presence, call/ping rules, sealed WebRTC signaling. Never chat text.
// - friend (PeerLink data channel): chat messages, acks and the call
//   switch (OFF | AUDIO | VIDEO) during a call.
// - device (IndexedDB): pairing record (device/config.ts) and unexpired messages.
//
// Everything that touches the browser or the network is injectable (LiveDeps), so the flows
// are unit-tested with fakes (live.test.ts).

import { markRaw, reactive } from 'vue'
import type { CallEndReason, PushSubscriptionJSONLike, RoomView, ServerToClient } from '@shared/protocol'
import type { Side } from '@shared/types'
import { VIDEO_UNLOCK_MS } from '@shared/constants'
import { decodeSecret, derivePairKeys, encodeSecret, generatePairSecret, pairingLink } from '../crypto/pair'
import { deviceConfigStore, type DeviceConfig, type DeviceConfigStore } from '../device/config'
import { idbPersistence } from '../messages/idbPersistence'
import { MessageStore, MAX_MESSAGE_LENGTH, type MessagePersistence } from '../messages/store'
import { connectServerLink, type LinkStatus, type ServerLink } from '../net/serverLink'
import { NOTIFICATION_TAG } from '../push/notification'
import { currentSubscription, notificationsGranted, requestNotifications } from '../push/subscribe'
import { PeerLink, type DataFrame } from '../rtc/peerLink'
import type { CallMode, Connection, DuoSession, DuoState, NotificationResult } from './types'

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
  /**
   * The page is going away (pagehide: closed, reloaded, navigated, or frozen into the
   * back/forward cache). Fires before onVisibility(false).
   */
  onLeave(cb: () => void): () => void
  /** Closes every duo notification on screen (the app is open, so they are old news). */
  closeNotifications(): void
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
    /** Notifications are allowed (permission granted, push supported). */
    allowed(): boolean
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

/**
 * A message handed to an open data channel but not acked by the friend within this time is
 * sent again (she dedupes by id). A channel can look open for seconds after her page is gone.
 */
export const ACK_RESEND_MS = 5_000

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
    onLeave(cb) {
      // pagehide covers unload too; no beforeunload listener: Firefox then skips the bfcache.
      window.addEventListener('pagehide', cb)
      return () => window.removeEventListener('pagehide', cb)
    },
    closeNotifications() {
      const sw = navigator.serviceWorker
      if (!sw) return
      // `ready` never settles without a worker; nothing waits on this.
      void sw.ready
        .then((reg) => reg.getNotifications({ tag: NOTIFICATION_TAG }))
        .then((shown) => shown.forEach((n) => n.close()))
        .catch(() => {})
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
      allowed: () => notificationsGranted(),
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

export function createLiveSession(opts: LiveOptions = {}): LiveSession {
  const deps: LiveDeps = { ...defaultDeps(opts), ...opts.deps }

  const state = reactive<DuoState>({
    phase: 'setup',
    self: null,
    connection: 'offline',
    view: null,
    messages: [],
    pendingIds: [],
    directOpen: false,
    pushMuted: false,
    notificationsAllowed: false,
    myMode: 'off',
    peerMode: 'off',
    videoUnlockAt: null,
    media: { local: null, remote: null, videoOn: false },
    lastCallEnded: null,
    error: null,
  })

  let rt: Runtime | null = null
  let disposed = false
  let pendingSub: PushSubscriptionJSONLike | null = null
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let errorTimer: ReturnType<typeof setTimeout> | null = null
  let resendTimer: ReturnType<typeof setTimeout> | null = null
  /** Pending message id -> when it was last handed to the current data channel. */
  const sentAt = new Map<string, number>()
  /**
   * Local media of the connected call: the microphone, plus the camera's video track while
   * both switches are on VIDEO. Opened only once the server reports the call connected, and
   * handed to the PeerLink right away.
   */
  let callStream: MediaStream | null = null
  /** getUserMedia for the call's microphone is in flight. */
  let micPending = false
  /** The microphone could not be opened for this call (asked once per call). */
  let micFailed = false
  /** getUserMedia for the camera is in flight. */
  let camPending = false
  /** We are in the voice room waiting alone (the friend has not joined yet). */
  let waitingAlone = false

  const pageOffs: (() => void)[] = []

  // ---------- errors ----------

  /** Shows a short error; it clears itself after ERROR_TTL_MS. */
  const setError = (text: string | null) => {
    if (errorTimer !== null) clearTimeout(errorTimer)
    errorTimer = null
    state.error = text
    // On the setup screen the adult must be able to read why (e.g. device revoked): no auto-clear.
    if (text === null || disposed || state.phase === 'setup') return
    errorTimer = setTimeout(() => {
      errorTimer = null
      if (state.error === text) state.error = null
    }, ERROR_TTL_MS)
  }

  // ---------- page ----------

  const page = deps.page
  if (page) {
    pageOffs.push(
      page.onVisibility((visible) => {
        // Voice room: we wait for her only while our app is visible. Hidden (screen off, app
        // switched, page closed) while she has not joined yet: we leave (the server cancels
        // too when it hears we are hidden). A connected call keeps going in the background.
        if (!visible && rt && state.view?.outgoing && !state.view.inCall) {
          rt.link.send({ t: 'callCancel' })
          endCall()
          leftUnanswered()
        }
        rt?.link.setVisible(visible)
        if (visible) page.closeNotifications()
        if (visible && rt) {
          // Timers may have slept with the page.
          rt.store.sweep()
          syncMessages()
          // Back from pagehide (bfcache restore) or a long sleep: do not wait for the retry tick.
          retryDirect()
        }
      }),
      // Close the direct link ourselves, so the friend's channel closes at once instead of
      // looking open until ICE gives up (~15 s). pageshow / visible reconnects.
      page.onLeave(() => rt?.peer.close()),
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

  /**
   * Hands pending messages to the data channel: those not sent on this channel yet, and those
   * sent ACK_RESEND_MS ago or earlier without an ack. A message stays pending (clock icon)
   * until the friend acks it.
   */
  const flushOutbox = () => {
    clearResend()
    if (!rt || !rt.peer.dataOpen) return
    const now = deps.now()
    const pending = rt.store.outbox()
    const live = new Set(pending.map((m) => m.id))
    for (const id of [...sentAt.keys()]) if (!live.has(id)) sentAt.delete(id)
    for (const m of pending) {
      const last = sentAt.get(m.id)
      if (last !== undefined && now - last < ACK_RESEND_MS) continue
      if (!rt.peer.sendData({ t: 'msg', m })) break
      sentAt.set(m.id, now)
    }
    scheduleResend()
  }

  const clearResend = () => {
    if (resendTimer !== null) clearTimeout(resendTimer)
    resendTimer = null
  }

  const scheduleResend = () => {
    if (disposed || sentAt.size === 0 || !rt?.peer.dataOpen) return
    const due = Math.min(...sentAt.values()) + ACK_RESEND_MS
    resendTimer = setTimeout(
      () => {
        resendTimer = null
        flushOutbox()
      },
      Math.max(0, due - deps.now()),
    )
  }

  const onAck = (ids: string[]) => {
    if (!rt) return
    const pending = new Set(rt.store.outbox().map((m) => m.id))
    const acked = ids.filter((id) => pending.has(id))
    for (const id of ids) sentAt.delete(id)
    if (!acked.length) return
    rt.store.markSent(acked)
    syncPending()
    if (sentAt.size === 0) clearResend()
  }

  // ---------- media ----------

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

  /** Releases the call's microphone and camera. */
  const endMedia = () => {
    const s = callStream
    callStream = null
    micFailed = false
    if (s) {
      stopStream(s)
      rt?.peer.setLocalStream(null)
    }
    state.media.local = null
    state.media.videoOn = false
  }

  /** The call is over: media released, both switches back to OFF. */
  const endCall = () => {
    endMedia()
    state.myMode = 'off'
    state.peerMode = 'off'
    state.videoUnlockAt = null
  }

  /** The call connected (both switches on AUDIO or VIDEO): only now open the microphone. */
  const openMic = async () => {
    const r = rt
    if (!r || callStream || micPending || micFailed) return
    micPending = true
    const stream = await acquire({ audio: AUDIO, video: false })
    micPending = false
    if (!stream) {
      // No microphone: the error stays on screen and the call ends cleanly for both.
      if (rt === r && state.view?.inCall) {
        micFailed = true
        r.link.send({ t: 'callEnd' })
        state.myMode = 'off'
        state.videoUnlockAt = null
      }
      return
    }
    if (rt !== r || !state.view?.inCall || callStream) {
      stopStream(stream)
      return
    }
    callStream = stream
    state.media.local = stream
    r.peer.setLocalStream(stream)
    await syncVideo()
  }

  /**
   * Video follows the two switches: the camera runs only while both are on VIDEO. When either
   * leaves VIDEO, the camera is stopped (its light goes off) and its track removed: voice.
   */
  const syncVideo = async (): Promise<void> => {
    const s = callStream
    if (!s) {
      state.media.videoOn = false
      return
    }
    const wanted = () => callStream === s && state.myMode === 'video' && state.peerMode === 'video'
    const video = s.getVideoTracks()
    if (wanted() && video.some((t) => t.readyState === 'live')) {
      state.media.videoOn = true
      return
    }
    if (video.length) {
      for (const t of video) {
        t.stop()
        s.removeTrack(t)
      }
      rt?.peer.setLocalStream(s)
    }
    state.media.videoOn = false
    if (!wanted() || camPending) return
    camPending = true
    const cam = await acquire({ audio: false, video: VIDEO })
    camPending = false
    if (!cam) {
      // No camera: our switch steps back to AUDIO, and the friend is told.
      if (callStream === s && state.myMode === 'video') {
        state.myMode = 'audio'
        sendMode()
      }
      return
    }
    const track = cam.getVideoTracks()[0]
    if (!track || !wanted()) {
      stopStream(cam)
      return
    }
    s.addTrack(track)
    rt?.peer.setLocalStream(s)
    state.media.videoOn = true
  }

  /** Tells the friend our switch position, device to device (never via the server). */
  const sendMode = () => {
    if (rt?.peer.dataOpen && state.view?.inCall) rt.peer.sendData({ t: 'mode', mode: state.myMode })
  }

  // ---------- server frames ----------

  const onView = (view: RoomView) => {
    const prev = state.view
    state.view = view

    // (A view still showing our wait after we left locally is stale: our switch is OFF then.)
    if (view.outgoing && state.myMode !== 'off') waitingAlone = true
    if (view.inCall) waitingAlone = false

    // The switches and call media follow the server's call state: nothing opens while it
    // rings, the mic once connected.
    if (view.inCall) {
      if (!prev?.inCall) {
        // Both switches are at least on AUDIO to get here; her exact one comes over the channel.
        if (state.myMode === 'off') state.myMode = 'audio'
        if (state.peerMode === 'off') state.peerMode = 'audio'
        sendMode()
      }
      void openMic()
    } else {
      if (callStream || prev?.inCall) endCall()
      // While she calls us, her switch is on AUDIO.
      state.peerMode = view.incoming ? 'audio' : 'off'
      // We stopped waiting before she joined (cancel, a dropped socket): back to OFF.
      if (prev?.outgoing && !view.outgoing) {
        endCall()
        leftUnanswered()
      }
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
    endCall()
  }

  /**
   * We left the voice room before the friend joined: a «📞 голосовой» service item goes into
   * the chat for both of us, device to device, and lives an hour like any message. Once per
   * wait, however we left (OFF, hidden, dropped).
   */
  const leftUnanswered = () => {
    if (!waitingAlone || !rt) return
    waitingAlone = false
    rt.store.composeVoice()
    flushOutbox()
  }

  const onServer = (msg: ServerToClient) => {
    switch (msg.t) {
      case 'view':
        return onView(msg.view)
      case 'callEnded':
        return onCallEnded(msg.reason)
      case 'error':
        if (msg.code === 'unauthorized') return void revoked()
        if (msg.code === 'not-allowed') {
          setError(T.notAllowed)
          // A refused call: the switch goes back to OFF.
          if (!state.view?.inCall && !state.view?.outgoing) endCall()
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
      // Ack duplicates and expired ones too, so the friend stops resending them.
      const id = (frame.m as { id?: unknown }).id
      if (typeof id === 'string' && id.length > 0 && id.length <= 100) rt.peer.sendData({ t: 'ack', ids: [id] })
      return
    }
    if (frame.t === 'ack') return onAck(frame.ids)
    if (frame.t === 'mode') {
      // Only during a call; both switches go back to OFF when it ends.
      if (!state.view?.inCall) return
      state.peerMode = frame.mode
      void syncVideo()
      return
    }
  }

  const onDataOpen = (open: boolean) => {
    state.directOpen = open
    // A new channel: everything still unacked goes again.
    sentAt.clear()
    clearResend()
    if (!open || !rt) return
    sendMode()
    flushOutbox()
  }

  // ---------- lifecycle ----------

  const stop = () => {
    const r = rt
    rt = null
    if (sweepTimer !== null) clearTimeout(sweepTimer)
    sweepTimer = null
    if (retryTimer !== null) clearInterval(retryTimer)
    retryTimer = null
    clearResend()
    sentAt.clear()
    endCall()
    waitingAlone = false
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
    state.pushMuted = config.pushMuted ?? false
    state.notificationsAllowed = deps.push.allowed()
    state.phase = 'ready'
    // The app is open: notifications on screen are old news.
    page?.closeNotifications()

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
        if (rt !== r) return
        state.connection = connectionOf(s)
        // The bell's choice goes to the server on every (re)connect.
        if (s === 'open') link.send({ t: 'pushMute', muted: state.pushMuted })
      }),
      store.onChange(syncMessages),
      peer.onData(onData),
      peer.onDataOpen(onDataOpen),
      peer.onRemoteStream((s) => {
        if (rt === r) state.media.remote = s ? markRaw(s) : null
      }),
    )
    state.connection = connectionOf(link.status)
    if (link.status === 'open') link.send({ t: 'pushMute', muted: state.pushMuted })
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
  const pair = async (secret: Uint8Array, side: Side, adminSecret?: string) => {
    await ready
    const { roomId } = await derivePairKeys(secret)
    const deviceToken = await claim(roomId, side, adminSecret)
    const config: DeviceConfig = { secret: encodeSecret(secret), side, deviceToken }
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

    async createPair({ adminSecret }) {
      const secret = generatePairSecret()
      await pair(secret, 'a', adminSecret)
      return { link: pairingLink(deps.origin, secret) }
    },

    async joinPair({ secret }) {
      await pair(secret, 'b')
    },

    async enableNotifications() {
      try {
        const result = await deps.push.request((sub) => {
          pendingSub = sub
          rt?.link.send({ t: 'pushSubscribe', sub })
        })
        if (result === 'granted') state.notificationsAllowed = true
        return result
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
      // The server never sees the text; it may send the absent friend a content-free invitation.
      rt.link.send({ t: 'wrote' })
    },

    ping() {
      rt?.link.send({ t: 'ping' })
    },

    async setPushMuted(muted) {
      // Turning pushes on without permission asks first (this stays the first await of the tap).
      if (!muted && !state.notificationsAllowed && (await session.enableNotifications()) !== 'granted') return
      state.pushMuted = muted
      const r = rt
      if (!r) return
      r.link.send({ t: 'pushMute', muted })
      r.config = { ...r.config, pushMuted: muted }
      await deps.config.save(r.config).catch((err) => console.debug('[live] cannot save the bell', err))
    },

    // No getUserMedia here: the mic opens only once the server reports the call connected.
    async setMode(mode: CallMode) {
      const r = rt
      const v = state.view
      const from = state.myMode
      if (!r || !v || mode === from) return

      if (mode === 'off') {
        if (v.inCall) r.link.send({ t: 'callEnd' })
        else if (v.outgoing) r.link.send({ t: 'callCancel' })
        endMedia()
        state.myMode = 'off'
        state.videoUnlockAt = null
        if (v.outgoing && !v.inCall) leftUnanswered()
        return
      }

      if (from === 'off') {
        // From OFF only AUDIO: it joins her call, or calls her (not while the button is locked).
        if (mode !== 'audio' || v.inCall || v.outgoing) return
        if (v.incoming) r.link.send({ t: 'callAccept' })
        else if (v.peerPaired && v.call.kind === 'ready') r.link.send({ t: 'call' })
        else return
        state.myMode = 'audio'
        state.videoUnlockAt = deps.now() + VIDEO_UNLOCK_MS
        return
      }

      // AUDIO <-> VIDEO. VIDEO stays locked for a moment after OFF -> AUDIO (no mis-tap into video).
      if (mode === 'video' && deps.now() < (state.videoUnlockAt ?? Infinity)) return
      state.myMode = mode
      sendMode()
      await syncVideo()
    },

    dismissCallEnded() {
      state.lastCallEnded = null
    },
    dismissError() {
      setError(null)
    },

    dispose() {
      disposed = true
      if (errorTimer !== null) clearTimeout(errorTimer)
      errorTimer = null
      for (const off of pageOffs) off()
      stop()
    },
  }
  return session
}
