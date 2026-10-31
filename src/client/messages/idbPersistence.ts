import type { MessagePersistence, StoredMessage } from './store'

const STORE = 'messages'
const KEY = 'all'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function idbPersistence(dbName = 'duo-chat'): MessagePersistence {
  let dbPromise: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbPromise
  }

  return {
    async load() {
      const db = await open()
      const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
      return Array.isArray(value) ? (value as StoredMessage[]) : []
    },
    async save(all) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(all, KEY)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
  }
}
