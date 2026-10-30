// Case rules (pure; work on a CaseRecord in memory): build a new case, apply a batch of edits with dictionary
// validation, decode for the browser, summarise for lists. Field-level last save wins (EP Workspace P3-4).
import { codeLabel, displayValue, editable, hasValue, type Dictionary, type EntityDef } from '../../shared/dictionary.ts';
import { FieldError, decodeValue, encodeValue, mergeOtherSpecify } from '../../shared/validate.ts';
import { evaluateReadiness, isProcedureLevel, naKey, type Readiness } from '../../shared/readiness.ts';
import { cha2ds2vasc, chaRelevant } from '../../shared/cha.ts';
import { CATEGORY_FIELDS } from '../../shared/categories.ts';
import { caseEnv, consequences, misfit } from '../../shared/rules.ts';
import { deriveChanges } from '../../shared/derive.ts';
import { PROCEDURE_ITEMS } from '../../shared/procedureTypes.ts';
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
  type HistoryEntry,
  type HistoryItem,
  type NaEdit,
  type PickedItemsEdit,
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

export function findLive(rec: CaseRecord, entity: string, id: string): StoredRow | undefined {
  return liveRows(rec, entity).find((r) => r._id === id);
}

export function insert(rec: CaseRecord, entity: string, id: string, values: Record<string, unknown>, a: Actor): StoredRow {
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
  /** Bulk add may leave it empty for the collector to fill. */
  episodeStart: string | null;
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
    not_available: {},
    history: [],
    copied: {},
    ai: {},
  };
  insert(rec, 'PATIENT_IDENTIFIERS', input.patientId, { patient_id: input.patientId, mrn: input.mrn }, a);
  insert(rec, 'PATIENTS', input.patientId, { patient_id: input.patientId, enrollment_date: input.enrollmentDate, registry_basis: input.registryBasis }, a);
  insert(rec, 'EP_EPISODES', episodeId, { episode_id: episodeId, patient_id: input.patientId, episode_start_date: input.episodeStart, episode_status: 'OPEN' }, a);
  return rec;
}

// ── case history (EP Workspace F-16: who, when, value before → after; shown only inside the case) ──

const MERGE_MS = 2 * 60_000;

export function addHistory(rec: CaseRecord, e: Omit<HistoryEntry, 'at' | 'by'>, a: Actor) {
  const list = (rec.history ??= []);
  const last = list[list.length - 1];
  // Typing in one field (saved every pause) is one change: keep the first "before" and the last "after".
  if (e.kind === 'edit' && last?.kind === 'edit' && last.by === a.userId && last.row_id === e.row_id && last.field === e.field && last.text === e.text && Date.parse(a.now) - Date.parse(last.at) <= MERGE_MS) {
    last.new = e.new;
    last.at = a.now;
    if (JSON.stringify(last.old ?? null) === JSON.stringify(last.new ?? null)) list.pop();
    return;
  }
  list.push({ id: `hist_${crypto.randomUUID()}`, at: a.now, by: a.userId, ...e });
}

/** The procedure a row belongs to (null for case-level rows). */
function procedureOf(dict: Dictionary, entity: string, row: Record<string, unknown>): string | null {
  if (entity === 'EP_PROCEDURES') return String(row._id ?? row.procedure_id);
  if (dict.entities[entity]?.scope === 'procedure') return (row.procedure_id as string) ?? null;
  return null;
}

