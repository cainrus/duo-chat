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
