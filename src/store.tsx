import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CaseSummary } from '../shared/caseTypes.ts';
import { api, ApiError } from './lib/api';
import { kvGet, kvSet } from './lib/localdb';
import { sync } from './lib/sync';

export interface Toast {
  id: number;
  message: string;
  kind?: 'info' | 'error' | 'success';
  undo?: () => void;
}

export interface GroupRow {
  group_id: string;
  name: string;
  cases?: number;
  next_seq?: number;
}

interface Ctx {
  loaded: boolean;
  loadError: string | null;
  groups: GroupRow[];
  cases: CaseSummary[];
  /** Reloads the case list and the groups (their case counts). */
  refreshCases: () => Promise<boolean>;
  /** Replaces one case's line in the list (after a save). */
  upsertCase: (c: CaseSummary) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}

/** The old single-device version kept cases in this browser; the owner approved removing them (phase 2). */
function removeOldLocalDatabase() {
  try {
    indexedDB.deleteDatabase('ep-caselog');
  } catch {
    /* not available */
  }
}

export function StoreProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++toastSeq.current;
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismissToast(id), t.undo ? 7000 : 4000);
    },
    [dismissToast],
  );

  const hasList = useRef(false);
  const refreshCases = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([api<{ cases: CaseSummary[] }>('GET', '/api/cases'), api<{ groups: GroupRow[] }>('GET', '/api/groups')]);
      // Cases made offline and not sent yet stay in the list (L3).
      setCases((prev) => {
        const next = [...r.cases, ...prev.filter((c) => sync.isLocalOnly(c.case_id) && !r.cases.some((x) => x.case_id === c.case_id))];
        void kvSet('list', { cases: next, groups: g.groups, at: Date.now() });
        return next;
      });
      setGroups(g.groups);
      setLoadError(null);
      hasList.current = true;
      return true;
    } catch (e) {
      // Offline with this device's copy: no error, the copy is shown (L3).
      const err = e as ApiError;
      offlineFail.current = err.status === 0;
      if (!(err.status === 0 && hasList.current)) setLoadError(err.message);
      return false;
    }
  }, []);
  const offlineFail = useRef(false);

  // Local-first (R3-4, L2): this user's device copy of the list shows at once; the server's replaces it.
  useEffect(() => {
    removeOldLocalDatabase();
    let shown = false;
    (async () => {
      await sync.start(userId);
      const local = await kvGet<{ cases: CaseSummary[]; groups: GroupRow[] }>('list');
      if (local && !shown) {
        hasList.current = true;
        setCases(local.cases);
        setGroups(local.groups);
        if (offlineFail.current) setLoadError(null);
        setLoaded(true);
      }
    })();
    (async () => {
      // Only the server's answer replaces the device copy; a failed refresh leaves it shown.
      if (await refreshCases()) shown = true;
      setLoaded(true);
    })();
  }, [refreshCases, userId]);

  const upsertCase = useCallback((c: CaseSummary) => {
    setCases((list) => {
      const next = list.some((x) => x.case_id === c.case_id) ? list.map((x) => (x.case_id === c.case_id ? c : x)) : [...list, c];
      void kvGet<{ groups: GroupRow[] }>('list').then((l) => kvSet('list', { cases: next, groups: l?.groups ?? [], at: Date.now() }));
      return next;
    });
  }, []);

  // A save answered while its case is not open still updates the list line; a discarded offline case leaves it.
  useEffect(
    () =>
      sync.onCase('*', (e) => {
        if (e.kind === 'saved') upsertCase(e.detail.summary);
        if (e.kind === 'discarded')
          setCases((list) => {
            const next = list.filter((c) => c.case_id !== e.case_id);
            void kvGet<{ groups: GroupRow[] }>('list').then((l) => kvSet('list', { cases: next, groups: l?.groups ?? [], at: Date.now() }));
            return next;
          });
      }),
    [upsertCase],
  );

  const value = useMemo<Ctx>(
    () => ({ loaded, loadError, groups, cases, refreshCases, upsertCase, toasts, toast, dismissToast }),
    [loaded, loadError, groups, cases, refreshCases, upsertCase, toasts, toast, dismissToast],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
