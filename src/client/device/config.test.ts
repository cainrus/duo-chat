import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { deviceConfigStore, isProfile, type DeviceConfig } from './config'

const sample: DeviceConfig = {
  secret: 'c2VjcmV0',
  side: 'b',
  deviceToken: 'tok',
  me: { name: 'Маша', avatar: 'bunny' },
  peer: null,
}

describe('device config', () => {
  it('round-trips, updates and clears', async () => {
    const store = deviceConfigStore('config-test-1')
    expect(await store.load()).toBeNull()
    await store.save(sample)
    expect(await store.load()).toEqual(sample)
    await store.save({ ...sample, peer: { name: 'Соня', avatar: 'fox' } })
    // A second handle (like the service worker) reads the same record.
    expect((await deviceConfigStore('config-test-1').load())?.peer?.name).toBe('Соня')
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('ignores a malformed record', async () => {
    const store = deviceConfigStore('config-test-2')
    await store.save({ ...sample, side: 'c' } as unknown as DeviceConfig)
    expect(await store.load()).toBeNull()
  })

  it('validates profiles', () => {
    expect(isProfile({ name: 'Соня', avatar: 'fox' })).toBe(true)
    expect(isProfile({ name: '  ', avatar: 'fox' })).toBe(false)
    expect(isProfile({ name: 'Соня', avatar: 'dragon' })).toBe(false)
    expect(isProfile({ name: 'x'.repeat(41), avatar: 'fox' })).toBe(false)
  })
})
