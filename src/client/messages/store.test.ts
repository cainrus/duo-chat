import { describe, expect, it } from 'vitest'
import { MESSAGE_TTL_MS } from '@shared/constants'
import { MAX_MESSAGE_LENGTH, MessageStore, type MessagePersistence, type StoredMessage } from './store'

const T0 = 1_700_000_000_000

function memory(initial: StoredMessage[] = []): MessagePersistence & { saved: StoredMessage[] } {
  const p = {
    saved: initial,
    async load() {
      return structuredClone(p.saved)
    },
    async save(all: StoredMessage[]) {
      p.saved = structuredClone(all)
    },
  }
  return p
}

function makeStore(self: 'a' | 'b' = 'a', persistence = memory()) {
  let now = T0
  let n = 0
  const store = new MessageStore({ self, persistence, now: () => now, newId: () => `id${++n}` })
  return { store, persistence, setNow: (t: number) => (now = t) }
}

describe('composing', () => {
  it('puts our message in the timeline and the outbox', async () => {
    const { store } = makeStore()
    await store.init()
    const m = store.compose('  привет  ')
    expect(m).toEqual({ id: 'id1', from: 'a', text: 'привет', sentAt: T0 })
    expect(store.timeline()).toEqual([m])
    expect(store.outbox()).toEqual([m])
    store.markSent([m.id])
    expect(store.outbox()).toEqual([])
    expect(store.timeline()).toEqual([m])
  })

  it('refuses empty and too long text', async () => {
    const { store } = makeStore()
    await store.init()
    expect(() => store.compose('   ')).toThrow()
    expect(() => store.compose('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toThrow()
  })
})

describe('one hour of life', () => {
  it('an unsent message expires in the outbox and is never sent', async () => {
    const { store, setNow } = makeStore()
    await store.init()
    store.compose('ау')
    setNow(T0 + MESSAGE_TTL_MS)
    expect(store.outbox()).toEqual([])
    expect(store.timeline()).toEqual([])
  })

  it('received at minute 59, gone at minute 60 (the owner\'s example)', async () => {
    const { store, setNow } = makeStore('b')
    await store.init()
    setNow(T0 + 59 * 60_000)
    expect(store.receive({ id: 'x', from: 'a', text: 'hi', sentAt: T0 })).toBe(true)
    expect(store.timeline()).toHaveLength(1)
    expect(store.nextExpiryAt()).toBe(T0 + MESSAGE_TTL_MS)
    setNow(T0 + MESSAGE_TTL_MS)
    expect(store.timeline()).toEqual([])
    expect(store.sweep()).toBe(1)
  })

  it('ignores a message that is already expired on arrival', async () => {
    const { store, setNow } = makeStore('b')
    await store.init()
    setNow(T0 + MESSAGE_TTL_MS + 1)
    expect(store.receive({ id: 'x', from: 'a', text: 'hi', sentAt: T0 })).toBe(false)
  })

  it('a sender clock running ahead cannot extend the hour on this device', async () => {
    const { store, setNow } = makeStore('b')
    await store.init()
    expect(store.receive({ id: 'x', from: 'a', text: 'hi', sentAt: T0 + 5 * MESSAGE_TTL_MS })).toBe(true)
    setNow(T0 + MESSAGE_TTL_MS)
    expect(store.timeline()).toEqual([])
  })
})

describe('receiving', () => {
  it('drops duplicates, our own side, and malformed input', async () => {
    const { store } = makeStore('b')
    await store.init()
    const m = { id: 'x', from: 'a', text: 'hi', sentAt: T0 }
    expect(store.receive(m)).toBe(true)
    expect(store.receive(m)).toBe(false)
    expect(store.receive({ ...m, id: 'y', from: 'b' })).toBe(false)
    expect(store.receive({ id: 'z', from: 'a', text: 42, sentAt: T0 })).toBe(false)
    expect(store.receive({ id: 'w', from: 'a', text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1), sentAt: T0 })).toBe(false)
    expect(store.receive(null)).toBe(false)
    expect(store.timeline()).toHaveLength(1)
  })

  it('orders the timeline by send time', async () => {
    const { store, setNow } = makeStore('b')
    await store.init()
    setNow(T0 + 10)
    const mine = store.compose('second')
    store.receive({ id: 'x', from: 'a', text: 'first', sentAt: T0 })
    expect(store.timeline().map((m) => m.text)).toEqual(['first', mine.text])
  })

  it('notifies listeners on change', async () => {
    const { store } = makeStore('b')
    await store.init()
    let calls = 0
    const off = store.onChange(() => calls++)
    store.compose('a')
    store.receive({ id: 'x', from: 'a', text: 'hi', sentAt: T0 })
    off()
    store.compose('b')
    expect(calls).toBe(2)
  })
})

describe('persistence', () => {
  it('survives a reload within the hour, outbox included', async () => {
    const first = makeStore('a')
    await first.store.init()
    const m = first.store.compose('держись')
    await first.store.flush()

    const second = makeStore('a', first.persistence)
    second.setNow(T0 + 1000)
    await second.store.init()
    expect(second.store.timeline()).toEqual([m])
    expect(second.store.outbox()).toEqual([m])
  })

  it('drops expired messages when loading', async () => {
    const first = makeStore('a')
    await first.store.init()
    first.store.compose('old')
    await first.store.flush()
    const second = makeStore('a', first.persistence)
    second.setNow(T0 + MESSAGE_TTL_MS)
    await second.store.init()
    expect(second.store.timeline()).toEqual([])
    await second.store.flush()
    expect(first.persistence.saved).toEqual([])
  })
})