/** Where a row is, as the case page names it: "Procedure 2", "Complication 1", "ECG 3". */
export function placeOf(dict: Dictionary, rec: CaseRecord, entity: string, row: StoredRow): { proc: string | null; own: string | null } {
  const def = dict.entities[entity];
  if (def.nest_under) {
    const parent = (rec.rows[def.nest_under.entity] ?? []).find((r) => r._id === row[def.nest_under!.fk]);
    const up = parent ? placeOf(dict, rec, def.nest_under.entity, parent) : { proc: null, own: null };
    const sibs = liveRows(rec, entity).filter((r) => r[def.nest_under!.fk] === row[def.nest_under!.fk]);
    const k = sibs.findIndex((r) => r._id === row._id);
    return { proc: up.proc, own: [up.own ?? dict.entities[def.nest_under.entity].label, `${def.label} ${k >= 0 ? k + 1 : ''}`.trim()].join(' · ') };
  }
  const pid = procedureOf(dict, entity, row);
  const n = pid ? liveRows(rec, 'EP_PROCEDURES').findIndex((p) => p._id === pid) : -1;
  const proc = pid ? (n >= 0 ? `Procedure ${n + 1}` : 'Removed procedure') : null;
  if (entity === 'EP_PROCEDURES' || def.cardinality === 'single') return { proc, own: null };
  if (entity === 'PROCEDURE_COMPONENTS') return { proc, own: `Component ${codeLabel(def.fields.find((f) => f.name === 'component_type')!, row.component_type)}` };
  const sibs = liveRows(rec, entity).filter((r) => !pid || r.procedure_id === pid);
  const k = sibs.findIndex((r) => r._id === row._id);
  return { proc, own: `${def.label}${k >= 0 ? ` ${k + 1}` : ''}` };
}

export const whereText = (p: { proc: string | null; own: string | null }) => [p.proc, p.own].filter(Boolean).join(' · ') || undefined;

export class EditError extends Error {}

/** Fill the links of a new row and check its place in the case. Returns the stored values. */
export function placeRow(dict: Dictionary, rec: CaseRecord, def: EntityDef, id: string, parentId: string | null | undefined, a: Actor): Record<string, unknown> {
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
  // Every procedure section keeps its procedure, also the extension that has no procedure_id field of its own.
  if (procedureId) v.procedure_id = procedureId;
  // Follow-ups and outcome events: the dictionary's polymorphic index event is this procedure (phase 7).
  if (procedureId && def.fields.some((f) => f.name === 'index_event_type') && def.fields.some((f) => f.name === 'index_event_id')) {
    v.index_event_type = 'PROCEDURE';
    v.index_event_id = procedureId;
  }
  if (def.entity === 'EP_PROCEDURES') v.episode_id = rec.meta.episode_id;
  if (def.entity === 'PROCEDURE_COMPONENTS') {
    const seqs = liveRows(rec, 'PROCEDURE_COMPONENTS').filter((r) => r.procedure_id === procedureId).map((r) => Number(r.component_sequence) || 0);
    v.component_sequence = Math.max(0, ...seqs) + 1;
  }
  return v;
}

/** Validates one value for a row (dictionary codes, types, links inside this case). Returns the stored value. */
/** M-1 save check (same evaluator as the screen): a value the rules forbid is refused, and so is a change that would
 *  leave another answer of the same procedure (or of the case) not fitting, unless this batch clears that answer. */
function checkRules(dict: Dictionary, rec: CaseRecord, def: EntityDef, row: StoredRow, field: string, value: unknown, clearing: Set<string>) {
  if (!dict.rules.byTarget.size) return;
  const decoded = decodeRows(dict, rec);
  const rowsOf = (e: string) => decoded[e] ?? [];
  const pid = procedureOf(dict, def.entity, row);
  const own = rowsOf(def.entity).find((r) => r._id === row._id) ?? null;
  // Read as stored (EP Workspace valueMisfit): a field shown only once it holds an answer takes no new answer.
  const env = caseEnv(dict.entities, rowsOf, pid, { entity: def.entity, row: own });
  const label = def.fields.find((f) => f.name === field)?.label ?? field;
  const why = misfit(dict.rules, def.entity, field, value, env);
  if (why) throw new EditError(`${label}: ${why}.`);
  const broken = consequences(dict.rules, dict.entities, rowsOf, pid, def.entity, field, value).filter((c) => {
    const cpid = dict.entities[c.entity]?.scope === 'procedure' || c.entity === 'EP_PROCEDURES' ? pid : null;
    return !clearing.has(`${c.entity}.${c.field}@${cpid ?? ''}`);
  });
  if (broken.length) {
    const names = broken.map((c) => dict.entities[c.entity].fields.find((f) => f.name === c.field)?.label ?? c.field).join(', ');
    throw new EditError(`${label}: first remove the answers that would no longer apply (${names}).`);
  }
}

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
export function afterChange(def: EntityDef, row: StoredRow, field: string) {
  for (const child of def.fields) {
    if (child.parent_field === field && child.parent_map && row[child.name] !== null && row[child.name] !== undefined) {
      if (child.parent_map[String(row[child.name])] !== row[field]) row[child.name] = null;
    }
  }
  if (def.fields.some((x) => x.name === 'other_specify_json')) row.other_specify_json = mergeOtherSpecify(def, row, null, null);
}

