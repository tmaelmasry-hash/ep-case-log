// The dictionary as this app uses it: the entity forms generated from the owner's dictionary (config/dictionary),
// merged with config/case_layout.json (case = episode, several procedures) and the label corrections.
// Pure: the server and the browser both build it from the same JSON files.

export interface Code {
  code: string;
  label: string;
}

export interface FormField {
  name: string;
  label: string;
  type: string;
  req: string;
  role?: string;
  unit?: string;
  codes?: Code[];
  offer?: string[];
  parent_field?: string;
  parent_map?: Record<string, string>;
  target?: string | null;
  maxLength?: number;
  min?: number;
  max?: number;
  auto?: boolean;
  auto_other?: boolean;
  help?: string;
  rule?: string;
}

export interface RawEntity {
  entity?: string;
  pk: string;
  parentFk: string[];
  fields: FormField[];
}

export interface LayoutEntity {
  scope?: 'case' | 'procedure';
  cardinality: 'single' | 'multi';
  label: string;
  module?: string[];
  auto_parent?: Record<string, string>;
  nest_under?: { entity: string; fk: string };
  later?: string;
}

export interface LayoutRow {
  id: string;
  label: string;
  icon: string;
  entities: string[];
}

export interface CaseLayout {
  entities: Record<string, LayoutEntity>;
  groups: { id: string; label: string; rows: LayoutRow[] }[];
  /** core_dataset category → the component types that put a procedure in it (keys starting with _ are notes). */
  core_categories: Record<string, string[] | string>;
  /** Procedure-level core items of an entity apply only with one of these component types (keys starting with _ are notes). */
  core_item_requires_component?: Record<string, string[] | string>;
}

/** One item of config/dictionary/core_dataset.json (EP Workspace "Ready to complete?"). */
export interface CoreItem {
  entity: string;
  field: string;
  when?: string | Record<string, string[]>;
  complete_if?: string[];
  then?: Record<string, string>;
  not_available_is_warning?: boolean;
}

export interface CoreSpec {
  common: CoreItem[];
  /** A list of items, or a note such as "common_only_until_R2". */
  categories: Record<string, CoreItem[] | string>;
}

export interface EntityDef extends LayoutEntity {
  entity: string;
  pk: string;
  parentFk: string[];
  fields: FormField[];
  extension: boolean;
}

export interface Dictionary {
  entities: Record<string, EntityDef>;
  layout: CaseLayout;
  /** "ENTITY.field" of the core dataset, common and category items (★ marks). */
  core: Set<string>;
  coreSpec: CoreSpec;
}

export interface RawDictionary {
  entities: Record<string, RawEntity>;
  extension: Record<string, unknown>;
  labels: { fields: Record<string, string>; codes: Record<string, string> };
  layout: CaseLayout;
  core: CoreSpec;
}

export function buildDictionary(raw: RawDictionary): Dictionary {
  const entities: Record<string, EntityDef> = {};
  const add = (name: string, form: RawEntity, extension: boolean) => {
    const meta = raw.layout.entities[name];
    if (!meta) throw new Error(`config/case_layout.json has no entry for ${name}`);
    entities[name] = { ...meta, entity: name, pk: form.pk, parentFk: form.parentFk, fields: structuredClone(form.fields), extension };
  };
  for (const [name, form] of Object.entries(raw.entities)) add(name, form, false);
  for (const [name, def] of Object.entries(raw.extension)) if (!name.startsWith('_')) add(name, def as RawEntity, true);
  for (const name of Object.keys(raw.layout.entities)) if (!entities[name]) throw new Error(`config/case_layout.json names unknown entity ${name}`);

  for (const [k, label] of Object.entries(raw.labels.fields)) {
    const [e, f] = k.split('.');
    const field = entities[e]?.fields.find((x) => x.name === f);
    if (field) field.label = label;
  }
  for (const ent of Object.values(entities)) {
    for (const f of ent.fields) for (const c of f.codes ?? []) c.label = raw.labels.codes[`${ent.entity}.${f.name}.${c.code}`] ?? raw.labels.codes[c.code] ?? c.label;
    if (ent.nest_under && !entities[ent.nest_under.entity]) throw new Error(`${ent.entity}: nest_under names unknown entity`);
    for (const t of ent.module ?? []) {
      const ok = entities.PROCEDURE_COMPONENTS?.fields.find((f) => f.name === 'component_type')?.codes?.some((c) => c.code === t);
      if (!ok) throw new Error(`${ent.entity}: module component type ${t} is not a dictionary code`);
    }
  }
  const items = [...raw.core.common, ...Object.values(raw.core.categories).flatMap((x) => (Array.isArray(x) ? x : []))];
  for (const it of items) if (!entities[it.entity]?.fields.some((f) => f.name === it.field)) throw new Error(`core_dataset names unknown field ${it.entity}.${it.field}`);
  for (const [cat, types] of Object.entries(raw.layout.core_categories ?? {})) {
    if (cat.startsWith('_')) continue;
    if (!(cat in raw.core.categories)) throw new Error(`case_layout core_categories names unknown category ${cat}`);
    for (const t of types as string[]) if (!entities.PROCEDURE_COMPONENTS?.fields.find((f) => f.name === 'component_type')?.codes?.some((c) => c.code === t)) throw new Error(`core category ${cat}: ${t} is not a component type`);
  }
  const core = new Set(items.map((c) => `${c.entity}.${c.field}`));
  return { entities, layout: raw.layout, core, coreSpec: raw.core };
}

/** Fields that never appear on a form: links filled by the app, polymorphic keys, the "Other — specify" store. */
const HIDDEN = new Set(['PATIENT_IDENTIFIERS.merged_into_patient_id']);
/** Shown but not editable on the case page. */
export const READONLY = new Set(['PATIENT_IDENTIFIERS.mrn', 'PROCEDURE_COMPONENTS.component_sequence', 'PROCEDURE_COMPONENTS.component_type']);

export function formFields(def: EntityDef): FormField[] {
  return def.fields.filter(
    (f) => !f.auto && !f.auto_other && f.type !== 'json_object' && f.type !== 'fk_polymorphic' && !HIDDEN.has(`${def.entity}.${f.name}`) && !(def.auto_parent && f.name in def.auto_parent) && !(def.nest_under && def.nest_under.fk === f.name),
  );
}

export function editable(def: EntityDef, f: FormField): boolean {
  return formFields(def).includes(f) && !READONLY.has(`${def.entity}.${f.name}`);
}

export function codeLabel(f: FormField, code: unknown): string {
  return f.codes?.find((c) => c.code === code)?.label ?? String(code);
}

/** Codes offered for this field given the current row (offer list; subtype filtered by its parent diagnosis). */
export function offeredCodes(f: FormField, row?: Record<string, unknown> | null): string[] {
  let codes = (f.codes ?? []).map((c) => c.code);
  if (f.offer) codes = codes.filter((c) => f.offer!.includes(c) || c === row?.[f.name]);
  if (f.parent_field && f.parent_map) {
    const p = row?.[f.parent_field];
    codes = p ? codes.filter((c) => f.parent_map![c] === p) : [];
  }
  return codes;
}

export function displayValue(f: FormField, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map((c) => codeLabel(f, c)).join(', ');
  if (f.type === 'boolean') return v ? 'Yes' : 'No';
  if (f.codes) return codeLabel(f, v);
  if (f.type === 'datetime') return String(v).replace('T', ' ');
  return f.unit ? `${v} ${f.unit}` : String(v);
}

export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '' && v !== '[]' && v !== '{}';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
