<script setup lang="ts">
import { computed } from 'vue'
import { qrDataUrl } from '../pairing'

const props = withDefaults(defineProps<{ text: string; size?: number }>(), { size: 240 })
const src = computed(() => qrDataUrl(props.text))
</script>

<template>
  <van-image :src="src" :width="size" :height="size" radius="16" alt="QR-код для второго устройства" class="qr" />
</template>
