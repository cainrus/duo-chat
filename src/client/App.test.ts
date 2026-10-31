// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import App from './App.vue'
import { mountWithDuo } from './ui/test/mountWithDuo'

describe('App', () => {
  it('starts on setup when the device is not paired', () => {
    const { wrapper } = mountWithDuo(App, {}, { start: 'setup' })
    expect(wrapper.find('[data-test="setup"]').exists()).toBe(true)
  })

  it('a call the friend gave up on becomes a missed-call card, and lastCallEnded is cleared', async () => {
    const { wrapper, session } = mountWithDuo(App, { attachTo: document.body })
    session.dev.incoming('video')
    await nextTick()
    session.dev.peerCancels()
    await nextTick()
    await nextTick()
    expect(session.state.lastCallEnded).toBeNull()
    expect(wrapper.find('[data-test="missed-call"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
