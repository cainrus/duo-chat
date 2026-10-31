// Strict parsing of client WebSocket frames. Anything unexpected is rejected, so the room
// only ever sees well-formed input and relays nothing it did not check the shape of.

import type { ClientToServer, PushSubscriptionJSONLike } from '@shared/protocol'
import type { SealedEnvelope } from '@shared/types'

/** Upper bound for one frame; sealed SDP offers are a few KB. */
export const MAX_FRAME_BYTES = 64 * 1024

/** Hosts of the browser push services the two target devices use (Chrome/Android, Safari/iPadOS, Firefox, Edge). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^(.+\.)?push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^(.+\.)?notify\.windows\.com$/,
]

const B64URL = /^[A-Za-z0-9_-]+$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function hasOnly(o: Obj, keys: string[]): boolean {
  return Object.keys(o).every((k) => keys.includes(k))
}

function envelope(v: unknown): SealedEnvelope | null {
  if (!isObj(v) || !hasOnly(v, ['v', 'iv', 'ct'])) return null
  if (v.v !== 1 || !isStr(v.iv, 64) || !isStr(v.ct, MAX_FRAME_BYTES)) return null
  if (!B64URL.test(v.iv) || !B64URL.test(v.ct)) return null
  return { v: 1, iv: v.iv, ct: v.ct }
}

/** Accepts only https endpoints of known push services, so the server cannot be aimed at arbitrary URLs. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.port === '' && PUSH_HOSTS.some((re) => re.test(url.hostname))
}

function subscription(v: unknown): PushSubscriptionJSONLike | null {
  if (!isObj(v) || !isStr(v.endpoint, 2048) || !isAllowedPushEndpoint(v.endpoint)) return null
  const keys = v.keys
  if (!isObj(keys) || !isStr(keys.p256dh, 128) || !isStr(keys.auth, 64)) return null
  if (!B64URL.test(keys.p256dh) || !B64URL.test(keys.auth)) return null
  const exp = v.expirationTime
  if (exp !== undefined && exp !== null && typeof exp !== 'number') return null
  return { endpoint: v.endpoint, expirationTime: exp ?? null, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

/** Returns the frame, or null if it is not exactly one of the ClientToServer shapes. */
export function parseClientFrame(raw: string | ArrayBuffer): ClientToServer | null {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(v) || typeof v.t !== 'string') return null
  switch (v.t) {
    case 'hello':
      return hasOnly(v, ['t', 'deviceToken']) && isStr(v.deviceToken, 128) ? { t: 'hello', deviceToken: v.deviceToken } : null
    case 'visibility':
      return hasOnly(v, ['t', 'visible']) && typeof v.visible === 'boolean' ? { t: 'visibility', visible: v.visible } : null
    case 'signal': {
      const env = hasOnly(v, ['t', 'env']) ? envelope(v.env) : null
      return env ? { t: 'signal', env } : null
    }
    case 'call':
      return hasOnly(v, ['t', 'kind']) && (v.kind === 'voice' || v.kind === 'video') ? { t: 'call', kind: v.kind } : null
    case 'callCancel':
    case 'callAccept':
    case 'callDecline':
    case 'callEnd':
    case 'ping':
    case 'replied':
      return hasOnly(v, ['t']) ? { t: v.t } : null
    case 'pushSubscribe': {
      const sub = hasOnly(v, ['t', 'sub']) ? subscription(v.sub) : null
      return sub ? { t: 'pushSubscribe', sub } : null
    }
    default:
      return null
  }
}
