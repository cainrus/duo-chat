<script setup lang="ts">
// Root: theme, and which screen is up. Every screen reads the session from `inject('duo')`.
import { computed, inject, ref, watch, type Component } from 'vue'
import { showToast } from 'vant'
import type { CallKind } from '@shared/types'
import { themeVars } from './ui/theme'
import { useDuo } from './ui/useDuo'
import SetupScreen from './ui/screens/SetupScreen.vue'
import ChatScreen from './ui/screens/ChatScreen.vue'
import IncomingCall from './ui/screens/IncomingCall.vue'
import OutgoingCall from './ui/screens/OutgoingCall.vue'
import InCall from './ui/screens/InCall.vue'
import MediaAudio from './ui/components/MediaAudio.vue'

const duo = useDuo()
const s = duo.state
/** Dev-only panel, provided by main.ts in VITE_FAKE mode. */
const devPanel = inject<Component | null>('duoDevPanel', null)

// The setup wizard stays up after pairing until the adult taps "done" (QR, notifications).
const wizard = ref(s.phase === 'setup')
watch(
  () => s.phase,
  (p) => {
    if (p === 'setup') wizard.value = true
  },
)
const showSetup = computed(() => s.phase === 'setup' || wizard.value)

const callMinimized = ref(false)

// Which way the last call went, so "why it ended" can be told from our side.
const lastRole = ref<'caller' | 'callee' | null>(null)
watch(
  () => s.view?.outgoing,
  (o) => o && (lastRole.value = 'caller'),
)
watch(
  () => s.view?.incoming,
  (i) => i && (lastRole.value = 'callee'),
)

const NOTES = {
  caller: { declined: 'Сейчас не может 🙈', timeout: 'Не ответила 🤷', cancelled: null, hangup: 'Пока-пока 👋' },
  callee: { declined: null, timeout: null, cancelled: null, hangup: 'Пока-пока 👋' },
} as const

// The session sets lastCallEnded; the UI shows a short note and asks the session to clear it.
watch(
  () => s.lastCallEnded,
  (reason) => {
    if (!reason) return
    const role = lastRole.value ?? 'callee'
    const note = NOTES[role][reason]
    if (note) showToast({ message: note, position: 'middle', duration: 1800 })
    duo.dismissCallEnded()
  },
)

function callBack(kind: CallKind) {
  duo.dismissMissedCall()
  void duo.startCall(kind)
}
</script>

<template>
  <van-config-provider :theme-vars="themeVars" theme="light" theme-vars-scope="global">
    <SetupScreen v-if="showSetup" @done="wizard = false" />
    <template v-else>
      <ChatScreen :missed-call="s.missedCall?.kind ?? null" @call-back="callBack" @dismiss-missed="duo.dismissMissedCall()" />
      <OutgoingCall />
      <IncomingCall />
      <InCall v-model:minimized="callMinimized" />
    </template>
    <!-- Remote audio lives here so it keeps playing while the call screen is hidden. -->
    <MediaAudio v-if="s.view?.inCall" :stream="s.media.remote" />
    <component :is="devPanel" v-if="devPanel" />
  </van-config-provider>
</template>
