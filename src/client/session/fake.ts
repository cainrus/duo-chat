// A fake DuoSession for UI development (`VITE_FAKE=1 pnpm dev`) and component tests.
// It imitates what the server and the friend's device would do, so every screen and
// button state is reachable from the dev panel (FakeDevPanel.vue). Never used in production:
// main.ts imports it dynamically behind `import.meta.env.VITE_FAKE`, so the build drops it.

import { markRaw, reactive } from 'vue'
import type { CallEndReason, PingResult, RoomView } from '@shared/protocol'
import type { Side } from '@shared/types'
import {
  CALL_ATTEMPTS_PER_ROUND,
  CALL_COOLDOWN_MS,
  LOCK_MS,
  MESSAGE_TTL_MS,
  PING_PUSHES_PER_ROUND,
  VIDEO_UNLOCK_MS,
} from '@shared/constants'
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '../messages/store'
import type { CallMode, Connection, DuoSession, DuoState, NotificationResult, Profile } from './types'

export type FakeOptions = {
  /** Start already paired, with a friend and a few messages (default), or on the setup screen. */
  start?: 'ready' | 'setup'
  /** The friend answers your messages with an emoji while present. */
  autoReply?: boolean
  /** Artificial latency of async actions, ms. */
  latency?: number
  now?: () => number
}

/** Knobs for the dev panel: everything the server or the friend could do. */
export type FakeDev = {
  /** peerHasPush: the friend turned notifications on (pings to her can be pushed). */
  options: { autoReply: boolean; peerHasPush: boolean }
  setPhase(phase: 'setup' | 'ready'): void
  setConnection(c: Connection): void
  peerJoins(): void
  peerLeaves(): void
  peerUnpaired(): void
  peerSays(text?: string): void
  seedChat(): void
  expireOldest(): void
  clearChat(): void
  nudge(): void
  /** She calls us (her switch to AUDIO). */
  incoming(): void
  peerCancels(): void
  /** She joins our ringing call. */
  peerAccepts(): void
  ringTimeout(): void
  peerHangsUp(): void
  /** Her switch during a call: AUDIO or VIDEO. */
  peerMode(mode: 'audio' | 'video'): void
  setCallView(kind: 'ready' | 'cooldown' | 'nobodyHome'): void
  setPingView(kind: 'ready' | 'exhausted'): void
  setError(text: string | null): void
  /** The app was opened from a call notification after the call was already gone. */
  missedFromPush(): void
}

export type FakeSession = DuoSession & { dev: FakeDev }

const FRIEND: Profile = { name: 'Соня', avatar: 'fox' }
const ME_DEFAULT: Profile = { name: 'Маша', avatar: 'bunny' }
const REPLIES = ['😂', '🥰', '👍', 'Привет!', '🦄✨', 'Давай играть?', '🐱🐶', 'Ура! 🎉']

