import { CATEGORIES, procCategory, procLabel, type Category } from './catalog';
import type { CaseRec } from './types';
import { monthKey, todayISO } from './util';

export type RangeKey = '30d' | '90d' | '12mo' | 'all' | 'custom';

export interface DateRange {
  from: string | null; // inclusive YYYY-MM-DD
  to: string | null; // inclusive YYYY-MM-DD
}

export function rangeFor(key: RangeKey, custom: DateRange, now = new Date()): DateRange {
  const to = todayISO(now);
  const back = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days + 1);
    return todayISO(d);
  };
  switch (key) {
    case '30d':
      return { from: back(30), to };
    case '90d':
      return { from: back(90), to };
    case '12mo': {
      const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      return { from: todayISO(d), to };
    }
    case 'custom':
      return custom;
    default:
      return { from: null, to: null };
  }
}

export function inRange(date: string, r: DateRange): boolean {
  if (r.from && date < r.from) return false;
  if (r.to && date > r.to) return false;
  return true;
}

/** All month keys from a to b inclusive. */
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let [y, m] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  let guard = 0;
  while ((y < by || (y === by && m <= bm)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface TypeCount {
  label: string;
  count: number;
  pct: number; // share of all procedures in range
}

export interface CategoryCount {
  category: Category;
  count: number;
  types: TypeCount[];
}

export interface Stats {
  caseCount: number;
  procedureCount: number;
  patientCount: number;
  complicationCases: number;
  complicationRate: number; // 0..1
  byMonth: { month: string; count: number }[];
  byCategory: CategoryCount[];
  complications: { label: string; count: number }[];
}

export function computeStats(all: CaseRec[], r: DateRange): Stats {
  const cases = all.filter((c) => !c.deleted && inRange(c.date, r));
  const procs = cases.flatMap((c) => c.procedures);
  const procedureCount = procs.length;

  const monthCounts = new Map<string, number>();
  for (const c of cases) monthCounts.set(monthKey(c.date), (monthCounts.get(monthKey(c.date)) ?? 0) + 1);
  let byMonth: Stats['byMonth'] = [];
  if (cases.length) {
    const keys = [...monthCounts.keys()].sort();
    const first = r.from ? monthKey(r.from) : keys[0];
    const last = r.to ? monthKey(r.to) : keys[keys.length - 1];
    byMonth = monthsBetween(first < keys[0] ? first : keys[0], last > keys[keys.length - 1] ? last : keys[keys.length - 1]).map((m) => ({
      month: m,
      count: monthCounts.get(m) ?? 0,
    }));
  }

  const byCategory: CategoryCount[] = [];
  for (const cat of CATEGORIES) {
    const inCat = procs.filter((p) => procCategory(p) === cat);
    if (!inCat.length) continue;
    const typeMap = new Map<string, number>();
    for (const p of inCat) typeMap.set(procLabel(p), (typeMap.get(procLabel(p)) ?? 0) + 1);
    const types = [...typeMap.entries()]
      .map(([label, count]) => ({ label, count, pct: count / procedureCount }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    byCategory.push({ category: cat, count: inCat.length, types });
  }

  const compMap = new Map<string, number>();
  for (const c of cases) for (const k of c.complications) compMap.set(k, (compMap.get(k) ?? 0) + 1);
  const complicationCases = cases.filter((c) => c.complications.length > 0).length;

  return {
    caseCount: cases.length,
    procedureCount,
    patientCount: new Set(cases.map((c) => c.mrn)).size,
    complicationCases,
    complicationRate: cases.length ? complicationCases / cases.length : 0,
    byMonth,
    byCategory,
    complications: [...compMap.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}
