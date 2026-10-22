// "Ready to complete?" — ported from EP Workspace server/domain/core.ts and adapted to case = episode with several
// procedures (owner, phase 3): case-level core items are checked once; procedure-level items (EP_PROCEDURES and
// procedure sections) and the category items of each procedure's components are checked for each procedure.
// Completed needs every applicable core field to have a value or "Not available" + reason. Date of birth "not
// available" is a warning only. Pure: the server enforces it and the browser shows it from the same code.
import { hasValue, type CoreItem, type Dictionary } from './dictionary.ts';

export type CheckState = 'ok' | 'missing' | 'not_available' | 'not_applicable';

/** Reasons offered for "Not available" (EP Workspace); any other short reason may be typed. */
export const NA_REASONS = ['Not documented in the record', 'Test not done', 'Record not accessible', 'Patient declined'];

export interface NotAvailable {
  reason: string;
  at: string;
  by: string;
}

type Row = Record<string, unknown> & { _id: string };

export interface CoreCheck {
  /** naKey: "ENTITY.field" for the case, "ENTITY.field@<procedure id>" for one procedure. */
  key: string;
  entity: string;
  field: string;
  label: string;
  /** null = the case; otherwise the EP_PROCEDURES row it belongs to. */
  procedure_id: string | null;
  /** Layout row id of the case page ("patient", "risk"…) or "procedure". */
  section: string;
  /** "common" or a core_dataset category id. */
  group: string;
  state: CheckState;
  /** "Not available" may be recorded for this item (not for items with complete_if). */
  na_allowed: boolean;
  reason?: string;
}

export interface Issue {
  text: string;
  entity: string;
  field: string;
  procedure_id: string | null;
  section: string;
}

export interface Tally {
  done: number;
  total: number;
}

export interface Readiness {
  checks: CoreCheck[];
  done: number;
  total: number;
  blockers: Issue[];
  warnings: Issue[];
  byProcedure: Record<string, Tally>;
  bySection: Record<string, Tally>;
  canComplete: boolean;
}

export function naKey(entity: string, field: string, procedureId: string | null): string {
  return procedureId ? `${entity}.${field}@${procedureId}` : `${entity}.${field}`;
}

/** EP_PROCEDURES and procedure sections are checked for each procedure. */
export function isProcedureLevel(dict: Dictionary, entity: string): boolean {
  return entity === 'EP_PROCEDURES' || dict.entities[entity]?.scope === 'procedure';
}

/** Categories of one procedure, from its component types (config/case_layout.json core_categories). */
export function categoriesOf(dict: Dictionary, componentTypes: string[]): string[] {
  return Object.entries(dict.layout.core_categories ?? {})
    .filter(([id, types]) => !id.startsWith('_') && Array.isArray(types) && types.some((t) => componentTypes.includes(t)))
    .map(([id]) => id);
}

export function sectionOf(dict: Dictionary, entity: string): string {
  if (isProcedureLevel(dict, entity)) return 'procedure';
  for (const g of dict.layout.groups) for (const r of g.rows) if (r.entities.includes(entity)) return r.id;
  return 'patient';
}

