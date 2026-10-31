<script setup lang="ts">
import { computed } from 'vue'
import { useDuo } from '../useDuo'
import DuoAvatar from '../components/DuoAvatar.vue'
import IconHangup from '~icons/ph/phone-disconnect-fill'

const duo = useDuo()
const s = duo.state
const outgoing = computed(() => s.view?.outgoing ?? null)
// Recomputed only when the outgoing call changes; CountDown ticks by itself.
const msLeft = computed(() => (outgoing.value ? Math.max(0, outgoing.value.until - Date.now()) : 0))
</script>

<template>
  <van-popup
    :show="!!outgoing"
    position="bottom"
    :overlay="false"
    :close-on-click-overlay="false"
    safe-area-inset-top
    safe-area-inset-bottom
    :style="{ height: '100%' }"
    class="ring"
    data-test="outgoing"
  >
    <div class="ring-body">
      <div class="ring-avatar ring-avatar--waves">
        <DuoAvatar :avatar="s.peer?.avatar" :size="160" />
      </div>
      <div class="ring-name">{{ s.peer?.name ?? 'Подружка' }}</div>
      <div class="ring-kind">
        <van-loading type="spinner" size="28" color="var(--van-primary-color)" />
        {{ outgoing?.kind === 'video' ? 'видеозвонок…' : 'звоним…' }}
      </div>
      <van-count-down v-if="outgoing" :time="msLeft" format="mm:ss" class="ring-timer" />
    </div>
    <div class="ring-actions ring-actions--single">
      <div class="action-tile">
        <van-button round size="large" type="danger" class="action-btn action-btn--xl" aria-label="Отбой" @click="duo.cancelCall()">
          <IconHangup class="action-icon" />
        </van-button>
        <div class="action-caption">Отбой</div>
      </div>
    </div>
  </van-popup>
</template>
