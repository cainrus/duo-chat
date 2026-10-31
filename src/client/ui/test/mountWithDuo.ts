// Test helper: mount a component with a fake session provided as 'duo'.
import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import type { Component } from 'vue'
import { createFakeSession, type FakeOptions, type FakeSession } from '../../session/fake'
import { DUO_KEY } from '../useDuo'

export function mountWithDuo<C extends Component>(comp: C, opts: ComponentMountingOptions<C> = {}, fake: FakeOptions = {}) {
  const session: FakeSession = createFakeSession({ latency: 0, autoReply: false, ...fake })
  const wrapper = mount(comp, {
    ...opts,
    global: { ...opts.global, provide: { [DUO_KEY]: session, ...opts.global?.provide } },
  } as ComponentMountingOptions<C>)
  return { wrapper, session }
}
