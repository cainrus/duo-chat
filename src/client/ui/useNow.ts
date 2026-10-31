import { onScopeDispose, ref, type Ref } from 'vue'

/** A reactive clock for countdowns; ticks once per `everyMs`. */
export function useNow(everyMs = 1000): Ref<number> {
  const now = ref(Date.now())
  const id = setInterval(() => (now.value = Date.now()), everyMs)
  onScopeDispose(() => clearInterval(id))
  return now
}
