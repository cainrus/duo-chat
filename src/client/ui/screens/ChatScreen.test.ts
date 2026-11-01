// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import ChatScreen from './ChatScreen.vue'
import NotifyHelp from '../components/NotifyHelp.vue'
import { mountWithDuo } from '../test/mountWithDuo'

const bubbles = (w: { findAll: (s: string) => { text: () => string }[] }) =>
  w.findAll('[data-test="bubble"]').map((b) => b.text())

describe('ChatScreen', () => {
  it('a message disappears when it is removed from state (expiry)', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    const first = session.state.messages[0]!.text
    expect(bubbles(wrapper)).toContain(first)
    const count = bubbles(wrapper).length

    session.dev.expireOldest()
    await nextTick()

    expect(bubbles(wrapper)).toHaveLength(count - 1)
    expect(bubbles(wrapper)).not.toContain(first)
  })

  it('sends typed text through the session and clears the input', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    const before = session.state.messages.length
    await wrapper.get('textarea').setValue('Привет 🦄')
    await wrapper.get('[data-test="send"]').trigger('click')
    expect(session.state.messages).toHaveLength(before + 1)
    expect(session.state.messages.at(-1)).toMatchObject({ from: 'a', text: 'Привет 🦄' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('a message that has not reached the friend shows a clock until it is sent', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    expect(wrapper.findAll('[data-test="pending"]')).toHaveLength(0)
    session.dev.peerLeaves()
    session.sendText('ты где?')
    await nextTick()
    const last = wrapper.findAll('.row').at(-1)!
    expect(last.find('[data-test="pending"]').exists()).toBe(true)
    expect(last.get('[data-test="bubble"]').classes()).toContain('pending')
    session.dev.peerJoins()
    await nextTick()
    expect(wrapper.findAll('[data-test="pending"]')).toHaveLength(0)
    expect(wrapper.findAll('.row').at(-1)!.get('[data-test="bubble"]').classes()).not.toContain('pending')
  })

  it('the error bar × dismisses it', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    session.dev.setError('Нет доступа к микрофону')
    await nextTick()
    const bar = wrapper.get('[data-test="error"]')
    const close = bar.get('button[aria-label="Закрыть"]')
    await close.trigger('click')
    expect(session.state.error).toBeNull()
  })

  it('nothing on screen tells whether the friend is in the app', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    // The textarea's autosize height is layout noise, not information.
    const snapshot = () => wrapper.html().replace(/(<textarea[^>]*?) style="[^"]*"/, '$1')
    const here = snapshot()
    expect(wrapper.find('[data-test="presence"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ping"]').exists()).toBe(true)
    session.dev.peerLeaves()
    await nextTick()
    expect(snapshot()).toBe(here)
  })

  it('«онлайн» then waits with a countdown, the same whether or not she is here; no toast', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, { attachTo: document.body })
    const spy = vi.spyOn(session, 'ping')
    const btn = () => wrapper.get('[data-test="ping"] button')
    expect(btn().attributes('aria-label')).toBe('Отправить статус онлайн')
    expect(wrapper.get('[data-test="ping"]').text()).toContain('онлайн')
    await btn().trigger('click')
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(btn().attributes('aria-disabled')).toBe('true')
    expect(btn().attributes('aria-label')).toMatch(/подожди (59|60) с/)
    expect(wrapper.get('[data-test="ping-seconds"]').text()).toMatch(/^(59|60) с$/)
    expect(document.querySelector('.van-toast')).toBeNull()
    // A tap while waiting does nothing.
    await btn().trigger('click')
    expect(spy).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('no more pings today: a calm, disabled «🌙 завтра»', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    session.dev.setPingView('exhausted')
    await nextTick()
    const ping = wrapper.get('[data-test="ping"]')
    expect(ping.attributes('data-state')).toBe('exhausted')
    expect(ping.text()).toContain('🌙')
    expect(ping.text()).toContain('завтра')
    expect(ping.get('button').attributes('aria-disabled')).toBe('true')
  })

  it('a standard toggle switch turns pushes for this device off and on', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    const toggle = () => wrapper.get('[data-test="notifications"]')
    expect(toggle().attributes('role')).toBe('switch')
    expect(toggle().attributes('aria-label')).toBe('Уведомления')
    expect(toggle().attributes('aria-checked')).toBe('true')
    await toggle().trigger('click')
    await nextTick()
    expect(session.state.pushMuted).toBe(true)
    expect(toggle().attributes('aria-checked')).toBe('false')
    await toggle().trigger('click')
    await nextTick()
    expect(session.state.pushMuted).toBe(false)
  })

  it('my messages and the friend’s messages sit on different sides', async () => {
    const { wrapper } = mountWithDuo(ChatScreen)
    const rows = wrapper.findAll('.row')
    expect(rows.some((r) => r.classes('mine'))).toBe(true)
    expect(rows.some((r) => !r.classes('mine'))).toBe(true)
  })

  it('a voice room line shows centred as «📞 голосовой · HH:MM» and disappears at expiry like a message', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    session.dev.clearChat()
    session.dev.incoming()
    session.dev.peerCancels()
    await nextTick()
    const line = wrapper.get('[data-test="voice-item"]')
    expect(line.text()).toMatch(/^📞 голосовой · \d\d:\d\d$/)
    expect(line.classes()).toContain('service')
    expect(wrapper.findAll('[data-test="bubble"]')).toHaveLength(0)
    session.dev.expireOldest()
    await nextTick()
    expect(wrapper.find('[data-test="voice-item"]').exists()).toBe(false)
  })

  it('emoji keyboard inserts emoji into the input', async () => {
    const { wrapper } = mountWithDuo(ChatScreen)
    await wrapper.get('[aria-label="Смайлики"]').trigger('click')
    const kb = wrapper.get('[data-test="emoji-keyboard"]')
    // The sticker tabs come first; the faces tab is the first emoji one.
    await kb.get('[aria-label="Лица"]').trigger('click')
    // Vant renders a newly chosen pane a few ticks later (slower on CI), so wait for it.
    const smile = await vi.waitFor(() => {
      const item = kb.findAll('.van-grid-item').find((i) => i.text() === '😀')
      if (!item) throw new Error('faces pane not rendered yet')
      return item
    })
    await smile.trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('😀')
  })

  it('the keyboard opens on the spy stickers; a tap sends the sticker at once and leaves the input alone', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    const spy = vi.spyOn(session, 'sendSticker')
    await wrapper.get('[aria-label="Смайлики"]').trigger('click')
    const kb = wrapper.get('[data-test="emoji-keyboard"]')
    expect(kb.get('[data-test="tab-spy"]').attributes('src')).toBe('/stickers/spy/happy.svg')
    expect(kb.get('[data-test="tab-noto"]').attributes('src')).toBe('/stickers/noto/1f929.webp')
    const moods = kb.findAll('[data-test^="sticker-spy:"]')
    expect(moods).toHaveLength(8)
    expect(moods[1]!.attributes('aria-label')).toBe('шпион: подмигиваю')
    await moods[1]!.trigger('click')
    expect(spy).toHaveBeenCalledWith('spy:wink')
    expect(session.state.messages.at(-1)).toMatchObject({ from: 'a', kind: 'sticker', text: 'spy:wink' })
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')

    await kb.get('[data-test="tab-noto"]').trigger('click')
    await nextTick()
    const noto = kb.findAll('[data-test^="sticker-noto:"]')
    expect(noto).toHaveLength(31)
    await kb.get('[data-test="sticker-noto:1f984"]').trigger('click')
    expect(spy).toHaveBeenLastCalledWith('noto:1f984')
  })

  it('stickers show large on the sender’s side, without a bubble, with the clock while pending', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    session.dev.clearChat()
    session.dev.peerSticker('noto', 'noto:1f431')
    session.dev.peerLeaves()
    session.sendSticker('spy:sad')
    await nextTick()
    const rows = wrapper.findAll('[data-test="sticker"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.classes()).not.toContain('mine')
    expect(rows[0]!.get('img').attributes()).toMatchObject({ src: '/stickers/noto/1f431.webp', alt: '🐱' })
    expect(rows[1]!.classes()).toContain('mine')
    expect(rows[1]!.get('img').attributes('src')).toBe('/stickers/spy/sad.svg')
    expect(rows[1]!.find('[data-test="pending"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="bubble"]')).toHaveLength(0)
    session.dev.peerJoins()
    await nextTick()
    expect(wrapper.find('[data-test="pending"]').exists()).toBe(false)
  })

  it('an unknown sticker id renders nothing', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    session.dev.clearChat()
    session.state.messages.push({ id: 'x', from: 'b', text: 'noto:../evil', sentAt: Date.now(), kind: 'sticker' })
    await nextTick()
    expect(wrapper.find('[data-test="sticker"]').exists()).toBe(false)
    expect(wrapper.find('img[src*="evil"]').exists()).toBe(false)
  })

  it('the friend’s picture is the still spy in the header, and large during a voice call only', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen)
    expect(wrapper.get('[data-test="avatar"]').attributes('src')).toBe('/stickers/spy/avatar.svg')
    expect(wrapper.find('[data-test="call-avatar"]').exists()).toBe(false)
    session.dev.incoming()
    await session.setMode('audio')
    await nextTick()
    expect(wrapper.get('[data-test="call-avatar"] img').attributes('src')).toBe('/stickers/spy/avatar.svg')
    session.dev.peerHangsUp()
    await nextTick()
    expect(wrapper.find('[data-test="call-avatar"]').exists()).toBe(false)
  })
})

