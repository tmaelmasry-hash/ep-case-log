import type { CaseRec, ImageRec } from './types';

const DB_NAME = 'ep-caselog';
const DB_VERSION = 1;
export type StoreName = 'cases' | 'images' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('cases')) db.createObjectStore('cases', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Could not open database'));
    open.onblocked = () => reject(new Error('Database is blocked by another open tab. Close other tabs and reload.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx(db: IDBDatabase, stores: StoreName[], mode: IDBTransactionMode) {
  const t = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted (storage may be full)'));
  });
  return { t, done };
}

export async function getAll<T>(store: 'cases' | 'images'): Promise<T[]> {
  const db = await openDB();
  return req(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function getOne<T>(store: 'cases' | 'images', id: string): Promise<T | undefined> {
  const db = await openDB();
  return req(db.transaction(store).objectStore(store).get(id)) as Promise<T | undefined>;
}

export async function putMany(store: 'cases' | 'images', recs: (CaseRec | ImageRec)[]): Promise<void> {
  if (!recs.length) return;
  const db = await openDB();
  const { t, done } = tx(db, [store], 'readwrite');
  const os = t.objectStore(store);
  for (const r of recs) os.put(r);
  await done;
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  const { t, done } = tx(db, ['cases', 'images', 'meta'], 'readwrite');
  t.objectStore('cases').clear();
  t.objectStore('images').clear();
  t.objectStore('meta').clear();
  await done;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return req(db.transaction('meta').objectStore('meta').get(key)) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  const { t, done } = tx(db, ['meta'], 'readwrite');
  t.objectStore('meta').put(value, key);
  await done;
}
