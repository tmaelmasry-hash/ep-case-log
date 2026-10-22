import type { Activity, ActivityInput, Group, RegistryStore, User } from './types.ts';

export interface StoreData {
  users: User[];
  groups: Group[];
  activity: Activity[];
}

export function emptyData(): StoreData {
  return { users: [], groups: [], activity: [] };
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

  async appendActivity(entries: ActivityInput[]) {
    let id = this.data.activity.length ? this.data.activity[this.data.activity.length - 1].activity_id : 0;
    const at = new Date().toISOString();
    for (const e of entries) this.data.activity.push({ ...this.clone(e), activity_id: ++id, at });
    await this.persist();
  }

  async listActivity() {
    return this.clone(this.data.activity);
  }
}
