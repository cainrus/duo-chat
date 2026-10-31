<script setup lang="ts">
// Connected call. Remote video (or the friend's avatar in voice mode), a draggable self-view,
// and mute / camera / to-chat / end. "To chat" hides this screen; a floating bubble with the
// call timer brings it back. Remote audio plays from App.vue, so it keeps going meanwhile.
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useDuo } from '../useDuo'
import { callVars } from '../theme'
import { useNow } from '../useNow'
import { mmss } from '../format'
import DuoAvatar from '../components/DuoAvatar.vue'
import MediaVideo from '../components/MediaVideo.vue'
import IconMic from '~icons/ph/microphone-fill'
import IconMicOff from '~icons/ph/microphone-slash-fill'
import IconCam from '~icons/ph/video-camera-fill'
import IconCamOff from '~icons/ph/video-camera-slash-fill'
import IconChat from '~icons/ph/chat-circle-dots-fill'
import IconHangup from '~icons/ph/phone-disconnect-fill'
import IconPhone from '~icons/ph/phone-fill'

const minimized = defineModel<boolean>('minimized', { required: true })

const duo = useDuo()
const s = duo.state
const inCall = computed(() => s.view?.inCall ?? null)
const now = useNow()

// The contract has no call start time, so the UI notes when the call connected.
const startedAt = ref<number | null>(null)
watch(
  inCall,
  (c) => {
    startedAt.value = c ? (startedAt.value ?? Date.now()) : null
    if (!c) minimized.value = false
  },
  { immediate: true },
)
const elapsed = computed(() => (startedAt.value ? mmss(now.value - startedAt.value) : '00:00'))

// Track lists are not reactive; re-read them when the stream adds or drops a track.
const trackTick = ref(0)
let watched: MediaStream | null = null
const bump = () => trackTick.value++
function watchStream(stream: MediaStream | null) {
  watched?.removeEventListener('addtrack', bump)
  watched?.removeEventListener('removetrack', bump)
  watched = stream
  stream?.addEventListener('addtrack', bump)
  stream?.addEventListener('removetrack', bump)
  bump()
}
watch(() => s.media.remote, watchStream, { immediate: true })
onScopeDispose(() => watchStream(null))

const remoteHasVideo = computed(() => {
  void trackTick.value
  return !!s.media.remote?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled)
})
const showSelf = computed(() => s.media.camOn && !!s.media.local)

// Self-view starts in the top-right corner, clear of the controls.
const selfOffset = ref({ x: Math.max(16, window.innerWidth - 136), y: 72 })
// "Back to call" starts under the chat header on the right, clear of the action buttons.
const backOffset = ref({ x: Math.max(16, window.innerWidth - 88), y: 96 })

function toggleCamera() {
  void duo.setCamera(!s.media.camOn)
}
</script>

<template>
  <van-config-provider :theme-vars="callVars" theme-vars-scope="local">
    <van-popup
      :show="!!inCall && !minimized"
      position="bottom"
      :overlay="false"
      :close-on-click-overlay="false"
      :style="{ height: '100%' }"
      class="incall"
      data-test="in-call"
    >
      <div class="stage">
        <MediaVideo v-show="remoteHasVideo" :stream="s.media.remote" muted class="remote" />
        <div v-if="!remoteHasVideo" class="voice-stage">
          <DuoAvatar :avatar="s.peer?.avatar" :size="180" class="voice-avatar" />
          <div class="voice-name">{{ s.peer?.name ?? 'Подружка' }}</div>
        </div>
        <div class="timer van-safe-area-top">{{ elapsed }}</div>
      </div>

      <van-floating-bubble v-if="showSelf && !minimized" v-model:offset="selfOffset" axis="xy" magnetic="x" :gap="16" class="self-view">
        <MediaVideo :stream="s.media.local" muted mirror />
      </van-floating-bubble>

      <div class="controls van-safe-area-bottom">
        <van-grid :column-num="4" :border="false">
          <van-grid-item>
            <div class="action-tile">
              <van-button round size="large" :type="s.media.micOn ? 'default' : 'warning'" class="action-btn" :aria-label="s.media.micOn ? 'Выключить микрофон' : 'Включить микрофон'" @click="duo.setMic(!s.media.micOn)">
                <IconMic v-if="s.media.micOn" class="action-icon" />
                <IconMicOff v-else class="action-icon" />
              </van-button>
              <div class="action-caption">{{ s.media.micOn ? 'Звук' : 'Тихо' }}</div>
            </div>
          </van-grid-item>
          <van-grid-item>
            <div class="action-tile">
              <van-button round size="large" type="default" class="action-btn" :aria-label="s.media.camOn ? 'Выключить камеру' : 'Включить камеру'" @click="toggleCamera">
                <IconCam v-if="s.media.camOn" class="action-icon" />
                <IconCamOff v-else class="action-icon" />
              </van-button>
              <div class="action-caption">Камера</div>
            </div>
          </van-grid-item>
          <van-grid-item>
            <div class="action-tile">
              <van-button round size="large" type="primary" class="action-btn" aria-label="В чат" @click="minimized = true">
                <IconChat class="action-icon" />
              </van-button>
              <div class="action-caption">Чат</div>
            </div>
          </van-grid-item>
          <van-grid-item>
            <div class="action-tile">
              <van-button round size="large" type="danger" class="action-btn" aria-label="Закончить" @click="duo.hangUp()">
                <IconHangup class="action-icon" />
              </van-button>
              <div class="action-caption">Пока</div>
            </div>
          </van-grid-item>
        </van-grid>
      </div>
    </van-popup>
  </van-config-provider>

  <!-- Back to the call from the chat. -->
  <van-floating-bubble v-if="inCall && minimized" v-model:offset="backOffset" axis="y" magnetic="x" :gap="16" class="back-bubble" data-test="back-to-call" @click="minimized = false">
    <div class="back-inner">
      <IconPhone class="back-icon" />
      <span class="back-time">{{ elapsed }}</span>
    </div>
  </van-floating-bubble>
</template>

<style scoped>
.incall {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.remote {
  position: absolute;
  inset: 0;
}
.voice-stage {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: radial-gradient(circle at 50% 40%, #2c2545 0%, #15121f 70%);
}
.voice-name {
  color: #fff;
  font-size: 28px;
  font-weight: 700;
}
.timer {
  position: absolute;
  top: 16px;
  left: 0;
  right: 0;
  text-align: center;
  color: #fff;
  font-size: var(--van-font-size-lg);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.controls {
  background: rgba(21, 18, 31, 0.92);
  padding: 8px 8px 4px;
}
.controls :deep(.van-grid-item__content) {
  background: transparent;
  padding: 8px 2px;
}
.controls .action-caption {
  color: #fff;
}
.back-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #fff;
  line-height: 1;
  gap: 2px;
}
.back-icon {
  width: 28px;
  height: 28px;
}
.back-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
