// Custom cohorts in the browser (owner R2-12): the list from /api/cohorts, shared by the menu, the builder and the
// case page. Membership itself comes with each case summary (summary.cohorts).
import { useEffect, useSyncExternalStore } from 'react';
import type { CohortDef } from '../../shared/cohorts.ts';
import { api } from './api';

export interface BuiltinOverride {
  label?: string;
  color?: string;
  hidden?: boolean;
}

let list: CohortDef[] = [];
let overrides: Record<string, BuiltinOverride> = {};
let snap = { list, overrides };
let loaded = false;
const subs = new Set<() => void>();

export async function refreshCohorts() {
  try {
    const r = await api<{ cohorts: CohortDef[]; overrides?: Record<string, BuiltinOverride> }>('GET', '/api/cohorts');
    list = r.cohorts;
    overrides = r.overrides ?? {};
  } catch {
    list = [];
    overrides = {};
  }
  snap = { list, overrides };
  loaded = true;
  subs.forEach((f) => f());
}

function useSnap() {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snap,
  );
  useEffect(() => {
    if (!loaded) void refreshCohorts();
  }, []);
  return v;
}

export const useCohorts = (): CohortDef[] => useSnap().list;
/** Admin edits of the built-in cohorts (name, color, hidden), by menu item id. */
export const useCohortOverrides = (): Record<string, BuiltinOverride> => useSnap().overrides;
export const overrideOf = (id: string): BuiltinOverride | undefined => overrides[id];

/** Menu id of a custom cohort (cohort side of the filters). */
export const cohortKey = (id: string) => `C:${id}`;
export const cohortOf = (key: string) => (key.startsWith('C:') ? list.find((c) => c.id === key.slice(2)) : undefined);
