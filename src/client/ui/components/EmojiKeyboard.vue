<script setup lang="ts">
// Inline emoji and sticker keyboard (Vant Tabs + Grid). Inline rather than a bottom Popup, so the
// child still sees the message being composed above it.
// The first two tabs are stickers (the spy, then Noto Animated Emoji): a tap SENDS the sticker at
// once. The emoji tabs after them put an emoji into the text field.
import { ref } from 'vue'
import { EMOJI_TABS } from '../emoji'
import { NOTO_STICKERS, SPY_STICKERS, stickerLabel, stickerSrc, type StickerId } from '../../stickers/catalog'

const emit = defineEmits<{ pick: [emoji: string]; sticker: [id: StickerId] }>()

type StickerTab = { key: string; label: string; icon: StickerId; stickers: readonly StickerId[] }
const STICKER_TABS: readonly StickerTab[] = [
  { key: 'spy', label: 'Шпион', icon: 'spy:happy', stickers: SPY_STICKERS },
  { key: 'noto', label: 'Стикеры', icon: 'noto:1f929', stickers: NOTO_STICKERS },
]
const active = ref(0)
</script>

<template>
  <div class="emoji-kb" data-test="emoji-keyboard">
    <van-tabs v-model:active="active" swipeable animated>
      <van-tab v-for="(tab, i) in STICKER_TABS" :key="tab.key" :name="i">
        <template #title>
          <img class="tab-img" :src="stickerSrc(tab.icon)" :alt="tab.label" :data-test="`tab-${tab.key}`" width="32" height="32" draggable="false" />
        </template>
        <div class="emoji-scroll">
          <van-grid :column-num="4" :border="false" clickable class="sticker-grid">
            <van-grid-item
              v-for="id in tab.stickers"
              :key="id"
              :aria-label="stickerLabel(id)"
              role="button"
              :data-test="`sticker-${id}`"
              @click="emit('sticker', id)"
            >
              <img class="sticker" :src="stickerSrc(id)" alt="" width="80" height="80" loading="lazy" draggable="false" />
            </van-grid-item>
          </van-grid>
        </div>
      </van-tab>
      <van-tab v-for="(tab, i) in EMOJI_TABS" :key="tab.label" :name="STICKER_TABS.length + i">
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
.tab-img {
  display: block;
  width: 32px;
  height: 32px;
}
.emoji-scroll {
  height: min(36dvh, 340px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.emoji-grid :deep(.van-grid-item__content) {
  padding: 10px 0;
}
.sticker-grid :deep(.van-grid-item__content) {
  padding: 8px 0;
}
.sticker {
  display: block;
  width: 80px;
  height: 80px;
  object-fit: contain;
}
.emoji {
  font-size: 38px;
  line-height: 1;
}
</style>
