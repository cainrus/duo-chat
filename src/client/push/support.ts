// Can notifications work on this device, right here? Pure functions over injected globals, so
// every branch is testable without a browser.
//
// Platform facts the answer rests on:
// - iPad/iPhone Safari TAB: no Web Push at all. Push only exists inside the app added to the
//   Home Screen (iPadOS/iOS 16.4+), so installing fixes it.
// - Android Chrome TAB: push works without installing; permission is per site.
// - 'denied' can only be undone in the browser/system settings; the page cannot ask again.

/**
 * - 'unsupported-install': no push here, and installing the app (Apple Home Screen) brings it;
 * - 'unsupported': no push here, and installing may not help (an old or odd browser);
 * - otherwise the permission: 'default' (never asked), 'granted' or 'denied'.
 */
export type NotificationSupport = 'unsupported-install' | 'unsupported' | 'default' | 'granted' | 'denied'

/** The globals the answer depends on (the real ones by default). */
export type PlatformEnv = {
  Notification?: { readonly permission: string }
  PushManager?: unknown
  navigator?: { readonly userAgent: string; readonly maxTouchPoints: number; readonly standalone?: boolean; readonly serviceWorker?: unknown }
  matchMedia?: (query: string) => { matches: boolean }
}

export function browserEnv(): PlatformEnv {
  const g = globalThis as typeof globalThis & PlatformEnv
  return {
    Notification: typeof g.Notification === 'undefined' ? undefined : g.Notification,
    PushManager: typeof g.PushManager === 'undefined' ? undefined : g.PushManager,
    navigator: typeof g.navigator === 'undefined' ? undefined : g.navigator,
    matchMedia: typeof g.matchMedia === 'function' ? (q) => g.matchMedia!(q) : undefined,
  }
}

/** Opened from the Home Screen icon (installed app), not a browser tab. */
export function isStandalone(env: PlatformEnv = browserEnv()): boolean {
  return env.navigator?.standalone === true || env.matchMedia?.('(display-mode: standalone)').matches === true
}

/** iPad, iPhone or iPod (an iPad in desktop mode reports Macintosh with touch points). */
export function isAppleTouch(env: PlatformEnv = browserEnv()): boolean {
  const nav = env.navigator
  if (!nav) return false
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
}

/** Web Push exists here: notifications, a service worker and PushManager. */
export function pushSupported(env: PlatformEnv = browserEnv()): boolean {
  return !!env.Notification && !!env.navigator && 'serviceWorker' in env.navigator && env.PushManager !== undefined
}

export function notificationSupport(env: PlatformEnv = browserEnv()): NotificationSupport {
  if (!pushSupported(env)) return isAppleTouch(env) && !isStandalone(env) ? 'unsupported-install' : 'unsupported'
  const p = env.Notification!.permission
  return p === 'granted' || p === 'denied' ? p : 'default'
}
