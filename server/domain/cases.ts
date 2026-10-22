// Case rules (pure; work on a CaseRecord in memory): build a new case, apply a batch of edits with dictionary
// validation, decode for the browser, summarise for lists. Field-level last save wins (EP Workspace P3-4).
import { editable, type Dictionary, type EntityDef } from '../../shared/dictionary.ts';
import { FieldError, decodeValue, encodeValue, mergeOtherSpecify } from '../../shared/validate.ts';
import {
  ID_RE,
  ageOn,
  idPrefix,
  slotId,
  type AdditionalEdit,
  type CaseDetail,
  type CaseRecord,
  type CaseSummary,
  type DecodedRow,
  type EditBatch,
  type EditResult,
  type StoredRow,
} from '../../shared/caseTypes.ts';

/** Rows that can never be removed: they are the case itself. */
const PERMANENT = new Set(['PATIENT_IDENTIFIERS', 'PATIENTS', 'EP_EPISODES']);

export interface Actor {
  userId: string;
  now: string;
}

export function newRowId(def: EntityDef): string {
  return `${idPrefix(def.pk)}_${crypto.randomUUID()}`;
}

export function liveRows(rec: CaseRecord, entity: string): StoredRow[] {
  return (rec.rows[entity] ?? []).filter((r) => !r._deleted);
}

function findLive(rec: CaseRecord, entity: string, id: string): StoredRow | undefined {
  return liveRows(rec, entity).find((r) => r._id === id);
}

function insert(rec: CaseRecord, entity: string, id: string, values: Record<string, unknown>, a: Actor): StoredRow {
  const row: StoredRow = { ...values, _id: id, _created_at: a.now, _created_by: a.userId, _updated_at: a.now, _updated_by: a.userId };
  (rec.rows[entity] ??= []).push(row);
  return row;
}

/** The id a one-per-scope row must have. */
export function expectedSlot(dict: Dictionary, entity: string, scopeId: string): string {
  return slotId(idPrefix(dict.entities[entity].pk), entity, scopeId);
}

export interface NewCaseInput {
  caseId: string;
  patientId: string;
  mrn: string;
  groupId: string;
  groupSeq: number;
  episodeStart: string;
  enrollmentDate: string;
  registryBasis: string;
}

/** A new case = the patient identity rows + one open episode (EP Workspace M3-9: episode_status OPEN). */
export function newCaseRecord(dict: Dictionary, input: NewCaseInput, a: Actor): CaseRecord {
  const episodeId = expectedSlot(dict, 'EP_EPISODES', input.caseId);
  const rec: CaseRecord = {
    meta: {
      case_id: input.caseId,
      patient_id: input.patientId,
      episode_id: episodeId,
      mrn: input.mrn,
      group_id: input.groupId,
      group_seq: input.groupSeq,
      collection_status: 'IN_PROGRESS',
      created_at: a.now,
      created_by: a.userId,
      updated_at: a.now,
      updated_by: a.userId,
      row_version: 1,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    },
    rows: {},
    additional: [],
  };
  insert(rec, 'PATIENT_IDENTIFIERS', input.patientId, { patient_id: input.patientId, mrn: input.mrn }, a);
  insert(rec, 'PATIENTS', input.patientId, { patient_id: input.patientId, enrollment_date: input.enrollmentDate, registry_basis: input.registryBasis }, a);
  insert(rec, 'EP_EPISODES', episodeId, { episode_id: episodeId, patient_id: input.patientId, episode_start_date: input.episodeStart, episode_status: 'OPEN' }, a);
  return rec;
}

class EditError extends Error {}