export function removeRow(dict: Dictionary, rec: CaseRecord, entity: string, id: string, a: Actor) {
  const row = findLive(rec, entity, id);
  if (!row) return;
  row._deleted = true;
  row._updated_at = a.now;
  row._updated_by = a.userId;
  // Links from other rows to the removed one are cleared (their own values stay), e.g. an outcome event's follow-up.
  for (const other of Object.values(dict.entities)) {
    for (const f of other.fields) {
      if (f.type !== 'fk' || f.target !== entity || f.auto || other.nest_under?.fk === f.name) continue;
      for (const r of liveRows(rec, other.entity)) {
        if (r[f.name] !== id) continue;
        r[f.name] = null;
        r._updated_at = a.now;
        r._updated_by = a.userId;
      }
    }
  }
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
        const stored = insert(rec, def.entity, c.id, row, a);
        // One-per-scope sections appear on their first value; only added rows and procedures are worth a line.
        if (def.cardinality === 'multi') {
          const p = placeOf(dict, rec, def.entity, stored);
          addHistory(rec, { kind: 'add', entity: def.entity, row_id: c.id, text: def.entity === 'EP_PROCEDURES' ? `${p.proc} added` : `${p.own} added${p.proc ? ` to ${p.proc}` : ''}` }, a);
        }
      } catch (e) {
        failedCreates.add(c.id);
        throw e;
      }
    }),
  );

  // Answers this batch clears (M-1: a change may make other answers not apply; they must be cleared with it).
  const clearing = new Set(
    (batch.changes ?? [])
      .filter((c) => c?.value === null || c?.value === '' || (Array.isArray(c?.value) && !c.value.length))
      .map((c) => {
        const r = findLive(rec, String(c.entity), String(c.id));
        return `${c.entity}.${c.field}@${r ? procedureOf(dict, String(c.entity), r) : ''}`;
      }),
  );

  (batch.changes ?? []).slice(0, 200).forEach((ch, i) =>
    run('change', i, () => {
      const def = dict.entities[ch?.entity];
      if (!def) throw new EditError('Unknown section.');
      if (failedCreates.has(ch.id)) throw new EditError(`${def.label}: the row could not be added.`);
      const row = findLive(rec, def.entity, String(ch.id));
      if (!row) throw new EditError(`${def.label}: this row was removed.`);
      const where = whereText(placeOf(dict, rec, def.entity, row));
      if (ch.field === 'other_specify_json') {
        const key = String(ch.key ?? '');
        const before = (decodeValue(def.fields.find((f) => f.name === 'other_specify_json')!, row.other_specify_json) as Record<string, string> | null)?.[key] ?? null;
        row.other_specify_json = mergeOtherSpecify(def, row, key, ch.value);
        const after = (decodeValue(def.fields.find((f) => f.name === 'other_specify_json')!, row.other_specify_json) as Record<string, string> | null)?.[key] ?? null;
        if (before !== after) addHistory(rec, { kind: 'edit', entity: def.entity, row_id: row._id, field: key, text: 'other', where, old: before, new: after }, a);
      } else {
        const f = def.fields.find((x) => x.name === ch.field);
        const before = f ? decodeValue(f, row[ch.field]) : null;
        const encoded = encodeFor(dict, rec, def, row, ch.field, ch.value, userIds);
        checkRules(dict, rec, def, row, ch.field, decodeValue(f!, encoded), clearing);
        row[ch.field] = encoded;
        afterChange(def, row, ch.field);
        const after = decodeValue(f!, row[ch.field]);
        if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) addHistory(rec, { kind: 'edit', entity: def.entity, row_id: row._id, field: ch.field, where, old: before, new: after }, a);
        // Checked by a person: no longer marked as copied, nor as an AI value waiting for review.
        if (rec.copied) delete rec.copied[`${def.entity}.${ch.field}`];
        if (rec.ai) delete rec.ai[`${def.entity}|${row._id}|${ch.field}`];
        // A value replaces "Not available" (EP Workspace: entering a value later replaces it).
        if (hasValue(after) && rec.not_available) delete rec.not_available[naKey(def.entity, ch.field, procedureOf(dict, def.entity, row))];
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
      const row = findLive(rec, def.entity, String(r.id));
      if (!row) return;
      const p = placeOf(dict, rec, def.entity, row);
      removeRow(dict, rec, def.entity, row._id, a);
      if (def.entity === 'EP_PROCEDURES') {
        for (const k of Object.keys(rec.not_available ?? {})) if (k.endsWith(`@${row._id}`)) delete rec.not_available![k];
        if (rec.picked_items) delete rec.picked_items[row._id];
      }
      const what = def.entity === 'EP_PROCEDURES' ? `${p.proc} removed` : def.cardinality === 'single' ? `${def.label} section cleared${p.proc ? ` in ${p.proc}` : ''}` : `${p.own} removed${p.proc ? ` from ${p.proc}` : ''}`;
      addHistory(rec, { kind: 'remove', entity: def.entity, row_id: row._id, text: what }, a);
    }),
  );

  (batch.additional ?? []).slice(0, 20).forEach((e, i) =>
    run('additional', i, () => {
      const cur = rec.additional.find((x) => x.info_id === e.id && !x.is_deleted);
      const before = cur ? { text: cur.text, fact_date: cur.fact_date } : null;
      applyAdditional(rec, e, a);
      const after = rec.additional.find((x) => x.info_id === e.id && !x.is_deleted);
      if (!before && after) addHistory(rec, { kind: 'add', text: 'Additional information added', new: after.text }, a);
      else if (before && !after) addHistory(rec, { kind: 'remove', text: 'Additional information removed', old: before.text }, a);
      else if (before && after && (before.text !== after.text || before.fact_date !== after.fact_date)) addHistory(rec, { kind: 'edit', row_id: e.id, field: 'text', text: 'Additional information', old: before.text, new: after.text }, a);
    }),
  );

  (batch.not_available ?? []).slice(0, 50).forEach((n, i) => run('na', i, () => applyNotAvailable(dict, rec, n, a)));
  (batch.picked_items ?? []).slice(0, 50).forEach((p, i) => run('items', i, () => applyPickedItems(rec, p)));

  if (results.some((r) => r.ok)) {
    applyDerived(dict, rec, a);
    rec.meta.updated_at = a.now;
    rec.meta.updated_by = a.userId;
    rec.meta.row_version++;
    rec.meta.collector_user_id ??= a.userId;
  }
  return results;
}

