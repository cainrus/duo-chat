import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { deviceConfigStore, type DeviceConfig } from './config'

const sample: DeviceConfig = { secret: 'c2VjcmV0', side: 'b', deviceToken: 'tok' }

describe('device config', () => {
  it('round-trips, updates and clears', async () => {
    const store = deviceConfigStore('config-test-1')
    expect(await store.load()).toBeNull()
    await store.save(sample)
    expect(await store.load()).toEqual(sample)
    await store.save({ ...sample, pushMuted: true })
    // A second handle reads the same record.
    expect((await deviceConfigStore('config-test-1').load())?.pushMuted).toBe(true)
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('ignores a malformed record', async () => {
    const store = deviceConfigStore('config-test-2')
    await store.save({ ...sample, side: 'c' } as unknown as DeviceConfig)
    expect(await store.load()).toBeNull()
  })

  it('loads a record saved with the old name and picture, without them', async () => {
    const store = deviceConfigStore('config-test-3')
    const old = { ...sample, me: { name: 'Маша', avatar: 'bunny' }, peer: { name: 'Соня', avatar: 'fox' } }
    await store.save(old as unknown as DeviceConfig)
    expect(await store.load()).toEqual(sample)
  })
})
