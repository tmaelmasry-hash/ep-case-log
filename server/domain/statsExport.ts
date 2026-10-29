// Statistics file (owner, step 7): one flat table ready for analysis, beside the Sheet copy of phase 10.
// One row per procedure (or per case); columns named in words, values as labels (owner: words, not codes), dates as
// real dates; a "Columns" sheet says what each column is and lists the codes; an "About" sheet the choices.
// No names or identifiers beyond the MRN (PATIENT_IDENTIFIERS is left out; age is given instead of date of birth).
import type { CaseRecord, DecodedRow } from '../../shared/caseTypes.ts';
import { ageOn } from '../../shared/caseTypes.ts';
import { displayValue, formFields, type Dictionary, type FormField } from '../../shared/dictionary.ts';
import { inHajjSeason } from '../../shared/derive.ts';
import type { XCell, XSheet } from '../../shared/xlsx.ts';
import type { Group } from '../store/types.ts';
import { decodeRows } from './cases.ts';

export interface StatsRequest {
  from: string | null;
  to: string | null;
  basis: 'COMPLETED' | 'ALL';
  per: 'PROCEDURE' | 'CASE';
  groupIds: string[];
}

const SKIP_ENTITIES = new Set(['PATIENT_IDENTIFIERS']);
const NUMERIC = new Set(['integer', 'decimal']);
const DATES = new Set(['date', 'datetime']);

interface Col {
  key: string;
  header: string;
  entity: string;
  field: FormField;
}

const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const inPeriod = (d: string | null, r: StatsRequest) => !!d && (!r.from || d >= r.from) && (!r.to || d <= r.to);

