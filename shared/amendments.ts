// Local amendments approved by the owner (EP Workspace M-3, M-4a, M-4b; config/dictionary/amendments.json, copied
// unchanged): laid on top of the frozen dictionary when the config is built. New fields on dictionary sections, new
// codes on dictionary fields, new sections, more copy-forward fields. A name or code that already exists is refused:
// an amendment never changes or hides what the dictionary says. Ported from EP Workspace server/config.ts.
import type { CaseLayout, RawEntity } from './dictionary.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Amendments {
  version?: string;
  fields?: Record<string, any[]>;
  codes?: Record<string, any[]>;
  entities?: Record<string, any>;
  copy_forward?: Record<string, string[]>;
}

const TYPES = ['enum', 'lookup', 'lookup_array', 'boolean_unknown', 'boolean', 'integer', 'decimal', 'date', 'datetime', 'string', 'fk', 'json_object'];
const WHERE = 'config/dictionary/amendments.json';

/** Returns new entity forms and layout with the amendments applied (inputs are not changed). */
export function applyAmendments(entities: Record<string, RawEntity>, layout: CaseLayout, am: Amendments | undefined): { entities: Record<string, RawEntity>; layout: CaseLayout } {
  if (!am) return { entities, layout };
  const out: Record<string, RawEntity> = structuredClone(entities);
  const lay: CaseLayout = structuredClone(layout);
  const checkField = (e: string, f: any) => {
    if (!/^[a-z][a-z0-9_]*$/.test(f.name) || !f.label || !TYPES.includes(f.type)) throw new Error(`${WHERE}: ${e}.${f.name} needs a snake_case name, a label and a known type`);
    if (['enum', 'lookup', 'lookup_array', 'boolean_unknown'].includes(f.type) && !f.codes?.length) throw new Error(`${WHERE}: ${e}.${f.name} has no codes`);
    if (f.role !== 'REQUIRED_PARENT_FK' && f.role !== 'OTHER_SPECIFY' && !f.amendment) throw new Error(`${WHERE}: ${e}.${f.name} must name its approved proposal item (amendment)`);
  };
  for (const [name, def] of Object.entries<any>(am.entities ?? {})) {
    if (out[name]) throw new Error(`${WHERE}: section ${name} already exists`);
    if (!lay.entities[name]) throw new Error(`config/case_layout.json: amendment section ${name} has no entry`);
    for (const f of def.fields) checkField(name, f);
    out[name] = { pk: def.pk, parentFk: def.parentFk, fields: def.fields } as RawEntity;
  }
  for (const [e, list] of Object.entries<any[]>(am.fields ?? {})) {
    if (!out[e]) throw new Error(`${WHERE}: section ${e} does not exist`);
    for (const f of list) {
      checkField(e, f);
      if (out[e].fields.some((x) => x.name === f.name)) throw new Error(`${WHERE}: ${e}.${f.name} already exists in the dictionary`);
      // `after`: shown right after that field (e.g. energies used after energy source); else at the end of the section.
      const at = f.after ? out[e].fields.findIndex((x) => x.name === f.after) : -1;
      if (f.after && at < 0) throw new Error(`${WHERE}: ${e}.${f.name} after ${f.after}, which does not exist`);
      const { after: _after, ...field } = f;
      if (at < 0) out[e].fields.push(field);
      else out[e].fields.splice(at + 1, 0, field);
    }
  }
  for (const [path, list] of Object.entries<any[]>(am.codes ?? {})) {
    const [e, fname] = path.split('.');
    const f = out[e]?.fields.find((x) => x.name === fname);
    if (!f?.codes) throw new Error(`${WHERE}: ${path} is not a coded field`);
    for (const c of list) {
      if (!/^[A-Z0-9_]+$/.test(c.code) || !c.label || !c.amendment) throw new Error(`${WHERE}: ${path} code ${c.code} needs an UPPER_CASE code, a label and its proposal item`);
      if (f.codes.some((x) => x.code === c.code)) throw new Error(`${WHERE}: ${c.code} is already a code of ${path}`);
      f.codes.push({ code: c.code, label: c.label });
      if (f.offer) f.offer.push(c.code);
    }
  }
  for (const [e, list] of Object.entries(am.copy_forward ?? {})) {
    for (const n of list) if (!out[e]?.fields.some((x) => x.name === n)) throw new Error(`${WHERE}: copy_forward ${e}.${n} does not exist`);
    const meta = lay.entities[e];
    if (!meta) throw new Error(`${WHERE}: copy_forward ${e} has no case_layout entry`);
    meta.copy_forward = [...(meta.copy_forward ?? []), ...list.filter((n) => !meta.copy_forward?.includes(n))];
  }
  return { entities: out, layout: lay };
}
