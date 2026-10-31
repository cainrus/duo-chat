// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import pingSource from './PingButton.vue?raw'
import PingButton from './PingButton.vue'

describe('PingButton', () => {
  it('ready: shows the label and emits press', async () => {
    const w = mount(PingButton, { props: { view: { kind: 'ready' } } })
    expect(w.text()).toContain('Позвать')
    expect(w.get('button').attributes('aria-disabled')).toBe('false')
    await w.get('button').trigger('click')
    expect(w.emitted('press')).toHaveLength(1)
  })

  it('cooldown: disabled, a ring and the seconds left (also in the label); taps do nothing', async () => {
    const w = mount(PingButton, { props: { view: { kind: 'cooldown', until: Date.now() + 42_000 } } })
    expect(w.attributes('data-state')).toBe('cooldown')
    expect(w.find('svg.ring').exists()).toBe(true)
    expect(w.text()).toMatch(/4[12] с/)
    expect(w.get('button').attributes('aria-label')).toMatch(/подожди 4[12] с/)
    expect(w.get('button').attributes('aria-disabled')).toBe('true')
    await w.get('button').trigger('click')
    expect(w.emitted('press')).toBeUndefined()
  })

  it('exhausted: a calm «🌙 завтра», disabled', async () => {
    const w = mount(PingButton, { props: { view: { kind: 'exhausted', until: Date.now() + 1000 } } })
    expect(w.attributes('data-state')).toBe('exhausted')
    expect(w.text()).toContain('🌙')
    expect(w.text()).toContain('завтра')
    expect(w.get('button').attributes('aria-disabled')).toBe('true')
    await w.get('button').trigger('click')
    expect(w.emitted('press')).toBeUndefined()
  })

  it('the little shake on a disabled tap stops for people who asked for less motion', () => {
    const block = pingSource.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)
    expect(block?.[1]).toMatch(/\.shake \{\s*animation: none/)
  })
})
