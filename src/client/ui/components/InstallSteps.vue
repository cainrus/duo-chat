<script setup lang="ts">
// "Add to the Home Screen" in two pictured taps: Share -> Add to Home Screen on iPad/iPhone,
// Menu -> Install app elsewhere (Android Chrome). Shared by the setup screen and the
// notifications help.
import IconShare from '~icons/ph/export-fill'
import IconAdd from '~icons/ph/plus-square-fill'
import IconMenu from '~icons/ph/dots-three-vertical-bold'

defineProps<{ apple: boolean }>()
</script>

<template>
  <div class="install-steps" data-test="install-steps" :data-platform="apple ? 'apple' : 'other'">
    <template v-if="apple">
      <div class="install-step"><IconShare class="install-icon" /><span>Поделиться</span></div>
      <span class="install-arrow" aria-hidden="true">→</span>
      <div class="install-step"><IconAdd class="install-icon" /><span>На экран «Домой»</span></div>
    </template>
    <template v-else>
      <div class="install-step"><IconMenu class="install-icon" /><span>Меню</span></div>
      <span class="install-arrow" aria-hidden="true">→</span>
      <div class="install-step"><IconAdd class="install-icon" /><span>Установить приложение</span></div>
    </template>
  </div>
</template>

<style scoped>
.install-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
}
.install-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-2);
  text-align: center;
}
.install-icon {
  width: 40px;
  height: 40px;
  color: var(--van-duo-lavender-ink);
}
.install-arrow {
  font-size: 24px;
  color: var(--van-text-color-3);
}
</style>
