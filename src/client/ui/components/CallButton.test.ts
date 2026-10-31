// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CallButton from './CallButton.vue'

const btn = (w: ReturnType<typeof mount>) => w.get('button')

describe('CallButton', () => {
  it('ready: enabled, shows its label and emits press with the kind', async () => {
    const w = mount(CallButton, { props: { kind: 'video', view: { kind: 'ready' } } })
    expect(w.attributes('data-state')).toBe('ready')
    expect(btn(w).attributes('disabled')).toBeUndefined()
    expect(w.text()).toContain('Видео')
    await btn(w).trigger('click')
    expect(w.emitted('press')).toEqual([['video']])
  })

  it('cooldown: disabled with a mm:ss countdown to `until`', async () => {
    const w = mount(CallButton, { props: { kind: 'voice', view: { kind: 'cooldown', until: Date.now() + 90_000 } } })
    expect(w.attributes('data-state')).toBe('cooldown')
    expect(btn(w).attributes('disabled')).toBeDefined()
    expect(w.text()).toMatch(/01:(29|30)/)
    await btn(w).trigger('click')
    expect(w.emitted('press')).toBeUndefined()
  })

  it("nobodyHome: disabled, says 'никого нет'", () => {
    const w = mount(CallButton, { props: { kind: 'voice', view: { kind: 'nobodyHome', until: Date.now() + 3_600_000 } } })
    expect(w.attributes('data-state')).toBe('nobodyHome')
    expect(btn(w).attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('никого нет')
    expect(w.text()).not.toContain('Звонок')
  })

  it('busy (another call going on) disables a ready button', () => {
    const w = mount(CallButton, { props: { kind: 'voice', view: { kind: 'ready' }, busy: true } })
    expect(btn(w).attributes('disabled')).toBeDefined()
  })
})
