// Shared test harness for server tests (phase 5 on): the API router over the test store, signed-in clients,
// synthetic accounts admin / sara / omar. Synthetic data only.
import { buildRouter, handleApi } from '../../server/api.ts';
import { makeContext } from '../../server/context.ts';
import { loadConfig } from '../../server/dictionary.ts';
import type { Router } from '../../server/http.ts';
import { seedTestUsers } from '../../server/seed.ts';
import type { Group, RegistryStore } from '../../server/store/types.ts';
import { idPrefix } from '../../shared/caseTypes.ts';
import { makeTestStore } from './storeFactory.ts';

export const PW = 'synthetic-pass-123';
const ORIGIN = 'http://app.test';
export const config = loadConfig();
export const { dict } = config;
export const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;

export interface Harness {
  app: Router;
  store: RegistryStore;
  groups: Group[];
  clock: { now: Date };
}

export class Client {
  cookie = '';
  csrf = '';
  h: Harness;
  constructor(h: Harness) {
    this.h = h;
  }
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { host: 'app.test' };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      headers.origin = ORIGIN;
      if (this.csrf) headers['x-csrf-token'] = this.csrf;
    }
    const res = await handleApi(this.h.app, new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const c of res.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    if ((data as { csrf?: string })?.csrf) this.csrf = (data as { csrf: string }).csrf;
    return { status: res.status, data: data as any, headers: res.headers };
  }
}

export async function harness(): Promise<Harness> {
  const store = await makeTestStore();
  const clock = { now: new Date('2026-10-22T08:00:00Z') };
  const app = buildRouter(makeContext({ sessionSecret: 'test-secret-0123456789-0123456789-abcdef', secureCookies: true }, store, config, () => clock.now));
  await seedTestUsers(store, PW, [
    { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
    { username: 'sara', name: 'Sara', role: 'MEMBER', groupIndex: [0] },
    { username: 'omar', name: 'Omar', role: 'MEMBER', groupIndex: [1] },
  ]);
  const groups = (await store.listGroups()).sort((a, b) => a.sort_order - b.sort_order);
  return { app, store, groups, clock };
}

export async function as(h: Harness, username: string) {
  const c = new Client(h);
  await c.call('POST', '/api/auth/login', { username, password: PW });
  return c;
}

export async function newCase(c: Client, mrn: string, group = c.h.groups[0].group_id, extra: Record<string, unknown> = {}) {
  const r = await c.call('POST', '/api/cases', { group_id: group, mrn, episode_start_date: '2026-03-12', ...extra });
  if (r.status !== 200) throw new Error(`create case: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { case_id: string; group_seq: number; copied: number; copied_from: string | null; case_of_mrn: number | null };
}

export async function edit(c: Client, id: string, batch: Record<string, unknown>) {
  const r = await c.call('PATCH', `/api/cases/${id}`, batch);
  if (r.status !== 200) throw new Error(`edit: ${r.status} ${JSON.stringify(r.data)}`);
  const bad = r.data.results.filter((x: { ok: boolean }) => !x.ok);
  if (bad.length) throw new Error(`edit failed: ${JSON.stringify(bad)}`);
  return r.data;
}
