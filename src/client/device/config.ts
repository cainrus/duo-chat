// This device's pairing record, kept in IndexedDB only.
// Uses nothing but the `indexedDB` global.
// A separate database from the messages ('duo-chat'), so the two never fight over versions.

import type { Side } from '@shared/types'

export type DeviceConfig = {
  /** The pair secret, base64url. Never leaves the device except in the pairing link. */
  secret: string
  side: Side
  /** Proves this device to the server (the server keeps only its hash). */
  deviceToken: string
  /** The bell in the chat: this device asked for no pushes. Re-sent to the server on connect. */
  pushMuted?: boolean
}

export interface DeviceConfigStore {
  load(): Promise<DeviceConfig | null>
  save(config: DeviceConfig): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'duo-chat-device'
const STORE = 'config'
const KEY = 'device'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function deviceConfigStore(dbName = DB_NAME): DeviceConfigStore {
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch((err: unknown) => {
      dbPromise = null
      throw err
    })
    return dbPromise
  }

  return {
    async load() {
      const db = await open()
      const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
      // Records saved before names and pictures were dropped carry `me`/`peer`: ignored.
      return isDeviceConfig(value)
        ? {
            secret: value.secret,
            side: value.side,
            deviceToken: value.deviceToken,
            ...(value.pushMuted !== undefined ? { pushMuted: value.pushMuted } : {}),
          }
        : null
    },
    async save(config) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(structuredClone(config), KEY)
      await done(tx)
    },
    async clear() {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      await done(tx)
    },
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function isDeviceConfig(v: unknown): v is DeviceConfig {
  return (
    isObject(v) &&
    typeof v.secret === 'string' &&
    (v.side === 'a' || v.side === 'b') &&
    typeof v.deviceToken === 'string' &&
    (v.pushMuted === undefined || typeof v.pushMuted === 'boolean')
  )
}
