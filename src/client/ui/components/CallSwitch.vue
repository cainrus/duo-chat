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
/** VIDEO is locked for a moment after AUDIO turned on (just greyed, like any disabled segment). */
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
    <!-- iOS/Material segmented control: one thumb slides under the chosen segment. -->
    <span class="thumb" :class="`thumb--${s.myMode}`" aria-hidden="true" />
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
      <IconVideo v-else class="seg-icon" />
    </button>
  </div>
</template>

<style scoped>
/* Segment 64px, gap 4px: the thumb moves one step of 68px per segment. */
.switch {
  position: relative;
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--van-radius-max);
  background: var(--van-duo-track);
}
.thumb {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 64px;
  height: 56px;
  border-radius: var(--van-radius-max);
  background: var(--van-background-2);
  box-shadow: 0 1px 3px rgba(43, 36, 64, 0.15);
  transition:
    transform 0.2s ease,
    background-color 0.2s;
}
.thumb--audio {
  transform: translateX(68px);
  background: var(--van-duo-mint);
}
.thumb--video {
  transform: translateX(136px);
  background: var(--van-duo-lavender);
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
}
.seg--on {
  color: var(--van-text-color);
}
.seg:disabled {
  opacity: 0.4;
  cursor: default;
}
.seg-icon {
  width: 30px;
  height: 30px;
}
/* Her voice room is open: AUDIO is tinted until we join. Static, no glow. */
.seg--calling {
  background: var(--van-duo-sky);
  color: var(--van-text-color);
}
@media (prefers-reduced-motion: reduce) {
  .thumb {
    transition: none;
  }
}
</style>
