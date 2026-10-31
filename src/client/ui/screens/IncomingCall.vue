<script setup lang="ts">
import { computed } from 'vue'
import { useDuo } from '../useDuo'
import DuoAvatar from '../components/DuoAvatar.vue'
import IconPhone from '~icons/ph/phone-fill'
import IconVideo from '~icons/ph/video-camera-fill'
import IconHangup from '~icons/ph/phone-disconnect-fill'

const duo = useDuo()
const s = duo.state
const incoming = computed(() => s.view?.incoming ?? null)
const show = computed(() => !!incoming.value && !s.view?.inCall)
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    :overlay="false"
    :close-on-click-overlay="false"
    :lock-scroll="true"
    safe-area-inset-top
    safe-area-inset-bottom
    :style="{ height: '100%' }"
    class="ring"
    data-test="incoming"
  >
    <div class="ring-body">
      <div class="ring-avatar">
        <DuoAvatar :avatar="s.peer?.avatar" :size="160" />
      </div>
      <div class="ring-name">{{ s.peer?.name ?? 'Подружка' }}</div>
      <div class="ring-kind">
        <IconVideo v-if="incoming?.kind === 'video'" class="kind-icon" />
        <IconPhone v-else class="kind-icon" />
        {{ incoming?.kind === 'video' ? 'видеозвонок' : 'звонит' }}
      </div>
    </div>
    <van-grid :column-num="2" :border="false" class="ring-actions">
      <van-grid-item>
        <div class="action-tile">
          <van-button round size="large" type="danger" class="action-btn action-btn--xl" aria-label="Не сейчас" @click="duo.declineCall()">
            <IconHangup class="action-icon" />
          </van-button>
          <div class="action-caption">Не сейчас</div>
        </div>
      </van-grid-item>
      <van-grid-item>
        <div class="action-tile">
          <van-button round size="large" type="success" class="action-btn action-btn--xl pulse" aria-label="Ответить" @click="duo.acceptCall()">
            <IconVideo v-if="incoming?.kind === 'video'" class="action-icon" />
            <IconPhone v-else class="action-icon" />
          </van-button>
          <div class="action-caption">Ответить</div>
        </div>
      </van-grid-item>
    </van-grid>
  </van-popup>
</template>