/** Fill the links of a new row and check its place in the case. Returns the stored values. */
function placeRow(dict: Dictionary, rec: CaseRecord, def: EntityDef, id: string, parentId: string | null | undefined, a: Actor): Record<string, unknown> {
  const v: Record<string, unknown> = { [def.pk]: id };
  if (def.later) throw new EditError(`${def.label} comes in ${def.later}.`);
  if (PERMANENT.has(def.entity)) throw new EditError(`${def.label} cannot be added.`);
  let procedureId: string | null = null;
  if (def.nest_under) {
    const parent = parentId ? findLive(rec, def.nest_under.entity, parentId) : undefined;
    if (!parent) throw new EditError(`${def.label}: the row it belongs to was not found.`);
    v[def.nest_under.fk] = parentId;
  } else if (def.scope === 'procedure') {
    if (!parentId || !findLive(rec, 'EP_PROCEDURES', parentId)) throw new EditError(`${def.label}: choose the procedure first.`);
    procedureId = parentId;
  } else if (parentId) {
    throw new EditError(`${def.label}: unexpected parent.`);
  }
  if (def.cardinality === 'single') {
    const scopeId = procedureId ?? rec.meta.case_id;
    if (def.nest_under) throw new EditError(`${def.label}: layout error.`);
    if (id !== expectedSlot(dict, def.entity, scopeId)) throw new EditError(`${def.label}: wrong id for a one-per-${def.scope === 'procedure' ? 'procedure' : 'case'} section.`);
  }
  for (const f of def.fields) {
    if (f.type !== 'fk' || !f.auto) continue;
    if (def.nest_under?.fk === f.name) continue;
    if (f.target === 'PATIENTS') v[f.name] = rec.meta.patient_id;
    else if (f.target === 'EP_EPISODES') v[f.name] = rec.meta.episode_id;
    else if (f.target === 'EP_PROCEDURES') v[f.name] = procedureId;
    else if (def.auto_parent?.[f.name]) {
      const pe = def.auto_parent[f.name];
      const slot = expectedSlot(dict, pe, rec.meta.case_id);
      if (!findLive(rec, pe, slot)) insert(rec, pe, slot, placeRow(dict, rec, dict.entities[pe], slot, null, a), a);
      v[f.name] = slot;
    }
  }
  if (def.entity === 'EP_PROCEDURES') v.episode_id = rec.meta.episode_id;
  if (def.entity === 'PROCEDURE_COMPONENTS') {
    const seqs = liveRows(rec, 'PROCEDURE_COMPONENTS').filter((r) => r.procedure_id === procedureId).map((r) => Number(r.component_sequence) || 0);
    v.component_sequence = Math.max(0, ...seqs) + 1;
  }
  return v;
}

/** Validates one value for a row (dictionary codes, types, links inside this case). Returns the stored value. */
function encodeFor(dict: Dictionary, rec: CaseRecord, def: EntityDef, row: Record<string, unknown>, field: string, value: unknown, userIds: Set<string>, allowCreateOnly = false): unknown {
  const f = def.fields.find((x) => x.name === field);
  if (!f) throw new EditError(`${def.label}: unknown field ${field}.`);
  const createOnly = allowCreateOnly && def.entity === 'PROCEDURE_COMPONENTS' && field === 'component_type';
  if (!editable(def, f) && !createOnly) throw new EditError(`${f.label} cannot be edited here.`);
  const stored = encodeValue(f, value, row);
  if (f.type === 'fk' && stored !== null) {
    const ok = f.target === 'USERS' ? userIds.has(String(stored)) : !!f.target && !!findLive(rec, f.target, String(stored));
    if (!ok) throw new EditError(`${f.label}: the linked record is not in this case.`);
  }
  return stored;
}

/** After a value changes: clear a dependent subtype that no longer belongs, and prune "Other — specify" keys. */
function afterChange(def: EntityDef, row: StoredRow, field: string) {
  for (const child of def.fields) {
    if (child.parent_field === field && child.parent_map && row[child.name] !== null && row[child.name] !== undefined) {
      if (child.parent_map[String(row[child.name])] !== row[field]) row[child.name] = null;
    }
  }
  if (def.fields.some((x) => x.name === 'other_specify_json')) row.other_specify_json = mergeOtherSpecify(def, row, null, null);
}

