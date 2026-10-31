<script setup lang="ts">
// One-time setup, done by an adult on each device:
// install to the home screen (iPad: pairing must happen INSIDE the installed app, because its
// storage is separate from Safari's) -> name + avatar -> create the pair (QR) or join it
// (scan the QR in-app, or paste the link) -> notifications -> done.
import { computed, defineAsyncComponent, reactive, ref } from 'vue'
import { showToast } from 'vant'
import { AVATARS, type AvatarId, type NotificationResult } from '../../session/types'
import { useDuo } from '../useDuo'
import { AVATAR_LOOK } from '../avatars'
import { isAppleTouch, isStandalone, parsePairingLink } from '../pairing'
import DuoAvatar from '../components/DuoAvatar.vue'
import QrImage from '../components/QrImage.vue'
import IconShare from '~icons/ph/export-fill'
import IconAdd from '~icons/ph/plus-square-fill'
import IconMenu from '~icons/ph/dots-three-vertical-bold'
import IconDevice from '~icons/ph/device-mobile-fill'
import IconScan from '~icons/ph/scan-fill'
import IconBell from '~icons/ph/bell-ringing-fill'
import IconCopy from '~icons/ph/copy-fill'

// jsQR is the heaviest dependency and only needed once, on the second device: own chunk.
const QrScanner = defineAsyncComponent(() => import('../components/QrScanner.vue'))

const emit = defineEmits<{ done: [] }>()
const duo = useDuo()

type Step = 'profile' | 'pair' | 'notify'
const step = ref<Step>('profile')
const stepIndex = computed(() => ({ profile: 0, pair: 1, notify: 2 })[step.value])

const standalone = isStandalone()
const apple = isAppleTouch()

const form = reactive({ name: '', avatar: null as AvatarId | null })
const profileOk = computed(() => form.name.trim().length > 0 && form.avatar !== null)

const role = ref<'create' | 'join'>('create')
const adminSecret = ref('')
const pasted = ref('')
const busy = ref(false)
const problem = ref<string | null>(null)
const link = ref<string | null>(null)
const scanning = ref(false)
const notify = ref<NotificationResult | null>(null)

const me = () => ({ name: form.name.trim(), avatar: form.avatar! })

async function create() {
  problem.value = null
  busy.value = true
  try {
    link.value = (await duo.createPair({ adminSecret: adminSecret.value, me: me() })).link
  } catch (e) {
    problem.value = e instanceof Error ? e.message : 'Не получилось'
  } finally {
    busy.value = false
  }
}

async function join(text: string) {
  problem.value = null
  const secret = parsePairingLink(text)
  if (!secret) {
    problem.value = 'Эта ссылка не подходит. Нужна ссылка или QR с первого устройства.'
    return
  }
  busy.value = true
  try {
    await duo.joinPair({ secret, me: me() })
    step.value = 'notify'
  } catch (e) {
    problem.value = e instanceof Error ? e.message : 'Не получилось'
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
    showToast({ message: 'Ссылка скопирована', position: 'top' })
  } catch {
    showToast({ message: 'Не удалось скопировать', position: 'top' })
  }
}

async function enableNotifications() {
  busy.value = true
  try {
    notify.value = await duo.enableNotifications()
  } finally {
    busy.value = false
  }
}

const notifyLabel = computed(
  () =>
    ({ granted: 'включены ✅', denied: 'запрещены — включите в настройках', unsupported: 'не поддерживаются здесь' }) as const,
)
</script>

