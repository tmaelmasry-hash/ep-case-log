import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearAll, getAll, getMeta, getOne, putMany, setMeta } from './lib/db';
import { mergeInto } from './lib/merge';
import { loadSyncConfig, loadSyncState, syncNow, type SyncConfig, type SyncState } from './lib/sync';
import type { CaseRec, ImageMeta, ImageRec } from './lib/types';
import { uid } from './lib/util';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind?: 'info' | 'error' | 'success';
  undo?: () => void;
}

interface Ctx {
  loaded: boolean;
  fatal: string | null;
  cases: CaseRec[]; // excludes tombstones
  images: ImageMeta[]; // excludes tombstones
  saveStatus: SaveStatus;
  lastBackup: number | null;
  syncConfig: SyncConfig;
  syncState: SyncState;
  syncing: boolean;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  createCase: (init: Partial<CaseRec>) => Promise<CaseRec>;
  updateCase: (id: string, patch: Partial<CaseRec>) => Promise<void>;
  deleteCase: (id: string) => Promise<void>;
  addImages: (items: { dataUrl: string; thumb: string; caseId: string | null; kind: ImageRec['kind'] }[]) => Promise<void>;
  updateImage: (id: string, patch: Partial<ImageRec>) => Promise<void>;
  deleteImage: (id: string) => Promise<void>;
  getImage: (id: string) => Promise<ImageRec | undefined>;
  importRecords: (cases: CaseRec[], images: ImageRec[]) => Promise<{ cases: number; images: number }>;
  exportAll: () => Promise<{ cases: CaseRec[]; images: ImageRec[] }>;
  markBackedUp: () => Promise<void>;
  eraseAll: () => Promise<void>;
  saveSyncConfig: (c: SyncConfig) => Promise<void>;
  runSync: (manual?: boolean) => Promise<void>;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}