function removeRow(dict: Dictionary, rec: CaseRecord, entity: string, id: string, a: Actor) {
  const row = findLive(rec, entity, id);
  if (!row) return;
  row._deleted = true;
  row._updated_at = a.now;
  row._updated_by = a.userId;
  for (const child of Object.values(dict.entities)) {
    if (child.nest_under?.entity === entity) for (const k of liveRows(rec, child.entity).filter((r) => r[child.nest_under!.fk] === id)) removeRow(dict, rec, child.entity, k._id, a);
    if (entity === 'EP_PROCEDURES' && child.scope === 'procedure') for (const k of liveRows(rec, child.entity).filter((r) => r.procedure_id === id)) removeRow(dict, rec, child.entity, k._id, a);
  }
}

function applyAdditional(rec: CaseRecord, e: AdditionalEdit, a: Actor) {
  const text = typeof e.text === 'string' ? e.text.trim() : '';
  if (e.fact_date && !/^\d{4}-\d{2}-\d{2}$/.test(e.fact_date)) throw new EditError('Date: enter a valid date.');
  if (text.length > 2000) throw new EditError('At most 2,000 characters.');
  const cur = rec.additional.find((x) => x.info_id === e.id && !x.is_deleted);
  if (e.op === 'add') {
    if (!ID_RE.test(e.id) || !e.id.startsWith('info_')) throw new EditError('Invalid id.');
    if (cur) return;
    if (!text) throw new EditError('Write the information first.');
    rec.additional.push({ info_id: e.id, text, fact_date: e.fact_date ?? null, created_at: a.now, created_by: a.userId, is_deleted: false });
  } else if (e.op === 'set') {
    if (!cur) throw new EditError('This information was removed.');
    if (e.text !== undefined) {
      if (!text) throw new EditError('Write the information, or remove it.');
      cur.text = text;
    }
    if (e.fact_date !== undefined) cur.fact_date = e.fact_date ?? null;
  } else if (e.op === 'remove') {
    if (cur) cur.is_deleted = true;
  }
}

/** Applies a batch in order: creates, then changes, then removes. Each item succeeds or fails on its own. */
export function applyEdits(dict: Dictionary, rec: CaseRecord, batch: EditBatch, a: Actor, userIds: Set<string>): EditResult[] {
  const results: EditResult[] = [];
  const failedCreates = new Set<string>();
  const run = (kind: EditResult['kind'], i: number, fn: () => void) => {
    try {
      fn();
      results.push({ kind, i, ok: true });
    } catch (e) {
      if (e instanceof EditError || e instanceof FieldError) results.push({ kind, i, ok: false, message: e.message });
      else throw e;
    }
  };

  (batch.creates ?? []).slice(0, 50).forEach((c, i) =>
    run('create', i, () => {
      const def = dict.entities[c?.entity];
      if (!def) throw new EditError('Unknown section.');
      if (typeof c.id !== 'string' || !ID_RE.test(c.id) || !c.id.startsWith(`${idPrefix(def.pk)}_`)) {
        failedCreates.add(String(c.id));
        throw new EditError(`${def.label}: invalid id.`);
      }
      if (findLive(rec, def.entity, c.id)) return; // a retried save adds nothing
      if ((rec.rows[def.entity] ?? []).some((r) => r._id === c.id)) {
        failedCreates.add(c.id);
        throw new EditError(`${def.label}: this row was removed.`);
      }
      try {
        const values = placeRow(dict, rec, def, c.id, c.parent_id, a);
        const row = { ...values } as Record<string, unknown>;
        for (const [k, v] of Object.entries(c.values ?? {}).slice(0, 20)) row[k] = encodeFor(dict, rec, def, row, k, v, userIds, true);
        insert(rec, def.entity, c.id, row, a);
      } catch (e) {
        failedCreates.add(c.id);
        throw e;
      }
    }),
  );

  (batch.changes ?? []).slice(0, 200).forEach((ch, i) =>
    run('change', i, () => {
      const def = dict.entities[ch?.entity];
      if (!def) throw new EditError('Unknown section.');
      if (failedCreates.has(ch.id)) throw new EditError(`${def.label}: the row could not be added.`);
      const row = findLive(rec, def.entity, String(ch.id));
      if (!row) throw new EditError(`${def.label}: this row was removed.`);
      if (ch.field === 'other_specify_json') {
        row.other_specify_json = mergeOtherSpecify(def, row, String(ch.key ?? ''), ch.value);
      } else {
        row[ch.field] = encodeFor(dict, rec, def, row, ch.field, ch.value, userIds);
        afterChange(def, row, ch.field);
      }
      row._updated_at = a.now;
      row._updated_by = a.userId;
    }),
  );

  (batch.removes ?? []).slice(0, 50).forEach((r, i) =>
    run('remove', i, () => {
      const def = dict.entities[r?.entity];
      if (!def) throw new EditError('Unknown section.');
      if (PERMANENT.has(def.entity)) throw new EditError(`${def.label} cannot be removed.`);
      removeRow(dict, rec, def.entity, String(r.id), a);
    }),
  );

  (batch.additional ?? []).slice(0, 20).forEach((e, i) => run('additional', i, () => applyAdditional(rec, e, a)));

  if (results.some((r) => r.ok)) {
    rec.meta.updated_at = a.now;
    rec.meta.updated_by = a.userId;
    rec.meta.row_version++;
  }
  return results;
}

