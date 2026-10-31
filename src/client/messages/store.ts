// Ephemeral chat messages, kept only on the devices.
// Every message lives exactly MESSAGE_TTL_MS from `sentAt`, wherever it is:
// in the sender's outbox, in transit, or on the receiver's screen.
// Clock skew guard: a message expires at min(sentAt, arrival time) + TTL, so a peer clock
// running ahead can never make a message live longer than an hour on this device.

import { MESSAGE_TTL_MS } from '@shared/constants'
import type { Side } from '@shared/types'

export const MAX_MESSAGE_LENGTH = 1000

/**
 * A chat item. `kind: 'voice'` (no text) is a service line: its sender waited in the voice room
 * and left before the friend joined. It travels and expires exactly like a message.
 * A plain text message has no `kind` (an incoming `'text'` is accepted too).
 */
export type ChatMessage = { id: string; from: Side; text: string; sentAt: number; kind?: 'voice' }

export type StoredMessage = ChatMessage & {
  expiresAt: number
  /** Our own message the friend has not acked yet. */
  pending: boolean
}

export interface MessagePersistence {
  load(): Promise<StoredMessage[]>
  save(all: StoredMessage[]): Promise<void>
}

export type MessageStoreOptions = {
  self: Side
  persistence: MessagePersistence
  now?: () => number
  newId?: () => string
}

export class MessageStore {
  private readonly self: Side
  private readonly persistence: MessagePersistence
  private readonly now: () => number
  private readonly newId: () => string
  private messages: StoredMessage[] = []
  private listeners = new Set<() => void>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(opts: MessageStoreOptions) {
    this.self = opts.self
    this.persistence = opts.persistence
    this.now = opts.now ?? Date.now
    this.newId = opts.newId ?? (() => crypto.randomUUID())
  }

  /** Loads persisted messages and drops expired ones. */
  async init(): Promise<void> {
    const loaded = await this.persistence.load()
    const now = this.now()
    this.messages = loaded.filter((m) => m.expiresAt > now)
    if (this.messages.length !== loaded.length) this.persist()
    if (this.messages.length > 0) this.emit()
  }

  /** Adds our message to the timeline and the outbox. Trims; throws on empty or too long text. */
  compose(text: string): ChatMessage {
    const trimmed = text.trim()
    if (trimmed.length === 0) throw new Error('empty message')
    if (trimmed.length > MAX_MESSAGE_LENGTH) throw new Error('message too long')
    return this.add({ id: this.newId(), from: this.self, text: trimmed, sentAt: this.now() })
  }

  /** Adds our voice room service item (we left the room before the friend joined). */
  composeVoice(): ChatMessage {
    return this.add({ id: this.newId(), from: this.self, text: '', sentAt: this.now(), kind: 'voice' })
  }

  private add(msg: ChatMessage): ChatMessage {
    this.messages.push({ ...msg, expiresAt: msg.sentAt + MESSAGE_TTL_MS, pending: true })
    this.persist()
    this.emit()
    return msg
  }

  /**
   * A message from the peer arrived. Returns false (and ignores it) when it is expired,
   * a duplicate, not from the peer side, or malformed.
   */
  receive(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null) return false
    const m = msg as Record<string, unknown>
    const { id, from, text, sentAt, kind } = m
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) return false
    const other: Side = this.self === 'a' ? 'b' : 'a'
    if (from !== other) return false
    if (kind !== undefined && kind !== 'text' && kind !== 'voice') return false
    const voice = kind === 'voice'
    if (typeof text !== 'string') return false
    if (voice ? text !== '' : text.length < 1 || text.length > MAX_MESSAGE_LENGTH) return false
    if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return false
    if (this.messages.some((x) => x.id === id)) return false
    const now = this.now()
    const expiresAt = Math.min(sentAt, now) + MESSAGE_TTL_MS
    if (expiresAt <= now) return false
    this.messages.push({ id, from: other, text, sentAt, ...(voice ? { kind: 'voice' as const } : {}), expiresAt, pending: false })
    this.persist()
    this.emit()
    return true
  }

  /** Our not-yet-acked, not-expired messages, oldest first. */
  outbox(): ChatMessage[] {
    return this.live()
      .filter((m) => m.pending)
      .sort(byTime)
      .map(toChat)
  }

  markSent(ids: string[]): void {
    let changed = false
    for (const m of this.messages) {
      if (m.pending && ids.includes(m.id)) {
        m.pending = false
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** All live messages (ours and theirs), sorted by sentAt then id. */
  timeline(): ChatMessage[] {
    return this.live().sort(byTime).map(toChat)
  }

  /** Removes expired messages; returns how many were removed. */
  sweep(): number {
    const now = this.now()
    const before = this.messages.length
    this.messages = this.messages.filter((m) => m.expiresAt > now)
    const removed = before - this.messages.length
    if (removed > 0) {
      this.persist()
      this.emit()
    }
    return removed
  }

  /** When the next message expires, so the UI can schedule a sweep. */
  nextExpiryAt(): number | null {
    const live = this.live()
    return live.length === 0 ? null : Math.min(...live.map((m) => m.expiresAt))
  }

  /** Called after every change of the timeline. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /** Resolves when the latest state has been written to persistence. */
  async flush(): Promise<void> {
    await this.writeChain
  }

  private live(): StoredMessage[] {
    const now = this.now()
    return this.messages.filter((m) => m.expiresAt > now)
  }

  private persist(): void {
    const snapshot = structuredClone(this.live())
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => this.persistence.save(snapshot))
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }
}

function byTime(a: StoredMessage, b: StoredMessage): number {
  return a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function toChat(m: StoredMessage): ChatMessage {
  const c: ChatMessage = { id: m.id, from: m.from, text: m.text, sentAt: m.sentAt }
  return m.kind === 'voice' ? { ...c, kind: 'voice' } : c
}
