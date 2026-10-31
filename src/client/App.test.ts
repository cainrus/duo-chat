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

  it('a call the friend gave up on shows the missed-call card from state.missedCall, and lastCallEnded is cleared', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    session.dev.incoming('video')
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    await nextTick()
    expect(session.state.missedCall?.kind).toBe('video')
    expect(session.state.lastCallEnded).toBeNull()
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('a missed call from a push shows the card; dismissing clears state.missedCall', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    session.dev.missedFromPush('voice')
    await nextTick()
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(true)
    await wrapper.find('.missed-close').trigger('click')
    expect(session.state.missedCall).toBeNull()
    wrapper.unmount()
  })

  it('asks the session to clear lastCallEnded instead of writing into state', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    const spy = vi.spyOn(session, 'dismissCallEnded')
    session.dev.incoming('voice')
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
