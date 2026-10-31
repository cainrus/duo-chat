import { inject } from 'vue'
import type { DuoSession } from '../session/types'

export const DUO_KEY = 'duo'

export function useDuo(): DuoSession {
  const s = inject<DuoSession>(DUO_KEY)
  if (!s) throw new Error('DuoSession is not provided')
  return s
}
