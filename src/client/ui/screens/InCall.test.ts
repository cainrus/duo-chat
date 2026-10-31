// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import InCall from './InCall.vue'
import { mountWithDuo } from '../test/mountWithDuo'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('InCall', () => {
  it('names every control for screen readers, in Russian', async () => {
    const { wrapper, session } = mountWithDuo(InCall, { props: { minimized: false }, attachTo: document.body })
    session.state.view = { ...session.state.view!, inCall: { kind: 'voice' } }
    await nextTick()
    const labels = [...document.querySelectorAll('.controls button')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Выключить микрофон', 'Включить камеру', 'В чат', 'Закончить'])
    wrapper.unmount()
  })

  it('the floating bubble that returns to the call is a labelled button', async () => {
    const { wrapper, session } = mountWithDuo(InCall, { props: { minimized: false }, attachTo: document.body })
    session.state.view = { ...session.state.view!, inCall: { kind: 'voice' } }
    await nextTick()
    await wrapper.setProps({ minimized: true })
    const bubble = document.querySelector('[data-test="back-to-call"]')!
    expect(bubble).not.toBeNull()
    expect(bubble.getAttribute('role')).toBe('button')
    expect(bubble.getAttribute('aria-label')).toBe('Вернуться к звонку')
    wrapper.unmount()
  })
})
