// Follow-up bell (phase 12; ported from EP Workspace F-16, switched off as in its F-19): which procedures have a
// follow-up visit or a device check due, overdue or coming up. Rules in config/site.json `followup_due`
// (dictionary fields and codes only, checked at start-up):
// - visit: a dictionary timepoint (D30, M6, M12) falls due N days after the procedure date and that procedure has no
//   follow-up visit with that timepoint yet (follow-ups belong to a procedure here, phase 7);
// - device check: the case's latest device check's "next check due date";
// - nothing for a case whose follow-up says the patient died, was lost to follow-up or withdrew, nor for a procedure
//   cancelled before it started; deleted cases are left out.
// Listed when due within `ahead_days` or overdue by at most `overdue_days`. The day offsets are the registry's
// reminder rule, not a clinical field.
import type { Dictionary } from '../../shared/dictionary.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';
import { liveRows } from './cases.ts';

export interface FollowupRule {
  enabled: boolean;
  procedure_date_field: string;
  procedure_status_field: string;
  skip_procedure_status?: string[];
  timepoint_field: string;
  timepoints: { code: string; days: number }[];
  stop_when?: Record<string, string[]>;
  device_check?: { entity: string; date_field: string; due_field: string };
  ahead_days: number;
  overdue_days: number;
}

export interface DueItem {
  case_id: string;
  procedure_id: string | null;
  mrn: string;
  group_id: string;
  group_seq: number;
  kind: 'visit' | 'device_check';
  what: string;
  due_date: string;
  /** Days from today: negative = overdue. */
  days: number;
}

const DAY = 86_400_000;
const dayOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const split = (path: string) => path.split('.') as [string, string];

/** Start-up check: every field and code named by the rule exists in the dictionary. */
export function checkFollowupConfig(dict: Dictionary, r: FollowupRule | undefined) {
  if (!r) return;
  const field = (entity: string, name: string) => {
    const f = dict.entities[entity]?.fields.find((x) => x.name === name);
    if (!f) throw new Error(`config/site.json followup_due: ${entity}.${name} is not a dictionary field`);
    return f;
  };
  const codes = (entity: string, name: string, list: string[]) => {
    const f = field(entity, name);
    for (const c of list) if (!f.codes?.some((x) => x.code === c)) throw new Error(`config/site.json followup_due: ${c} is not a code of ${entity}.${name}`);
  };
  const [pe, pf] = split(r.procedure_date_field);
  field(pe, pf);
  const [se, sf] = split(r.procedure_status_field);
  codes(se, sf, r.skip_procedure_status ?? []);
  codes('FOLLOW_UPS', r.timepoint_field, r.timepoints.map((t) => t.code));
  for (const [f, list] of Object.entries(r.stop_when ?? {})) codes('FOLLOW_UPS', f, list);
  if (r.device_check) {
    field(r.device_check.entity, r.device_check.date_field);
    field(r.device_check.entity, r.device_check.due_field);
  }
}

export function followUpsDue(r: FollowupRule | undefined, cases: CaseRecord[], today: string): DueItem[] {
  if (!r?.enabled) return [];
  const [, dateField] = split(r.procedure_date_field);
  const [, statusField] = split(r.procedure_status_field);
  const inWindow = (days: number) => days <= r.ahead_days && days >= -r.overdue_days;
  const items: DueItem[] = [];
  for (const rec of cases) {
    if (rec.meta.is_deleted) continue;
    const visits = liveRows(rec, 'FOLLOW_UPS');
    if (visits.some((v) => Object.entries(r.stop_when ?? {}).some(([f, list]) => list.includes(String(v[f]))))) continue;
    const item = (kind: DueItem['kind'], what: string, due: string, procedureId: string | null): DueItem => ({
      case_id: rec.meta.case_id,
      procedure_id: procedureId,
      mrn: rec.meta.mrn,
      group_id: rec.meta.group_id,
      group_seq: rec.meta.group_seq,
      kind,
      what,
      due_date: due,
      days: between(today, due),
    });
    for (const p of liveRows(rec, 'EP_PROCEDURES')) {
      if ((r.skip_procedure_status ?? []).includes(String(p[statusField]))) continue;
      const proc = dayOf(p[dateField]);
      if (!proc) continue;
      const done = new Set(visits.filter((v) => v.procedure_id === p._id).map((v) => String(v[r.timepoint_field])));
      for (const t of r.timepoints) {
        if (done.has(t.code)) continue;
        const due = addDays(proc, t.days);
        if (inWindow(between(today, due))) items.push(item('visit', `${t.code} visit`, due, p._id));
      }
    }
    if (r.device_check) {
      const dc = r.device_check;
      const latest = liveRows(rec, dc.entity).sort((a, b) => String(b[dc.date_field] ?? '').localeCompare(String(a[dc.date_field] ?? '')))[0];
      const due = latest ? dayOf(latest[dc.due_field]) : null;
      if (due && inWindow(between(today, due))) items.push(item('device_check', 'Device check', due, null));
    }
  }
  return items.sort((a, b) => a.days - b.days || a.group_seq - b.group_seq);
}
