<script setup lang="ts">
// «онлайн»: tells the friend I am online (a push only if she is away; the same button and
// states either way, so it never reveals whether she is here). The server's view decides:
// ready; cooldown (disabled, a ring counts down the seconds, so a kid sees the wait instead of
// tapping again and again); exhausted (disabled, a calm «🌙 завтра»).
import { computed } from 'vue'
import { CALL_COOLDOWN_MS } from '@shared/constants'
import type { PingButtonView } from '@shared/types'
import { useNow } from '../useNow'
import IconWave from '~icons/ph/hand-waving-fill'

const props = defineProps<{ view: PingButtonView }>()
const emit = defineEmits<{ press: [] }>()

const now = useNow(250)
// Clamped: the clock ticks every 250 ms and may lag a fresh `until` by a moment.
const secondsLeft = computed(() =>
  props.view.kind === 'cooldown'
    ? Math.min(Math.ceil(CALL_COOLDOWN_MS / 1000), Math.max(0, Math.ceil((props.view.until - now.value) / 1000)))
    : 0,
)
const cooling = computed(() => props.view.kind === 'cooldown' && secondsLeft.value > 0)
const disabled = computed(() => cooling.value || props.view.kind === 'exhausted')

// The ring empties as the pause runs out (it is never longer than CALL_COOLDOWN_MS).
const R = 30
const CIRC = 2 * Math.PI * R
const dashOffset = computed(() => {
  const left = Math.min(1, (secondsLeft.value * 1000) / CALL_COOLDOWN_MS)
  return CIRC * (1 - left)
})

const label = computed(() => {
  if (cooling.value) return `Отправить статус онлайн: подожди ${secondsLeft.value} с`
  if (props.view.kind === 'exhausted') return 'Отправить статус онлайн: сегодня всё, завтра снова'
  return 'Отправить статус онлайн'
})

// A tap on the disabled button does nothing: the ring is the whole answer.
function tap() {
  if (!disabled.value) emit('press')
}
</script>

<template>
  <div class="action-tile" :data-state="cooling ? 'cooldown' : view.kind" data-test="ping">
    <!-- aria-disabled, not disabled: it stays focusable so a screen reader can read the seconds left. -->
    <button
      type="button"
      class="ping-btn"
      :class="{ 'is-off': disabled }"
      :aria-disabled="disabled"
      :aria-label="label"
      @click="tap"
    >
      <svg v-if="cooling" class="ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle class="ring-track" cx="32" cy="32" :r="R" />
        <circle class="ring-left" cx="32" cy="32" :r="R" :stroke-dasharray="CIRC" :stroke-dashoffset="dashOffset" />
      </svg>
      <span v-if="view.kind === 'exhausted'" class="moon" aria-hidden="true">🌙</span>
      <IconWave v-else class="action-icon" />
    </button>
    <div class="action-caption" aria-hidden="true">
      <span v-if="cooling" class="caption-muted" data-test="ping-seconds">{{ secondsLeft }} с</span>
      <span v-else-if="view.kind === 'exhausted'" class="caption-muted">завтра</span>
      <span v-else>онлайн</span>
    </div>
  </div>
</template>

<style scoped>
.ping-btn {
  position: relative;
  width: 64px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--van-radius-max);
  background: var(--van-duo-peach);
  color: var(--van-text-color);
  cursor: pointer;
}
.ping-btn.is-off {
  background: var(--van-duo-track);
  color: var(--van-text-color-3);
  cursor: default;
}
.ring {
  position: absolute;
  inset: -4px 0;
  width: 100%;
  height: calc(100% + 8px);
  transform: rotate(-90deg);
}
.ring-track,
.ring-left {
  fill: none;
  stroke-width: 4;
}
.ring-track {
  stroke: var(--van-duo-track);
}
.ring-left {
  stroke: var(--van-duo-peach-ink);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s linear;
}
.moon {
  font-size: 28px;
  line-height: 1;
}
@media (prefers-reduced-motion: reduce) {
  .ring-left {
    transition: none;
  }
}
</style>
