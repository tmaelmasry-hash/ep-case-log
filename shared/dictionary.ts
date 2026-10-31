// The dictionary as this app uses it: the entity forms generated from the owner's dictionary (config/dictionary),
// merged with config/case_layout.json (case = episode, several procedures) and the label corrections.
// Pure: the server and the browser both build it from the same JSON files.
import { applyAmendments, type Amendments } from './amendments.ts';
import { checkRules, compileRules, type CompiledRules, type RulesConfig } from './rules.ts';

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
  /** Codes of a multi-choice field that must stand alone (M-4b: None, Unknown). */
  exclusive?: string[];
  /** Owner-approved local amendment item (config/dictionary/amendments.json). */
  amendment?: string;
  min?: number;
  max?: number;
  auto?: boolean;
  auto_other?: boolean;
  help?: string;
  rule?: string;
  /** Hidden by the owner's field review (case_layout form.hidden): never on a form; the stored column stays. */
  hidden?: boolean;
  /** A dictionary date & time field shown and stored as a date (case_layout form.date_only). */
  date_only?: boolean;
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
  /** Fields copied from the same MRN's latest case into a new case (phase 5). */
  copy_forward?: string[];
  /** Shown first; the other fields under "More fields" (phase 7, light follow-up). */
  primary_fields?: string[];
  /** These event types as Yes + date inside each row of `under` (phase 7). */
  quick_events?: { under: string; fk: string; type_field: string; date_field: string; codes: string[] };
  /** Nested rows offered only when this rules predicate (shared/rules.ts) is true; rows already saved stay listed
   *  (owner, 31 Oct: leadless channel measurements for leadless devices only, DR-DV-06). */
  show_when?: Record<string, unknown>;
}

export interface LayoutRow {
  id: string;
  label: string;
  icon: string;
  entities: string[];
  /** Title of the section's sheet when it differs from the row (owner, 28 Oct: "Patient Demographics"). */
  title?: string;
  /** Only the rows with these values (owner, 28 Oct: TEE, Cardiac CT and CMR are one entity, shown as three sections). */
  values?: Record<string, string>;
}

/** Whether a row belongs to a layout section that shows only some values of its entity. */
export const rowInSection = (r: LayoutRow, row: Record<string, unknown>) => Object.entries(r.values ?? {}).every(([k, v]) => row[k] === v);

export interface CaseLayout {
  entities: Record<string, LayoutEntity>;
  groups: { id: string; label: string; rows: LayoutRow[] }[];
  /** core_dataset category → the component types that put a procedure in it (keys starting with _ are notes). */
  core_categories: Record<string, string[] | string>;
  /** Procedure-level core items of an entity apply only with one of these component types (keys starting with _ are notes). */
  core_item_requires_component?: Record<string, string[] | string>;
  /** Labels of the core categories (keys starting with _ are notes). */
  category_labels?: Record<string, string>;
  /** Owner field review (24 Oct 2026): how the form shows dictionary fields. Keys are "ENTITY.field". */
  form?: FormOverrides;
}

export interface FormOverrides {
  hidden?: string[];
  not_core?: string[];
  labels?: Record<string, string>;
  code_order?: Record<string, string[]>;
  offer?: Record<string, string[]>;
  date_only?: string[];
  /** Hajj season for the automatic Hajj timing (Hijri [month, day]; owner 24 Oct: 1 Dhu al-Qa'dah → 15 Muharram). */
  hajj_season?: { start: [number, number]; end: [number, number]; rites: [[number, number], [number, number]] };
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
  /** Dynamic-form rules (M-1), compiled once. */
  rules: CompiledRules;
}

export interface RawDictionary {
  entities: Record<string, RawEntity>;
  extension: Record<string, unknown>;
  labels: { fields: Record<string, string>; codes: Record<string, string> };
  layout: CaseLayout;
  core: CoreSpec;
  /** Owner-approved local amendments (M-3, M-4a, M-4b), laid on top of the dictionary. */
  amendments?: Amendments;
  /** KAMC's own amendments from the owner's field review (config/local_amendments.json), laid on top of those. */
  localAmendments?: Amendments;
  /** Dynamic-form rules (M-1, config/rules.json). */
  rules?: RulesConfig;
}

