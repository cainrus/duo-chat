<script setup lang="ts">
// In-app QR scanner: camera frames -> canvas -> jsQR. Pure JS, no WASM, no network.
import { onBeforeUnmount, ref, watch } from 'vue'
import jsQR from 'jsqr'
import IconX from '~icons/ph/x-bold'

const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ found: [text: string] }>()

const video = ref<HTMLVideoElement | null>(null)
const problem = ref<string | null>(null)
let stream: MediaStream | null = null
let raf = 0
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d', { willReadFrequently: true })

async function start() {
  problem.value = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  } catch {
    problem.value = 'Нет доступа к камере. Разрешите камеру или вставьте ссылку.'
    return
  }
  if (!show.value) return stop()
  if (video.value) {
    video.value.srcObject = stream
    await video.value.play().catch(() => {})
  }
  raf = requestAnimationFrame(tick)
}

function tick() {
  const v = video.value
  if (v && ctx && v.readyState >= 2 && v.videoWidth > 0) {
    // Downscale for speed; QR codes on a screen are large.
    const scale = Math.min(1, 640 / v.videoWidth)
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) {
      emit('found', code.data)
      show.value = false
      return
    }
  }
  raf = requestAnimationFrame(tick)
}

function stop() {
  cancelAnimationFrame(raf)
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  if (video.value) video.value.srcObject = null
}

watch(show, (on) => (on ? void start() : stop()))
onBeforeUnmount(stop)
</script>

<template>
  <van-popup v-model:show="show" position="bottom" :style="{ height: '100%' }" safe-area-inset-top safe-area-inset-bottom class="scanner">
    <video ref="video" class="scanner-video" autoplay playsinline muted />
    <div class="scanner-frame" aria-hidden="true" />
    <p class="scanner-hint">{{ problem ?? 'Наведите камеру на QR-код' }}</p>
    <van-button round size="large" class="scanner-close" aria-label="Закрыть" @click="show = false">
      <IconX class="action-icon" />
    </van-button>
  </van-popup>
</template>

<style scoped>
.scanner {
  background: #000;
}
.scanner-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scanner-frame {
  position: absolute;
  left: 50%;
  top: 45%;
  width: min(70vw, 360px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border: 4px solid rgba(255, 255, 255, 0.9);
  border-radius: 28px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
}
.scanner-hint {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(120px + env(safe-area-inset-bottom));
  margin: 0;
  color: #fff;
  text-align: center;
  font-size: var(--van-font-size-lg);
}
.scanner-close {
  position: absolute;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  width: 72px;
  transform: translateX(-50%);
}
</style>
