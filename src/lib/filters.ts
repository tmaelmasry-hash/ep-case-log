// Sidebar filters (owner R2-4 / R2-6): procedure menu items, cohort items and a period, combined. Several items of one
// side = any of them; the two sides and the period = all of them. Shared by the desktop sidebar, the phone drawer and
// the Procedures list; kept in this browser across visits (owner).
import { useMemo, useSyncExternalStore } from 'react';
import categories from '../../config/categories.json';
import { CategoryMatcher, type CategoryConfig } from '../../shared/categories.ts';
import type { CaseSummary } from '../../shared/caseTypes.ts';
import { cohortKey, cohortOf, overrideOf } from './cohorts';

export const matcher = new CategoryMatcher(categories as unknown as CategoryConfig);

export interface Filters {
  /** Procedures-section item ids (or UNCLASSIFIED); empty = all procedures. */
  proc: string[];
  /** Cohort item ids, or year children such as "HAJJ@1447"; empty = everyone. */
  group: string[];
  from: string | null;
  to: string | null;
  /** Registry group of the group switcher ("ALL" or a group id); kept across visits. */
  grp: string;
  /** Collection status shown in the cases list only (owner, 28 Oct); the Dashboard has its own basis. */
  status: 'ALL' | 'IN_PROGRESS' | 'COMPLETED';
  /** List order: newest first (default), oldest first, or most missing first. */
  sort: 'NEW' | 'OLD' | 'MISSING';
}

const KEY = 'ep.filters';
const EMPTY: Filters = { proc: [], group: [], from: null, to: null, grp: 'ALL', status: 'ALL', sort: 'NEW' };

function load(): Filters {
  try {
    const saved = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), grp: localStorage.getItem('ep.group') ?? 'ALL' };
    return { ...saved, proc: Array.isArray(saved.proc) ? saved.proc : [], group: Array.isArray(saved.group) ? saved.group : [] };
  } catch {
    return EMPTY;
  }
}

let state = load();
const subs = new Set<() => void>();

export function setFilters(patch: Partial<Filters>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    if (patch.grp) localStorage.setItem('ep.group', patch.grp);
  } catch {
    /* storage blocked */
  }
  subs.forEach((f) => f());
}

/** Adds or removes one item of a side. */
export function toggleFilter(side: 'proc' | 'group', id: string) {
  const cur = state[side];
  setFilters({ [side]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
}

export const clearFilters = () => setFilters({ proc: [], group: [], from: null, to: null, status: 'ALL' });

export function useFilters(): Filters {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** Tags of every case (memoised per list), with its custom cohorts as "C:<id>". */
export function useTagged(cases: CaseSummary[]) {
  return useMemo(() => new Map(cases.map((c) => [c.case_id, new Set([...matcher.tagsOf(c), ...(c.cohorts ?? []).map(cohortKey)])])), [cases]);
}

export const inPeriod = (c: CaseSummary, f: Filters) => (!f.from || (c.episode_start_date ?? '') >= f.from) && (!f.to || (c.episode_start_date ?? '9999') <= f.to);

/** Cases passing the filters; leave one side out (`except`) to count the items of that side. */
export function applyFilters(cases: CaseSummary[], tagged: Map<string, Set<string>>, f: Filters, except?: 'proc' | 'group') {
  return cases.filter((c) => {
    const t = tagged.get(c.case_id)!;
    return (
      (f.grp === 'ALL' || c.group_id === f.grp) &&
      inPeriod(c, f) &&
      (except === 'proc' || !f.proc.length || f.proc.some((x) => t.has(x))) &&
      (except === 'group' || !f.group.length || f.group.some((x) => t.has(x)))
    );
  });
}

/** Color token of a registry group (owner, 28 Oct: a color per group), by its place in the group list. */
const GROUP_COLORS = ['cat-dev', 'cat-af', 'cat-svt', 'cat-laa', 'cat-flutter', 'cat-ap', 'cat-avn', 'cat-pilgrim'];
export function groupColor(groups: { group_id: string }[], id: string): string {
  const i = groups.findIndex((g) => g.group_id === id);
  return GROUP_COLORS[(i < 0 ? 0 : i) % GROUP_COLORS.length];
}

/** Display name of a selection, including year children ("Hajj 1447"). */
export function itemLabel(id: string): string {
  const [base, year] = id.split('@');
  if (base === 'UNCLASSIFIED') return 'Unclassified';
  const custom = cohortOf(id);
  if (custom) return custom.name;
  const it = matcher.item(base);
  return it ? `${overrideOf(base)?.label ?? it.label}${year ? ` ${year}` : ''}` : id;
}

/** Color token of an item: its own, else its nearest parent's. */
export function itemColor(id: string): string {
  const custom = cohortOf(id);
  if (custom) return custom.color;
  let it = matcher.item(id.split('@')[0]);
  while (it && !it.color && !overrideOf(it.id)?.color && it.parent) it = matcher.item(it.parent);
  return (it && overrideOf(it.id)?.color) ?? it?.color ?? 'accent';
}

/** Category color of one procedure component (for the procedure chips). */
const COMPONENT_ITEM: Record<string, string> = {
  AF: 'AF',
  FLUTTER: 'FLUTTER',
  AVNRT: 'SVT',
  AT_SVT: 'SVT',
  AVRT_WPW: 'AP',
  AVJ_ABLATION: 'AVN',
  PVC: 'VENT',
  VT_VF: 'VENT',
  DIAGNOSTIC_EPS: 'EPS',
  DEVICE_IMPLANT: 'DEV',
  CRT_CSP: 'DEV',
  LEAD_MANAGEMENT: 'DEV',
  ILR: 'DEV',
  LAA_CLOSURE: 'LAA',
};
export const componentColor = (c: string) => (COMPONENT_ITEM[c] ? itemColor(COMPONENT_ITEM[c]) : 'cat-other');
