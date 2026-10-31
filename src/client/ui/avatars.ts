// Bundled generic avatars: a system emoji on a soft colour. No photos, nothing uploaded.
import type { AvatarId } from '../session/types'

export const AVATAR_LOOK: Record<AvatarId, { glyph: string; bg: string; label: string }> = {
  cat: { glyph: '🐱', bg: '#FFE3C2', label: 'Котик' },
  fox: { glyph: '🦊', bg: '#FFD9CC', label: 'Лисичка' },
  bunny: { glyph: '🐰', bg: '#F6E1FF', label: 'Зайчик' },
  bear: { glyph: '🐻', bg: '#EADBC8', label: 'Мишка' },
  panda: { glyph: '🐼', bg: '#E4EEE8', label: 'Панда' },
  owl: { glyph: '🦉', bg: '#E8E2D5', label: 'Сова' },
  unicorn: { glyph: '🦄', bg: '#FFE0F0', label: 'Единорог' },
  frog: { glyph: '🐸', bg: '#DDF5D8', label: 'Лягушка' },
}
