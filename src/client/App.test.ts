// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import { mountWithDuo } from './ui/test/mountWithDuo'

describe('App', () => {
  it('starts on setup when the device is not paired', () => {
    const { wrapper } = mountWithDuo(App, {}, { start: 'setup' })
    expect(wrapper.find('[data-test="setup"]').exists()).toBe(true)
  })

  it('a voice room she left before we joined shows a service line in the chat, no card', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    session.dev.incoming()
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    await nextTick()
    expect(session.state.lastCallEnded).toBeNull()
    expect(wrapper.get('[data-test="voice-item"]').text()).toMatch(/^📞 голосовой · \d\d:\d\d$/)
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('asks the session to clear lastCallEnded instead of writing into state', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    const spy = vi.spyOn(session, 'dismissCallEnded')
    session.dev.incoming()
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('the chat is the only screen: no call popups; a call and its video happen inside the chat', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    const chat = () => document.querySelector('[data-test="timeline"]')
    session.dev.incoming()
    await nextTick()
    expect(chat()).not.toBeNull()
    expect(document.querySelector('[data-test="incoming"], [data-test="outgoing"], [data-test="in-call"]')).toBeNull()
    await session.setMode('audio')
    await nextTick()
    expect(chat()).not.toBeNull()
    expect(document.querySelector('[data-test="in-call"], [data-test="back-to-call"]')).toBeNull()
    wrapper.unmount()
  })
})
