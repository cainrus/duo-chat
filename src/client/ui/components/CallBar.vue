<script setup lang="ts">
// The call bar at the top of the chat: this side's call switch, one short status line under it,
// and the ping button. Calls live inside the chat; there is no separate call screen.
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useDuo } from '../useDuo'
import { useNow } from '../useNow'
import { mmss } from '../format'
import { startRinging } from '../sound'
import CallSwitch from './CallSwitch.vue'
import PingButton from './PingButton.vue'

const emit = defineEmits<{ ping: [] }>()

const duo = useDuo()
const s = duo.state
const now = useNow()

const view = computed(() => s.view)
const peerName = computed(() => s.peer?.name ?? 'Подружка')
const calling = computed(() => !!view.value?.incoming && s.myMode === 'off')

// The contract has no call start time, so the UI notes when the call connected.
const startedAt = ref<number | null>(null)
watch(
  () => !!view.value?.inCall,
  (on) => (startedAt.value = on ? (startedAt.value ?? Date.now()) : null),
  { immediate: true },
)
const elapsed = computed(() => mmss(startedAt.value ? now.value - startedAt.value : 0))
/** Recomputed when the server view changes; CountDown ticks by itself. */
const msLeft = (until: number) => Math.max(0, until - Date.now())

// A soft repeating chime while she waits for us (it stops by itself after a minute).
let stopRing: (() => void) | null = null
watch(
  calling,
  (on) => {
    stopRing?.()
    stopRing = on ? startRinging() : null
  },
  { immediate: true },
)
onScopeDispose(() => stopRing?.())
</script>

<template>
  <section class="call-bar" data-test="call-bar">
    <div class="call-main">
      <CallSwitch />
      <div class="call-status" aria-live="polite" data-test="call-status">
        <template v-if="view?.inCall">
          <span class="status-live">{{ elapsed }}</span>
        </template>
        <span v-else-if="view?.outgoing" data-test="waiting">ждём {{ peerName }}…</span>
        <span v-else-if="calling" class="status-calling" data-test="peer-calling">{{ peerName }} зовёт</span>
        <template v-else-if="view?.call.kind === 'cooldown'">
          <span class="status-muted">снова через</span>
          <van-count-down :time="msLeft(view.call.until)" format="mm:ss" class="status-timer" />
        </template>
        <span v-else-if="view?.call.kind === 'nobodyHome'" class="status-warn" data-test="nobody-home">никого нет</span>
      </div>
    </div>
    <PingButton v-if="view" :view="view.ping" @press="emit('ping')" />
  </section>
</template>

<style scoped>
.call-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 16px 8px;
}
.call-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.call-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding-left: 8px;
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-2);
  font-variant-numeric: tabular-nums;
}
.status-timer {
  --van-count-down-font-size: var(--van-font-size-sm);
  --van-count-down-text-color: var(--van-text-color-2);
}
.status-live {
  color: var(--van-success-color);
  font-weight: 600;
}
.status-calling {
  color: var(--van-success-color);
  font-weight: 700;
  font-size: var(--van-font-size-md);
}
.status-muted {
  color: var(--van-text-color-3);
}
.status-warn {
  color: var(--van-text-color);
  font-weight: 600;
}
.call-bar :deep(.action-btn.van-button) {
  width: 64px;
  height: 56px;
}
.call-bar :deep(.action-caption) {
  font-size: var(--van-font-size-sm);
}
</style>
