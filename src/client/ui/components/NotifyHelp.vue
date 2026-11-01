<script setup lang="ts">
// "How to turn notifications on", full screen, for an adult: opened from the greyed bell in
// the chat header or from the setup screen whenever notifications cannot work right here.
// - install: iPad/iPhone Safari tab, where push only exists in the Home Screen app;
// - denied: the browser/system blocks them, only the settings can undo it;
// - unsupported: this browser has no notifications at all.
import { computed } from 'vue'
import type { NotificationSupport } from '../../session/types'
import InstallSteps from './InstallSteps.vue'
import IconBellSlash from '~icons/ph/bell-slash-fill'
import IconWarning from '~icons/ph/warning-circle-fill'

const props = defineProps<{ support: NotificationSupport; apple: boolean; standalone: boolean }>()
const show = defineModel<boolean>('show', { required: true })

type HelpVariant ='install' | 'denied' | 'unsupported'
const variant = computed<HelpVariant>(() =>
  props.support === 'unsupported-install' ? 'install' : props.support === 'denied' ? 'denied' : 'unsupported',
)
const title = computed(
  () =>
    ({
      install: 'Как включить уведомления',
      denied: 'Уведомления запрещены',
      unsupported: 'Здесь нет уведомлений',
    })[variant.value],
)
</script>

<template>
  <van-popup v-model:show="show" position="bottom" :style="{ height: '100%' }" class="help" :lock-scroll="true">
    <div class="help-body van-safe-area-top van-safe-area-bottom" data-test="notify-help" :data-variant="variant">
      <IconBellSlash class="help-icon" aria-hidden="true" />
      <h2 class="help-title">{{ title }}</h2>

      <template v-if="variant === 'install'">
        <p class="help-text">
          На iPad и iPhone уведомления приходят только в приложении на экране «Домой». В этой вкладке
          Safari их не будет.
        </p>
        <div class="help-card">
          <p class="help-step-title">Добавьте чат на экран «Домой»</p>
          <InstallSteps :apple="apple" />
          <p class="help-text help-text--small">Потом откройте чат со значка «чат» и включите уведомления там.</p>
        </div>
        <div class="help-card help-card--warn" data-test="storage-note">
          <IconWarning class="warn-icon" aria-hidden="true" />
          <p class="help-text">
            Приложение со значка не видит эту вкладку. В нём пару придётся создать заново: взрослый
            создаёт новую пару с паролем, а второе устройство подключается к ней по новому QR-коду.
          </p>
        </div>
      </template>

      <template v-else-if="variant === 'denied'">
        <p class="help-text">Уведомления для чата запрещены. Отсюда их не включить, только в настройках.</p>
        <div class="help-card" data-test="settings-hint">
          <template v-if="apple">
            <p class="help-step-title">На iPad или iPhone</p>
            <p class="help-text">Настройки → Уведомления → «чат» → Допуск уведомлений.</p>
          </template>
          <template v-else-if="standalone">
            <p class="help-step-title">В установленном приложении</p>
            <p class="help-text">Настройки телефона → Приложения → «чат» → Уведомления → включить.</p>
          </template>
          <template v-else>
            <p class="help-step-title">В браузере</p>
            <p class="help-text">Нажмите на значок слева от адреса сайта → Разрешения (или «Настройки сайта») → Уведомления → Разрешить.</p>
          </template>
        </div>
        <p class="help-text help-text--small">Потом вернитесь в чат: переключатель появится сам.</p>
      </template>

      <template v-else>
        <template v-if="apple">
          <p class="help-text">
            Это приложение не умеет показывать уведомления. Нужна iPadOS или iOS 16.4 или новее:
            Настройки → Основные → Обновление ПО.
          </p>
        </template>
        <template v-else>
          <p class="help-text">Этот браузер не умеет показывать уведомления. Откройте чат в Chrome или установите приложение:</p>
          <div class="help-card">
            <InstallSteps :apple="false" />
          </div>
        </template>
      </template>

      <p class="help-text help-text--small">Звонки и переписка работают и без уведомлений.</p>

      <van-button round block type="primary" size="large" class="help-close" data-test="notify-help-close" @click="show = false">
        Понятно
      </van-button>
    </div>
  </van-popup>
</template>

<style scoped>
.help-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 560px;
  margin: 0 auto;
  padding: 32px 20px;
  text-align: center;
}
.help-icon {
  width: 56px;
  height: 56px;
  color: var(--van-text-color-3);
}
.help-title {
  margin: 0;
  font-size: 24px;
  color: var(--van-text-color);
}
.help-text {
  margin: 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  line-height: 1.45;
}
.help-text--small {
  font-size: var(--van-font-size-sm);
}
.help-card {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: var(--van-radius-lg);
  background: var(--van-background-2);
}
.help-card--warn {
  flex-direction: row;
  align-items: flex-start;
  text-align: left;
  background: var(--van-duo-butter);
}
.help-card--warn .help-text {
  color: var(--van-text-color);
}
.warn-icon {
  flex: none;
  width: 24px;
  height: 24px;
  color: var(--van-warning-color);
}
.help-step-title {
  margin: 0;
  font-weight: 700;
  color: var(--van-text-color);
}
.help-close {
  margin-top: 8px;
}
</style>