/** Values the app fills by itself (shared/derive.ts), stored after each save with a history line like any edit.
 *  They skip the form checks (several of these fields are hidden) but still go through the dictionary codes. */
export function applyDerived(dict: Dictionary, rec: CaseRecord, a: Actor) {
  const season = dict.layout.form?.hajj_season;
  if (!season) return;
  const ctx = { caseId: rec.meta.case_id, episodeId: rec.meta.episode_id, patientId: rec.meta.patient_id, slot: (e: string, s: string) => expectedSlot(dict, e, s), season };
  // One value may lead to another (an AF section's type → the diagnosis subtype); a few passes settle it.
  for (let pass = 0; pass < 3; pass++) {
    const decoded = decodeRows(dict, rec);
    const changes = deriveChanges(dict, (e) => decoded[e] ?? [], ctx);
    if (!changes.length) return;
    for (const ch of changes) {
      const def = dict.entities[ch.entity];
      const f = def.fields.find((x) => x.name === ch.field)!;
      const row = findLive(rec, ch.entity, ch.id) ?? (ch.create ? ensureSingleRow(dict, rec, ch.entity, ch.create.parent_id, a) : undefined);
      if (!row) continue;
      const before = decodeValue(f, row[ch.field]);
      try {
        row[ch.field] = encodeValue(f, ch.value, row);
      } catch {
        continue; // a value the dictionary refuses is never stored
      }
      afterChange(def, row, ch.field);
      row._updated_at = a.now;
      row._updated_by = a.userId;
      const after = decodeValue(f, row[ch.field]);
      // Links the app keeps are not worth a history line; filled answers are.
      if (f.type !== 'fk' && JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) addHistory(rec, { kind: 'edit', entity: def.entity, row_id: row._id, field: ch.field, where: whereText(placeOf(dict, rec, def.entity, row)), old: before, new: after }, a);
    }
  }
}

