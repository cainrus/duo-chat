import { createApp, markRaw } from 'vue'
import { Locale } from 'vant'
import ruRU from 'vant/es/locale/lang/ru-RU'
// Styles for Vant's function APIs (auto-import only covers template components).
import 'vant/es/toast/style'
import './ui/global.css'
import App from './App.vue'
import { DUO_KEY } from './ui/useDuo'

Locale.use('ru-RU', ruRU)

async function main() {
  const app = createApp(App)
  if (import.meta.env.VITE_FAKE === '1') {
    // Dev only: statically false in a normal build, so the fake and its panel are dropped.
    const { createFakeSession } = await import('./session/fake')
    const { default: FakeDevPanel } = await import('./session/FakeDevPanel.vue')
    const start = new URLSearchParams(location.search).has('setup') ? 'setup' : 'ready'
    const session = createFakeSession({ start })
    app.provide(DUO_KEY, session)
    app.provide('duoFake', session.dev)
    app.provide('duoDevPanel', markRaw(FakeDevPanel))
    // For scripted walkthroughs (devtools, screenshots).
    ;(window as unknown as { duoFake: unknown }).duoFake = session.dev
  } else {
    // Task 7 wires the live session here: app.provide(DUO_KEY, createLiveSession())
    throw new Error('Live session is not wired yet (Task 7). Run with VITE_FAKE=1.')
  }
  app.mount('#app')
}

void main()