const toMeta = ({ dataUrl, ...m }: ImageRec): ImageMeta => (void dataUrl, m);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [allCases, setAllCases] = useState<CaseRec[]>([]);
  const [allImages, setAllImages] = useState<ImageMeta[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [syncConfig, setSyncConfig] = useState<SyncConfig>({ url: '', token: '', auto: true });
  const [syncState, setSyncState] = useState<SyncState>({ lastSyncAt: null, lastSeq: 0, lastError: null });
  const [syncing, setSyncing] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const pending = useRef(0);
  const syncTimer = useRef<number | undefined>(undefined);
  const syncCfgRef = useRef(syncConfig);
  syncCfgRef.current = syncConfig;
  const syncingRef = useRef(false);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++toastSeq.current;
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismissToast(id), t.undo ? 7000 : 3500);
    },
    [dismissToast],
  );

  const reload = useCallback(async () => {
    const [cs, im] = await Promise.all([getAll<CaseRec>('cases'), getAll<ImageRec>('images')]);
    setAllCases(cs);
    setAllImages(im.map(toMeta));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reload();
        setLastBackup((await getMeta<number>('lastBackup')) ?? null);
        setSyncConfig(await loadSyncConfig());
        setSyncState(await loadSyncState());
        navigator.storage?.persist?.().catch(() => undefined);
        setLoaded(true);
      } catch (e) {
        setFatal((e as Error).message || 'Could not open local storage.');
      }
    })();
  }, [reload]);

  const runSync = useCallback(
    async (manual = false) => {
      const cfg = syncCfgRef.current;
      if (!cfg.url || syncingRef.current) return;
      if (!manual && (!cfg.auto || !navigator.onLine)) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const r = await syncNow(cfg);
        if (r.pulled) await reload();
        if (manual) toast({ message: `Synced · ${r.pushed} sent, ${r.pulled} received`, kind: 'success' });
      } catch (e) {
        if (manual) toast({ message: (e as Error).message, kind: 'error' });
      } finally {
        setSyncState(await loadSyncState());
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [reload, toast],
  );

  const scheduleSync = useCallback(() => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => runSync(false), 1500);
  }, [runSync]);

  // Periodic + reconnect sync.
  useEffect(() => {
    if (!loaded || !syncConfig.url || !syncConfig.auto) return;
    runSync(false);
    const iv = window.setInterval(() => runSync(false), 60_000);
    const onOnline = () => runSync(false);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('online', onOnline);
    };
  }, [loaded, syncConfig.url, syncConfig.auto, runSync]);

  /** Persist with visible status; in-memory state is already updated optimistically. */
  const persist = useCallback(
    async (store: 'cases' | 'images', recs: (CaseRec | ImageRec)[]) => {
      pending.current++;
      setSaveStatus('saving');
      try {
        await putMany(store, recs);
        pending.current--;
        if (!pending.current) setSaveStatus('saved');
        scheduleSync();
      } catch (e) {
        pending.current--;
        setSaveStatus('error');
        toast({ message: `Save failed: ${(e as Error).message || 'storage error'}`, kind: 'error' });
        throw e;
      }
    },
    [scheduleSync, toast],
  );

  const casesRef = useRef(allCases);
  casesRef.current = allCases;
  const imagesRef = useRef(allImages);
  imagesRef.current = allImages;

  const createCase = useCallback(
    async (init: Partial<CaseRec>) => {
      const now = Date.now();
      const rec: CaseRec = {
        id: uid(),
        createdAt: now,
        updatedAt: now,
        date: '',
        mrn: '',
        age: null,
        sex: '',
        role: '',
        fluoroMin: null,
        procedures: [],
        complications: [],
        complicationNote: '',
        cha: null,
        notes: '',
        ...init,
        _dirty: 1,
      };
      setAllCases((c) => [...c, rec]);
      await persist('cases', [rec]);
      return rec;
    },
    [persist],
  );

  const updateCase = useCallback(
    async (id: string, patch: Partial<CaseRec>) => {
      const cur = casesRef.current.find((c) => c.id === id);
      if (!cur) return;
      const next: CaseRec = { ...cur, ...patch, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), _dirty: 1 };
      casesRef.current = casesRef.current.map((c) => (c.id === id ? next : c));
      setAllCases(casesRef.current);
      await persist('cases', [next]);
    },
    [persist],
  );

  const deleteCase = useCallback(
    async (id: string) => {
      const cur = casesRef.current.find((c) => c.id === id);
      if (!cur) return;
      await updateCase(id, { deleted: true });
      // Images attached to a deleted case go back to the inbox's trash with it.
      const imgs = imagesRef.current.filter((i) => i.caseId === id && !i.deleted);
      for (const i of imgs) await updateImageRef.current(i.id, { deleted: true });
      toast({
        message: 'Case deleted',
        undo: async () => {
          await updateCase(id, { deleted: false });
          for (const i of imgs) await updateImageRef.current(i.id, { deleted: false });
        },
      });
    },
    [toast, updateCase],
  );

  const addImages = useCallback(
    async (items: { dataUrl: string; thumb: string; caseId: string | null; kind: ImageRec['kind'] }[]) => {
      const now = Date.now();
      const recs: ImageRec[] = items.map((it, i) => ({ id: uid(), createdAt: now + i, updatedAt: now + i, caption: '', ...it, _dirty: 1 }));
      setAllImages((im) => [...im, ...recs.map(toMeta)]);
      await persist('images', recs);
    },
    [persist],
  );

  const updateImage = useCallback(
    async (id: string, patch: Partial<ImageRec>) => {
      const cur = await getOne<ImageRec>('images', id);
      if (!cur) return;
      const next: ImageRec = { ...cur, ...patch, updatedAt: Math.max(Date.now(), cur.updatedAt + 1), _dirty: 1 };
      imagesRef.current = imagesRef.current.map((i) => (i.id === id ? toMeta(next) : i));
      setAllImages(imagesRef.current);
      await persist('images', [next]);
    },
    [persist],
  );
  const updateImageRef = useRef(updateImage);
  updateImageRef.current = updateImage;

  const deleteImage = useCallback(
    async (id: string) => {
      await updateImage(id, { deleted: true });
      toast({ message: 'Image deleted', undo: () => updateImage(id, { deleted: false }) });
    },
    [toast, updateImage],
  );

  const getImage = useCallback((id: string) => getOne<ImageRec>('images', id), []);

  const importRecords = useCallback(
    async (cases: CaseRec[], images: ImageRec[]) => {
      const [lc, li] = await Promise.all([getAll<CaseRec>('cases'), getAll<ImageRec>('images')]);
      const cm = new Map(lc.map((c) => [c.id, c]));
      const im = new Map(li.map((c) => [c.id, c]));
      const ac = mergeInto(cm, cases).map((r) => ({ ...r, _dirty: 1 as const }));
      const ai = mergeInto(im, images).map((r) => ({ ...r, _dirty: 1 as const }));
      await persist('cases', ac);
      await persist('images', ai);
      await reload();
      return { cases: ac.length, images: ai.length };
    },
    [persist, reload],
  );

  const exportAll = useCallback(async () => {
    const [cases, images] = await Promise.all([getAll<CaseRec>('cases'), getAll<ImageRec>('images')]);
    return { cases, images };
  }, []);

  const markBackedUp = useCallback(async () => {
    const now = Date.now();
    await setMeta('lastBackup', now);
    setLastBackup(now);
  }, []);

  const eraseAll = useCallback(async () => {
    const cfg = syncCfgRef.current;
    await clearAll();
    // Keep sync settings but reset the cursor so a later sync can restore server data.
    await setMeta('syncConfig', cfg);
    setAllCases([]);
    setAllImages([]);
    setLastBackup(null);
    setSyncState({ lastSyncAt: null, lastSeq: 0, lastError: null });
  }, []);

  const saveSyncConfig = useCallback(async (c: SyncConfig) => {
    const prev = syncCfgRef.current;
    await setMeta('syncConfig', c);
    if (prev.url.replace(/\/+$/, '') !== c.url.replace(/\/+$/, '')) {
      // New server: pull from the start and push everything we have.
      const [cs, im] = await Promise.all([getAll<CaseRec>('cases'), getAll<ImageRec>('images')]);
      await putMany('cases', cs.map((r) => ({ ...r, _dirty: 1 as const })));
      await putMany('images', im.map((r) => ({ ...r, _dirty: 1 as const })));
      await setMeta('syncState', { lastSyncAt: null, lastSeq: 0, lastError: null });
      setSyncState({ lastSyncAt: null, lastSeq: 0, lastError: null });
    }
    syncCfgRef.current = c;
    setSyncConfig(c);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      loaded,
      fatal,
      cases: allCases.filter((c) => !c.deleted),
      images: allImages.filter((i) => !i.deleted),
      saveStatus,
      lastBackup,
      syncConfig,
      syncState,
      syncing,
      toasts,
      toast,
      dismissToast,
      createCase,
      updateCase,
      deleteCase,
      addImages,
      updateImage,
      deleteImage,
      getImage,
      importRecords,
      exportAll,
      markBackedUp,
      eraseAll,
      saveSyncConfig,
      runSync,
    }),
    [loaded, fatal, allCases, allImages, saveStatus, lastBackup, syncConfig, syncState, syncing, toasts, toast, dismissToast, createCase, updateCase, deleteCase, addImages, updateImage, deleteImage, getImage, importRecords, exportAll, markBackedUp, eraseAll, saveSyncConfig, runSync],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