const ITEM_IDS = new Set(PROCEDURE_ITEMS.map((x) => x.id));

/** The ticked "What was done?" items of one procedure (operational, owner 30 Oct): known item ids only, the whole
 *  list each time, so the last save wins. No history line: the components the items add have their own. */
function applyPickedItems(rec: CaseRecord, p: PickedItemsEdit) {
  const pid = String(p?.procedure_id ?? '');
  if (!Array.isArray(p?.items) || p.items.length > PROCEDURE_ITEMS.length || p.items.some((x) => typeof x !== 'string' || !ITEM_IDS.has(x))) throw new EditError('What was done: unknown item.');
  if (!(rec.rows.EP_PROCEDURES ?? []).some((r) => r._id === pid)) throw new EditError('What was done: unknown procedure.');
  if (!findLive(rec, 'EP_PROCEDURES', pid)) return; // removed meanwhile: nothing to keep
  const items = PROCEDURE_ITEMS.map((x) => x.id).filter((x) => p.items.includes(x));
  const all = (rec.picked_items ??= {});
  if (items.length) all[pid] = items;
  else delete all[pid];
}

/** "Not available" + reason on an empty core field, or clear it (reason null). */
function applyNotAvailable(dict: Dictionary, rec: CaseRecord, n: NaEdit, a: Actor) {
  const def = dict.entities[n?.entity];
  const f = def?.fields.find((x) => x.name === n.field);
  if (!def || !f) throw new EditError('Unknown field.');
  const pid = isProcedureLevel(dict, def.entity) ? (n.procedure_id ?? null) : null;
  if (isProcedureLevel(dict, def.entity) && (!pid || !findLive(rec, 'EP_PROCEDURES', pid))) throw new EditError(`${f.label}: choose the procedure first.`);
  const key = naKey(def.entity, f.name, pid);
  const na = (rec.not_available ??= {});
  const where = pid ? whereText(placeOf(dict, rec, 'EP_PROCEDURES', findLive(rec, 'EP_PROCEDURES', pid)!)) : undefined;
  if (n.reason === null) {
    if (!na[key]) return;
    delete na[key];
    addHistory(rec, { kind: 'na', entity: def.entity, field: f.name, where, old: true, new: null }, a);
    return;
  }
  const reason = String(n.reason ?? '').trim().slice(0, 200);
  if (!reason) throw new EditError(`${f.label}: give a reason.`);
  const check = readinessOf(dict, rec).checks.find((c) => c.key === key);
  if (!check || check.state === 'not_applicable') throw new EditError(`${f.label}: "Not available" is only for core fields that apply to this case.`);
  if (!check.na_allowed) throw new EditError(`${f.label}: choose one of its answers.`);
  if (check.state === 'ok') throw new EditError(`${f.label} has a value. Clear it first.`);
  if (na[key]?.reason === reason) return;
  na[key] = { reason, at: a.now, by: a.userId };
  addHistory(rec, { kind: 'na', entity: def.entity, field: f.name, where, new: reason }, a);
}

export function readinessOf(dict: Dictionary, rec: CaseRecord): Readiness {
  return evaluateReadiness(dict, decodeRows(dict, rec), rec.not_available ?? {}, rec.ai ?? {});
}

/** Mark completed: only when every core field has a value or "Not available". Never changes clinical values. */
export function completeCase(dict: Dictionary, rec: CaseRecord, a: Actor): Readiness {
  const r = readinessOf(dict, rec);
  if (rec.meta.collection_status === 'COMPLETED' || !r.canComplete) return r;
  Object.assign(rec.meta, { collection_status: 'COMPLETED', completed_at: a.now, completed_by: a.userId, updated_at: a.now, updated_by: a.userId, row_version: rec.meta.row_version + 1 });
  addHistory(rec, { kind: 'complete', text: `Marked completed (core ${r.done} of ${r.total})` }, a);
  return r;
}

/** Admin moves a case to another group (owner step 6): it takes the next number there; the old one stays in History. */
export function moveCase(rec: CaseRecord, to: { group_id: string; seq: number; from_label: string; to_label: string }, a: Actor) {
  Object.assign(rec.meta, { group_id: to.group_id, group_seq: to.seq, updated_at: a.now, updated_by: a.userId, row_version: rec.meta.row_version + 1 });
  addHistory(rec, { kind: 'move', text: `Moved from ${to.from_label} to ${to.to_label}` }, a);
}

