// Web Push subscription on this device.
// iOS rule: Notification.requestPermission() must run from a tap, before any other await,
// and only works inside the installed home-screen app (not a Safari tab).

import type { PushSubscriptionJSONLike, VapidKeyResponse } from '@shared/protocol'
import type { NotificationResult } from '../session/types'
import { pushSupported } from './support'

export type PushEnv = {
  apiBase: string
  fetch?: typeof fetch
  /** How long to wait for the service worker to become ready. */
  swTimeoutMs?: number
}

/**
 * Asks for permission (call from a tap) and subscribes. `onSubscription` gets the subscription
 * to send to the server as `pushSubscribe`.
 */
export async function requestNotifications(
  env: PushEnv,
  onSubscription: (sub: PushSubscriptionJSONLike) => void,
): Promise<NotificationResult> {
  if (!pushSupported()) return 'unsupported'
  // First await: the permission prompt, while the tap still counts as a user gesture.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const sub = await subscribe(env)
  if (!sub) return 'unsupported'
  onSubscription(sub)
  return 'granted'
}

/**
 * When permission was already granted: the current subscription (renewed if the server's key
 * changed), without any prompt. Null when there is no permission or no push support.
 */
export async function currentSubscription(env: PushEnv): Promise<PushSubscriptionJSONLike | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null
  try {
    return await subscribe(env)
  } catch (err) {
    console.debug('[push] cannot refresh subscription', err)
    return null
  }
}

async function subscribe(env: PushEnv): Promise<PushSubscriptionJSONLike | null> {
  const reg = await readyRegistration(env.swTimeoutMs ?? 10_000)
  if (!reg) return null
  const key = await vapidKey(env)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  return toJSONLike(sub)
}

/** `serviceWorker.ready` never settles when no worker is registered, so it gets a timeout. */
function readyRegistration(timeoutMs: number): Promise<ServiceWorkerRegistration | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.serviceWorker.ready.then(
      (reg) => {
        clearTimeout(timer)
        resolve(reg)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

async function vapidKey(env: PushEnv): Promise<Uint8Array<ArrayBuffer>> {
  const res = await (env.fetch ?? fetch)(`${env.apiBase}/api/vapid-public-key`)
  if (!res.ok) throw new Error(`vapid key: ${res.status}`)
  const body = (await res.json()) as VapidKeyResponse
  return base64UrlToBytes(body.key)
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return false
  const a = new Uint8Array(current)
  return a.length === wanted.length && a.every((b, i) => b === wanted[i])
}

export function toJSONLike(sub: PushSubscription): PushSubscriptionJSONLike | null {
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) return null
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } }
}
