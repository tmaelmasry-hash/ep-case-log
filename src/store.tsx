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
  refreshCases: () => Promise<void>;
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

  const refreshCases = useCallback(async () => {
    try {
      const [r, g] = await Promise.all([api<{ cases: CaseSummary[] }>('GET', '/api/cases'), api<{ groups: GroupRow[] }>('GET', '/api/groups')]);
      setCases(r.cases);
      setGroups(g.groups);
      setLoadError(null);
      void kvSet('list', { cases: r.cases, groups: g.groups, at: Date.now() });
    } catch (e) {
      setLoadError((e as ApiError).message);
    }
  }, []);

  // Local-first (R3-4, L2): this user's device copy of the list shows at once; the server's replaces it.
  useEffect(() => {
    removeOldLocalDatabase();
    let shown = false;
    (async () => {
      await sync.start(userId);
      const local = await kvGet<{ cases: CaseSummary[]; groups: GroupRow[] }>('list');
      if (local && !shown) {
        setCases(local.cases);
        setGroups(local.groups);
        setLoaded(true);
      }
    })();
    (async () => {
      await refreshCases();
      shown = true;
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

  // A save answered while its case is not open still updates the list line.
  useEffect(() => sync.onCase('*', (e) => e.kind === 'saved' && upsertCase(e.detail.summary)), [upsertCase]);

  const value = useMemo<Ctx>(
    () => ({ loaded, loadError, groups, cases, refreshCases, upsertCase, toasts, toast, dismissToast }),
    [loaded, loadError, groups, cases, refreshCases, upsertCase, toasts, toast, dismissToast],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
