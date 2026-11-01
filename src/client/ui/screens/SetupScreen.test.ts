// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import SetupScreen from './SetupScreen.vue'
import { mountWithDuo } from '../test/mountWithDuo'
import type { NotificationSupport } from '../../session/types'

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

/** Creates the pair, then "next" leads to the notifications step. */
async function atNotifyStep(notifications: NotificationSupport) {
  const m = mountWithDuo(SetupScreen, {}, { start: 'setup', notifications })
  await m.wrapper.get('[data-test="admin-secret"] input').setValue('secret')
  await m.wrapper.get('[data-test="create"]').trigger('click')
  await vi.waitFor(() => expect(m.wrapper.find('[data-test="next"]').exists()).toBe(true))
  await m.wrapper.get('[data-test="next"]').trigger('click')
  await flushPromises()
  return m
}

describe('SetupScreen: the notifications step offers only what can work here', () => {
  afterEach(() => vi.restoreAllMocks())

  it("'default': the button asks, then shows they are on", async () => {
    const { wrapper, session } = await atNotifyStep('default')
    const btn = () => wrapper.get('[data-test="notify"]')
    expect(btn().text()).toContain('Включить уведомления')
    await btn().trigger('click')
    await vi.waitFor(() => expect(session.state.notifications).toBe('granted'))
    await flushPromises()
    expect(btn().text()).toContain('включены')
    expect(btn().attributes('disabled')).toBeDefined()
  })

  it('iPad Safari tab: no button that cannot work; it points to installing', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPAD_UA)
    const { wrapper } = await atNotifyStep('unsupported-install')
    expect(wrapper.find('[data-test="notify"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="notify-hint"]').text()).toContain('экране «Домой»')
    await wrapper.get('[data-test="notify-help-open"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="notify-help"]').attributes('data-variant')).toBe('install')
  })

  it("'denied': points to the settings", async () => {
    const { wrapper } = await atNotifyStep('denied')
    expect(wrapper.find('[data-test="notify"]').exists()).toBe(false)
    await wrapper.get('[data-test="notify-help-open"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="notify-help"]').attributes('data-variant')).toBe('denied')
  })
})
