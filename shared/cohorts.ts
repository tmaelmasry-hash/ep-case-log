// Custom cohorts (owner R2-12): the Admin makes a cohort either by rule (conditions on dictionary fields; cases join on
// their own) or by tag (the Admin adds cases by hand). Definitions live in the Settings tab ("cohorts"), tags in the
// CohortTags tab. Pure: the server evaluates rules on decoded rows; the browser only shows the result.
import type { Dictionary, FormField } from './dictionary.ts';
import type { DecodedRow } from './caseTypes.ts';

export type CohortOp = 'in' | 'yes' | 'no' | 'lt' | 'gt' | 'between' | 'before' | 'after' | 'has' | 'empty';

export interface CohortCondition {
  /** "ENTITY.field" of the dictionary. */
  field: string;
  op: CohortOp;
  /** Codes for "in"; one number or date for lt/gt/before/after; two for between. */
  values?: (string | number)[];
}

export interface CohortDef {
  id: string;
  name: string;
  kind: 'rule' | 'tag';
  /** CSS color token (cat-*) chosen by the Admin. */
  color: string;
  note?: string;
  match?: 'ALL' | 'ANY';
  conditions?: CohortCondition[];
  created_at: string;
  created_by: string;
  deleted?: boolean;
}

export const COHORT_COLORS = ['cat-ap', 'cat-flutter', 'cat-pilgrim', 'cat-svt', 'cat-af', 'cat-avn', 'cat-dev', 'cat-laa'];

/** Entities never offered in rules: who the patient is. */
const PRIVATE_ENTITIES = new Set(['PATIENT_IDENTIFIERS']);
const RULE_TYPES = new Set(['enum', 'lookup', 'lookup_array', 'boolean', 'boolean_unknown', 'integer', 'decimal', 'date', 'datetime']);

/** Fields a rule may use: coded, yes/no, numbers and dates of every entity except identifiers. */
export function ruleFields(dict: Dictionary): { path: string; entity: string; label: string; f: FormField }[] {
  const out: { path: string; entity: string; label: string; f: FormField }[] = [];
  for (const [entity, def] of Object.entries(dict.entities)) {
    if (PRIVATE_ENTITIES.has(entity)) continue;
    for (const f of def.fields) if (RULE_TYPES.has(f.type)) out.push({ path: `${entity}.${f.name}`, entity, label: `${def.label} › ${f.label}`, f });
  }
  return out;
}

/** Operators that fit a field type. */
export function opsFor(f: FormField): CohortOp[] {
  if (f.type === 'boolean') return ['yes', 'no', 'empty'];
  if (f.type === 'integer' || f.type === 'decimal') return ['lt', 'gt', 'between', 'has', 'empty'];
  if (f.type === 'date' || f.type === 'datetime') return ['before', 'after', 'between', 'has', 'empty'];
  return ['in', 'has', 'empty'];
}

/** Problems with a rule, for the API and the form ("" = fine). */
export function checkCohort(dict: Dictionary, d: Pick<CohortDef, 'name' | 'kind' | 'match' | 'conditions'>): string {
  if (!d.name?.trim() || d.name.trim().length > 60) return 'Give the cohort a name (up to 60 characters).';
  if (d.kind === 'tag') return '';
  if (d.kind !== 'rule') return 'Choose by rule or by tag.';
  if (d.match !== 'ALL' && d.match !== 'ANY') return 'Choose All or Any.';
  if (!d.conditions?.length || d.conditions.length > 10) return 'Add one to ten conditions.';
  const fields = new Map(ruleFields(dict).map((x) => [x.path, x.f]));
  for (const c of d.conditions) {
    const f = fields.get(c.field);
    if (!f) return `${c.field} cannot be used in a rule.`;
    if (!opsFor(f).includes(c.op)) return `${f.label}: that comparison does not fit this field.`;
    const v = c.values ?? [];
    if (c.op === 'in' && (!v.length || v.some((x) => !f.codes?.some((k) => k.code === x)))) return `${f.label}: choose one or more of its values.`;
    if ((c.op === 'lt' || c.op === 'gt') && (v.length !== 1 || !Number.isFinite(Number(v[0])))) return `${f.label}: enter a number.`;
    if ((c.op === 'before' || c.op === 'after') && (v.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(String(v[0])))) return `${f.label}: enter a date.`;
    if (c.op === 'between' && v.length !== 2) return `${f.label}: enter both ends.`;
  }
  return '';
}

const present = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

function rowMeets(c: CohortCondition, f: FormField, v: unknown): boolean {
  const vals = c.values ?? [];
  switch (c.op) {
    case 'has':
      return present(v);
    case 'in':
      return (Array.isArray(v) ? v : [v]).some((x) => vals.includes(x as string));
    case 'yes':
      return v === true;
    case 'no':
      return v === false;
    case 'lt':
      return present(v) && Number(v) < Number(vals[0]);
    case 'gt':
      return present(v) && Number(v) > Number(vals[0]);
    case 'before':
      return present(v) && String(v).slice(0, 10) < String(vals[0]);
    case 'after':
      return present(v) && String(v).slice(0, 10) > String(vals[0]);
    case 'between':
      if (!present(v)) return false;
      return f.type === 'date' || f.type === 'datetime'
        ? String(v).slice(0, 10) >= String(vals[0]) && String(v).slice(0, 10) <= String(vals[1])
        : Number(v) >= Number(vals[0]) && Number(v) <= Number(vals[1]);
    default:
      return false;
  }
}

/** Does a case (decoded rows) meet a rule cohort? A condition holds when any row of its entity meets it;
 *  "empty" holds when no row has a value. */
export function meetsRule(dict: Dictionary, d: CohortDef, rows: Record<string, DecodedRow[]>): boolean {
  if (d.kind !== 'rule' || !d.conditions?.length) return false;
  const test = (c: CohortCondition) => {
    const [entity, name] = c.field.split('.');
    const f = dict.entities[entity]?.fields.find((x) => x.name === name);
    if (!f) return false;
    const list = rows[entity] ?? [];
    if (c.op === 'empty') return !list.some((r) => present(r[name]));
    return list.some((r) => rowMeets(c, f, r[name]));
  };
  return d.match === 'ANY' ? d.conditions.some(test) : d.conditions.every(test);
}
