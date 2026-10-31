<script setup lang="ts">
// Dev panel for the fake session: plays the server and the friend's device, so every screen
// and button state can be reached by hand. Only loaded with VITE_FAKE=1.
import { inject, ref } from 'vue'
import type { FakeDev } from './fake'
import { useDuo } from '../ui/useDuo'
import IconWrench from '~icons/ph/wrench-fill'

const dev = inject<FakeDev>('duoFake')!
const s = useDuo().state
const open = ref(false)

type Btn = { label: string; run: () => void }
const groups: { title: string; items: Btn[] }[] = [
  {
    title: 'Экран',
    items: [
      { label: 'Настройка', run: () => dev.setPhase('setup') },
      { label: 'Готово (чат)', run: () => dev.setPhase('ready') },
      { label: 'Онлайн', run: () => dev.setConnection('online') },
      { label: 'Нет связи', run: () => dev.setConnection('offline') },
      { label: 'Ошибка', run: () => dev.setError('Нет связи с сервером. Пробуем ещё…') },
      { label: 'Без ошибки', run: () => dev.setError(null) },
    ],
  },
  {
    title: 'Подружка',
    items: [
      { label: 'Пришла', run: () => dev.peerJoins() },
      { label: 'Ушла', run: () => dev.peerLeaves() },
      { label: 'Не подключена', run: () => dev.peerUnpaired() },
      { label: 'Пишет', run: () => dev.peerSays() },
      { label: 'Эмодзи', run: () => dev.peerSays('🦄🌈') },
      { label: 'Зовёт (nudge)', run: () => dev.nudge() },
      { label: 'Пуши у неё вкл/выкл', run: () => (dev.options.peerHasPush = !dev.options.peerHasPush) },
    ],
  },
  {
    title: 'Сообщения',
    items: [
      { label: 'Наполнить', run: () => dev.seedChat() },
      { label: 'Истекло старое', run: () => dev.expireOldest() },
      { label: 'Очистить', run: () => dev.clearChat() },
      { label: 'Автоответ вкл/выкл', run: () => (dev.options.autoReply = !dev.options.autoReply) },
    ],
  },
  {
    title: 'Кнопки',
    items: [
      { label: 'Звонок: готов', run: () => dev.setCallView('ready') },
      { label: 'Звонок: пауза', run: () => dev.setCallView('cooldown') },
      { label: 'Никого нет', run: () => dev.setCallView('nobodyHome') },
      { label: 'Позвать: готов', run: () => dev.setPingView('ready') },
      { label: 'Позвать: всё', run: () => dev.setPingView('exhausted') },
    ],
  },
  {
    title: 'Звонки',
    items: [
      { label: 'Входящий 📞', run: () => dev.incoming('voice') },
      { label: 'Входящий 🎥', run: () => dev.incoming('video') },
      { label: 'Она сбросила (пропущен)', run: () => dev.peerCancels() },
      { label: 'Она ответила', run: () => dev.peerAccepts() },
      { label: 'Она отклонила', run: () => dev.peerDeclines() },
      { label: 'Не ответила', run: () => dev.ringTimeout() },
      { label: 'Пропущенный из пуша', run: () => dev.missedFromPush() },
      { label: 'Она положила трубку', run: () => dev.peerHangsUp() },
      { label: 'Её камера вкл', run: () => dev.peerCamera(true) },
      { label: 'Её камера выкл', run: () => dev.peerCamera(false) },
    ],
  },
]

function run(b: Btn) {
  b.run()
}
</script>

<template>
  <button type="button" class="dev-toggle" aria-label="Dev panel" data-test="dev-toggle" @click="open = true">
    <IconWrench class="dev-icon" />
  </button>
  <van-popup v-model:show="open" position="right" :style="{ width: 'min(360px, 88vw)', height: '100%' }" class="dev-panel" data-test="dev-panel">
    <div class="dev-body">
      <div class="dev-state">
        phase={{ s.phase }} · {{ s.connection }} · peer {{ s.view?.peerPresent ? 'here' : 'away' }} · call={{ s.view?.call.kind }} · ping={{ s.view?.ping.kind }} · push {{ dev.options.peerHasPush ? 'on' : 'off' }} · last ping={{ s.lastPing?.result ?? '-' }}
      </div>
      <section v-for="g in groups" :key="g.title" class="dev-group">
        <h3 class="dev-title">{{ g.title }}</h3>
        <div class="dev-buttons">
          <van-button v-for="b in g.items" :key="b.label" size="small" round plain type="primary" class="dev-btn" @click="run(b)">
            {{ b.label }}
          </van-button>
        </div>
      </section>
    </div>
  </van-popup>
</template>

<style scoped>
.dev-toggle {
  position: fixed;
  left: 0;
  top: 40%;
  z-index: 3000;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: rgba(43, 36, 64, 0.12);
  color: var(--van-text-color-2);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
}
.dev-icon {
  width: 20px;
  height: 20px;
}
.dev-panel {
  z-index: 3001 !important;
}
.dev-body {
  padding: 16px 12px 40px;
}
.dev-state {
  font: 12px/1.4 ui-monospace, monospace;
  color: var(--van-text-color-2);
  margin-bottom: 8px;
}
.dev-title {
  margin: 14px 0 8px;
  font-size: 14px;
  color: var(--van-text-color-2);
}
.dev-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dev-btn.van-button {
  height: 34px;
  font-size: 13px;
}
</style>