/** One cell from the values of one field over the rows that apply (several rows: labels joined with "; "). */
function cell(f: FormField, values: unknown[]): XCell {
  const vals = values.filter((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  if (!vals.length) return null;
  if (vals.length === 1) {
    const v = vals[0];
    if (DATES.has(f.type) && day(v)) return { date: day(v)! };
    if (NUMERIC.has(f.type) && Number.isFinite(Number(v))) return Number(v);
  }
  return [...new Set(vals.map((v) => (DATES.has(f.type) ? (day(v) ?? String(v)) : displayValue(f, v))))].join('; ');
}

export function buildStatsSheets(dict: Dictionary, cases: CaseRecord[], groups: Group[], req: StatsRequest, now: Date): { sheets: XSheet[]; rows: number; cases: number } {
  const season = dict.layout.form?.hajj_season;
  const gname = new Map(groups.map((g) => [g.group_id, g.name]));
  const comp = dict.entities.PROCEDURE_COMPONENTS.fields.find((f) => f.name === 'component_type')!;
  const ptype = dict.entities.EP_PROCEDURES.fields.find((f) => f.name === 'primary_procedure_type')!;

  // Columns: every field a person fills (form fields), entity by entity, in dictionary order.
  const cols: Col[] = [];
  for (const def of Object.values(dict.entities)) {
    if (SKIP_ENTITIES.has(def.entity)) continue;
    for (const f of formFields(def)) {
      if (f.type === 'fk' || f.name.endsWith('_id')) continue;
      cols.push({ key: `${def.entity}.${f.name}`, header: `${def.label}: ${f.label}`, entity: def.entity, field: f });
    }
  }

  const live = cases.filter((c) => !c.meta.is_deleted && req.groupIds.includes(c.meta.group_id) && (req.basis === 'ALL' || c.meta.collection_status === 'COMPLETED'));
  const head = ['MRN', 'Group', 'Case No.', 'Status', req.per === 'PROCEDURE' ? 'Procedure date' : 'Episode start date', 'Hajj season', 'Age', 'Sex', 'Procedure'];
  const body: XCell[][] = [];
  const caseSet = new Set<string>();

  for (const c of live) {
    const rows = decodeRows(dict, c);
    const ep = rows.EP_EPISODES?.[0];
    const ident = rows.PATIENT_IDENTIFIERS?.[0];
    const pat = rows.PATIENTS?.[0];
    const episodeStart = day(ep?.episode_start_date);
    const procs = rows.EP_PROCEDURES ?? [];
    const label = (p: DecodedRow) => {
      const cs = (rows.PROCEDURE_COMPONENTS ?? []).filter((x) => x.procedure_id === p._id).map((x) => displayValue(comp, x.component_type));
      return [p.primary_procedure_type ? displayValue(ptype, p.primary_procedure_type) : null, cs.length ? cs.join(' + ') : null].filter(Boolean).join(': ') || null;
    };
    const valuesFor = (col: Col, proc: DecodedRow | null): XCell => {
      const def = dict.entities[col.entity];
      let list = rows[col.entity] ?? [];
      if (def.scope === 'procedure' && proc) list = col.entity === 'EP_PROCEDURES' ? [proc] : list.filter((r) => r.procedure_id === proc._id);
      return cell(col.field, list.map((r) => r[col.field.name]));
    };
    const base = (date: string | null): XCell[] => [
      c.meta.mrn,
      gname.get(c.meta.group_id) ?? '',
      c.meta.group_seq,
      c.meta.collection_status === 'COMPLETED' ? 'Completed' : 'In progress',
      date ? { date } : null,
      date && season ? (inHajjSeason(date, season) ? 'Yes' : 'No') : null,
      ageOn(ident?.date_of_birth, date ?? episodeStart),
      pat?.sex_at_birth ? displayValue(dict.entities.PATIENTS.fields.find((f) => f.name === 'sex_at_birth')!, pat.sex_at_birth) : null,
    ];
    if (req.per === 'PROCEDURE') {
      for (const p of procs) {
        const date = day(p.procedure_start_datetime) ?? episodeStart;
        if ((req.from || req.to) && !inPeriod(date, req)) continue;
        body.push([...base(date), label(p), ...cols.map((col) => valuesFor(col, p))]);
        caseSet.add(c.meta.case_id);
      }
    } else {
      const first = procs.map((p) => day(p.procedure_start_datetime)).filter(Boolean).sort()[0] ?? null;
      const date = episodeStart ?? first;
      if ((req.from || req.to) && !inPeriod(date, req)) continue;
      body.push([...base(date), procs.map(label).filter(Boolean).join('; ') || null, ...cols.map((col) => valuesFor(col, null))]);
      caseSet.add(c.meta.case_id);
    }
  }

  const columns: XCell[][] = [
    ['Column', 'From the dictionary', 'Type', 'Codes (code = label)'],
    ['MRN', '', 'text', ''],
    ['Group', 'registry group', 'text', ''],
    ['Case No.', 'number within the group', 'number', ''],
    ['Status', 'data collection status', 'text', 'In progress; Completed'],
    [head[4], req.per === 'PROCEDURE' ? 'EP_PROCEDURES.procedure_start_datetime (else the episode start)' : 'EP_EPISODES.episode_start_date', 'date', ''],
    ['Hajj season', '1 Dhu al-Qa\'dah to 15 Muharram, by that date', 'Yes / No', ''],
    ['Age', 'from date of birth on that date (the date of birth itself is not in the file)', 'number', ''],
    ['Sex', 'PATIENTS.sex_at_birth', 'text', ''],
    ['Procedure', 'EP_PROCEDURES.primary_procedure_type + PROCEDURE_COMPONENTS', 'text', ''],
    ...cols.map((col) => [col.header, col.key, col.field.type, (col.field.codes ?? []).map((x) => `${x.code} = ${x.label}`).join('; ')]),
  ];
  const about: XCell[][] = [
    ['KAMC EP Registry — statistics file'],
    ['Made', now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    ['Period', req.from || req.to ? `${req.from ?? '…'} to ${req.to ?? '…'} (${req.per === 'PROCEDURE' ? 'procedure date' : 'episode start'})` : 'All dates'],
    ['Cases', req.basis === 'COMPLETED' ? 'Completed only' : 'Completed and In progress'],
    ['One row per', req.per === 'PROCEDURE' ? 'procedure' : 'case'],
    ['Groups', req.groupIds.map((id) => gname.get(id) ?? id).join(', ')],
    ['Rows', body.length],
    ['Values', 'Labels in words. Several rows of one item (e.g. several complications) are joined with "; ".'],
    ['Left out', 'Names and identifiers other than the MRN; date of birth (age is given).'],
  ];
  return {
    sheets: [
      { name: req.per === 'PROCEDURE' ? 'Procedures' : 'Cases', rows: [[...head, ...cols.map((x) => x.header)], ...body] },
      { name: 'Columns', rows: columns },
      { name: 'About', rows: about },
    ],
    rows: body.length,
    cases: caseSet.size,
  };
}
