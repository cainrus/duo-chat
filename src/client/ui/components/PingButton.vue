<script setup lang="ts">
import type { PingButtonView } from '@shared/types'
import IconWave from '~icons/ph/hand-waving-fill'

defineProps<{ view: PingButtonView; shaking?: boolean }>()
const emit = defineEmits<{ press: [] }>()
</script>

<template>
  <div class="action-tile" :data-state="view.kind">
    <!-- Never disabled: when pushes are used up it still nudges a friend who is in the app. -->
    <van-badge :content="view.kind === 'exhausted' ? '!' : undefined" :offset="[-10, 10]" color="var(--van-text-color-3)">
      <van-button round size="large" type="warning" aria-label="Позвать в чат" class="action-btn" :class="{ wiggle: shaking }" @click="emit('press')">
        <IconWave class="action-icon" />
      </van-button>
    </van-badge>
    <div class="action-caption">
      <span v-if="view.kind === 'exhausted'" class="caption-muted">сегодня всё</span>
      <span v-else>Позвать</span>
    </div>
  </div>
</template>
