// A fake DuoSession for UI development (`VITE_FAKE=1 pnpm dev`) and component tests.
// It imitates what the server and the friend's device would do, so every screen and
// button state is reachable from the dev panel (FakeDevPanel.vue). Never used in production:
// main.ts imports it dynamically behind `import.meta.env.VITE_FAKE`, so the build drops it.

import { markRaw, reactive } from 'vue'
import type { CallEndReason, RoomView } from '@shared/protocol'
import type { CallKind, Side } from '@shared/types'
import {
  CALL_ATTEMPTS_PER_ROUND,
  CALL_COOLDOWN_MS,
  LOCK_MS,
  MESSAGE_TTL_MS,
  PING_PUSHES_PER_ROUND,
} from '@shared/constants'
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '../messages/store'
import type { Connection, DuoSession, DuoState, NotificationResult, Profile } from './types'

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
  options: { autoReply: boolean }
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
  incoming(kind: CallKind): void
  peerCancels(): void
  peerAccepts(): void
  peerDeclines(): void
  ringTimeout(): void
  peerHangsUp(): void
  peerCamera(on: boolean): void
  setCallView(kind: 'ready' | 'cooldown' | 'nobodyHome'): void
  setPingView(kind: 'ready' | 'exhausted'): void
  setError(text: string | null): void
  /** The app was opened from a call notification after the call was already gone. */
  missedFromPush(kind?: CallKind): void
}

export type FakeSession = DuoSession & { dev: FakeDev }

const FRIEND: Profile = { name: 'Соня', avatar: 'fox' }
const ME_DEFAULT: Profile = { name: 'Маша', avatar: 'bunny' }
const REPLIES = ['😂', '🥰', '👍', 'Привет!', '🦄✨', 'Давай играть?', '🐱🐶', 'Ура! 🎉']

export function createFakeSession(opts: FakeOptions = {}): FakeSession {
  const now = opts.now ?? Date.now
  const latency = opts.latency ?? 400
  const options = reactive({ autoReply: opts.autoReply ?? true })
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
    directOpen: false,
    nudgeAt: null,
    media: { local: null, remote: null, micOn: true, camOn: false },
    lastCallEnded: null,
    error: null,
  })

  const view = (): RoomView => {
    if (!state.view) state.view = baseView(mySide, false)
    return state.view
  }
  const syncDirect = () => {
    state.directOpen = state.connection === 'online' && !!state.view?.peerPresent
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
  }
  const startMedia = (kind: CallKind) => {
    state.media.micOn = true
    state.media.camOn = kind === 'video'
    state.media.local = kind === 'video' ? fakeCamera('🐰', '#6C5CE7', '#FFB23F') : null
    state.media.remote = kind === 'video' ? fakeCamera('🦊', '#22B07D', '#6C5CE7') : null
  }

  // --- call attempt rules, simplified from the server's state machine ---
  const finishAttempt = (endedEarly: boolean) => {
    const v = view()
    if (callAttempts >= CALL_ATTEMPTS_PER_ROUND) {
      v.call = { kind: 'nobodyHome', until: now() + LOCK_MS }
    } else if (endedEarly || v.call.kind !== 'cooldown') {
      v.call = { kind: 'ready' }
    }
  }
  const scheduleCooldownEnd = (until: number) => {
    clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      const v = view()
      if (v.call.kind === 'cooldown') v.call = { kind: 'ready' }
    }, Math.max(0, until - now()))
  }
  const connect = (kind: CallKind) => {
    const v = view()
    clearTimeout(ringTimer)
    v.outgoing = null
    v.incoming = null
    v.inCall = { kind }
    v.call = { kind: 'ready' }
    callAttempts = 0
    startMedia(kind)
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
      add(mySide, t)
      if (options.autoReply && state.view?.peerPresent) {
        clearTimeout(replyTimer)
        replyTimer = setTimeout(() => dev.peerSays(), 1200)
      }
    },

    ping() {
      const v = view()
      if (v.peerPresent || v.ping.kind === 'exhausted') return // nudge goes to the friend, nothing to show here
      pingPushes++
      if (pingPushes >= PING_PUSHES_PER_ROUND) v.ping = { kind: 'exhausted', until: now() + LOCK_MS }
    },

    async startCall(kind) {
      const v = view()
      if (v.call.kind !== 'ready' || v.outgoing || v.inCall || v.incoming) return
      await wait()
      state.missedCall = null
      const until = now() + CALL_COOLDOWN_MS
      callAttempts++
      v.outgoing = { kind, until }
      v.call = { kind: 'cooldown', until }
      scheduleCooldownEnd(until)
      ringTimer = setTimeout(() => dev.ringTimeout(), until - now())
    },

    cancelCall() {
      const v = view()
      if (!v.outgoing) return
      clearTimeout(ringTimer)
      v.outgoing = null
      state.lastCallEnded = 'cancelled'
      finishAttempt(false)
    },

    async acceptCall() {
      const v = view()
      if (!v.incoming) return
      await wait()
      state.missedCall = null
      connect(v.incoming.kind)
    },

    declineCall() {
      const v = view()
      v.incoming = null
    },

    hangUp() {
      const v = view()
      if (!v.inCall) return
      v.inCall = null
      stopMedia()
      state.lastCallEnded = 'hangup'
    },

    setMic(on) {
      state.media.micOn = on
    },

    async setCamera(on) {
      state.media.camOn = on
      if (on && !state.media.local) state.media.local = fakeCamera('🐰', '#6C5CE7', '#FFB23F')
      if (!on && state.media.local) {
        state.media.local.getTracks().forEach((t) => t.stop())
        state.media.local = null
      }
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

  const missed = (kind: CallKind) => {
    state.missedCall = { kind, at: now() }
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
    },
    nudge() {
      state.nudgeAt = now()
    },
    incoming(kind) {
      const v = view()
      state.missedCall = null
      v.incoming = { kind }
    },
    peerCancels() {
      const v = view()
      if (!v.incoming) return
      missed(v.incoming.kind)
      v.incoming = null
      end('cancelled')
    },
    peerAccepts() {
      const v = view()
      if (v.outgoing) connect(v.outgoing.kind)
    },
    peerDeclines() {
      const v = view()
      if (!v.outgoing) return
      clearTimeout(ringTimer)
      v.outgoing = null
      end('declined')
      finishAttempt(true)
    },
    ringTimeout() {
      const v = view()
      if (v.incoming) {
        missed(v.incoming.kind)
        v.incoming = null
        end('timeout')
        return
      }
      if (!v.outgoing) return
      clearTimeout(ringTimer)
      v.outgoing = null
      end('timeout')
      finishAttempt(false)
    },
    peerHangsUp() {
      const v = view()
      if (!v.inCall) return
      v.inCall = null
      stopMedia()
      end('hangup')
    },
    peerCamera(on) {
      state.media.remote?.getTracks().forEach((t) => t.stop())
      state.media.remote = on ? fakeCamera('🦊', '#22B07D', '#6C5CE7') : null
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
    missedFromPush(kind = 'voice') {
      const v = view()
      v.incoming = null
      missed(kind)
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
    incoming: null,
    outgoing: null,
    inCall: null,
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