<template>
  <div class="setup van-safe-area-top van-safe-area-bottom" data-test="setup">
    <header class="setup-head">
      <div class="setup-logo" aria-hidden="true">🐰💬🦊</div>
      <h1 class="setup-title">Настройка</h1>
      <p class="setup-sub">Для взрослых, один раз на каждом устройстве</p>
    </header>

    <!-- iPad/phone in a browser tab: install first, pair inside the installed app. -->
    <van-cell-group v-if="!standalone" inset class="card install" data-test="install-hint">
      <van-cell :title="apple ? 'Сначала добавьте на экран «Домой»' : 'Сначала установите приложение'" title-class="card-title">
        <template #icon><IconDevice class="cell-icon" /></template>
      </van-cell>
      <div class="install-steps">
        <template v-if="apple">
          <div class="install-step"><IconShare class="install-icon" /><span>Поделиться</span></div>
          <span class="install-arrow">→</span>
          <div class="install-step"><IconAdd class="install-icon" /><span>На экран «Домой»</span></div>
        </template>
        <template v-else>
          <div class="install-step"><IconMenu class="install-icon" /><span>Меню</span></div>
          <span class="install-arrow">→</span>
          <div class="install-step"><IconAdd class="install-icon" /><span>Установить приложение</span></div>
        </template>
      </div>
      <p class="install-note">
        Потом откройте Дуо со значка на экране и продолжайте там.
        <template v-if="apple">На iPad приложение со значка не видит данные Safari, поэтому пару нужно создавать уже в нём.</template>
      </p>
    </van-cell-group>

    <van-steps :active="stepIndex" active-color="var(--van-primary-color)" class="steps">
      <van-step>Кто это</van-step>
      <van-step>Пара</van-step>
      <van-step>Уведомления</van-step>
    </van-steps>

    <!-- 1. Name + avatar -->
    <van-cell-group v-if="step === 'profile'" inset class="card">
      <van-field v-model="form.name" label="Имя" placeholder="Как зовут ребёнка" maxlength="20" :border="false" size="large" data-test="name" />
      <div class="avatar-label">Картинка</div>
      <van-grid :column-num="4" :border="false" clickable class="avatar-grid">
        <van-grid-item v-for="a in AVATARS" :key="a" :class="{ picked: form.avatar === a }" :data-test="`avatar-${a}`" @click="form.avatar = a">
          <van-badge :content="form.avatar === a ? '✓' : undefined" color="var(--van-primary-color)" :offset="[-4, 4]">
            <DuoAvatar :avatar="a" :size="72" :aria-label="AVATAR_LOOK[a].label" />
          </van-badge>
        </van-grid-item>
      </van-grid>
      <div class="card-actions">
        <van-button round block type="primary" size="large" :disabled="!profileOk" data-test="next" @click="step = 'pair'">Дальше</van-button>
      </div>
    </van-cell-group>

    <!-- 2. Pairing -->
    <van-cell-group v-else-if="step === 'pair'" inset class="card">
      <van-tabs v-model:active="role" :before-change="() => !link" class="role-tabs">
        <van-tab name="create" title="Создать" />
        <van-tab name="join" title="Подключиться" />
      </van-tabs>

      <template v-if="role === 'create'">
        <template v-if="!link">
          <p class="hint">Создайте пару здесь и покажите QR второму устройству.</p>
          <van-field v-model="adminSecret" type="password" label="Пароль" placeholder="Пароль администратора" autocomplete="off" :border="false" data-test="admin-secret" />
          <div class="card-actions">
            <van-button round block type="primary" size="large" :loading="busy" data-test="create" @click="create">Создать пару</van-button>
          </div>
        </template>
        <div v-else class="qr-box" data-test="qr">
          <QrImage :text="link" :size="260" />
          <p class="hint">Откройте Дуо на втором устройстве (со значка на экране), выберите «Подключиться» и наведите камеру на этот код.</p>
          <van-button round icon-position="left" size="normal" @click="copyLink">
            <template #icon><IconCopy class="btn-inline-icon" /></template>
            Скопировать ссылку
          </van-button>
          <p class="hint hint--small">Ссылка одноразовая: после подключения второго устройства она больше не сработает.</p>
          <div class="card-actions">
            <van-button round block type="primary" size="large" data-test="next" @click="step = 'notify'">Дальше</van-button>
          </div>
        </div>
      </template>

      <template v-else>
        <p class="hint">Отсканируйте QR с первого устройства.</p>
        <div class="card-actions">
          <van-button round block type="primary" size="large" :loading="busy" data-test="scan" @click="scanning = true">
            <template #icon><IconScan class="btn-inline-icon" /></template>
            Сканировать QR
          </van-button>
        </div>
        <van-field v-model="pasted" label="Или ссылка" placeholder="Вставьте ссылку" :border="false" autocomplete="off" data-test="paste">
          <template #button>
            <van-button size="small" round type="primary" :disabled="!pasted.trim()" @click="join(pasted)">Ок</van-button>
          </template>
        </van-field>
      </template>

      <p v-if="problem" class="problem" data-test="problem">{{ problem }}</p>
    </van-cell-group>

    <!-- 3. Notifications (iOS: must be a tap inside the installed app) -->
    <van-cell-group v-else inset class="card">
      <p class="hint">Чтобы подружка могла позвать, когда приложение закрыто.</p>
      <div class="card-actions">
        <van-button round block type="primary" size="large" :loading="busy" :disabled="notify === 'granted'" data-test="notify" @click="enableNotifications">
          <template #icon><IconBell class="btn-inline-icon" /></template>
          Включить уведомления
        </van-button>
      </div>
      <van-cell v-if="notify" title="Уведомления" :value="notifyLabel[notify]" />
      <div class="card-actions">
        <van-button round block size="large" type="success" data-test="done" @click="emit('done')">
          Готово — в чат
        </van-button>
      </div>
    </van-cell-group>

    <QrScanner v-if="role === 'join'" v-model:show="scanning" @found="join" />
  </div>
</template>

<style scoped>
.setup {
  min-height: 100dvh;
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 32px;
}
.setup-head {
  text-align: center;
  padding: 24px 16px 8px;
}
.setup-logo {
  font-size: 48px;
}
.setup-title {
  margin: 8px 0 4px;
  font-size: 28px;
  color: var(--van-text-color);
}
.setup-sub {
  margin: 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}
.steps {
  margin: 12px 16px;
  border-radius: var(--van-radius-lg);
}
.card {
  margin-top: 12px;
  margin-bottom: 12px;
  padding: 8px 0;
}
.card :deep(.card-title) {
  font-weight: 700;
}
.cell-icon {
  width: 28px;
  height: 28px;
  margin-right: 10px;
  color: var(--van-primary-color);
}
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
  color: var(--van-primary-color);
}
.install-arrow {
  font-size: 24px;
  color: var(--van-text-color-3);
}
.install-note {
  margin: 4px 16px 8px;
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-2);
}
.avatar-label {
  padding: 8px 16px 0;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
}
.avatar-grid :deep(.van-grid-item__content) {
  background: transparent;
}
.picked :deep(.duo-avatar) {
  outline: 4px solid var(--van-primary-color);
  outline-offset: 3px;
}
.card-actions {
  padding: 12px 16px;
}
.hint {
  margin: 12px 16px;
  color: var(--van-text-color-2);
  font-size: var(--van-font-size-md);
  line-height: 1.4;
}
.hint--small {
  font-size: var(--van-font-size-sm);
  color: var(--van-text-color-3);
}
.qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16px;
  text-align: center;
}
.qr-box .card-actions {
  align-self: stretch;
}
.problem {
  margin: 8px 16px;
  color: var(--van-danger-color);
  font-size: var(--van-font-size-md);
}
.btn-inline-icon {
  width: 24px;
  height: 24px;
  vertical-align: -5px;
}
.role-tabs {
  margin: 0 8px;
}
.role-tabs :deep(.van-tab) {
  font-size: var(--van-font-size-md);
}
</style>
