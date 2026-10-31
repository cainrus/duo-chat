import { describe, expect, it } from 'vitest'
import { PRESENCE_GRACE_MS } from '@shared/constants'
import { initialPresence, isPresent, presenceExpiresAt, setActive } from './presence'

const T0 = 9_000_000

describe('presence', () => {
  it('a side that never connected is absent', () => {
    expect(isPresent(initialPresence(), T0)).toBe(false)
    expect(presenceExpiresAt(initialPresence())).toBeNull()
  })

  it('is present while active', () => {
    const p = setActive(initialPresence(), true, T0)
    expect(isPresent(p, T0 + 10 * PRESENCE_GRACE_MS)).toBe(true)
    expect(presenceExpiresAt(p)).toBeNull()
  })

  it('stays present for one minute after going inactive', () => {
    const p = setActive(setActive(initialPresence(), true, T0), false, T0 + 1000)
    expect(isPresent(p, T0 + 1000 + PRESENCE_GRACE_MS - 1)).toBe(true)
    expect(isPresent(p, T0 + 1000 + PRESENCE_GRACE_MS)).toBe(false)
    expect(presenceExpiresAt(p)).toBe(T0 + 1000 + PRESENCE_GRACE_MS)
  })

  it('repeated inactive reports do not extend the grace', () => {
    const a = setActive(setActive(initialPresence(), true, T0), false, T0)
    const b = setActive(a, false, T0 + 30_000)
    expect(presenceExpiresAt(b)).toBe(T0 + PRESENCE_GRACE_MS)
  })

  it('coming back clears the grace timer', () => {
    const p = setActive(setActive(setActive(initialPresence(), true, T0), false, T0 + 1), true, T0 + 2)
    expect(isPresent(p, T0 + 5 * PRESENCE_GRACE_MS)).toBe(true)
  })
})