export function reopenCase(rec: CaseRecord, reason: string, a: Actor) {
  Object.assign(rec.meta, { collection_status: 'IN_PROGRESS', completed_at: null, completed_by: null, reopen_reason: reason, updated_at: a.now, updated_by: a.userId, row_version: rec.meta.row_version + 1 });
  addHistory(rec, { kind: 'reopen', text: `Reopened — ${reason}` }, a);
}

/** History lines for the case page, newest first, with labels and values as shown on the forms. */
export function historyItems(dict: Dictionary, rec: CaseRecord, nameOf: (id: string) => string): HistoryItem[] {
  const show = (entity: string | undefined, field: string | undefined, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const f = entity ? dict.entities[entity]?.fields.find((x) => x.name === field) : undefined;
    return f ? displayValue(f, v) || '—' : String(v);
  };
  return (rec.history ?? [])
    .slice()
    .reverse()
    .map((h) => {
      const base = { at: h.at, by: nameOf(h.by), kind: h.kind };
      const def = h.entity ? dict.entities[h.entity] : undefined;
      const flabel = def?.fields.find((x) => x.name === h.field)?.label ?? h.field ?? '';
      const prefix = h.where ? `${h.where} · ` : '';
      if (h.kind === 'edit' && h.text === 'ai' && def) return { ...base, kind: 'ai' as const, text: `${prefix}${flabel} (AI, to review)`, old: show(h.entity, h.field, h.old), new: show(h.entity, h.field, h.new) };
      if (h.kind === 'edit' && h.text === 'other') return { ...base, text: `${prefix}${flabel}: Other — specify`, old: show(undefined, undefined, h.old), new: show(undefined, undefined, h.new) };
      if (h.kind === 'edit' && def) return { ...base, text: `${prefix}${flabel}`, old: show(h.entity, h.field, h.old), new: show(h.entity, h.field, h.new) };
      if (h.kind === 'edit') return { ...base, text: h.text ?? 'Changed', old: show(undefined, undefined, h.old), new: show(undefined, undefined, h.new) };
      if (h.kind === 'na') return { ...base, text: h.new ? `${prefix}${flabel}: Not available (${h.new})` : `${prefix}${flabel}: "Not available" cleared` };
      return { ...base, text: h.text ?? h.kind };
    });
}

/** The one-per-scope row of an entity (scope = the case, or a procedure), made if missing. */
export function ensureSingleRow(dict: Dictionary, rec: CaseRecord, entity: string, procedureId: string | null, a: Actor): StoredRow {
  const def = dict.entities[entity];
  if (entity === 'PATIENT_IDENTIFIERS' || entity === 'PATIENTS') return findLive(rec, entity, rec.meta.patient_id)!;
  if (entity === 'EP_EPISODES') return findLive(rec, entity, rec.meta.episode_id)!;
  if (entity === 'EP_PROCEDURES') return findLive(rec, entity, procedureId!)!;
  const id = expectedSlot(dict, entity, def.scope === 'procedure' ? procedureId! : rec.meta.case_id);
  return findLive(rec, entity, id) ?? insert(rec, entity, id, placeRow(dict, rec, def, id, def.scope === 'procedure' ? procedureId : null, a), a);
}

/** A new repeatable row (in a procedure for procedure sections). */
export function addNewRow(dict: Dictionary, rec: CaseRecord, entity: string, procedureId: string | null, a: Actor): StoredRow {
  const def = dict.entities[entity];
  const id = newRowId(def);
  const row = insert(rec, entity, id, placeRow(dict, rec, def, id, def.scope === 'procedure' || entity === 'EP_PROCEDURES' ? (entity === 'EP_PROCEDURES' ? null : procedureId) : null, a), a);
  const p = placeOf(dict, rec, entity, row);
  addHistory(rec, { kind: 'add', entity, row_id: id, text: entity === 'EP_PROCEDURES' ? `${p.proc} added (AI)` : `${p.own} added${p.proc ? ` to ${p.proc}` : ''} (AI)` }, a);
  return row;
}

