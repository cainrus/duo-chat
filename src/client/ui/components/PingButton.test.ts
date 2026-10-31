// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PingButton from './PingButton.vue'

describe('PingButton', () => {
  it('ready: shows the label, no badge', () => {
    const w = mount(PingButton, { props: { view: { kind: 'ready' } } })
    expect(w.text()).toContain('Позвать')
    expect(w.find('.van-badge').exists()).toBe(false)
  })

  it('exhausted: badge + "сегодня всё", and still pressable (never disabled)', async () => {
    const w = mount(PingButton, { props: { view: { kind: 'exhausted', until: Date.now() + 1000 } } })
    expect(w.attributes('data-state')).toBe('exhausted')
    expect(w.text()).toContain('сегодня всё')
    expect(w.get('.van-badge').text()).toBe('!')
    const button = w.get('button')
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(w.emitted('press')).toHaveLength(1)
  })
})
