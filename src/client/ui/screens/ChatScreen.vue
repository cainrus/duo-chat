<script setup lang="ts">
// The only screen after setup: the friend, the call bar (call switch + ping), the video while
// both switches are on VIDEO, the conversation and the input with a big emoji keyboard.
// Calls happen right here; the chat stays usable during them.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { showToast } from 'vant'
import type { PingResult } from '@shared/protocol'
import { MAX_MESSAGE_LENGTH } from '../../messages/store'
import { useDuo } from '../useDuo'
import DuoAvatar from '../components/DuoAvatar.vue'
import ChatBubble from '../components/ChatBubble.vue'
import EmojiKeyboard from '../components/EmojiKeyboard.vue'
import CallBar from '../components/CallBar.vue'
import CallVideo from '../components/CallVideo.vue'
import IconSmiley from '~icons/ph/smiley-fill'
import IconSend from '~icons/ph/paper-plane-right-fill'
import IconPhoneMissed from '~icons/ph/phone-incoming-fill'
import IconOffline from '~icons/ph/wifi-slash-bold'
import IconX from '~icons/ph/x-bold'
import IconBell from '~icons/ph/bell-fill'
import IconBellOff from '~icons/ph/bell-slash-fill'

defineProps<{ missedCall: boolean }>()
const emit = defineEmits<{ callBack: []; dismissMissed: [] }>()

const duo = useDuo()
const s = duo.state

const text = ref('')
const emojiOpen = ref(false)
const list = ref<HTMLElement | null>(null)

const view = computed(() => s.view)
const present = computed(() => !!view.value?.peerPresent)
const pending = computed(() => new Set(s.pendingIds))
const peerName = computed(() => s.peer?.name ?? (view.value?.peerPaired ? 'Подружка' : 'Ждём подружку'))

function send() {
  const t = text.value.trim()
  if (!t) return
  duo.sendText(t)
  text.value = ''
}

function pickEmoji(e: string) {
  if (text.value.length + e.length <= MAX_MESSAGE_LENGTH) text.value += e
}

/** Enter sends; Shift+Enter makes a new line. */
function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault()
    send()
  }
}

