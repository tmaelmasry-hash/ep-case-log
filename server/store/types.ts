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

/** Storage boundary: users, groups, activity, cases. The Google Sheet store implements the same interface in phase 4. */
export interface RegistryStore {
  readonly kind: 'memory' | 'file';
  getUser(id: string): Promise<User | null>;
  findUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(u: User): Promise<void>;
  updateUser(id: string, patch: Partial<User>): Promise<User | null>;
  listGroups(): Promise<Group[]>;
  createGroup(g: Group): Promise<void>;
  appendActivity(entries: ActivityInput[]): Promise<void>;
  listActivity(): Promise<Activity[]>;
  /** Next case number in a group (never reused). */
  allocateSeq(groupId: string): Promise<number>;
  listCases(): Promise<CaseRecord[]>;
  getCase(id: string): Promise<CaseRecord | null>;
  /** Insert or replace a whole case. */
  putCase(rec: CaseRecord): Promise<void>;
}
