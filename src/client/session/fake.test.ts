// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALL_COOLDOWN_MS, VIDEO_UNLOCK_MS } from '@shared/constants'
import { createFakeSession } from './fake'

describe('fake session', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = () => createFakeSession({ latency: 0, autoReply: false })

  it('voice room: we wait with no timeout; giving up twice ends in "nobody\'s home"', async () => {
    const s = make()
    const v = () => s.state.view!
    await s.setMode('audio')
    expect(s.state.myMode).toBe('audio')
    expect(v().outgoing).toBe(true)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(v().outgoing).toBe(true)

    await s.setMode('off')
    expect(s.state.lastCallEnded).toBe('cancelled')
    expect(v().call.kind).toBe('cooldown')
    await vi.advanceTimersByTimeAsync(CALL_COOLDOWN_MS)
    expect(v().call.kind).toBe('ready')

    await s.setMode('audio')
    await s.setMode('off')
    expect(v().call.kind).toBe('nobodyHome')
  })

  it('AUDIO joins her call; OFF hangs up and reports why', async () => {
    const s = make()
    s.dev.incoming()
    expect(s.state.peerMode).toBe('audio')
    await s.setMode('audio')
    expect(s.state.view!.inCall).toBe(true)
    expect(s.state.view!.incoming).toBe(false)
    await s.setMode('off')
    expect(s.state.view!.inCall).toBe(false)
    expect(s.state.lastCallEnded).toBe('hangup')
    expect(s.state).toMatchObject({ myMode: 'off', peerMode: 'off' })
  })

  it('her call she stops waiting in is missed', () => {
    const s = make()
    s.dev.incoming()
    s.dev.peerCancels()
    expect(s.state.view!.incoming).toBe(false)
    expect(s.state.peerMode).toBe('off')
    expect(s.state.missedCall).not.toBeNull()
  })

  it('VIDEO: locked from OFF and for a moment after AUDIO; video only while both are on VIDEO', async () => {
    const s = make()
    await s.setMode('video')
    expect(s.state.myMode).toBe('off')
    s.dev.incoming()
    await s.setMode('audio')
    await s.setMode('video')
    expect(s.state.myMode).toBe('audio')
    vi.advanceTimersByTime(VIDEO_UNLOCK_MS)
    await s.setMode('video')
    expect(s.state).toMatchObject({ myMode: 'video', peerMode: 'audio' })
    expect(s.state.media.videoOn).toBe(false)
    s.dev.peerMode('video')
    expect(s.state.media.videoOn).toBe(true)
    s.dev.peerMode('audio')
    expect(s.state.media.videoOn).toBe(false)
    s.dev.peerHangsUp()
    expect(s.state).toMatchObject({ myMode: 'off', peerMode: 'off' })
  })

  it('ping pushes run out while the friend is away, and a reply resets them', () => {
    const s = make()
    s.dev.peerLeaves()
    s.ping()
    expect(s.state.lastPing?.result).toBe('pushed')
    expect(s.state.view!.ping.kind).toBe('ready')
    s.ping()
    expect(s.state.view!.ping.kind).toBe('exhausted')
    s.ping()
    expect(s.state.lastPing?.result).toBe('held')
    s.dev.peerSays('🙂')
    expect(s.state.view!.ping.kind).toBe('ready')
  })

  it('ping result: nudged while she is here, held when she has no notifications (not counted)', () => {
    const s = make()
    s.ping()
    expect(s.state.lastPing?.result).toBe('nudged')
    s.dev.peerLeaves()
    s.dev.options.peerHasPush = false
    s.ping()
    s.ping()
    expect(s.state.lastPing?.result).toBe('held')
    expect(s.state.view!.ping.kind).toBe('ready')
  })
})