export function evaluateReadiness(dict: Dictionary, rows: Record<string, Row[]>, notAvailable: Record<string, { reason: string }>): Readiness {
  const procs = rows.EP_PROCEDURES ?? [];
  const rowsIn = (entity: string, pid: string | null): Row[] => {
    const all = rows[entity] ?? [];
    if (!isProcedureLevel(dict, entity)) return all;
    if (entity === 'EP_PROCEDURES') return all.filter((r) => r._id === pid);
    return all.filter((r) => r.procedure_id === pid);
  };
  const labelOf = (entity: string, field: string) => dict.entities[entity].fields.find((f) => f.name === field)?.label ?? field;

  const checks: CoreCheck[] = [];
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];

  const evaluate = (item: CoreItem, group: string, pid: string | null) => {
    const label = labelOf(item.entity, item.field);
    const key = naKey(item.entity, item.field, pid);
    const section = sectionOf(dict, item.entity);
    const base = { key, entity: item.entity, field: item.field, label, procedure_id: pid, section, group, na_allowed: !item.complete_if };
    // Rows that can hold the value; a "when" on the same entity narrows them (e.g. LVEF % on echoes with LVEF measured).
    let candidates = rowsIn(item.entity, pid);
    let applicable = true;
    if (typeof item.when === 'string') {
      if (item.when === 'lookup_has_codes_for_primary_ep_diagnosis') {
        const dx = rowsIn('ARRHYTHMIA_INDICATIONS', null)[0]?.primary_ep_diagnosis;
        const f = dict.entities.ARRHYTHMIA_INDICATIONS.fields.find((x) => x.name === 'diagnosis_subtype');
        applicable = !!dx && Object.values(f?.parent_map ?? {}).includes(String(dx));
      }
    } else if (item.when) {
      for (const [path, codes] of Object.entries(item.when)) {
        const [e, f] = path.split('.');
        const meets = (r: Row) => r[f] !== null && r[f] !== undefined && codes.includes(String(r[f]));
        if (e === item.entity) {
          candidates = candidates.filter(meets);
          if (!candidates.length) applicable = false;
        } else if (!rowsIn(e, isProcedureLevel(dict, e) ? pid : null).some(meets)) applicable = false;
      }
    }
    if (!applicable) {
      checks.push({ ...base, state: 'not_applicable' });
      return;
    }
    const value = candidates.map((r) => r[item.field]).find(hasValue);
    let state: CheckState;
    if (item.complete_if) state = hasValue(value) && item.complete_if.includes(String(value)) ? 'ok' : 'missing';
    else if (hasValue(value)) state = 'ok';
    else if (notAvailable[key]) state = 'not_available';
    else state = 'missing';
    const check: CoreCheck = { ...base, state };
    const issue = { entity: item.entity, field: item.field, procedure_id: pid, section };
    if (state === 'not_available') {
      check.reason = notAvailable[key].reason;
      if (item.not_available_is_warning) warnings.push({ ...issue, text: `${label} not available (${check.reason}) — age is never used to infer it` });
    }
    if (state === 'missing') blockers.push({ ...issue, text: item.complete_if && hasValue(value) ? `${label}: not reviewed yet` : `${label} is empty` });
    // complications_reviewed = PRESENT needs at least one complete complication of this procedure (core_dataset "then").
    if (state === 'ok' && item.then?.[String(value)]) {
      const ok = rowsIn('COMPLICATIONS', pid).some((r) => hasValue(r.category) && hasValue(r.relatedness) && hasValue(r.outcome));
      if (!ok) {
        check.state = 'missing';
        blockers.push({ ...issue, entity: 'COMPLICATIONS', field: 'category', text: 'Complications present: add at least one complication with category, relatedness and outcome' });
      }
    }
    checks.push(check);
  };

  const spec = dict.coreSpec;
  const catItems = (id: string) => {
    const x = spec.categories[id];
    return Array.isArray(x) ? x : [];
  };
  const procCats = new Map(
    procs.map((p) => [
      p._id,
      categoriesOf(
        dict,
        rowsIn('PROCEDURE_COMPONENTS', p._id).map((c) => String(c.component_type)),
      ),
    ]),
  );

  // The case: common items of case-level entities, then case-level items of any procedure's categories (once).
  const seen = new Set<string>();
  for (const item of spec.common) {
    if (isProcedureLevel(dict, item.entity)) continue;
    seen.add(`${item.entity}.${item.field}`);
    evaluate(item, 'common', null);
  }
  for (const id of new Set([...procCats.values()].flat())) {
    for (const item of catItems(id)) {
      const k = `${item.entity}.${item.field}`;
      if (isProcedureLevel(dict, item.entity) || seen.has(k)) continue;
      seen.add(k);
      evaluate(item, id, null);
    }
  }
  // Each procedure: its common items, then the items of its own categories.
  for (const p of procs) {
    const mine = new Set<string>();
    for (const item of spec.common) {
      if (!isProcedureLevel(dict, item.entity)) continue;
      mine.add(`${item.entity}.${item.field}`);
      evaluate(item, 'common', p._id);
    }
    for (const id of procCats.get(p._id) ?? []) {
      for (const item of catItems(id)) {
        const k = `${item.entity}.${item.field}`;
        if (!isProcedureLevel(dict, item.entity) || mine.has(k)) continue;
        mine.add(k);
        evaluate(item, id, p._id);
      }
    }
  }

  const counted = checks.filter((c) => c.state !== 'not_applicable');
  const isDone = (c: CoreCheck) => c.state === 'ok' || c.state === 'not_available';
  const byProcedure: Record<string, Tally> = {};
  const bySection: Record<string, Tally> = {};
  for (const c of counted) {
    const t = c.procedure_id ? (byProcedure[c.procedure_id] ??= { done: 0, total: 0 }) : (bySection[c.section] ??= { done: 0, total: 0 });
    t.total++;
    if (isDone(c)) t.done++;
  }
  return { checks, done: counted.filter(isDone).length, total: counted.length, blockers, warnings, byProcedure, bySection, canComplete: blockers.length === 0 };
}
