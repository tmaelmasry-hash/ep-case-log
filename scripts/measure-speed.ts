// Times sign-in, list, open and one field save against a running local server on the TEST Sheet (synthetic data only).
//   node scripts/measure-speed.ts [http://localhost:8787]
// Uses the TEST admin from data/test-admin-password.txt. Edits one field of the first case (Urgency, toggled).
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8787';
const pw = /TEST Sheet only\): (\S+)/.exec(readFileSync('data/test-admin-password.txt', 'utf8'))?.[1];
if (!pw) throw new Error('no TEST admin password in data/test-admin-password.txt');
let cookie = '';
let csrf = '';

async function call(method: string, path: string, body?: unknown) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', origin: base, cookie, ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.csrf === 'string') csrf = data.csrf;
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return { data, ms };
}

const login = await call('POST', '/api/auth/login', { username: 'admin', password: pw });
const list = await call('GET', '/api/cases');
const list2 = await call('GET', '/api/cases');
const cases = list.data.cases as { case_id: string }[];
if (!cases.length) throw new Error('no cases on the TEST Sheet');
const open = await call('GET', `/api/cases/${cases[0].case_id}`);
const d = open.data as { meta: { episode_id: string }; rows: Record<string, { _id: string; urgency?: string }[]> };
const proc = d.rows.EP_PROCEDURES?.[0];
let save = { ms: NaN };
if (proc) {
  const urgency = proc.urgency === 'URGENT' ? 'ELECTIVE' : 'URGENT';
  save = await call('PATCH', `/api/cases/${cases[0].case_id}`, { changes: [{ entity: 'EP_PROCEDURES', id: proc._id, field: 'urgency', value: urgency }] });
}
const save2 = proc ? await call('PATCH', `/api/cases/${cases[0].case_id}`, { changes: [{ entity: 'EP_PROCEDURES', id: proc._id, field: 'urgency', value: proc.urgency ?? null }] }) : { ms: NaN };
console.log(JSON.stringify({ cases: cases.length, login: login.ms, list: list.ms, list_again: list2.ms, open: open.ms, save: save.ms, save_again: save2.ms }));
