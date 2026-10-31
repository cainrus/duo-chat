<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ stream: MediaStream | null }>()
const el = ref<HTMLAudioElement | null>(null)

function attach() {
  if (el.value && el.value.srcObject !== props.stream) el.value.srcObject = props.stream
}
onMounted(attach)
watch(() => props.stream, attach)
</script>

<template>
  <audio ref="el" autoplay class="media-audio" />
</template>

<style scoped>
.media-audio {
  display: none;
}
</style>
