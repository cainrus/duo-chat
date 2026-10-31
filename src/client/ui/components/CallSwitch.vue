<script setup lang="ts">
// This side's call switch: OFF | AUDIO | VIDEO. Each side sets only its own; the session maps
// it onto the server's call rules and the friend's switch (see DuoSession.setMode).
// - From OFF only AUDIO is tappable (it calls, or joins her call). VIDEO stays locked while OFF
//   and for VIDEO_UNLOCK_MS after AUDIO, so a mis-tap never lands in video.
// - Her call: AUDIO glows. Nothing ever shows that she chose VIDEO (no pressure).
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { CallMode } from '../../session/types'
import { useDuo } from '../useDuo'
import IconOff from '~icons/ph/phone-slash-fill'
import IconAudio from '~icons/ph/phone-fill'
import IconVideo from '~icons/ph/video-camera-fill'
import IconLock from '~icons/ph/lock-simple-fill'

const duo = useDuo()
const s = duo.state

// VIDEO unlocks at a moment, not on a state change: a timer flips this.
const unlocked = ref(false)
let unlockTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => s.videoUnlockAt,
  (at) => {
    if (unlockTimer !== null) clearTimeout(unlockTimer)
    unlockTimer = null
    unlocked.value = at !== null && Date.now() >= at
    if (at !== null && !unlocked.value) {
      unlockTimer = setTimeout(() => (unlocked.value = true), at - Date.now())
    }
  },
  { immediate: true },
)
onScopeDispose(() => unlockTimer !== null && clearTimeout(unlockTimer))

const view = computed(() => s.view)
/** She is calling us and we have not joined yet. */
const calling = computed(() => !!view.value?.incoming && s.myMode === 'off')
const canStart = computed(() => {
  const v = view.value
  if (!v || v.inCall || v.outgoing) return false
  return v.incoming || (v.peerPaired && v.call.kind === 'ready')
})
/** VIDEO is locked for a moment after AUDIO turned on (shown with a lock). */
const videoLocked = computed(() => s.myMode !== 'off' && !unlocked.value)

type Segment = { mode: CallMode; label: string; disabled: boolean }
const segments = computed<Segment[]>(() => [
  { mode: 'off', label: 'Выключить звонок', disabled: false },
  { mode: 'audio', label: calling.value ? 'Подключиться' : 'Звук', disabled: s.myMode === 'off' && !canStart.value },
  { mode: 'video', label: 'Видео', disabled: s.myMode === 'off' || videoLocked.value },
])

function pick(seg: Segment) {
  if (seg.disabled || seg.mode === s.myMode) return
  void duo.setMode(seg.mode)
}
</script>

<template>
  <div class="switch" role="radiogroup" aria-label="Звонок" data-test="call-switch" :data-mode="s.myMode">
    <button
      v-for="seg in segments"
      :key="seg.mode"
      type="button"
      role="radio"
      class="seg"
      :class="[`seg--${seg.mode}`, { 'seg--on': s.myMode === seg.mode, 'seg--calling': seg.mode === 'audio' && calling }]"
      :aria-checked="s.myMode === seg.mode"
      :aria-label="seg.label"
      :disabled="seg.disabled"
      :data-test="`mode-${seg.mode}`"
      @click="pick(seg)"
    >
      <IconOff v-if="seg.mode === 'off'" class="seg-icon" />
      <IconAudio v-else-if="seg.mode === 'audio'" class="seg-icon" />
      <template v-else>
        <IconVideo class="seg-icon" />
        <IconLock v-if="videoLocked" class="seg-lock" data-test="video-lock" aria-hidden="true" />
      </template>
    </button>
  </div>
</template>

<style scoped>
.switch {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--van-radius-max);
  background: var(--van-background-2);
  box-shadow: 0 1px 4px rgba(43, 36, 64, 0.12);
}
.seg {
  position: relative;
  width: 64px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--van-radius-max);
  background: transparent;
  color: var(--van-text-color-2);
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.seg:disabled {
  color: var(--van-text-color-3);
  opacity: 0.45;
  cursor: default;
}
.seg-icon {
  width: 30px;
  height: 30px;
}
.seg-lock {
  position: absolute;
  right: 8px;
  bottom: 6px;
  width: 16px;
  height: 16px;
}
.seg--on.seg--off {
  background: var(--van-active-color);
  color: var(--van-text-color);
}
.seg--on.seg--audio {
  background: var(--van-success-color);
  color: #fff;
}
.seg--on.seg--video {
  background: var(--van-primary-color);
  color: #fff;
}
/* Her call: AUDIO glows softly until we join (or it rings out). */
.seg--calling {
  background: #e5f7ef;
  color: var(--van-success-color);
  animation: calling 1.6s ease-out infinite;
}
@keyframes calling {
  0% {
    box-shadow: 0 0 0 0 rgba(34, 176, 125, 0.45);
  }
  100% {
    box-shadow: 0 0 0 14px rgba(34, 176, 125, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .seg--calling {
    animation: none;
  }
  .seg {
    transition: none;
  }
}
</style>
