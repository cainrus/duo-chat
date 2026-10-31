<script setup lang="ts">
// Home screen: the friend, the conversation, the input with a big emoji keyboard, and the
// three big buttons (ping, voice, video). Every button state comes from the server's view.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CallKind } from '@shared/types'
import { MAX_MESSAGE_LENGTH } from '../../messages/store'
import { useDuo } from '../useDuo'
import { playDing } from '../sound'
import DuoAvatar from '../components/DuoAvatar.vue'
import ChatBubble from '../components/ChatBubble.vue'
import EmojiKeyboard from '../components/EmojiKeyboard.vue'
import CallButton from '../components/CallButton.vue'
import PingButton from '../components/PingButton.vue'
import IconSmiley from '~icons/ph/smiley-fill'
import IconSend from '~icons/ph/paper-plane-right-fill'
import IconPhoneMissed from '~icons/ph/phone-incoming-fill'
import IconOffline from '~icons/ph/wifi-slash-bold'
import IconX from '~icons/ph/x-bold'

defineProps<{ missedCall: CallKind | null }>()
const emit = defineEmits<{ callBack: [kind: CallKind]; dismissMissed: [] }>()

const duo = useDuo()
const s = duo.state

const text = ref('')
const emojiOpen = ref(false)
const list = ref<HTMLElement | null>(null)
const shaking = ref(false)

const view = computed(() => s.view)
const self = computed(() => view.value?.self)
const present = computed(() => !!view.value?.peerPresent)
const busy = computed(() => !view.value?.peerPaired || !!view.value?.outgoing || !!view.value?.inCall || !!view.value?.incoming)
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
watch([() => s.messages.length, emojiOpen], scrollToEnd)

// The friend pressed "come to the chat" while we are here: wiggle the avatar and ding.
watch(
  () => s.nudgeAt,
  (at) => {
    if (at == null) return
    playDing()
    shaking.value = false
    void nextTick(() => (shaking.value = true))
    setTimeout(() => (shaking.value = false), 1600)
  },
)
</script>

<template>
  <div class="chat van-safe-area-top">
    <header class="chat-head">
      <van-badge dot :color="present ? 'var(--van-success-color)' : 'var(--van-text-color-3)'" :offset="[-6, 50]">
        <DuoAvatar :avatar="s.peer?.avatar" :size="56" :class="{ nudge: shaking }" data-test="peer-avatar" />
      </van-badge>
      <div class="head-text">
        <div class="head-name">{{ peerName }}</div>
        <div class="head-status" :data-present="present" data-test="presence">
          {{ present ? 'здесь' : view?.peerPaired ? 'нет в чате' : 'ещё не подключилась' }}
        </div>
      </div>
      <IconOffline v-if="s.connection !== 'online'" class="head-offline" aria-label="Нет связи" />
      <DuoAvatar :avatar="s.me?.avatar" :size="40" class="head-me" />
    </header>

    <van-notice-bar v-if="s.error" :text="s.error" mode="closeable" wrapable color="var(--van-danger-color)" background="#FDECEF" />

    <main ref="list" class="chat-list" data-test="timeline">
      <div v-if="!s.messages.length" class="chat-empty" aria-hidden="true">👋</div>
      <ChatBubble v-for="m in s.messages" :key="m.id" :text="m.text" :mine="m.from === self" />
    </main>

    <footer class="chat-foot van-safe-area-bottom">
      <div v-if="missedCall" class="missed" data-test="missed-call">
        <IconPhoneMissed class="missed-icon" />
        <span class="missed-text">Звонила {{ s.peer?.name ?? 'подружка' }}</span>
        <van-button round type="success" class="missed-btn" @click="emit('callBack', missedCall)">Перезвонить</van-button>
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
      <van-grid v-else :column-num="3" :border="false" class="actions">
        <van-grid-item>
          <PingButton v-if="view" :view="view.ping" @press="duo.ping()" />
        </van-grid-item>
        <van-grid-item>
          <CallButton v-if="view" kind="voice" :view="view.call" :busy="busy" @press="duo.startCall($event)" />
        </van-grid-item>
        <van-grid-item>
          <CallButton v-if="view" kind="video" :view="view.call" :busy="busy" @press="duo.startCall($event)" />
        </van-grid-item>
      </van-grid>
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
  padding: 8px 12px 0;
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
.actions {
  padding: 4px 0;
}
.actions :deep(.van-grid-item__content) {
  background: transparent;
  padding: 8px 4px;
}
.nudge {
  animation: nudge 0.5s ease-in-out 3;
}
@keyframes nudge {
  0%,
  100% {
    transform: rotate(0) scale(1);
  }
  25% {
    transform: rotate(-14deg) scale(1.12);
  }
  75% {
    transform: rotate(14deg) scale(1.12);
  }
}
</style>