describe('ChatScreen: the notifications control knows where it runs', () => {
  const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  afterEach(() => vi.restoreAllMocks())

  const help = (w: { find: (s: string) => { exists: () => boolean; attributes: (n: string) => string | undefined } }) =>
    w.find('[data-test="notify-help"]')

  it("'default': the switch, off; turning it on asks for permission and then it is on", async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, {}, { notifications: 'default' })
    const toggle = () => wrapper.get('[data-test="notifications"]')
    expect(wrapper.find('[data-test="notifications-help"]').exists()).toBe(false)
    expect(toggle().attributes('aria-checked')).toBe('false')
    const ask = vi.spyOn(session, 'enableNotifications')
    await toggle().trigger('click')
    expect(ask).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(session.state.notifications).toBe('granted'))
    await flushPromises()
    expect(session.state.pushMuted).toBe(false)
    expect(toggle().attributes('aria-checked')).toBe('true')
  })

  it("'granted': the switch, on", () => {
    const { wrapper } = mountWithDuo(ChatScreen, {}, { notifications: 'granted' })
    expect(wrapper.get('[data-test="notifications"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[data-test="notifications-help"]').exists()).toBe(false)
  })

  it('iPad Safari tab: a greyed bell instead of the switch; it opens the install help with the storage note', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPAD_UA)
    const { wrapper } = mountWithDuo(ChatScreen, {}, { notifications: 'unsupported-install' })
    expect(wrapper.find('[data-test="notifications"]').exists()).toBe(false)
    const bell = wrapper.get('[data-test="notifications-help"]')
    expect(bell.element.tagName).toBe('BUTTON')
    expect(bell.attributes('aria-label')).toMatch(/Как включить/)
    expect(help(wrapper).exists()).toBe(false)
    await bell.trigger('click')
    await nextTick()
    expect(help(wrapper).attributes('data-variant')).toBe('install')
    expect(wrapper.get('[data-test="install-steps"]').attributes('data-platform')).toBe('apple')
    expect(wrapper.get('[data-test="install-steps"]').text()).toContain('На экран «Домой»')
    expect(wrapper.get('[data-test="storage-note"]').text()).toContain('пару придётся создать заново')
    await wrapper.get('[data-test="notify-help-close"]').trigger('click')
    await nextTick()
    expect(wrapper.getComponent(NotifyHelp).props('show')).toBe(false)
  })

  it("'denied': a greyed bell opening the «allow in settings» help", async () => {
    const { wrapper } = mountWithDuo(ChatScreen, {}, { notifications: 'denied' })
    expect(wrapper.find('[data-test="notifications"]').exists()).toBe(false)
    await wrapper.get('[data-test="notifications-help"]').trigger('click')
    await nextTick()
    expect(help(wrapper).attributes('data-variant')).toBe('denied')
    expect(wrapper.get('[data-test="settings-hint"]').text()).toContain('Разрешить')
    expect(wrapper.find('[data-test="storage-note"]').exists()).toBe(false)
  })

  it("'unsupported': a greyed bell; the help says this browser cannot, and suggests another or installing", async () => {
    const { wrapper } = mountWithDuo(ChatScreen, {}, { notifications: 'unsupported' })
    await wrapper.get('[data-test="notifications-help"]').trigger('click')
    await nextTick()
    expect(help(wrapper).attributes('data-variant')).toBe('unsupported')
    expect(help(wrapper).exists()).toBe(true)
    expect(wrapper.get('[data-test="notify-help"]').text()).toContain('Chrome')
  })

  it('the control follows the state live: allowed in the settings -> the switch comes back', async () => {
    const { wrapper, session } = mountWithDuo(ChatScreen, {}, { notifications: 'denied' })
    expect(wrapper.find('[data-test="notifications"]').exists()).toBe(false)
    session.dev.setNotifications('granted')
    await nextTick()
    expect(wrapper.get('[data-test="notifications"]').attributes('aria-checked')).toBe('true')
  })
})