export function createFakeSession(opts: FakeOptions = {}): FakeSession {
  const now = opts.now ?? Date.now
  const latency = opts.latency ?? 400
  const options = reactive({ autoReply: opts.autoReply ?? true, peerHasPush: true })
  let idSeq = 0
  let callAttempts = 0
  let pingPushes = 0
  let ringTimer: ReturnType<typeof setTimeout> | undefined
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined
  let replyTimer: ReturnType<typeof setTimeout> | undefined

  const mySide: Side = 'a'
  const peerSide: Side = 'b'

  const state = reactive<DuoState>({
    phase: 'setup',
    self: null,
    missedCall: null,
    connection: 'online',
    me: null,
    peer: null,
    view: null,
    messages: [],
    pendingIds: [],
    directOpen: false,
    nudgeAt: null,
    lastPing: null,
    myMode: 'off',
    peerMode: 'off',
    videoUnlockAt: null,
    media: { local: null, remote: null, videoOn: false },
    lastCallEnded: null,
    error: null,
  })

  const view = (): RoomView => {
    if (!state.view) state.view = baseView(mySide, false)
    return state.view
  }
  const syncDirect = () => {
    state.directOpen = state.connection === 'online' && !!state.view?.peerPresent
    // The outbox flushes as soon as the direct link opens.
    if (state.directOpen && state.pendingIds.length) state.pendingIds = []
  }
  const wait = () => new Promise<void>((r) => setTimeout(r, latency))
  const add = (from: Side, text: string) => {
    const msg: ChatMessage = { id: `m${++idSeq}`, from, text, sentAt: now() }
    state.messages.push(msg)
    return msg
  }

  // --- media: animated canvases stand in for cameras (no permission prompts in dev) ---
  const stopMedia = () => {
    for (const s of [state.media.local, state.media.remote]) s?.getTracks().forEach((t) => t.stop())
    state.media.local = null
    state.media.remote = null
    state.media.videoOn = false
  }
  /** Video only while both switches are on VIDEO, like the real session. */
  const syncVideo = () => {
    const want = !!state.view?.inCall && state.myMode === 'video' && state.peerMode === 'video'
    if (want === state.media.videoOn) return
    stopMedia()
    if (!want) return
    state.media.videoOn = true
    state.media.local = fakeCamera('🐰', '#6C5CE7', '#FFB23F')
    state.media.remote = fakeCamera('🦊', '#22B07D', '#6C5CE7')
  }
  const endCall = () => {
    stopMedia()
    state.myMode = 'off'
    state.peerMode = 'off'
    state.videoUnlockAt = null
  }

  // --- call attempt rules, simplified from the server's state machine ---
  /** The call ended unanswered: the cooldown ends with it; out of attempts locks the button. */
  const finishAttempt = () => {
    const v = view()
    clearTimeout(cooldownTimer)
    v.call = callAttempts >= CALL_ATTEMPTS_PER_ROUND ? { kind: 'nobodyHome', until: now() + LOCK_MS } : { kind: 'ready' }
  }
  const scheduleCooldownEnd = (until: number) => {
    clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      const v = view()
      if (v.call.kind === 'cooldown') v.call = { kind: 'ready' }
    }, Math.max(0, until - now()))
  }
  const connect = () => {
    const v = view()
    clearTimeout(ringTimer)
    v.outgoing = null
    v.incoming = false
    v.inCall = true
    v.call = { kind: 'ready' }
    callAttempts = 0
    state.myMode = 'audio'
    state.peerMode = 'audio'
  }
  const hangUp = (reason: CallEndReason) => {
    const v = view()
    if (!v.inCall) return
    v.inCall = false
    endCall()
    state.lastCallEnded = reason
  }

  const session: FakeSession = {
    state,

    async createPair({ adminSecret, me }) {
      await wait()
      if (!adminSecret.trim()) throw new Error('Нужен пароль администратора')
      state.me = me
      state.self = 'a'
      state.view = baseView('a', false)
      state.phase = 'ready'
      const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      return { link: `${location.origin}/#${secret}` }
    },

    async joinPair({ me }) {
      await wait()
      state.me = me
      state.peer = { ...FRIEND }
      state.self = 'b'
      state.view = { ...baseView('b', true), peerPresent: true }
      state.phase = 'ready'
      syncDirect()
    },

    async enableNotifications(): Promise<NotificationResult> {
      await wait()
      return 'granted'
    },

    sendText(text) {
      const t = text.trim()
      if (!t || t.length > MAX_MESSAGE_LENGTH) return
      const msg = add(mySide, t)
      if (!state.directOpen) state.pendingIds.push(msg.id)
      if (options.autoReply && state.view?.peerPresent) {
        clearTimeout(replyTimer)
        replyTimer = setTimeout(() => dev.peerSays(), 1200)
      }
    },

    ping() {
      const v = view()
      const result = (r: PingResult) => (state.lastPing = { result: r, at: now() })
      if (v.peerPresent) return void result('nudged')
      // Rationed, or nobody to push to: nothing is counted.
      if (!v.peerPaired || v.ping.kind === 'exhausted' || !options.peerHasPush) return void result('held')
      pingPushes++
      if (pingPushes >= PING_PUSHES_PER_ROUND) v.ping = { kind: 'exhausted', until: now() + LOCK_MS }
      result('pushed')
    },

    async setMode(mode: CallMode) {
      const v = view()
      const from = state.myMode
      if (mode === from) return
      if (mode === 'off') {
        if (v.inCall) return hangUp('hangup')
        if (v.outgoing) {
          clearTimeout(ringTimer)
          v.outgoing = null
          state.lastCallEnded = 'cancelled'
          finishAttempt()
        }
        endCall()
        return
      }
      if (from === 'off') {
        if (mode !== 'audio' || v.inCall || v.outgoing) return
        if (v.incoming) {
          state.missedCall = null
          connect()
        } else if (v.peerPaired && v.call.kind === 'ready') {
          state.missedCall = null
          const until = now() + CALL_COOLDOWN_MS
          callAttempts++
          v.outgoing = { until }
          v.call = { kind: 'cooldown', until }
          scheduleCooldownEnd(until)
          ringTimer = setTimeout(() => dev.ringTimeout(), until - now())
        } else return
        state.myMode = 'audio'
        state.videoUnlockAt = now() + VIDEO_UNLOCK_MS
        return
      }
      if (mode === 'video' && now() < (state.videoUnlockAt ?? Infinity)) return
      state.myMode = mode
      syncVideo()
    },

    dismissCallEnded() {
      state.lastCallEnded = null
    },

    dismissMissedCall() {
      state.missedCall = null
    },

    dismissError() {
      state.error = null
    },

    dev: undefined as unknown as FakeDev,
  }

  const missed = () => {
    state.missedCall = { at: now() }
  }

  const end = (reason: CallEndReason) => {
    state.lastCallEnded = reason
  }

  const dev: FakeDev = {
    options,
    setPhase(phase) {
      state.phase = phase
      if (phase === 'ready' && !state.me) {
        state.me = { ...ME_DEFAULT }
        state.peer = { ...FRIEND }
        state.view = { ...baseView(mySide, true), peerPresent: true }
        state.self = mySide
        syncDirect()
      }
    },
    setConnection(c) {
      state.connection = c
      syncDirect()
    },
    peerJoins() {
      const v = view()
      v.peerPaired = true
      v.peerPresent = true
      state.peer ??= { ...FRIEND }
      syncDirect()
    },
    peerLeaves() {
      const v = view()
      v.peerPresent = false
      syncDirect()
    },
    peerUnpaired() {
      const v = view()
      v.peerPaired = false
      v.peerPresent = false
      state.peer = null
      syncDirect()
    },
    peerSays(text) {
      add(peerSide, text ?? REPLIES[idSeq % REPLIES.length]!)
      // A reply from the friend resets our ping counter.
      pingPushes = 0
      view().ping = { kind: 'ready' }
    },
    seedChat() {
      const t = now()
      const seed: [Side, string, number][] = [
        [peerSide, 'Привет! 👋', 9],
        [mySide, 'Привет!!! 🥰', 8],
        [peerSide, '🐱🐶🦄', 7],
        [mySide, 'Что делаешь?', 6],
        [peerSide, 'Рисую радугу 🌈🎨', 5],
        [mySide, '😍', 4],
        [peerSide, 'Пойдём завтра на площадку?', 3],
        [mySide, 'Да! ⭐⭐⭐', 2],
      ]
      for (const [from, text, minAgo] of seed) {
        state.messages.push({ id: `m${++idSeq}`, from, text, sentAt: t - minAgo * 60_000 })
      }
    },
    expireOldest() {
      state.messages.shift()
    },
    clearChat() {
      state.messages.splice(0)
      state.pendingIds = []
    },
    nudge() {
      state.nudgeAt = now()
    },
    incoming() {
      const v = view()
      if (v.inCall || v.outgoing) return
      state.missedCall = null
      v.incoming = true
      state.peerMode = 'audio'
    },
    peerCancels() {
      const v = view()
      if (!v.incoming) return
      missed()
      v.incoming = false
      state.peerMode = 'off'
      end('cancelled')
    },
    peerAccepts() {
      const v = view()
      if (v.outgoing) connect()
    },
    ringTimeout() {
      const v = view()
      if (v.incoming) {
        missed()
        v.incoming = false
        state.peerMode = 'off'
        end('timeout')
        return
      }
      if (!v.outgoing) return
      clearTimeout(ringTimer)
      v.outgoing = null
      endCall()
      end('timeout')
      finishAttempt()
    },
    peerHangsUp() {
      hangUp('hangup')
    },
    peerMode(mode) {
      if (!view().inCall) return
      state.peerMode = mode
      syncVideo()
    },
    setCallView(kind) {
      const v = view()
      if (kind === 'ready') {
        callAttempts = 0
        v.call = { kind }
      } else if (kind === 'cooldown') {
        const until = now() + CALL_COOLDOWN_MS
        v.call = { kind, until }
        scheduleCooldownEnd(until)
      } else {
        callAttempts = CALL_ATTEMPTS_PER_ROUND
        v.call = { kind, until: now() + LOCK_MS }
      }
    },
    setPingView(kind) {
      const v = view()
      pingPushes = kind === 'exhausted' ? PING_PUSHES_PER_ROUND : 0
      v.ping = kind === 'ready' ? { kind } : { kind, until: now() + LOCK_MS }
    },
    setError(text) {
      state.error = text
    },
    missedFromPush() {
      const v = view()
      v.incoming = false
      state.peerMode = 'off'
      missed()
    },
  }
  session.dev = dev

  // Messages vanish one hour after they were sent, like the real store.
  if (typeof window !== 'undefined') {
    setInterval(() => {
      const cut = now() - MESSAGE_TTL_MS
      const keep = state.messages.filter((m) => m.sentAt > cut)
      if (keep.length !== state.messages.length) state.messages.splice(0, state.messages.length, ...keep)
    }, 1000)
  }

  if ((opts.start ?? 'ready') === 'ready') {
    dev.setPhase('ready')
    dev.seedChat()
  }
  return session
}

function baseView(self: Side, peerPaired: boolean): RoomView {
  return {
    self,
    peerPaired,
    peerPresent: false,
    call: { kind: 'ready' },
    ping: { kind: 'ready' },
    incoming: false,
    outgoing: null,
    inCall: false,
  }
}

/** An animated canvas as a camera stand-in. markRaw: a Vue proxy is not a MediaStream. */
function fakeCamera(glyph: string, from: string, to: string): MediaStream | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.captureStream !== 'function') return null
  const stream = canvas.captureStream(15)
  let t = 0
  const draw = () => {
    if (!stream.getVideoTracks().some((tr) => tr.readyState === 'live')) return
    t += 1
    const g = ctx.createLinearGradient(0, 0, 640, 480)
    g.addColorStop(0, from)
    g.addColorStop(1, to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 640, 480)
    ctx.font = '200px system-ui, "Apple Color Emoji", "Noto Color Emoji"'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, 320 + Math.sin(t / 10) * 40, 240 + Math.cos(t / 13) * 20)
    setTimeout(draw, 66)
  }
  draw()
  return markRaw(stream)
}
