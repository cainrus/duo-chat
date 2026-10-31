<script setup lang="ts">
import { computed } from 'vue'
import { isEmojiOnly } from '../emoji'

const props = defineProps<{ text: string; mine: boolean }>()
const big = computed(() => isEmojiOnly(props.text))
</script>

<template>
  <div class="row" :class="{ mine }">
    <div class="bubble" :class="{ mine, big }" data-test="bubble">{{ text }}</div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  justify-content: flex-start;
}
.row.mine {
  justify-content: flex-end;
}
.bubble {
  max-width: min(78%, 560px);
  padding: 12px 16px;
  border-radius: var(--van-radius-lg);
  border-bottom-left-radius: var(--van-radius-sm);
  background: var(--van-background-2);
  color: var(--van-text-color);
  font-size: var(--van-font-size-lg);
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  box-shadow: 0 1px 2px rgba(43, 36, 64, 0.06);
  user-select: text;
}
.bubble.mine {
  background: var(--van-primary-color);
  color: #fff;
  border-bottom-left-radius: var(--van-radius-lg);
  border-bottom-right-radius: var(--van-radius-sm);
}
.bubble.big {
  background: transparent;
  box-shadow: none;
  padding: 0 4px;
  font-size: 48px;
  line-height: 1.15;
}
</style>
