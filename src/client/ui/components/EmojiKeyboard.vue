<script setup lang="ts">
// Inline emoji keyboard (Vant Tabs + Grid). Inline rather than a bottom Popup, so the child
// still sees the message being composed above it.
import { ref } from 'vue'
import { EMOJI_TABS } from '../emoji'

const emit = defineEmits<{ pick: [emoji: string] }>()
const active = ref(0)
</script>

<template>
  <div class="emoji-kb" data-test="emoji-keyboard">
    <van-tabs v-model:active="active" swipeable animated>
      <van-tab v-for="(tab, i) in EMOJI_TABS" :key="tab.label" :name="i">
        <template #title><span class="tab-icon" :aria-label="tab.label">{{ tab.icon }}</span></template>
        <div class="emoji-scroll">
          <van-grid :column-num="6" :border="false" clickable class="emoji-grid">
            <van-grid-item v-for="e in tab.emoji" :key="e" @click="emit('pick', e)">
              <span class="emoji">{{ e }}</span>
            </van-grid-item>
          </van-grid>
        </div>
      </van-tab>
    </van-tabs>
  </div>
</template>

<style scoped>
.emoji-kb {
  margin-top: 8px;
  border-radius: var(--van-radius-lg) var(--van-radius-lg) 0 0;
  background: var(--van-background-2);
  overflow: hidden;
}
.tab-icon {
  font-size: 28px;
}
.emoji-scroll {
  height: min(36dvh, 340px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.emoji-grid :deep(.van-grid-item__content) {
  padding: 10px 0;
}
.emoji {
  font-size: 38px;
  line-height: 1;
}
</style>
