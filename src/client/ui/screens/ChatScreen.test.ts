// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ChatScreen from './ChatScreen.vue'
import { mountWithDuo } from '../test/mountWithDuo'

const bubbles = (w: { findAll: (s: string) => { text: () => string }[] }) =>
  w.findAll('[data-test="bubble"]').map((b) => b.text())

describe('ChatScreen', () => {
  it('a message disappears when it is removed from state (expiry)', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    const first = session.state.messages[0]!.text
    expect(bubbles(wrapper)).toContain(first)
    const count = bubbles(wrapper).length

    session.dev.expireOldest()
    await nextTick()

    expect(bubbles(wrapper)).toHaveLength(count - 1)
    expect(bubbles(wrapper)).not.toContain(first)
  })

  it('sends typed text through the session and clears the input', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    const before = session.state.messages.length
    await wrapper.get('textarea').setValue('Привет 🦄')
    await wrapper.get('[data-test="send"]').trigger('click')
    expect(session.state.messages).toHaveLength(before + 1)
    expect(session.state.messages.at(-1)).toMatchObject({ from: 'a', text: 'Привет 🦄' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('a message that has not reached the friend shows a clock until it is sent', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    expect(wrapper.findAll('[data-test="pending"]')).toHaveLength(0)
    session.dev.peerLeaves()
    session.sendText('ты где?')
    await nextTick()
    const last = wrapper.findAll('.row').at(-1)!
    expect(last.find('[data-test="pending"]').exists()).toBe(true)
    expect(last.get('[data-test="bubble"]').classes()).toContain('pending')
    session.dev.peerJoins()
    await nextTick()
    expect(wrapper.findAll('[data-test="pending"]')).toHaveLength(0)
    expect(wrapper.findAll('.row').at(-1)!.get('[data-test="bubble"]').classes()).not.toContain('pending')
  })

  it('the error bar sits above the floating call bubble and its × dismisses it', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    session.dev.setError('Нет доступа к микрофону')
    await nextTick()
    const bar = wrapper.get('[data-test="error"]')
    // Vant's floating bubble uses z-index 999 (--van-floating-bubble-z-index).
    expect(Number((bar.element as HTMLElement).style.zIndex)).toBeGreaterThan(999)
    expect((bar.element as HTMLElement).style.position).toBe('relative')
    await bar.get('.van-notice-bar__right-icon').trigger('click')
    expect(session.state.error).toBeNull()
  })

  it('my messages and the friend’s messages sit on different sides', async () => {
    const { wrapper } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    const rows = wrapper.findAll('.row')
    expect(rows.some((r) => r.classes('mine'))).toBe(true)
    expect(rows.some((r) => !r.classes('mine'))).toBe(true)
  })

  it('shows presence and the missed-call card', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: 'voice' } })
    expect(wrapper.get('[data-test="presence"]').text()).toBe('здесь')
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(true)
    session.dev.peerLeaves()
    await nextTick()
    expect(wrapper.get('[data-test="presence"]').text()).toBe('нет в чате')
  })

  it('emoji keyboard inserts emoji into the input', async () => {
    const { wrapper } = mountWithDuo(ChatScreen, { props: { missedCall: null } })
    await wrapper.get('[aria-label="Смайлики"]').trigger('click')
    const kb = wrapper.get('[data-test="emoji-keyboard"]')
    await kb.findAll('.van-grid-item')[0]!.trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('😀')
  })
})
