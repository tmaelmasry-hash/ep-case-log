// Completeness by case-page section (R4-8): the core checks of shared/readiness.ts counted per section, so the case
// sheet and the group matrix show the same numbers as "Ready to complete?". Only groups and counts; no rules here.
// Rule-hidden items are already "not_applicable" in readiness and are left out.
import type { LayoutRow } from './dictionary.ts';
import type { CoreCheck } from './readiness.ts';

/** Procedure-level entities shown in the "Complications" part of the procedure sheet. */
export const COMPLICATION_ENTITIES = ['EXT_PROCEDURE_REVIEW', 'COMPLICATIONS'];

export interface CompletenessCounts {
  /** A value is recorded (accepted). */
  recorded: number;
  /** "Not available" with a reason. */
  not_available: number;
  missing: number;
  /** Filled by the AI and not accepted yet: not counted as answered. */
  ai: number;
  /** Applicable core checks (all of the above). */
  total: number;
}

export interface CompletenessRow extends CompletenessCounts {
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

export interface Completeness {
  rows: CompletenessRow[];
  totals: CompletenessCounts;
}

const empty = (): CompletenessCounts => ({ recorded: 0, not_available: 0, missing: 0, ai: 0, total: 0 });

function add(t: CompletenessCounts, c: CoreCheck): void {
  if (c.state === 'not_applicable') return;
  t.total++;
  if (c.state === 'ok') t.recorded++;
  else if (c.state === 'not_available') t.not_available++;
  else if (c.state === 'ai_pending') t.ai++;
  else t.missing++;
}

/** Which row a check belongs to. */
export function completenessKey(c: CoreCheck): string {
  if (!c.procedure_id) return `s:${c.section}`;
  return COMPLICATION_ENTITIES.includes(c.entity) ? `c:${c.procedure_id}` : `p:${c.procedure_id}`;
}

/** Rows in screen order: each layout row, then each procedure followed by its complications. A row with total 0
 *  has no core items (show "No core items here", never 100 %). Procedures not in `procedures` are added at the end. */
export function completenessBySection(groups: { rows: LayoutRow[] }[], checks: CoreCheck[], procedures: { id: string; label: string }[]): Completeness {
  const rows: CompletenessRow[] = [];
  const byKey = new Map<string, CompletenessRow>();
  const push = (r: Omit<CompletenessRow, keyof CompletenessCounts | 'fix'>) => {
    const row: CompletenessRow = { ...r, ...empty(), fix: null };
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
  const totals = empty();
  for (const c of checks) {
    const key = completenessKey(c);
    let row = byKey.get(key);
    if (!row) {
      push({ key, kind: 'section', label: c.section, section: c.section, procedure_id: null });
      row = byKey.get(key)!;
    }
    add(row, c);
    add(totals, c);
    if (!row.fix && (c.state === 'missing' || c.state === 'ai_pending')) row.fix = c;
  }
  return { rows, totals };
}