export function buildDictionary(input: RawDictionary): Dictionary {
  const base = applyAmendments(input.entities, input.layout, input.amendments);
  const am = applyAmendments(base.entities, base.layout, input.localAmendments);
  const raw = { ...input, entities: am.entities, layout: am.layout };
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
    for (const f of ent.copy_forward ?? []) if (!ent.fields.some((x) => x.name === f)) throw new Error(`${ent.entity}: copy_forward names unknown field ${f}`);
    if (ent.copy_forward && ent.cardinality !== 'single') throw new Error(`${ent.entity}: copy_forward needs a one-per-case section`);
    for (const f of ent.primary_fields ?? []) if (!ent.fields.some((x) => x.name === f)) throw new Error(`${ent.entity}: primary_fields names unknown field ${f}`);
    const q = ent.quick_events;
    if (q) {
      const tf = ent.fields.find((x) => x.name === q.type_field);
      if (!entities[q.under] || !ent.fields.some((x) => x.name === q.fk && x.target === q.under) || !ent.fields.some((x) => x.name === q.date_field)) throw new Error(`${ent.entity}: quick_events layout error`);
      for (const c of q.codes) if (!tf?.codes?.some((x) => x.code === c)) throw new Error(`${ent.entity}: quick_events code ${c} is not a dictionary code`);
    }
    for (const t of ent.module ?? []) {
      const ok = entities.PROCEDURE_COMPONENTS?.fields.find((f) => f.name === 'component_type')?.codes?.some((c) => c.code === t);
      if (!ok) throw new Error(`${ent.entity}: module component type ${t} is not a dictionary code`);
    }
  }
  const allItems = [...raw.core.common, ...Object.values(raw.core.categories).flatMap((x) => (Array.isArray(x) ? x : []))];
  for (const it of allItems) if (!entities[it.entity]?.fields.some((f) => f.name === it.field)) throw new Error(`core_dataset names unknown field ${it.entity}.${it.field}`);
  const dropped = applyForm(entities, raw.layout.form);
  const keep = (it: CoreItem) => !dropped.has(`${it.entity}.${it.field}`);
  const coreSpec: CoreSpec = {
    common: raw.core.common.filter(keep),
    categories: Object.fromEntries(Object.entries(raw.core.categories).map(([k, v]) => [k, Array.isArray(v) ? v.filter(keep) : v])),
  };
  const items = allItems.filter(keep);
  for (const [cat, types] of Object.entries(raw.layout.core_categories ?? {})) {
    if (cat.startsWith('_')) continue;
    if (!(cat in raw.core.categories)) throw new Error(`case_layout core_categories names unknown category ${cat}`);
    for (const t of types as string[]) if (!entities.PROCEDURE_COMPONENTS?.fields.find((f) => f.name === 'component_type')?.codes?.some((c) => c.code === t)) throw new Error(`core category ${cat}: ${t} is not a component type`);
  }
  const core = new Set(items.map((c) => `${c.entity}.${c.field}`));
  const problems = checkRules(raw.rules, entities);
  if (problems.length) throw new Error(problems.slice(0, 5).join('; '));
  return { entities, layout: raw.layout, core, coreSpec, rules: compileRules(raw.rules) };
}

/** Lays the owner's field review (case_layout form) on the entities. Refuses names and codes that are not in the
 *  dictionary. Returns the "ENTITY.field" keys that stop being core items (hidden or not_core). */
function applyForm(entities: Record<string, EntityDef>, form: FormOverrides | undefined): Set<string> {
  const dropped = new Set<string>();
  if (!form) return dropped;
  const fieldOf = (key: string, what: string) => {
    const [e, n] = key.split('.');
    const f = entities[e]?.fields.find((x) => x.name === n);
    if (!f) throw new Error(`config/case_layout.json form.${what}: ${key} is not a dictionary field`);
    return f;
  };
  const codesIn = (f: FormField, key: string, what: string, codes: string[]) => {
    for (const c of codes) if (!f.codes?.some((x) => x.code === c)) throw new Error(`config/case_layout.json form.${what}: ${c} is not a code of ${key}`);
  };
  for (const key of form.hidden ?? []) {
    fieldOf(key, 'hidden').hidden = true;
    dropped.add(key);
  }
  for (const key of form.not_core ?? []) {
    fieldOf(key, 'not_core');
    dropped.add(key);
  }
  for (const [key, label] of Object.entries(form.labels ?? {})) fieldOf(key, 'labels').label = label;
  for (const [key, order] of Object.entries(form.code_order ?? {})) {
    const f = fieldOf(key, 'code_order');
    codesIn(f, key, 'code_order', order);
    f.codes = [...order.map((c) => f.codes!.find((x) => x.code === c)!), ...f.codes!.filter((x) => !order.includes(x.code))];
  }
  for (const [key, offer] of Object.entries(form.offer ?? {})) {
    const f = fieldOf(key, 'offer');
    codesIn(f, key, 'offer', offer);
    f.offer = f.offer ? f.offer.filter((c) => offer.includes(c)) : [...offer];
  }
  for (const key of form.date_only ?? []) {
    const f = fieldOf(key, 'date_only');
    if (f.type !== 'datetime') throw new Error(`config/case_layout.json form.date_only: ${key} is not a date & time field`);
    f.type = 'date';
    f.date_only = true;
  }
  // A hidden history field is not copied into a new case (nobody could check the "Copied" mark).
  for (const ent of Object.values(entities)) if (ent.copy_forward) ent.copy_forward = ent.copy_forward.filter((n) => !form.hidden?.includes(`${ent.entity}.${n}`));
  return dropped;
}

/** Fields that never appear on a form: links filled by the app, polymorphic keys, the "Other — specify" store. */
const HIDDEN = new Set(['PATIENT_IDENTIFIERS.merged_into_patient_id']);
/** Shown but not editable on the case page. */
export const READONLY = new Set(['PATIENT_IDENTIFIERS.mrn', 'PROCEDURE_COMPONENTS.component_sequence', 'PROCEDURE_COMPONENTS.component_type']);

export function formFields(def: EntityDef): FormField[] {
  return def.fields.filter(
    (f) => !f.hidden && !f.auto && !f.auto_other && f.type !== 'json_object' && f.type !== 'fk_polymorphic' && !HIDDEN.has(`${def.entity}.${f.name}`) && !(def.auto_parent && f.name in def.auto_parent) && !(def.nest_under && def.nest_under.fk === f.name),
  );
}

export function editable(def: EntityDef, f: FormField): boolean {
  // A hidden link stays writable: the app fills it (quick follow-up events, auto-linked studies); a person never sees it.
  if (f.hidden && f.type === 'fk') return true;
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
