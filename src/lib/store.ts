import type { Message } from '../types'

// A small store on this device for the letters you opened: they open at once the next
// time, and can be read with no connection. Only the most recent conversations are
// kept, and signing out empties it. Nothing here leaves the device.

const NAME = 'doar-letters'
const STORE = 'threads'
const KEEP = 300
/** Tidying is done in strides, so that most saves cost one write. */
const SLACK = 30

export type Kept = { id: string; historyId: string; messages: Message[]; at: number }

let opening: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex('at', 'at')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The letter store could not be opened'))
    request.onblocked = () => reject(new Error('The letter store is held by another tab'))
  })
  // A failed opening is tried again the next time, not remembered.
  opening.catch(() => (opening = null))
  return opening
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The letter store refused'))
  })

/** Keep a conversation's letters. Past the limit, the ones opened longest ago make room. */
export async function keepMessages(id: string, historyId: string, messages: Message[], limit = KEEP): Promise<void> {
  const db = await database()
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
  await done(store.put({ id, historyId, messages, at: Date.now() } satisfies Kept))
  const count = await done(store.count())
  if (count <= limit + SLACK) return
  let extra = count - limit
  await new Promise<void>((resolve, reject) => {
    const walk = store.index('at').openKeyCursor()
    walk.onerror = () => reject(walk.error ?? new Error('The letter store refused'))
    walk.onsuccess = () => {
      const cursor = walk.result
      if (!cursor || extra <= 0) return resolve()
      store.delete(cursor.primaryKey)
      extra--
      cursor.continue()
    }
  })
}

/** The letters kept for a conversation, if any. */
export async function keptMessages(id: string): Promise<Kept | null> {
  const db = await database()
  return (await done<Kept | undefined>(db.transaction(STORE).objectStore(STORE).get(id))) ?? null
}

/** How many conversations are kept (for the system status). */
export async function keptCount(): Promise<number> {
  const db = await database()
  return done(db.transaction(STORE).objectStore(STORE).count())
}

/** Empty the store (signing out, or erasing everything). */
export async function forgetLetters(): Promise<void> {
  try {
    const db = await database()
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear())
  } catch {
    // Nothing was kept, or the browser has no store at all.
  }
}
