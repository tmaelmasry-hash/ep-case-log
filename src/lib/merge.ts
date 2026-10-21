import type { SyncFields } from './types';

/**
 * Last-write-wins: the incoming record replaces the local one only if it is newer.
 * Tombstones (deleted: true) are ordinary records, so deletes propagate too.
 */
export function shouldAccept(local: SyncFields | undefined, incoming: SyncFields): boolean {
  if (!local) return true;
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  // Deterministic tie-break so every replica converges on the same record.
  return JSON.stringify(stripLocal(incoming)) > JSON.stringify(stripLocal(local));
}

export function stripLocal<T extends SyncFields>(r: T): T {
  if (!('_dirty' in r)) return r;
  const { _dirty, ...rest } = r;
  void _dirty;
  return rest as T;
}

/** Merge incoming records into a map keyed by id; returns the records that were accepted. */
export function mergeInto<T extends SyncFields>(map: Map<string, T>, incoming: T[]): T[] {
  const accepted: T[] = [];
  for (const rec of incoming) {
    if (!rec || typeof rec.id !== 'string' || typeof rec.updatedAt !== 'number') continue;
    const clean = stripLocal(rec);
    if (shouldAccept(map.get(rec.id), clean)) {
      map.set(rec.id, clean);
      accepted.push(clean);
    }
  }
  return accepted;
}
