import { getAll, getMeta, getOne, putMany, setMeta } from './db';
import { shouldAccept, stripLocal } from './merge';
import type { CaseRec, ImageRec } from './types';

export interface SyncConfig {
  url: string; // base URL of the sync server, e.g. http://192.168.1.10:8787
  token: string;
  auto: boolean;
}

export interface SyncState {
  lastSyncAt: number | null;
  lastSeq: number;
  lastError: string | null;
}

export const DEFAULT_SYNC: SyncConfig = { url: '', token: '', auto: true };

export async function loadSyncConfig(): Promise<SyncConfig> {
  return { ...DEFAULT_SYNC, ...((await getMeta<SyncConfig>('syncConfig')) ?? {}) };
}

export async function loadSyncState(): Promise<SyncState> {
  return { lastSyncAt: null, lastSeq: 0, lastError: null, ...((await getMeta<SyncState>('syncState')) ?? {}) };
}

type Store = 'cases' | 'images';
type AnyRec = CaseRec | ImageRec;

const MAX_BATCH_BYTES = 4_000_000;

function endpoint(cfg: SyncConfig, path: string): string {
  return cfg.url.replace(/\/+$/, '') + path;
}

async function call<T>(cfg: SyncConfig, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(endpoint(cfg, path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
    });
  } catch {
    throw new Error('Cannot reach sync server (offline or wrong URL)');
  }
  if (res.status === 401) throw new Error('Sync server rejected the access token');
  if (!res.ok) throw new Error(`Sync server error ${res.status}`);
  return res.json() as Promise<T>;
}

export async function pingServer(cfg: SyncConfig): Promise<{ ok: boolean; records: number }> {
  return call(cfg, '/api/status');
}

function batches(items: { store: Store; rec: AnyRec }[]): { store: Store; rec: AnyRec }[][] {
  const out: { store: Store; rec: AnyRec }[][] = [];
  let cur: { store: Store; rec: AnyRec }[] = [];
  let size = 0;
  for (const it of items) {
    const s = JSON.stringify(it.rec).length;
    if (cur.length && size + s > MAX_BATCH_BYTES) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

/** Push local changes, then pull everything newer than the last seen server sequence. */
export async function syncNow(cfg: SyncConfig): Promise<SyncResult> {
  if (!cfg.url) throw new Error('No sync server configured');
  const state = await loadSyncState();
  let pushed = 0;
  let pulled = 0;
  try {
    const [cases, images] = await Promise.all([getAll<CaseRec>('cases'), getAll<ImageRec>('images')]);
    const dirty = [
      ...cases.filter((r) => r._dirty).map((rec) => ({ store: 'cases' as Store, rec })),
      ...images.filter((r) => r._dirty).map((rec) => ({ store: 'images' as Store, rec })),
    ];
    for (const batch of batches(dirty)) {
      await call(cfg, '/api/push', {
        method: 'POST',
        body: JSON.stringify({ records: batch.map((b) => ({ store: b.store, rec: stripLocal(b.rec) })) }),
      });
      // Clear the dirty flag only where the record was not edited again while pushing.
      for (const store of ['cases', 'images'] as Store[]) {
        const clean: AnyRec[] = [];
        for (const b of batch.filter((x) => x.store === store)) {
          const now = await getOne<AnyRec>(store, b.rec.id);
          if (now && now.updatedAt === b.rec.updatedAt) clean.push(stripLocal(now));
        }
        await putMany(store, clean);
      }
      pushed += batch.length;
    }

    let since = state.lastSeq;
    for (let guard = 0; guard < 10_000; guard++) {
      const page = await call<{ records: { store: Store; rec: AnyRec }[]; last: number; more: boolean }>(
        cfg,
        `/api/pull?since=${since}&limit=100`,
      );
      for (const store of ['cases', 'images'] as Store[]) {
        const accept: AnyRec[] = [];
        for (const { rec } of page.records.filter((r) => r.store === store)) {
          const local = await getOne<AnyRec>(store, rec.id);
          // A locally dirty record that is newer stays dirty and wins on the next push.
          if (shouldAccept(local, rec)) accept.push(stripLocal(rec));
        }
        await putMany(store, accept);
        pulled += accept.length;
      }
      since = page.last;
      if (!page.more) break;
    }
    await setMeta('syncState', { lastSyncAt: Date.now(), lastSeq: since, lastError: null } satisfies SyncState);
    return { pushed, pulled };
  } catch (e) {
    await setMeta('syncState', { ...state, lastError: (e as Error).message } satisfies SyncState);
    throw e;
  }
}
