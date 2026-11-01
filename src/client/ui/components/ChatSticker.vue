<script setup lang="ts">
// A sticker in the chat: large, no bubble, on the sender's side, with the same pending clock as
// ChatBubble for our own one that has not reached the friend yet. The id was validated when the
// message arrived (MessageStore.receive), so it always names one of our own files.
import { computed } from 'vue'
import { isStickerId, stickerLabel, stickerSrc } from '../../stickers/catalog'
import IconClock from '~icons/ph/clock-bold'

const props = defineProps<{ id: string; mine: boolean; pending?: boolean }>()
const known = computed(() => (isStickerId(props.id) ? props.id : null))
</script>

<template>
  <div v-if="known" class="sticker-row" :class="{ mine, pending }" data-test="sticker">
    <IconClock v-if="pending" class="pending-icon" aria-label="Ещё не доставлено" data-test="pending" />
    <img class="sticker" :class="{ pending }" :src="stickerSrc(known)" :alt="stickerLabel(known)" width="140" height="140" draggable="false" />
  </div>
</template>

<style scoped>
.sticker-row {
  display: flex;
  justify-content: flex-start;
  align-items: flex-end;
  gap: 6px;
}
.sticker-row.mine {
  justify-content: flex-end;
}
.pending-icon {
  flex: none;
  width: 16px;
  height: 16px;
  margin-bottom: 6px;
  color: var(--van-text-color-3);
}
.sticker {
  display: block;
  width: 140px;
  height: 140px;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
.sticker.pending {
  opacity: 0.6;
}
</style>
