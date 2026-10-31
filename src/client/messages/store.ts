// Ephemeral chat messages, kept only on the devices.
// Every message lives exactly MESSAGE_TTL_MS from `sentAt`, wherever it is:
// in the sender's outbox, in transit, or on the receiver's screen.
// Clock skew guard: a message expires at min(sentAt, arrival time) + TTL, so a peer clock
// running ahead can never make a message live longer than an hour on this device.

import type { Side } from '@shared/types'

export const MAX_MESSAGE_LENGTH = 1000

export type ChatMessage = { id: string; from: Side; text: string; sentAt: number }

export type StoredMessage = ChatMessage & {
  expiresAt: number
  /** Our own message that has not been handed to the data channel yet. */
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
  constructor(_opts: MessageStoreOptions) {
    throw new Error('not implemented')
  }

  /** Loads persisted messages and drops expired ones. */
  async init(): Promise<void> {
    throw new Error('not implemented')
  }

  /** Adds our message to the timeline and the outbox. Trims; throws on empty or too long text. */
  compose(_text: string): ChatMessage {
    throw new Error('not implemented')
  }

  /**
   * A message from the peer arrived. Returns false (and ignores it) when it is expired,
   * a duplicate, not from the peer side, or malformed.
   */
  receive(_msg: unknown): boolean {
    throw new Error('not implemented')
  }

  /** Our not-yet-sent, not-expired messages, oldest first. */
  outbox(): ChatMessage[] {
    throw new Error('not implemented')
  }

  markSent(_ids: string[]): void {
    throw new Error('not implemented')
  }

  /** All live messages (ours and theirs), sorted by sentAt then id. */
  timeline(): ChatMessage[] {
    throw new Error('not implemented')
  }

  /** Removes expired messages; returns how many were removed. */
  sweep(): number {
    throw new Error('not implemented')
  }

  /** When the next message expires, so the UI can schedule a sweep. */
  nextExpiryAt(): number | null {
    throw new Error('not implemented')
  }

  /** Called after every change of the timeline. Returns an unsubscribe function. */
  onChange(_cb: () => void): () => void {
    throw new Error('not implemented')
  }

  /** Resolves when the latest state has been written to persistence. */
  async flush(): Promise<void> {
    throw new Error('not implemented')
  }
}
