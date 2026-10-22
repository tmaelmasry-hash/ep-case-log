// What one request changed in a case, cell by cell (ported idea: EP Workspace server/store/record.ts).
// Stores write only these cells, so two people saving different fields of one case at the same moment both
// keep their values, and the last save of the same field wins (EP Workspace P3-4). Pure.
import type { AdditionalInfo, AiMark, CaseMeta, CaseRecord, HistoryEntry, StoredRow } from '../../shared/caseTypes.ts';
import type { NotAvailable } from '../../shared/readiness.ts';

export interface RowChange<T> {
  id: string;
  /** Changed keys (all keys when created). */
  set: Partial<T>;
  created: boolean;
}

export interface CasePatch {
  case_id: string;
  meta: Partial<CaseMeta>;
  rows: Record<string, RowChange<StoredRow>[]>;
  additional: RowChange<AdditionalInfo>[];
  not_available: Record<string, NotAvailable | null>;
  copied: Record<string, string | null>;
  ai: Record<string, AiMark | null>;
  history: RowChange<HistoryEntry>[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function changed<T extends object>(before: T | undefined, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) if (!before || !same(before[k], after[k])) out[k] = after[k];
  return out;
}

function diffList<T extends object>(before: T[], after: T[], idOf: (x: T, i: number) => string): RowChange<T>[] {
  const old = new Map(before.map((x, i) => [idOf(x, i), x]));
  const out: RowChange<T>[] = [];
  after.forEach((x, i) => {
    const id = idOf(x, i);
    const prev = old.get(id);
    const set = changed(prev, x);
    if (!prev) out.push({ id, set: { ...x }, created: true });
    else if (Object.keys(set).length) out.push({ id, set, created: false });
  });
  return out;
}

export const historyId = (h: HistoryEntry, i: number) => h.id ?? `idx_${i}`;

/** Changes from `base` (the case as this request read it; null = new case) to `next`. */
export function diffCase(base: CaseRecord | null, next: CaseRecord): CasePatch {
  const rows: CasePatch['rows'] = {};
  for (const [entity, list] of Object.entries(next.rows)) {
    const ch = diffList(base?.rows[entity] ?? [], list, (r) => r._id);
    if (ch.length) rows[entity] = ch;
  }
  const mapDiff = <T>(b: Record<string, T>, n: Record<string, T>) => {
    const out: Record<string, T | null> = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(n)])) if (!same(b[k], n[k])) out[k] = n[k] ?? null;
    return out;
  };
  const na = mapDiff(base?.not_available ?? {}, next.not_available ?? {});
  const copied = mapDiff(base?.copied ?? {}, next.copied ?? {});
  const ai = mapDiff(base?.ai ?? {}, next.ai ?? {});
  return {
    case_id: next.meta.case_id,
    meta: changed(base?.meta, next.meta),
    rows,
    additional: diffList(base?.additional ?? [], next.additional, (a) => a.info_id),
    not_available: na,
    copied,
    ai,
    history: diffList(base?.history ?? [], next.history ?? [], historyId),
  };
}

export function isEmptyPatch(p: CasePatch): boolean {
  return !Object.keys(p.meta).length && !Object.keys(p.rows).length && !p.additional.length && !Object.keys(p.not_available).length && !Object.keys(p.copied).length && !Object.keys(p.ai).length && !p.history.length;
}

/** Applies a patch to the stored copy of a case (null = not stored yet). */
export function applyPatch(stored: CaseRecord | null, p: CasePatch): CaseRecord {
  const rec: CaseRecord = stored ?? { meta: p.meta as CaseMeta, rows: {}, additional: [], not_available: {}, history: [] };
  if (stored) Object.assign(rec.meta, p.meta);
  for (const [entity, list] of Object.entries(p.rows)) {
    const target = (rec.rows[entity] ??= []);
    for (const c of list) {
      const row = target.find((r) => r._id === c.id);
      if (row) Object.assign(row, c.set);
      else target.push({ ...(c.set as StoredRow), _id: c.id });
    }
  }
  for (const c of p.additional) {
    const a = rec.additional.find((x) => x.info_id === c.id);
    if (a) Object.assign(a, c.set);
    else rec.additional.push(c.set as AdditionalInfo);
  }
  const na = (rec.not_available ??= {});
  for (const [k, v] of Object.entries(p.not_available)) {
    if (v) na[k] = v;
    else delete na[k];
  }
  const copied = (rec.copied ??= {});
  for (const [k, v] of Object.entries(p.copied)) {
    if (v) copied[k] = v;
    else delete copied[k];
  }
  const ai = (rec.ai ??= {});
  for (const [k, v] of Object.entries(p.ai)) {
    if (v) ai[k] = v;
    else delete ai[k];
  }
  const hist = (rec.history ??= []);
  for (const c of p.history) {
    const i = hist.findIndex((h, n) => historyId(h, n) === c.id);
    if (i >= 0) Object.assign(hist[i], c.set);
    else hist.push(c.set as HistoryEntry);
  }
  return rec;
}
