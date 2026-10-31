// Notification text for a Web Push. Pure, so it is tested without a service worker.
// The server sends only { kind } (see PushPayload); the friend's name is added here from
// the device config, so it never travels through the server or the push service.

import type { PushPayload } from '@shared/protocol'

export const FALLBACK_PEER_NAME = 'Подружка'

export type NotificationSpec = { title: string; options: NotificationOptions & { data: NotificationData } }

/** Where a click on the notification leads. A call push carries what the app needs to show a missed call. */
export type NotificationData = { url: string }

/** Query parameters of the URL a call notification opens; read once by the app on startup. */
export const CALL_PUSH_PARAM = 'from'
export const CALL_PUSH_VALUE = 'call-push'

export function callPushUrl(kind: 'voice' | 'video', at: number): string {
  return `/?${CALL_PUSH_PARAM}=${CALL_PUSH_VALUE}&kind=${kind}&at=${at}`
}

/** Parses `?from=call-push&kind=..&at=..`; null for anything else. */
export function parseCallPushUrl(search: string): { kind: 'voice' | 'video'; at: number } | null {
  const q = new URLSearchParams(search)
  if (q.get(CALL_PUSH_PARAM) !== CALL_PUSH_VALUE) return null
  const kind = q.get('kind')
  const at = Number(q.get('at'))
  if ((kind !== 'voice' && kind !== 'video') || !Number.isFinite(at) || at <= 0) return null
  return { kind, at }
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
  const o = v as Record<string, unknown>
  if (o.kind === 'ping') return { kind: 'ping' }
  if (o.kind === 'call' && (o.callKind === 'voice' || o.callKind === 'video')) return { kind: 'call', callKind: o.callKind }
  return null
}

/**
 * A push without a readable payload still shows a notification: iOS revokes push for
 * a site whose push events show nothing. It falls back to the ping text.
 */
export function notificationFor(
  payload: PushPayload | null,
  peerName: string | null | undefined,
  receivedAt: number,
): NotificationSpec {
  const name = peerName?.trim() || FALLBACK_PEER_NAME
  const base = { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'ru' }
  if (payload?.kind === 'call') {
    return {
      title: `${name} зовёт`,
      options: {
        ...base,
        body: payload.callKind === 'video' ? '📹' : '📞',
        tag: 'duo-call',
        data: { url: callPushUrl(payload.callKind, receivedAt) },
      },
    }
  }
  return { title: `${name} зовёт в чат`, options: { ...base, body: '💬', tag: 'duo-ping', data: { url: '/' } } }
}
