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

  it('a voice room left before the other joined leaves a voice line (hers or mine)', async () => {
    const s = make()
    s.dev.clearChat()
    s.dev.incoming()
    s.dev.peerCancels()
    expect(s.state.view!.incoming).toBe(false)
    expect(s.state.peerMode).toBe('off')
    expect(s.state.messages.map((m) => [m.from, m.kind])).toEqual([['b', 'voice']])
    await s.setMode('audio')
    await s.setMode('off')
    expect(s.state.messages.map((m) => [m.from, m.kind])).toEqual([['b', 'voice'], ['a', 'voice']])
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

  it('«онлайн»: a pause, the second, then nothing until tomorrow; the same whether or not she is here; a reply resets', () => {
    const s = make()
    s.ping()
    expect(s.state.view!.ping).toEqual({ kind: 'cooldown', until: Date.now() + CALL_COOLDOWN_MS })
    vi.advanceTimersByTime(CALL_COOLDOWN_MS)
    expect(s.state.view!.ping.kind).toBe('ready')
    s.dev.peerLeaves()
    s.ping()
    expect(s.state.view!.ping.kind).toBe('exhausted')
    s.dev.peerSays('🙂')
    expect(s.state.view!.ping.kind).toBe('ready')
  })

  it('the bell mutes and unmutes', async () => {
    const s = make()
    await s.setPushMuted(true)
    expect(s.state.pushMuted).toBe(true)
    await s.setPushMuted(false)
    expect(s.state.pushMuted).toBe(false)
  })
})
