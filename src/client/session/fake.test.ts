// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALL_COOLDOWN_MS } from '@shared/constants'
import { createFakeSession } from './fake'

describe('fake session', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = () => createFakeSession({ latency: 0, autoReply: false })

  it('two unanswered calls end in "nobody\'s home"', async () => {
    const s = make()
    const v = () => s.state.view!
    const p1 = s.startCall('voice')
    await vi.advanceTimersByTimeAsync(0)
    await p1
    expect(v().outgoing?.kind).toBe('voice')
    expect(v().call.kind).toBe('cooldown')

    await vi.advanceTimersByTimeAsync(CALL_COOLDOWN_MS)
    expect(v().outgoing).toBeNull()
    expect(s.state.lastCallEnded).toBe('timeout')
    expect(v().call.kind).toBe('ready')

    const p2 = s.startCall('video')
    await vi.advanceTimersByTimeAsync(0)
    await p2
    s.dev.ringTimeout()
    expect(v().call.kind).toBe('nobodyHome')
  })

  it('accepting an incoming call connects it and hang-up reports why', async () => {
    const s = make()
    s.dev.incoming('video')
    const p = s.acceptCall()
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(s.state.view!.inCall).toEqual({ kind: 'video' })
    expect(s.state.view!.incoming).toBeNull()
    s.hangUp()
    expect(s.state.view!.inCall).toBeNull()
    expect(s.state.lastCallEnded).toBe('hangup')
  })

  it('ping pushes run out while the friend is away, and a reply resets them', () => {
    const s = make()
    s.dev.peerLeaves()
    s.ping()
    expect(s.state.view!.ping.kind).toBe('ready')
    s.ping()
    expect(s.state.view!.ping.kind).toBe('exhausted')
    s.dev.peerSays('🙂')
    expect(s.state.view!.ping.kind).toBe('ready')
  })
})
