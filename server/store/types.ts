import type { Role } from '../auth/capabilities.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';

export interface User {
  user_id: string;
  username: string;
  display_name: string;
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
  groups: string[];
  password_hash: string | null;
  must_change_password: boolean;
  /** Raised on role/status/password change: every session issued before it stops working. */
  session_epoch: number;
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  last_login_at: string | null;
}

export interface Group {
  group_id: string;
  name: string;
  sort_order: number;
  next_seq: number;
  is_deleted: boolean;
  created_at: string;
}

export interface ActivityInput {
  actor: string | null;
  action: string;
  detail?: unknown;
}
export interface Activity extends ActivityInput {
  activity_id: number;
  at: string;
}

/** One bulk add of MRNs (phase 6): claimed once by its idempotency key, then saved with its results. */
export interface ImportItem {
  position: number;
  mrn: string;
  outcome: 'ADDED' | 'REPEATED' | 'ALREADY_HERE' | 'INVALID';
  case_id: string | null;
  group_seq: number | null;
  message: string | null;
}
export interface ImportJob {
  import_job_id: string;
  idempotency_key: string;
  actor_user_id: string;
  group_id: string;
  list_fingerprint: string;
  status: 'RUNNING' | 'DONE';
  total_rows: number;
  added: number;
  created_at: string;
  finished_at: string | null;
  items: ImportItem[];
}

export interface CohortTag {
  cohort_id: string;
  case_id: string;
  on: boolean;
  updated_at: string;
  updated_by: string;
}

/** What an Excel export holds (EP Workspace P4): which tabs, columns never exported, and (group export) which cases. */
export interface ExportRequest {
  fileName: string;
  keepTabs: string[] | null;
  dropColumns: Record<string, string[]>;
  caseIds: string[] | null;
}
export interface ExportFile {
  file_name: string;
  base64: string;
  bytes: number;
  tabs: string[];
  cases: number;
}

/** Storage boundary: users, groups, activity, cases. The Google Sheet store implements the same interface in phase 4. */
export interface RegistryStore {
  readonly kind: 'memory' | 'file' | 'sheets';
  getUser(id: string): Promise<User | null>;
  findUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(u: User): Promise<void>;
  updateUser(id: string, patch: Partial<User>): Promise<User | null>;
  listGroups(): Promise<Group[]>;
  createGroup(g: Group): Promise<void>;
  updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'sort_order'>>): Promise<Group | null>;
  appendActivity(entries: ActivityInput[]): Promise<void>;
  listActivity(): Promise<Activity[]>;
  /** Next case number in a group (never reused). */
  allocateSeq(groupId: string): Promise<number>;
  /** Reserves n consecutive numbers; returns the first. */
  allocateSeqs(groupId: string, n: number): Promise<number>;
  listCases(): Promise<CaseRecord[]>;
  /** forEdit: a copy kept from a read or save in the last minute may be returned (the Sheet store); the save that
   *  follows checks row_version and throws StaleCaseError if someone saved the case in between. */
  getCase(id: string, opts?: { forEdit?: boolean }): Promise<CaseRecord | null>;
  /** Saves a case. With `base` (the case as this request read it, or null for a new case) only the cells that
   *  changed from base are written, so concurrent saves of different fields all survive. Without it: whole case.
   *  `activity` lines are written in the same Sheet call. */
  putCase(rec: CaseRecord, base?: CaseRecord | null, activity?: ActivityInput[]): Promise<void>;
  /** Saves several new cases at once (bulk add). */
  putNewCases(recs: CaseRecord[]): Promise<void>;
  /** Records a bulk add under its idempotency key; false when that key was already used. */
  claimImport(job: ImportJob): Promise<boolean>;
  getImport(by: { key?: string; id?: string }): Promise<ImportJob | null>;
  saveImport(job: ImportJob): Promise<void>;
  /** Site settings set in the app (AI provider choice, AI usage, cohort definitions). */
  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown, by: string): Promise<void>;
  /** Cases the Admin added to tag cohorts by hand (owner R2-12); `on: false` = taken out again. */
  listCohortTags(): Promise<CohortTag[]>;
  setCohortTag(cohortId: string, caseId: string, on: boolean, by: string): Promise<void>;
  /** The Google Sheet exports itself (Apps Script); local stores leave this out and the server builds the file. */
  exportXlsx?(req: ExportRequest): Promise<ExportFile>;
}

/** The case was saved by someone else after `base` was read (row_version moved): read it again and redo the edit. */
export class StaleCaseError extends Error {
  constructor() {
    super('STALE');
  }
}
