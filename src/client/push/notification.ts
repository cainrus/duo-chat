// Notification text for a Web Push. Pure, so it is tested without a service worker.
// The server sends only { kind } (see PushPayload); the friend's name is added here from
// the device config, so it never travels through the server or the push service.
//
// Every invitation looks the same (owner, 2026-10-31): title «Дуо», body «<имя> зовёт тебя 👋»,
// whatever triggered it (ping, a message, the voice room). The kind stays only in `data`, to
// decide where a click leads. One tag for all, so a new one replaces the old: at most one duo
// notification on screen. Browsers cannot dismiss a shown notification on a timer, so expiry
// is enforced when the next push arrives and when the app is opened (see closeExpired).

import { INVITE_TTL_MS } from '@shared/constants'
import type { PushPayload } from '@shared/protocol'

export const FALLBACK_PEER_NAME = 'Подружка'
export const NOTIFICATION_TITLE = 'Дуо'
/** The one tag every duo notification uses. */
export const NOTIFICATION_TAG = 'duo'

export type NotificationSpec = {
  title: string
  options: NotificationOptions & { data: NotificationData; renotify: boolean; timestamp: number }
}

/**
 * Where a click on the notification leads, what triggered it, and when it stops being useful
 * (null: a call, valid until the app opens; a click after the caller left shows a missed call).
 */
export type NotificationData = { url: string; kind: PushPayload['kind'] | null; expiresAt: number | null }

/** Query parameters of the URL a call notification opens; read once by the app on startup. */
export const CALL_PUSH_PARAM = 'from'
export const CALL_PUSH_VALUE = 'call-push'

export function callPushUrl(at: number): string {
  return `/?${CALL_PUSH_PARAM}=${CALL_PUSH_VALUE}&at=${at}`
}

/** Parses `?from=call-push&at=..`; null for anything else. */
export function parseCallPushUrl(search: string): { at: number } | null {
  const q = new URLSearchParams(search)
  if (q.get(CALL_PUSH_PARAM) !== CALL_PUSH_VALUE) return null
  const at = Number(q.get('at'))
  if (!Number.isFinite(at) || at <= 0) return null
  return { at }
}

export function parsePushPayload(text: string | null): PushPayload | null {
  if (!text) return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const kind = (v as Record<string, unknown>).kind
  // An older server's extra fields (callKind) are ignored.
  return kind === 'ping' || kind === 'message' || kind === 'call' ? { kind } : null
}

/**
 * The one invitation notification. A push without a readable payload still shows it: iOS
 * revokes push for a site whose push events show nothing.
 */
export function notificationFor(
  payload: PushPayload | null,
  peerName: string | null | undefined,
  receivedAt: number,
): NotificationSpec {
  const name = peerName?.trim() || FALLBACK_PEER_NAME
  const kind = payload?.kind ?? null
  const call = kind === 'call'
  return {
    title: NOTIFICATION_TITLE,
    options: {
      body: `${name} зовёт тебя 👋`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ru',
      tag: NOTIFICATION_TAG,
      renotify: true,
      timestamp: receivedAt,
      data: {
        url: call ? callPushUrl(receivedAt) : '/',
        kind,
        expiresAt: call ? null : receivedAt + INVITE_TTL_MS,
      },
    },
  }
}

/** Shown notifications whose time is over (ping and message ones after INVITE_TTL_MS). */
export function expiredNotifications<T extends { data?: unknown }>(shown: readonly T[], now: number): T[] {
  return shown.filter((n) => {
    const at = (n.data as { expiresAt?: unknown } | null | undefined)?.expiresAt
    return typeof at === 'number' && now >= at
  })
}
