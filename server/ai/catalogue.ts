// Which dictionary fields the AI may propose, and how they are described to a model (phase 11; ported from EP
// Workspace server/ai/catalogue.ts). Built from the dictionary only — nothing invented. Sections follow the case
// page: the case rows, then "procedure" (the procedure the note describes) and "followup". Workers-safe.
import { editable, type Dictionary, type FormField } from '../../shared/dictionary.ts';

export interface AiField {
  entity: string;
  field: FormField;
  section: string;
  multi: boolean;
  procedure: boolean;
}

/** Never proposed by the AI: identity (the note is de-identified before it is sent). */
// The research study's own patient ID (M-3 F2) is an identifier too.
const NEVER = new Set(['PATIENT_IDENTIFIERS.mrn', 'PATIENT_IDENTIFIERS.full_name', 'PATIENT_IDENTIFIERS.merged_into_patient_id', 'PATIENTS.research_study_patient_id']);
const NO_TYPES = new Set(['fk', 'fk_polymorphic', 'json_object']);

export interface AiSection {
  id: string;
  label: string;
  entities: string[];
}

const cache = new WeakMap<Dictionary, { sections: AiSection[]; fields: Map<string, AiField>; text: Map<string, string> }>();

function build(dict: Dictionary) {
  let c = cache.get(dict);
  if (c) return c;
  const sections: AiSection[] = [];
  for (const g of dict.layout.groups) for (const r of g.rows) sections.push({ id: r.id, label: r.label, entities: r.entities.filter((e) => dict.entities[e].scope !== 'procedure') });
  const procEntities = Object.values(dict.entities)
    .filter((e) => (e.entity === 'EP_PROCEDURES' || e.scope === 'procedure') && !['PROCEDURE_COMPONENTS', 'FOLLOW_UPS', 'OUTCOME_EVENTS'].includes(e.entity))
    .map((e) => e.entity);
  sections.push({ id: 'procedure', label: 'The procedure this note describes', entities: procEntities });
  const fu = sections.find((s) => s.id === 'followup');
  if (fu) fu.entities = ['FOLLOW_UPS', 'OUTCOME_EVENTS'];
  const fields = new Map<string, AiField>();
  for (const s of sections) {
    for (const e of s.entities) {
      const def = dict.entities[e];
      if (def.nest_under || def.later) continue; // rows inside another row are entered by hand
      for (const x of def.fields) {
        if (!editable(def, x) || NO_TYPES.has(x.type) || x.role === 'OTHER_SPECIFY' || NEVER.has(`${e}.${x.name}`)) continue;
        fields.set(`${e}.${x.name}`, { entity: e, field: x, section: s.id, multi: def.cardinality === 'multi' && e !== 'EP_PROCEDURES', procedure: e === 'EP_PROCEDURES' || def.scope === 'procedure' });
      }
    }
  }
  c = { sections, fields, text: new Map() };
  cache.set(dict, c);
  return c;
}

export function aiFields(dict: Dictionary): Map<string, AiField> {
  return build(dict).fields;
}

export function aiSections(dict: Dictionary): AiSection[] {
  return build(dict).sections;
}

const TYPE_HINT: Record<string, string> = {
  date: 'date YYYY-MM-DD',
  datetime: 'date-time YYYY-MM-DDTHH:MM',
  integer: 'whole number',
  decimal: 'number',
  boolean: 'true or false',
  string: 'short text',
  lookup_array: 'one or more codes, comma-separated',
};

/** The field list for the given sections, as compact text for the model's instructions. */
export function catalogueText(dict: Dictionary, sectionIds: string[]): string {
  const c = build(dict);
  const key = [...sectionIds].sort().join(',');
  const hit = c.text.get(key);
  if (hit) return hit;
  const out: string[] = [];
  for (const s of c.sections) {
    if (!sectionIds.includes(s.id)) continue;
    out.push(`## Section ${s.id} — ${s.label}`);
    for (const e of s.entities) {
      const list = [...c.fields.values()].filter((x) => x.entity === e);
      if (!list.length) continue;
      const def = dict.entities[e];
      out.push(`### ${e} — ${def.label} (${e === 'EP_PROCEDURES' ? 'the one procedure this note describes' : def.cardinality === 'multi' ? 'repeatable: one row per event' : 'one per case'})`);
      for (const { field: x } of list) {
        const codes = x.codes?.length ? `; codes: ${x.codes.map((k) => k.code).join('|')}` : '';
        const unit = x.unit ? `; unit ${x.unit}` : '';
        out.push(`- ${x.name}: ${x.label} (${TYPE_HINT[x.type] ?? 'code'}${unit}${codes})`);
      }
    }
  }
  const text = out.join('\n');
  c.text.set(key, text);
  return text;
}
