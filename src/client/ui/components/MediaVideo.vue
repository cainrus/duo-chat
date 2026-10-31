<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ stream: MediaStream | null; muted?: boolean; mirror?: boolean }>()
const el = ref<HTMLVideoElement | null>(null)

function attach() {
  if (el.value && el.value.srcObject !== props.stream) el.value.srcObject = props.stream
}
onMounted(attach)
watch(() => props.stream, attach)
</script>

<template>
  <video ref="el" class="media-video" :class="{ mirror }" autoplay playsinline :muted="muted" />
</template>

<style scoped>
.media-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}
.mirror {
  transform: scaleX(-1);
}
</style>