function scrollToEnd() {
  void nextTick(() => {
    const el = list.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
onMounted(scrollToEnd)
watch([() => s.messages.length, emojiOpen, () => s.media.videoOn], scrollToEnd)

// What became of our ping: a short toast, so pressing it is never silent.
const PING_NOTES: Record<PingResult, string> = {
  pushed: 'Отправила 🔔',
  held: 'Подожди, она скоро увидит ⏳',
}
watch(
  () => s.lastPing,
  (p) => {
    if (p) showToast({ message: PING_NOTES[p.result], position: 'middle', duration: 1600 })
  },
)

// The bell: pushes to this device on or off. Turning them on may ask for permission first.
const bellOn = computed(() => s.notificationsAllowed && !s.pushMuted)
function toggleBell() {
  void duo.setPushMuted(bellOn.value)
}
</script>

<template>
  <div class="chat van-safe-area-top">
    <header class="chat-head">
      <van-badge dot :color="present ? 'var(--van-success-color)' : 'var(--van-text-color-3)'" :offset="[-6, 50]">
        <DuoAvatar :avatar="s.peer?.avatar" :size="56" data-test="peer-avatar" />
      </van-badge>
      <div class="head-text">
        <div class="head-name">{{ peerName }}</div>
        <div class="head-status" :data-present="present" data-test="presence">
          {{ present ? 'здесь' : view?.peerPaired ? 'нет в чате' : 'ещё не подключилась' }}
        </div>
      </div>
      <IconOffline v-if="s.connection !== 'online'" class="head-offline" aria-label="Нет связи" />
      <button
        type="button"
        class="bell"
        :class="{ 'bell--off': !bellOn }"
        aria-label="Уведомления вкл/выкл"
        :aria-pressed="bellOn"
        data-test="bell"
        @click="toggleBell"
      >
        <IconBell v-if="bellOn" class="bell-icon" />
        <IconBellOff v-else class="bell-icon" />
      </button>
      <DuoAvatar :avatar="s.me?.avatar" :size="40" class="head-me" />
    </header>

    <CallBar v-if="view" @ping="duo.ping()" />
    <CallVideo v-if="s.media.videoOn" />

    <van-notice-bar
      v-if="s.error"
      :text="s.error"
      wrapable
      color="var(--van-danger-color)"
      background="#FDECEF"
      data-test="error"
    >
      <!-- A real button (Vant's closeable × is a bare icon a screen reader cannot name). -->
      <template #right-icon>
        <button type="button" class="error-close" aria-label="Закрыть" @click="duo.dismissError()">
          <van-icon name="cross" />
        </button>
      </template>
    </van-notice-bar>

    <main ref="list" class="chat-list" data-test="timeline">
      <div v-if="!s.messages.length" class="chat-empty" aria-hidden="true">👋</div>
      <ChatBubble v-for="m in s.messages" :key="m.id" :text="m.text" :mine="m.from === s.self" :pending="pending.has(m.id)" />
    </main>

    <footer class="chat-foot van-safe-area-bottom">
      <div v-if="missedCall" class="missed" data-test="missed-call">
        <IconPhoneMissed class="missed-icon" />
        <span class="missed-text">Звонила {{ s.peer?.name ?? 'подружка' }}</span>
        <van-button round type="success" class="missed-btn" :disabled="view?.call.kind !== 'ready'" @click="emit('callBack')">Перезвонить</van-button>
        <van-button round class="missed-close" aria-label="Закрыть" @click="emit('dismissMissed')">
          <IconX class="missed-x" />
        </van-button>
      </div>
      <div class="input-row">
        <van-button round class="icon-btn" aria-label="Смайлики" :type="emojiOpen ? 'primary' : 'default'" @click="emojiOpen = !emojiOpen">
          <IconSmiley class="btn-icon" />
        </van-button>
        <van-field
          v-model="text"
          type="textarea"
          rows="1"
          autosize
          :maxlength="MAX_MESSAGE_LENGTH"
          :border="false"
          placeholder="Написать…"
          class="input"
          enterkeyhint="send"
          @keydown="onKeydown"
        />
        <van-button round type="primary" class="icon-btn" aria-label="Отправить" :disabled="!text.trim()" data-test="send" @click="send">
          <IconSend class="btn-icon" />
        </van-button>
      </div>

      <EmojiKeyboard v-if="emojiOpen" @pick="pickEmoji" />
    </footer>

  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 820px;
  margin: 0 auto;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
}
.head-text {
  flex: 1;
  min-width: 0;
}
.head-name {
  font-size: var(--van-font-size-lg);
  font-weight: 700;
  color: var(--van-text-color);
}
.head-status {
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-3);
}
.head-status[data-present='true'] {
  color: var(--van-success-color);
}
.head-offline {
  width: 28px;
  height: 28px;
  color: var(--van-danger-color);
}
.bell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 0;
  border-radius: 50%;
  background: var(--van-background-2);
  color: var(--van-warning-color);
  cursor: pointer;
}
.bell--off {
  color: var(--van-text-color-3);
}
.bell-icon {
  width: 26px;
  height: 26px;
}
.head-me {
  opacity: 0.9;
}
.chat-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-empty {
  margin: auto;
  font-size: 96px;
  opacity: 0.35;
}
.missed {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 16px;
  margin-bottom: 8px;
  border-radius: 32px;
  background: #e5f7ef;
}
.missed-icon {
  width: 32px;
  height: 32px;
  flex: none;
  color: var(--van-success-color);
}
.missed-text {
  flex: 1;
  min-width: 0;
  font-size: var(--van-font-size-md);
  color: var(--van-text-color);
}
.missed-btn {
  flex: none;
}
.missed-close {
  flex: none;
  width: 56px;
  padding: 0;
  background: transparent;
  border: 0;
}
.missed-x {
  width: 22px;
  height: 22px;
}
.chat-foot {
  padding: 8px 12px;
  background: var(--van-background);
}
.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px;
  border-radius: 32px;
  background: var(--van-background-2);
  box-shadow: 0 1px 3px rgba(43, 36, 64, 0.08);
}
.icon-btn {
  width: 56px;
  flex: none;
  padding: 0;
}
.btn-icon {
  width: 30px;
  height: 30px;
}
.input {
  flex: 1;
  padding: 14px 6px;
  font-size: var(--van-font-size-lg);
  user-select: text;
  background: transparent;
}
.input :deep(textarea) {
  max-height: 120px;
  user-select: text;
}
.error-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: -10px -12px -10px 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}
</style>
