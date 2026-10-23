// Case shapes shared by server and browser. Case = one EP_EPISODE of one patient (owner D4), with any number of
// EP_PROCEDURES; rows of every dictionary entity live inside their case (as in EP Workspace P1a-3).
import type { NotAvailable, Tally } from './readiness.ts';

export type StoredRow = Record<string, unknown> & {
  _id: string;
  _deleted?: boolean;
  _created_at: string;
  _created_by: string;
  _updated_at: string;
  _updated_by: string;
};

export interface CaseMeta {
  case_id: string;
  patient_id: string;
  episode_id: string;
  mrn: string;
  group_id: string;
  group_seq: number;
  /** Data-collection status (exactly In progress / Completed). */
  collection_status: 'IN_PROGRESS' | 'COMPLETED';
  /** First person who edited the case (dashboard "by collector"). */
  collector_user_id?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  reopen_reason?: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  row_version: number;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface AdditionalInfo {
  info_id: string;
  text: string;
  fact_date: string | null;
  created_at: string;
  created_by: string;
  is_deleted: boolean;
}

/** One line of a case's own history: who, when, and the value before → after (shown only inside the case). */
export interface HistoryEntry {
  /** Stable id (stores update a merged line in place). Older entries may lack it. */
  id?: string;
  at: string;
  by: string;
  kind: 'create' | 'edit' | 'add' | 'remove' | 'na' | 'complete' | 'reopen' | 'delete' | 'restore' | 'ai';
  /** Where in the case, at the time of the change (e.g. "Procedure 2", "ECG 1"). */
  where?: string;
  entity?: string;
  field?: string;
  row_id?: string;
  old?: unknown;
  new?: unknown;
  text?: string;
}

export interface CaseRecord {
  meta: CaseMeta;
  rows: Record<string, StoredRow[]>;
  additional: AdditionalInfo[];
  /** naKey → reason (shared/readiness.ts). */
  not_available?: Record<string, NotAvailable>;
  history?: HistoryEntry[];
  /** "ENTITY.field" → where it was copied from (phase 5); removed when someone edits the field. */
  copied?: Record<string, string>;
  /** AI Assistant marks (phase 11): "ENTITY|row|field" = value filled by the AI, not yet accepted;
   *  "ENTITY|row|field#ai" = conflicting values for a person to choose; "ENTITY|row|*" = a row the AI added. */
  ai?: Record<string, AiMark>;
}

export interface AiMark {
  source: 'AI' | 'AI_CONFLICT';
  entity: string;
  record_id: string;
  field: string;
  /** Short quote from the note (the note itself is never kept). */
  evidence: string | null;
  proposed?: unknown[];
  evidences?: string[];
  /** Conflict for a row not made yet: the procedure it belongs to (procedure-level tables). */
  procedure_id?: string | null;
  at: string;
  by: string;
}

/** A row as the browser sees it: decoded values plus _id. */
export type DecodedRow = Record<string, unknown> & { _id: string };

export interface CaseDetail {
  meta: CaseMeta & { group_name: string; completed_by_name: string | null };
  rows: Record<string, DecodedRow[]>;
  additional: AdditionalInfo[];
  not_available: Record<string, NotAvailable>;
  copied: Record<string, string>;
  ai: Record<string, AiMark>;
  history_count: number;
  users: { id: string; name: string }[];
  /** The case's line in the case list, so the list follows each save without reloading. */
  summary: CaseSummary;
}

export interface HistoryItem {
  at: string;
  by: string;
  kind: HistoryEntry['kind'];
  text: string;
  old?: string;
  new?: string;
}

export interface ProcedureSummary {
  id: string;
  start: string | null;
  type: string | null;
  status: string | null;
  components: string[];
  /** "ENTITY.field=CODE" of this procedure's own rows, for the sidebar (CATEGORY_FIELDS in shared/categories.ts). */
  codes?: string[];
}

export interface CaseSummary {
  case_id: string;
  mrn: string;
  group_id: string;
  group_seq: number;
  collection_status: CaseMeta['collection_status'];
  episode_start_date: string | null;
  episode_end_date: string | null;
  sex: string | null;
  age: number | null;
  procedures: ProcedureSummary[];
  core: Tally;
  /** CHA₂DS₂-VASc display (never stored): shown for AF / flutter care; score null = incomplete. */
  cha: { shown: boolean; score: number | null };
  /** Case-level "ENTITY.field=CODE" (rows without a procedure), for the sidebar. */
  codes?: string[];
  /** A follow-up visit or device check due soon or overdue (config/site.json followup_due windows), for the sidebar. */
  followup?: 'DUE' | 'OVERDUE' | null;
  /** Custom cohorts (owner R2-12) the case belongs to: rule cohorts it meets and tag cohorts it was added to. */
  cohorts?: string[];
  updated_at: string;
}

export interface EditCreate {
  entity: string;
  id: string;
  parent_id?: string | null;
  values?: Record<string, unknown>;
}
export interface EditChange {
  entity: string;
  id: string;
  field: string;
  value: unknown;
  /** For field "other_specify_json": which field's "Other — specify" text. */
  key?: string;
}
export interface EditRemove {
  entity: string;
  id: string;
}
export interface AdditionalEdit {
  op: 'add' | 'set' | 'remove';
  id: string;
  text?: string;
  fact_date?: string | null;
}
/** Records (reason) or clears (null) "Not available" on an empty core field; procedure_id for procedure fields. */
export interface NaEdit {
  entity: string;
  field: string;
  procedure_id?: string | null;
  reason: string | null;
}
export interface EditBatch {
  creates?: EditCreate[];
  changes?: EditChange[];
  removes?: EditRemove[];
  additional?: AdditionalEdit[];
  not_available?: NaEdit[];
}
export interface EditResult {
  kind: 'create' | 'change' | 'remove' | 'additional' | 'na';
  i: number;
  ok: boolean;
  message?: string;
}

/** Id prefix for an entity's rows, from its primary key (e.g. af_ablation_id → afablation). */
export function idPrefix(pk: string): string {
  return pk.replace(/_id$/, '').replace(/[^a-z]/g, '');
}

export const ID_RE = /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Deterministic id for a one-per-scope row, so two first saves at the same moment create the same row (EP Workspace P1b-6). */
export function slotId(prefix: string, entity: string, scopeId: string): string {
  const s = `${entity}|${scopeId}`;
  const h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ (c + k * 31), 0x01000193 + k * 2) >>> 0;
  }
  const hex = h.map((x) => x.toString(16).padStart(8, '0')).join('');
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Whole years between two YYYY-MM-DD dates (derived for display; never stored). */
export function ageOn(dob: unknown, on: unknown): number | null {
  if (typeof dob !== 'string' || typeof on !== 'string' || dob.length < 10 || on.length < 10) return null;
  const [y1, m1, d1] = dob.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = on.slice(0, 10).split('-').map(Number);
  let a = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) a--;
  return a >= 0 && a < 130 ? a : null;
}
