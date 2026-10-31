<script setup lang="ts">
import { computed } from 'vue'
import type { CallButtonView, CallKind } from '@shared/types'
import IconPhone from '~icons/ph/phone-fill'
import IconVideo from '~icons/ph/video-camera-fill'
import IconHouse from '~icons/ph/house-line-fill'

const props = defineProps<{
  kind: CallKind
  view: CallButtonView
  /** Another call is ringing or connected, or there is no friend yet. */
  busy?: boolean
}>()
const emit = defineEmits<{ press: [kind: CallKind] }>()

const label = computed(() => (props.kind === 'voice' ? 'Звонок' : 'Видео'))
// Recomputed only when the server view changes; CountDown ticks by itself.
const msLeft = computed(() => (props.view.kind === 'ready' ? 0 : Math.max(0, props.view.until - Date.now())))
const disabled = computed(() => props.busy || props.view.kind !== 'ready')
</script>

<template>
  <div class="action-tile" :data-state="view.kind">
    <van-button
      round
      size="large"
      type="primary"
      :disabled="disabled"
      :aria-label="label"
      class="action-btn"
      @click="emit('press', kind)"
    >
      <IconHouse v-if="view.kind === 'nobodyHome'" class="action-icon" />
      <IconPhone v-else-if="kind === 'voice'" class="action-icon" />
      <IconVideo v-else class="action-icon" />
    </van-button>
    <div class="action-caption">
      <van-count-down v-if="view.kind === 'cooldown'" :time="msLeft" format="mm:ss" class="caption-timer" />
      <span v-else-if="view.kind === 'nobodyHome'" class="caption-warn">никого нет</span>
      <span v-else>{{ label }}</span>
    </div>
  </div>
</template>
