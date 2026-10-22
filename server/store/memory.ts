import type { CaseRecord } from '../../shared/caseTypes.ts';
import { applyPatch, diffCase } from './patch.ts';
import type { Activity, ActivityInput, Group, ImportJob, RegistryStore, User } from './types.ts';

export interface StoreData {
  users: User[];
  groups: Group[];
  activity: Activity[];
  cases: CaseRecord[];
  imports?: ImportJob[];
  settings?: Record<string, { value: unknown; updated_at: string; updated_by: string }>;
}

export function emptyData(): StoreData {
  return { users: [], groups: [], activity: [], cases: [] };
}

/** In-memory store (tests, throw-away runs). `persist` lets FileStore save after each write. */
export class MemoryStore implements RegistryStore {
  kind: 'memory' | 'file' = 'memory';
  protected data: StoreData;

  constructor(data: StoreData = emptyData()) {
    this.data = data;
  }

  protected async persist(): Promise<void> {}

  private clone<T>(x: T): T {
    return structuredClone(x);
  }

  async getUser(id: string) {
    const u = this.data.users.find((x) => x.user_id === id);
    return u ? this.clone(u) : null;
  }

  async findUserByUsername(username: string) {
    const u = this.data.users.find((x) => x.username === username);
    return u ? this.clone(u) : null;
  }

  async listUsers() {
    return this.clone(this.data.users);
  }

  async createUser(u: User) {
    if (this.data.users.some((x) => x.user_id === u.user_id || x.username === u.username)) throw new Error('duplicate user');
    this.data.users.push(this.clone(u));
    await this.persist();
  }

  async updateUser(id: string, patch: Partial<User>) {
    const u = this.data.users.find((x) => x.user_id === id);
    if (!u) return null;
    Object.assign(u, this.clone(patch), { user_id: u.user_id });
    await this.persist();
    return this.clone(u);
  }

  async listGroups() {
    return this.clone(this.data.groups);
  }

  async createGroup(g: Group) {
    this.data.groups.push(this.clone(g));
    await this.persist();
  }

  async updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'sort_order'>>) {
    const g = this.data.groups.find((x) => x.group_id === id);
    if (!g) return null;
    Object.assign(g, this.clone(patch));
    await this.persist();
    return this.clone(g);
  }

  async appendActivity(entries: ActivityInput[]) {
    let id = this.data.activity.length ? this.data.activity[this.data.activity.length - 1].activity_id : 0;
    const at = new Date().toISOString();
    for (const e of entries) this.data.activity.push({ ...this.clone(e), activity_id: ++id, at });
    await this.persist();
  }

  async listActivity() {
    return this.clone(this.data.activity);
  }

  async allocateSeq(groupId: string) {
    return this.allocateSeqs(groupId, 1);
  }

  async allocateSeqs(groupId: string, n: number) {
    const g = this.data.groups.find((x) => x.group_id === groupId);
    if (!g) throw new Error('unknown group');
    const seq = g.next_seq;
    g.next_seq += n;
    await this.persist();
    return seq;
  }

  async putNewCases(recs: CaseRecord[]) {
    for (const r of recs) this.data.cases.push(this.clone(r));
    await this.persist();
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const s = this.data.settings?.[key];
    return s ? (this.clone(s.value) as T) : fallback;
  }

  async setSetting(key: string, value: unknown, by: string) {
    (this.data.settings ??= {})[key] = { value: this.clone(value), updated_at: new Date().toISOString(), updated_by: by };
    await this.persist();
  }

  async claimImport(job: ImportJob) {
    const list = (this.data.imports ??= []);
    if (list.some((j) => j.idempotency_key === job.idempotency_key)) return false;
    list.push(this.clone(job));
    await this.persist();
    return true;
  }

  async getImport(by: { key?: string; id?: string }) {
    const j = (this.data.imports ?? []).find((x) => (by.key ? x.idempotency_key === by.key : x.import_job_id === by.id));
    return j ? this.clone(j) : null;
  }

  async saveImport(job: ImportJob) {
    const list = (this.data.imports ??= []);
    const i = list.findIndex((j) => j.import_job_id === job.import_job_id);
    if (i >= 0) list[i] = this.clone(job);
    else list.push(this.clone(job));
    await this.persist();
  }

  async listCases() {
    return this.clone(this.data.cases);
  }

  async getCase(id: string) {
    const c = this.data.cases.find((x) => x.meta.case_id === id);
    return c ? this.clone(c) : null;
  }

  async putCase(rec: CaseRecord, base?: CaseRecord | null) {
    const i = this.data.cases.findIndex((x) => x.meta.case_id === rec.meta.case_id);
    const next = base === undefined ? this.clone(rec) : applyPatch(i >= 0 ? this.data.cases[i] : null, this.clone(diffCase(base, rec)));
    if (i >= 0) this.data.cases[i] = next;
    else this.data.cases.push(next);
    await this.persist();
  }
}