/** Copies the configured history fields (case_layout copy_forward) from the same MRN's latest case into a new one.
 *  Ported from EP Workspace copyForward: values stay as stored; each copied field is marked with `note` until a
 *  person edits it. Returns the number of values copied. */
export function copyForward(dict: Dictionary, rec: CaseRecord, src: CaseRecord, note: string, a: Actor): number {
  let n = 0;
  for (const def of Object.values(dict.entities)) {
    if (!def.copy_forward?.length) continue;
    const from = liveRows(src, def.entity)[0];
    if (!from) continue;
    const fields = def.copy_forward.filter((x) => hasValue(from[x]));
    if (!fields.length) continue;
    const id = def.entity === 'PATIENT_IDENTIFIERS' || def.entity === 'PATIENTS' ? rec.meta.patient_id : expectedSlot(dict, def.entity, rec.meta.case_id);
    let row = findLive(rec, def.entity, id);
    if (!row) row = insert(rec, def.entity, id, placeRow(dict, rec, def, id, null, a), a);
    for (const x of fields) {
      row[x] = from[x];
      (rec.copied ??= {})[`${def.entity}.${x}`] = note;
      n++;
    }
    if (from.other_specify_json && def.fields.some((x) => x.name === 'other_specify_json')) row.other_specify_json = mergeOtherSpecify(def, { ...row, other_specify_json: from.other_specify_json }, null, null);
  }
  if (n) addHistory(rec, { kind: 'add', text: `${n} history value${n === 1 ? '' : 's'} ${note.replace(/^Copied/, 'copied')} (same MRN)` }, a);
  return n;
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
        if (def.scope === 'procedure' && r.procedure_id) d.procedure_id = r.procedure_id;
        return d;
      });
  }
  return out;
}

export function toDetail(dict: Dictionary, rec: CaseRecord, groupName: string, users: { id: string; name: string }[], nameOf: (id: string) => string, followup: CaseSummary['followup'] = null): CaseDetail {
  return {
    meta: { ...rec.meta, group_name: groupName, completed_by_name: rec.meta.completed_by ? nameOf(rec.meta.completed_by) : null },
    rows: decodeRows(dict, rec),
    additional: rec.additional.filter((x) => !x.is_deleted),
    not_available: rec.not_available ?? {},
    copied: rec.copied ?? {},
    ai: rec.ai ?? {},
    picked_items: rec.picked_items ?? {},
    history_count: rec.history?.length ?? 0,
    users,
    summary: summarize(dict, rec, followup),
  };
}

/** "ENTITY.field=CODE" of the sidebar fields (shared/categories.ts), by procedure id ("" = case level). */
function categoryCodes(dict: Dictionary, rec: CaseRecord): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const path of CATEGORY_FIELDS) {
    const [entity, name] = path.split('.');
    const f = dict.entities[entity]?.fields.find((x) => x.name === name);
    if (!f) continue;
    for (const r of liveRows(rec, entity)) {
      const v = decodeValue(f, r[name]);
      const pid = entity === 'EP_PROCEDURES' ? r._id : typeof r.procedure_id === 'string' ? r.procedure_id : '';
      for (const c of Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]) out.set(pid, [...(out.get(pid) ?? []), `${path}=${c}`]);
    }
  }
  return out;
}

export function summarize(dict: Dictionary, rec: CaseRecord, followup: CaseSummary['followup'] = null): CaseSummary {
  const ep = liveRows(rec, 'EP_EPISODES')[0];
  const ident = liveRows(rec, 'PATIENT_IDENTIFIERS')[0];
  const pat = liveRows(rec, 'PATIENTS')[0];
  const comps = liveRows(rec, 'PROCEDURE_COMPONENTS');
  const codes = categoryCodes(dict, rec);
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
      codes: codes.get(p._id) ?? [],
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
    core: (({ done, total }) => ({ done, total }))(readinessOf(dict, rec)),
    cha: (() => {
      const rows = decodeRows(dict, rec);
      return { shown: chaRelevant(rows), score: cha2ds2vasc(rows).score };
    })(),
    codes: codes.get('') ?? [],
    followup,
    // Shown and filtered only until a real procedure is added (owner step 6).
    planned_type: procedures.length ? null : (rec.meta.planned_type ?? null),
    updated_at: rec.meta.updated_at,
  };
}
