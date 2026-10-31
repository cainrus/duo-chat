// Notification text for a Web Push. Pure, so it is tested without a service worker.
// The server sends only { kind } (see PushPayload). There are no names at all (owner,
// 2026-10-31: only two people), so the text is fixed.
//
// Every invitation looks the same (owner, 2026-10-31): the single word «онлайн» as the
// title, no body, no app name, whatever triggered it (button, a message, the voice room); a
// click just opens the chat. One tag for all, so a new one replaces the old: at most one
// notification on screen. Browsers cannot dismiss a shown notification on a timer, so expiry
// is enforced when the next push arrives and when the app is opened (see closeExpired).

import { INVITE_TTL_MS } from '@shared/constants'
import type { PushPayload } from '@shared/protocol'

export const NOTIFICATION_TITLE = 'онлайн'
/** The one tag every duo notification uses. */
export const NOTIFICATION_TAG = 'duo'

export type NotificationSpec = {
  title: string
  options: NotificationOptions & { data: NotificationData; renotify: boolean; timestamp: number }
}

/**
 * When the notification stops being useful (null: a voice room one, which may wait long).
 * A click always just opens the chat.
 */
export type NotificationData = { url: '/'; expiresAt: number | null }

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
export function notificationFor(payload: PushPayload | null, receivedAt: number): NotificationSpec {
  const call = payload?.kind === 'call'
  return {
    title: NOTIFICATION_TITLE,
    options: {
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ru',
      tag: NOTIFICATION_TAG,
      renotify: true,
      timestamp: receivedAt,
      data: { url: '/', expiresAt: call ? null : receivedAt + INVITE_TTL_MS },
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