export function decodeRows(dict: Dictionary, rec: CaseRecord): Record<string, DecodedRow[]> {
  const out: Record<string, DecodedRow[]> = {};
  for (const [entity, rows] of Object.entries(rec.rows)) {
    const def = dict.entities[entity];
    if (!def) continue;
    out[entity] = rows
      .filter((r) => !r._deleted)
      .map((r) => {
        const d: DecodedRow = { _id: r._id };
        for (const f of def.fields) d[f.name] = decodeValue(f, r[f.name]);
        return d;
      });
  }
  return out;
}

export function toDetail(dict: Dictionary, rec: CaseRecord, groupName: string, users: { id: string; name: string }[]): CaseDetail {
  return { meta: { ...rec.meta, group_name: groupName }, rows: decodeRows(dict, rec), additional: rec.additional.filter((x) => !x.is_deleted), users };
}

export function summarize(rec: CaseRecord): CaseSummary {
  const ep = liveRows(rec, 'EP_EPISODES')[0];
  const ident = liveRows(rec, 'PATIENT_IDENTIFIERS')[0];
  const pat = liveRows(rec, 'PATIENTS')[0];
  const comps = liveRows(rec, 'PROCEDURE_COMPONENTS');
  const procedures = liveRows(rec, 'EP_PROCEDURES')
    .map((p) => ({
      id: p._id,
      start: (p.procedure_start_datetime as string) ?? null,
      type: (p.primary_procedure_type as string) ?? null,
      status: (p.procedure_status as string) ?? null,
      components: comps
        .filter((c) => c.procedure_id === p._id)
        .sort((x, y) => Number(x.component_sequence) - Number(y.component_sequence))
        .map((c) => String(c.component_type)),
    }))
    .sort((x, y) => (x.start ?? '9999').localeCompare(y.start ?? '9999'));
  const start = (ep?.episode_start_date as string) ?? null;
  return {
    case_id: rec.meta.case_id,
    mrn: rec.meta.mrn,
    group_id: rec.meta.group_id,
    group_seq: rec.meta.group_seq,
    collection_status: rec.meta.collection_status,
    episode_start_date: start,
    episode_end_date: (ep?.episode_end_date as string) ?? null,
    sex: (pat?.sex_at_birth as string) ?? null,
    age: ageOn(ident?.date_of_birth, start),
    procedures,
    updated_at: rec.meta.updated_at,
  };
}
