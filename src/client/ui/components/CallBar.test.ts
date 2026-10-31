// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { VIDEO_UNLOCK_MS } from '@shared/constants'
import ChatScreen from '../screens/ChatScreen.vue'
import callSwitchSource from './CallSwitch.vue?raw'
import { mountWithDuo } from '../test/mountWithDuo'

const ring = vi.hoisted(() => ({ starts: 0, stops: 0 }))
vi.mock('../sound', () => ({
  startRinging: () => {
    ring.starts++
    return () => ring.stops++
  },
}))

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function mountChat() {
  const { wrapper, session } = mountWithDuo(ChatScreen)
  const seg = (mode: 'off' | 'audio' | 'video') => wrapper.get(`[data-test="mode-${mode}"]`)
  const disabled = (mode: 'off' | 'audio' | 'video') => seg(mode).attributes('disabled') !== undefined
  const status = () => wrapper.get('[data-test="call-status"]').text()
  return { wrapper, session, seg, disabled, status }
}

describe('call switch in the chat', () => {
  it('from OFF only AUDIO can be tapped; VIDEO is disabled', () => {
    const { seg, disabled } = mountChat()
    expect(seg('off').attributes('aria-checked')).toBe('true')
    expect(disabled('audio')).toBe(false)
    expect(disabled('video')).toBe(true)
  })

  it('AUDIO calls her; VIDEO shows a lock and unlocks VIDEO_UNLOCK_MS later; OFF while ringing cancels', async () => {
    vi.useFakeTimers()
    const { session, seg, disabled, status, wrapper } = mountChat()
    await seg('audio').trigger('click')
    await nextTick()
    expect(session.state.myMode).toBe('audio')
    expect(session.state.view!.outgoing).toBe(true)
    expect(seg('audio').attributes('aria-checked')).toBe('true')
    expect(status()).toContain('ждём…')
    expect(disabled('video')).toBe(true)
    expect(wrapper.find('[data-test="video-lock"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(VIDEO_UNLOCK_MS)
    expect(disabled('video')).toBe(false)
    expect(wrapper.find('[data-test="video-lock"]').exists()).toBe(false)

    await seg('off').trigger('click')
    await nextTick()
    expect(session.state.myMode).toBe('off')
    expect(session.state.view!.outgoing).toBe(false)
  })

  it('her call: AUDIO glows as «Подключиться», a soft ring plays, no decline anywhere; tapping AUDIO joins', async () => {
    const { wrapper, session, seg, status } = mountChat()
    const before = { ...ring }
    session.dev.incoming()
    await nextTick()
    expect(seg('audio').classes()).toContain('seg--calling')
    expect(seg('audio').attributes('aria-label')).toBe('Подключиться')
    expect(status()).toContain('Тебя зовут')
    expect(ring.starts).toBe(before.starts + 1)
    // No full-screen popup and no decline button.
    expect(wrapper.find('[data-test="incoming"]').exists()).toBe(false)
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label') ?? b.text())
    expect(labels.some((l) => /Не сейчас|Отклонить|Сбросить/.test(l))).toBe(false)

    await seg('audio').trigger('click')
    await nextTick()
    expect(session.state.view!.inCall).toBe(true)
    expect(seg('audio').classes()).not.toContain('seg--calling')
    expect(ring.stops).toBe(before.stops + 1)
  })

  it('she stops waiting: the ring stops', async () => {
    const { session } = mountChat()
    const before = { ...ring }
    session.dev.incoming()
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    expect(ring.stops).toBe(before.stops + 1)
  })

  it('no video-call button and no camera button: the switch is the only call control', () => {
    const { wrapper } = mountChat()
    const labels = wrapper.findAll('button').map((b) => b.attributes('aria-label'))
    expect(labels).not.toContain('Видеозвонок')
    expect(labels.filter((l) => l && /камер/i.test(l))).toEqual([])
    expect(wrapper.findAll('[data-test="call-switch"]')).toHaveLength(1)
  })

  it('VIDEO is one-sided and silent: no hint on either side until both are on VIDEO, then the video shows', async () => {
    vi.useFakeTimers()
    const { wrapper, session, seg, status } = mountChat()
    session.dev.incoming()
    await seg('audio').trigger('click')
    await vi.advanceTimersByTimeAsync(VIDEO_UNLOCK_MS)

    // She chose VIDEO, we did not: nothing tells us.
    session.dev.peerMode('video')
    await nextTick()
    expect(status()).not.toMatch(/видео|камер|ждём/i)
    expect(seg('video').classes()).not.toContain('seg--calling')
    expect(wrapper.find('[data-test="call-video"]').exists()).toBe(false)

    // We choose VIDEO while she is on AUDIO: no hint for us either.
    session.dev.peerMode('audio')
    await seg('video').trigger('click')
    await nextTick()
    expect(status()).not.toMatch(/видео|камер|ждём/i)
    expect(wrapper.find('[data-test="call-video"]').exists()).toBe(false)

    session.dev.peerMode('video')
    await nextTick()
    expect(wrapper.find('[data-test="call-video"]').exists()).toBe(true)
  })

  it('OFF from VIDEO ends the call and both switches return to OFF', async () => {
    vi.useFakeTimers()
    const { wrapper, session, seg } = mountChat()
    session.dev.incoming()
    await seg('audio').trigger('click')
    await vi.advanceTimersByTimeAsync(VIDEO_UNLOCK_MS)
    await seg('video').trigger('click')
    session.dev.peerMode('video')
    await nextTick()
    await seg('off').trigger('click')
    await nextTick()
    expect(session.state.view!.inCall).toBe(false)
    expect(session.state).toMatchObject({ myMode: 'off', peerMode: 'off' })
    expect(session.state.lastCallEnded).toBe('hangup')
    expect(wrapper.find('[data-test="call-video"]').exists()).toBe(false)
  })

  it('a locked call button: AUDIO disabled with a countdown, or «никого нет»', async () => {
    const { session, disabled, status } = mountChat()
    session.dev.setCallView('cooldown')
    await nextTick()
    expect(disabled('audio')).toBe(true)
    expect(status()).toMatch(/снова через\s*0[01]:\d\d/)
    session.dev.setCallView('nobodyHome')
    await nextTick()
    expect(disabled('audio')).toBe(true)
    expect(status()).toContain('никого нет')
  })

  it('the glow stops for people who asked for less motion', () => {
    const block = callSwitchSource.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)
    expect(block?.[1]).toMatch(/\.seg--calling \{\s*animation: none/)
  })
})
