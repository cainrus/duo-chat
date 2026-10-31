<script setup lang="ts">
import { computed } from 'vue'
import type { AvatarId } from '../../session/types'
import { AVATAR_LOOK } from '../avatars'

const props = withDefaults(defineProps<{ avatar: AvatarId | null | undefined; size?: number }>(), { size: 56 })

const look = computed(() => (props.avatar ? AVATAR_LOOK[props.avatar] : { glyph: '🙂', bg: '#EFE7DC', label: '' }))
// Sizes go through :style (CSSOM), which `style-src 'self'` allows.
const box = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.62)}px`,
  background: look.value.bg,
}))
</script>

<template>
  <span class="duo-avatar" :style="box" role="img" :aria-label="look.label">{{ look.glyph }}</span>
</template>

<style scoped>
.duo-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  line-height: 1;
  flex: none;
  user-select: none;
}
</style>
