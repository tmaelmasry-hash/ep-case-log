// Google Sheet layout (phase 4; idea from EP Workspace server/store/sheet-layout.ts, adapted to case = episode with
// several procedures). Cases tab = one row per case (key columns). Every dictionary row is one row of its tab,
// columns named `ENTITY__field` from the dictionary (nothing invented). Pure: Node and the Worker both use it.
import type { Dictionary } from '../../shared/dictionary.ts';

/** Tab → the dictionary entities whose rows it holds. Every entity must be in exactly one tab. */
export const ENTITY_TABS: Record<string, string[]> = {
  Patient: ['PATIENT_IDENTIFIERS', 'PATIENTS'],
  Episode: ['EP_EPISODES', 'ARRHYTHMIA_INDICATIONS', 'CLINICAL_PROFILE_SNAPSHOTS'],
  Procedures: ['EP_PROCEDURES', 'EXT_PROCEDURE_REVIEW'],
  Components: ['PROCEDURE_COMPONENTS'],
  Ablation_EPS: ['DIAGNOSTIC_EPS', 'SVT_ABLATIONS', 'AF_ABLATIONS', 'FLUTTER_ABLATIONS', 'VENTRICULAR_ABLATIONS', 'AVJ_ABLATIONS'],
  Device_Procedures: ['DEVICE_IMPLANTS', 'DEVICE_IMPLANT_CHANNEL_MEASUREMENTS', 'CRT_CSP_PROCEDURES', 'ILR_PROCEDURES', 'LEAD_PROCEDURES', 'LEAD_PROCEDURE_ITEMS'],
  Complications: ['COMPLICATIONS'],
  ECG: ['ECG_STUDIES'],
  Labs: ['LAB_RESULTS'],
  Medications: ['MEDICATION_RECORDS'],
  Imaging: ['ECHO_STUDIES', 'RHYTHM_MONITORING', 'ADVANCED_IMAGING', 'CORONARY_ANGIOGRAPHY', 'TILT_TESTS'],
  Devices_Leads: ['DEVICES', 'DEVICE_LEADS', 'DEVICE_LEAD_CONNECTIONS', 'DEVICE_LEAD_STATUS_EVENTS', 'DEVICE_INTERROGATIONS', 'DEVICE_CHECK_CHANNELS', 'DEVICE_INFECTIONS'],
  FollowUp: ['FOLLOW_UPS', 'OUTCOME_EVENTS'],
};

/** Cases tab: the case key block (CaseMeta keys), the readiness summary, then JSON columns. */
export const CASE_COLUMNS = [
  'case_id', 'mrn', 'group_id', 'group_seq', 'collection_status', 'patient_id', 'episode_id',
  'created_at', 'created_by', 'updated_at', 'updated_by', 'row_version',
  'is_deleted', 'deleted_at', 'deleted_by', 'completed_at', 'completed_by', 'reopen_reason',
  'core_done', 'core_total', 'not_available_json', 'additional_json',
];
/** row_key = case_id/ENTITY/row_id: unique per tab. */
export const ROW_HEAD = ['row_key', 'row_id', 'case_id', 'record_type', 'procedure_id'];
export const ROW_TAIL = ['created_at', 'created_by', 'updated_at', 'updated_by', 'deleted'];
/** StoredRow bookkeeping keys ↔ tail columns. */
export const ROW_META: Record<string, string> = { _id: 'row_id', _created_at: 'created_at', _created_by: 'created_by', _updated_at: 'updated_at', _updated_by: 'updated_by', _deleted: 'deleted' };

export const SUPPORT_TABS: Record<string, string[]> = {
  History: ['id', 'case_id', 'at', 'by', 'kind', 'where', 'entity', 'field', 'row_id', 'old_json', 'new_json', 'text'],
  Users: ['user_id', 'username', 'display_name', 'role', 'status', 'groups', 'password_hash', 'must_change_password', 'session_epoch',
    'failed_logins', 'locked_until', 'created_at', 'created_by', 'updated_at', 'last_login_at'],
  Groups: ['group_id', 'name', 'sort_order', 'next_seq', 'is_deleted', 'created_at'],
  Activity: ['activity_id', 'at', 'actor', 'action', 'detail_json'],
};

export const col = (entity: string, field: string) => `${entity}__${field}`;

export interface SheetLayout {
  tabs: { name: string; headers: string[] }[];
  tabOf: Record<string, string>;
}

export function buildLayout(dict: Dictionary): SheetLayout {
  const tabOf: Record<string, string> = {};
  for (const [tab, list] of Object.entries(ENTITY_TABS)) {
    for (const e of list) {
      if (!dict.entities[e]) throw new Error(`Sheet layout: unknown entity ${e}`);
      if (tabOf[e]) throw new Error(`Sheet layout: ${e} is in two tabs`);
      tabOf[e] = tab;
    }
  }
  const missing = Object.keys(dict.entities).filter((e) => !tabOf[e]);
  if (missing.length) throw new Error(`Sheet layout: no tab for ${missing.join(', ')}`);
  const tabs = [{ name: 'Cases', headers: CASE_COLUMNS }];
  for (const [tab, list] of Object.entries(ENTITY_TABS)) {
    const fields = list.flatMap((e) => dict.entities[e].fields.map((f) => col(e, f.name)));
    tabs.push({ name: tab, headers: [...ROW_HEAD, ...fields, ...ROW_TAIL] });
  }
  for (const [name, headers] of Object.entries(SUPPORT_TABS)) tabs.push({ name, headers });
  return { tabs, tabOf };
}
