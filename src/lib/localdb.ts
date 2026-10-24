// Device copy (owner R3-4, local-first L2): one IndexedDB database per signed-in user on this device, holding the
// case list, the cases opened here and the outbox of edits not yet in the Google Sheet. Kept after sign out (owner's
// choice). If IndexedDB is not available (private window, blocked storage) everything still works from memory only.
const VERSION = 1;
let current: { user: string; db: Promise<IDBDatabase | null> } | null = null;

function open(user: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(`kamc-registry-${user}`, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('cases')) db.createObjectStore('cases');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Opens (once) the database of this user; earlier users' databases stay untouched. */
export function openLocalFor(user: string) {
  if (current?.user !== user) current = { user, db: open(user) };
}

export async function hasLocal(): Promise<boolean> {
  return !!(await current?.db);
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await current?.db;
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const kvGet = <T>(key: string) => run<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const kvSet = (key: string, value: unknown) => run('kv', 'readwrite', (s) => void s.put(value, key));
export const caseGet = <T>(id: string) => run<T>('cases', 'readonly', (s) => s.get(id) as IDBRequest<T>);
export const casePut = (id: string, value: unknown) => run('cases', 'readwrite', (s) => void s.put(value, id));
export const caseDelete = (id: string) => run('cases', 'readwrite', (s) => void s.delete(id));
export const caseAll = <T>() => run<T[]>('cases', 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const caseCount = () => run<number>('cases', 'readonly', (s) => s.count());
export const outboxAll = <T>() => run<T[]>('outbox', 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const outboxPut = (item: unknown) => run('outbox', 'readwrite', (s) => void s.put(item));
export const outboxDelete = (seqs: number[]) =>
  run('outbox', 'readwrite', (s) => {
    for (const k of seqs) s.delete(k);
  });
