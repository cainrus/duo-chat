import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { idbPersistence } from './idbPersistence'
import type { StoredMessage } from './store'

const sample: StoredMessage[] = [
  { id: 'a1', from: 'a', text: 'привет', sentAt: 1000, expiresAt: 5000, pending: true },
  { id: 'b1', from: 'b', text: 'hi', sentAt: 2000, expiresAt: 6000, pending: false },
]

describe('idbPersistence', () => {
  it('loads an empty list from a fresh database', async () => {
    expect(await idbPersistence('t-empty').load()).toEqual([])
  })

  it('round-trips messages, also through a new connection', async () => {
    await idbPersistence('t-rt').save(sample)
    expect(await idbPersistence('t-rt').load()).toEqual(sample)
  })

  it('overwrites the previous state', async () => {
    const p = idbPersistence('t-over')
    await p.save(sample)
    await p.save([sample[0]!])
    expect(await p.load()).toEqual([sample[0]])
  })
})
