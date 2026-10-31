// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ChatScreen from './ChatScreen.vue'
import { mountWithDuo } from '../test/mountWithDuo'

const bubbles = (w: { findAll: (s: string) => { text: () => string }[] }) =>
  w.findAll('[data-test="bubble"]').map((b) => b.text())

describe('ChatScreen', () => {
  it('a message disappears when it is removed from state (expiry)', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    const first = session.state.messages[0]!.text
    expect(bubbles(wrapper)).toContain(first)
    const count = bubbles(wrapper).length

    session.dev.expireOldest()
    await nextTick()

    expect(bubbles(wrapper)).toHaveLength(count - 1)
    expect(bubbles(wrapper)).not.toContain(first)
  })

  it('sends typed text through the session and clears the input', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    const before = session.state.messages.length
    await wrapper.get('textarea').setValue('Привет 🦄')
    await wrapper.get('[data-test="send"]').trigger('click')
    expect(session.state.messages).toHaveLength(before + 1)
    expect(session.state.messages.at(-1)).toMatchObject({ from: 'a', text: 'Привет 🦄' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('a message that has not reached the friend shows a clock until it is sent', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
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

  it('the error bar × dismisses it', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    session.dev.setError('Нет доступа к микрофону')
    await nextTick()
    const bar = wrapper.get('[data-test="error"]')
    const close = bar.get('button[aria-label="Закрыть"]')
    await close.trigger('click')
    expect(session.state.error).toBeNull()
  })

  it('«Позвать» is hidden while the friend is in the chat, and shown when she is away', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    expect(wrapper.find('[data-test="ping"]').exists()).toBe(false)
    session.dev.peerLeaves()
    await nextTick()
    expect(wrapper.find('[data-test="ping"]').exists()).toBe(true)
  })

  it('pressing ping shows what became of it, then the button waits with a countdown', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false }, attachTo: document.body })
    const toastText = () => [...document.querySelectorAll('.van-toast')].map((t) => t.textContent ?? '').join('|')
    session.dev.peerLeaves()
    await nextTick()
    await wrapper.get('[data-test="ping"] button').trigger('click')
    await vi.waitFor(() => expect(toastText()).toContain('Отправила 🔔'))
    const btn = wrapper.get('[data-test="ping"] button')
    expect(btn.attributes('aria-disabled')).toBe('true')
    expect(btn.attributes('aria-label')).toMatch(/подожди (59|60) с/)
    expect(wrapper.get('[data-test="ping-seconds"]').text()).toMatch(/^(59|60) с$/)
    // A tap while waiting does nothing.
    const before = session.state.lastPing
    await btn.trigger('click')
    expect(session.state.lastPing).toBe(before)

    session.dev.setPingView('ready')
    session.dev.options.peerHasPush = false
    await nextTick()
    await wrapper.get('[data-test="ping"] button').trigger('click')
    await vi.waitFor(() => expect(toastText()).toContain('Подожди, она скоро увидит ⏳'))
    wrapper.unmount()
  })

  it('no more pings today: a calm, disabled «🌙 завтра»', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    session.dev.peerLeaves()
    session.dev.setPingView('exhausted')
    await nextTick()
    const ping = wrapper.get('[data-test="ping"]')
    expect(ping.attributes('data-state')).toBe('exhausted')
    expect(ping.text()).toContain('🌙')
    expect(ping.text()).toContain('завтра')
    expect(ping.get('button').attributes('aria-disabled')).toBe('true')
  })

  it('the bell turns pushes for this device off and on', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    const bell = () => wrapper.get('[data-test="bell"]')
    expect(bell().attributes('aria-label')).toBe('Уведомления вкл/выкл')
    expect(bell().attributes('aria-pressed')).toBe('true')
    await bell().trigger('click')
    await nextTick()
    expect(session.state.pushMuted).toBe(true)
    expect(bell().attributes('aria-pressed')).toBe('false')
    await bell().trigger('click')
    await nextTick()
    expect(session.state.pushMuted).toBe(false)
  })

  it('my messages and the friend’s messages sit on different sides', async () => {
    const { wrapper } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    const rows = wrapper.findAll('.row')
    expect(rows.some((r) => r.classes('mine'))).toBe(true)
    expect(rows.some((r) => !r.classes('mine'))).toBe(true)
  })

  it('shows presence and the missed-call card', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { props: { missedCall: true } })
    expect(wrapper.get('[data-test="presence"]').text()).toBe('здесь')
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(true)
    session.dev.peerLeaves()
    await nextTick()
    expect(wrapper.get('[data-test="presence"]').text()).toBe('нет в чате')
  })

  it('emoji keyboard inserts emoji into the input', async () => {
    const { wrapper } = mountWithDuo(ChatScreen, { props: { missedCall: false } })
    await wrapper.get('[aria-label="Смайлики"]').trigger('click')
    const kb = wrapper.get('[data-test="emoji-keyboard"]')
    await kb.findAll('.van-grid-item')[0]!.trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('😀')
  })
})
