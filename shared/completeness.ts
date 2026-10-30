// Data completeness (R4-8): the core checks of shared/readiness.ts counted per section, so the case sheet, the group
// matrix and "Ready to complete?" show the same numbers. No second rules engine: every count comes from
// evaluateReadiness's checks. Rule-hidden items are already "not_applicable" in readiness and are left out.
// Two groupings share one counter: by case-page row (case sheet) and by the six matrix columns (Admin group matrix).
import type { Dictionary, LayoutRow } from './dictionary.ts';
import type { CoreCheck } from './readiness.ts';

/** Procedure-level entities shown under Complications rather than Procedure. */
export const COMPLICATION_ENTITIES = ['EXT_PROCEDURE_REVIEW', 'COMPLICATIONS'];

export interface SectionCount {
  /** Applicable core checks (all of the below). */
  applicable: number;
  /** A value is recorded (accepted). */
  recorded: number;
  /** "Not available" with a reason. */
  not_available: number;
  missing: number;
  /** Filled by the AI and not accepted yet: not counted as answered. */
  ai_pending: number;
}

export const emptyCount = (): SectionCount => ({ applicable: 0, recorded: 0, not_available: 0, missing: 0, ai_pending: 0 });

/** Adds one check to a count; not_applicable checks are skipped. */
export function countCheck(t: SectionCount, c: Pick<CoreCheck, 'state'>): void {
  if (c.state === 'not_applicable') return;
  t.applicable++;
  if (c.state === 'ok') t.recorded++;
  else if (c.state === 'not_available') t.not_available++;
  else if (c.state === 'ai_pending') t.ai_pending++;
  else t.missing++;
}

// ---- By case-page row (case Completeness sheet, R4-8 case part) ----

export interface CompletenessRow extends SectionCount {
  /** "s:<layout row id>", "p:<procedure id>" or "c:<procedure id>" (complications of that procedure). */
  key: string;
  kind: 'section' | 'procedure' | 'complications';
  label: string;
  /** Layout row id for kind "section". */
  section: string | null;
  procedure_id: string | null;
  /** First check to fix in this row (missing or AI), in readiness order; null when nothing to fix. */
  fix: CoreCheck | null;
}

export interface CaseCompleteness {
  rows: CompletenessRow[];
  totals: SectionCount;
}

/** Which row a check belongs to. */
export function completenessKey(c: CoreCheck): string {
  if (!c.procedure_id) return `s:${c.section}`;
  return COMPLICATION_ENTITIES.includes(c.entity) ? `c:${c.procedure_id}` : `p:${c.procedure_id}`;
}

/** Rows in screen order: each layout row, then each procedure followed by its complications. A row with applicable 0
 *  has no core items (show "No core items here", never 100 %). Procedures not in `procedures` are added at the end. */
export function completenessBySection(groups: { rows: LayoutRow[] }[], checks: CoreCheck[], procedures: { id: string; label: string }[]): CaseCompleteness {
  const rows: CompletenessRow[] = [];
  const byKey = new Map<string, CompletenessRow>();
  const push = (r: Omit<CompletenessRow, keyof SectionCount | 'fix'>) => {
    const row: CompletenessRow = { ...r, ...emptyCount(), fix: null };
    rows.push(row);
    byKey.set(row.key, row);
  };
  for (const g of groups) for (const r of g.rows) if (!byKey.has(`s:${r.id}`)) push({ key: `s:${r.id}`, kind: 'section', label: r.label, section: r.id, procedure_id: null });
  const procs = [...procedures];
  for (const c of checks) if (c.procedure_id && !procs.some((p) => p.id === c.procedure_id)) procs.push({ id: c.procedure_id, label: 'Procedure' });
  for (const p of procs) {
    push({ key: `p:${p.id}`, kind: 'procedure', label: p.label, section: null, procedure_id: p.id });
    push({ key: `c:${p.id}`, kind: 'complications', label: procs.length > 1 ? `Complications · ${p.label}` : 'Complications', section: null, procedure_id: p.id });
  }
  const totals = emptyCount();
  for (const c of checks) {
    const key = completenessKey(c);
    let row = byKey.get(key);
    if (!row) {
      push({ key, kind: 'section', label: c.section, section: c.section, procedure_id: null });
      row = byKey.get(key)!;
    }
    countCheck(row, c);
    countCheck(totals, c);
    if (!row.fix && (c.state === 'missing' || c.state === 'ai_pending')) row.fix = c;
  }
  return { rows, totals };
}

// ---- By matrix column (Admin group matrix, R4-8 group part; used by GET /api/completeness) ----

export const COMPLETENESS_SECTIONS = [
  { id: 'patient', label: 'Patient' },
  { id: 'history', label: 'History' },
  { id: 'studies', label: 'Studies' },
  { id: 'procedure', label: 'Procedure' },
  { id: 'complications', label: 'Complications' },
  { id: 'followup', label: 'Follow-up' },
] as const;
export type CompletenessSection = (typeof COMPLETENESS_SECTIONS)[number]['id'];

export interface Completeness {
  sections: Record<CompletenessSection, SectionCount>;
  /** answered = recorded + not available with a reason (as readiness "done"). */
  core: { answered: number; applicable: number };
}

/** Case-page layout groups (config/case_layout.json) → matrix column; the "patient" row has its own column. */
const LAYOUT_GROUP: Record<string, CompletenessSection> = { history: 'history', investigations: 'studies', follow: 'followup' };

export function completenessSectionOf(dict: Dictionary, check: Pick<CoreCheck, 'entity' | 'section' | 'procedure_id'>): CompletenessSection {
  if (check.procedure_id !== null || check.section === 'procedure') return COMPLICATION_ENTITIES.includes(check.entity) ? 'complications' : 'procedure';
  if (check.section === 'patient') return 'patient';
  const g = dict.layout.groups.find((x) => x.rows.some((r) => r.id === check.section));
  return (g && LAYOUT_GROUP[g.id]) || 'history';
}

export function completenessOf(dict: Dictionary, checks: CoreCheck[]): Completeness {
  const sections = Object.fromEntries(COMPLETENESS_SECTIONS.map((s) => [s.id, emptyCount()])) as Record<CompletenessSection, SectionCount>;
  for (const c of checks) countCheck(sections[completenessSectionOf(dict, c)], c);
  const all = Object.values(sections);
  const sum = (k: keyof SectionCount) => all.reduce((n, s) => n + s[k], 0);
  return { sections, core: { answered: sum('recorded') + sum('not_available'), applicable: sum('applicable') } };
}
