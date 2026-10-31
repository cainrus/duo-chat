// Service worker source. Built with vite-plugin-pwa (strategy 'injectManifest'), which
// replaces `self.__WB_MANIFEST` below with the list of built files. It exports nothing.
//
// What it does:
// - push: shows "<friend> зовёт" (call) or "<friend> зовёт в чат" (ping). The friend's name
//   comes from the device config in IndexedDB, never from the push itself.
// - notificationclick: focuses an open window of the app, or opens one. A call notification
//   opens `/?from=call-push&kind=..&at=..` (or posts the same URL to an open window as
//   { t: 'notification-click', url }), so the app can show "missed call" when the call is over.
// - precaches the app shell, so the installed app opens without network (it still needs
//   the network to talk to the friend). Never touches /api.

/// <reference lib="webworker" />

import { deviceConfigStore } from '../device/config'
import { notificationFor, parsePushPayload } from './notification'

type PrecacheEntry = { url: string; revision: string | null } | string

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] }

const PRECACHE = 'duo-shell-v1'
const SHELL = '/index.html'

/** Same-origin absolute URLs of the built files, with the revision as a cache-busting query. */
function precacheUrls(): { key: string; fetchUrl: string }[] {
  const out: { key: string; fetchUrl: string }[] = []
  for (const entry of self.__WB_MANIFEST ?? []) {
    const url = typeof entry === 'string' ? entry : entry.url
    const revision = typeof entry === 'string' ? null : entry.revision
    const key = new URL(url, self.location.origin).href
    const fetchUrl = revision ? `${key}${key.includes('?') ? '&' : '?'}__rev=${encodeURIComponent(revision)}` : key
    out.push({ key, fetchUrl })
  }
  return out
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      const old = new Set((await cache.keys()).map((r) => r.url))
      const wanted = precacheUrls()
      for (const { key, fetchUrl } of wanted) {
        const res = await fetch(fetchUrl, { cache: 'no-store' })
        if (!res.ok) throw new Error(`precache failed: ${key}`)
        await cache.put(key, res)
        old.delete(key)
      }
      for (const url of old) await cache.delete(url)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== PRECACHE) await caches.delete(name)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    // Network first, so a new deploy shows up at once; the cached shell when offline.
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(new URL(SHELL, url.origin).href)) ?? Response.error()),
    )
    return
  }
  event.respondWith(
    (async () => (await caches.match(url.origin + url.pathname, { ignoreSearch: true })) ?? fetch(req))(),
  )
})

async function peerName(): Promise<string | null> {
  try {
    return (await deviceConfigStore().load())?.peer?.name ?? null
  } catch {
    return null
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let text: string | null = null
      try {
        text = event.data?.text() ?? null
      } catch {
        text = null
      }
      const spec = notificationFor(parsePushPayload(text), await peerName(), Date.now())
      await self.registration.showNotification(spec.title, spec.options)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: unknown } | null
  const url = typeof data?.url === 'string' && data.url.startsWith('/') ? data.url : '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (mine) {
        mine.postMessage({ t: 'notification-click', url })
        await mine.focus()
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
