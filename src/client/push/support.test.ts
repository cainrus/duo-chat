import { describe, expect, it } from 'vitest'
import { isAppleTouch, isStandalone, notificationSupport, pushSupported, type PlatformEnv } from './support'

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

function env(o: { ua?: string; touch?: number; standalone?: boolean; displayStandalone?: boolean; push?: boolean; permission?: string } = {}): PlatformEnv {
  const push = o.push ?? true
  const nav: Record<string, unknown> = { userAgent: o.ua ?? ANDROID_UA, maxTouchPoints: o.touch ?? 5 }
  if (o.standalone !== undefined) nav.standalone = o.standalone
  if (push) nav.serviceWorker = {}
  return {
    Notification: push ? { permission: o.permission ?? 'default' } : undefined,
    PushManager: push ? function PushManager() {} : undefined,
    navigator: nav as PlatformEnv['navigator'],
    matchMedia: () => ({ matches: o.displayStandalone ?? false }),
  }
}

describe('notificationSupport', () => {
  it('an iPad Safari tab (no push): installing fixes it', () => {
    expect(notificationSupport(env({ ua: IPAD_UA, push: false, standalone: false }))).toBe('unsupported-install')
    // iPadOS "desktop site" mode reports a Mac with touch points.
    expect(notificationSupport(env({ ua: IPAD_DESKTOP_UA, touch: 5, push: false }))).toBe('unsupported-install')
  })

  it('no push otherwise (old browser, or an installed iOS app older than 16.4): plain unsupported', () => {
    expect(notificationSupport(env({ push: false }))).toBe('unsupported')
    expect(notificationSupport(env({ ua: IPAD_UA, push: false, standalone: true }))).toBe('unsupported')
    // A real Mac (no touch) is not an Apple touch device.
    expect(notificationSupport(env({ ua: IPAD_DESKTOP_UA, touch: 0, push: false }))).toBe('unsupported')
  })

  it('partial APIs count as no push (Notification without PushManager or service worker)', () => {
    const e = env({ ua: IPAD_UA, standalone: false })
    expect(notificationSupport({ ...e, PushManager: undefined })).toBe('unsupported-install')
    const noSw = env()
    delete (noSw.navigator as Record<string, unknown>).serviceWorker
    expect(notificationSupport(noSw)).toBe('unsupported')
  })

  it('with push, the permission decides: default, granted, denied', () => {
    expect(notificationSupport(env({ permission: 'default' }))).toBe('default')
    expect(notificationSupport(env({ permission: 'granted' }))).toBe('granted')
    expect(notificationSupport(env({ permission: 'denied' }))).toBe('denied')
    // The installed iPad app has push like anyone else.
    expect(notificationSupport(env({ ua: IPAD_UA, standalone: true, permission: 'granted' }))).toBe('granted')
  })

  it('nothing at all (no navigator, e.g. a worker or SSR): unsupported', () => {
    expect(notificationSupport({})).toBe('unsupported')
  })
})

describe('platform helpers', () => {
  it('standalone: navigator.standalone (iOS) or display-mode (others)', () => {
    expect(isStandalone(env({ standalone: true }))).toBe(true)
    expect(isStandalone(env({ displayStandalone: true }))).toBe(true)
    expect(isStandalone(env())).toBe(false)
  })

  it('apple touch: iPad/iPhone UA, or a Mac UA with touch points', () => {
    expect(isAppleTouch(env({ ua: IPAD_UA }))).toBe(true)
    expect(isAppleTouch(env({ ua: IPAD_DESKTOP_UA, touch: 5 }))).toBe(true)
    expect(isAppleTouch(env({ ua: IPAD_DESKTOP_UA, touch: 0 }))).toBe(false)
    expect(isAppleTouch(env({ ua: ANDROID_UA }))).toBe(false)
  })

  it('pushSupported needs all three APIs', () => {
    expect(pushSupported(env())).toBe(true)
    expect(pushSupported(env({ push: false }))).toBe(false)
  })
})
