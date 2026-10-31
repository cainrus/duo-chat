<script setup lang="ts">
// Video at the top of the chat, shown only while both switches are on VIDEO: the friend big,
// ourselves small in the corner. Her audio plays from App.vue, so this video stays muted.
import { useDuo } from '../useDuo'
import MediaVideo from './MediaVideo.vue'

const s = useDuo().state
</script>

<template>
  <div class="call-video" data-test="call-video">
    <MediaVideo :stream="s.media.remote" muted class="remote" />
    <div class="self">
      <MediaVideo :stream="s.media.local" muted mirror />
    </div>
  </div>
</template>

<style scoped>
.call-video {
  position: relative;
  flex: none;
  height: min(40dvh, 72vw, 460px);
  margin: 0 16px 8px;
  border-radius: var(--van-radius-lg);
  overflow: hidden;
  background: #15121f;
}
.remote {
  position: absolute;
  inset: 0;
}
.self {
  position: absolute;
  top: 10px;
  right: 10px;
  width: min(28%, 140px);
  aspect-ratio: 3 / 4;
  border-radius: var(--van-radius-md);
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
</style>
