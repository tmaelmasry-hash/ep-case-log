// Server tests for phase 3: readiness for each procedure, "Not available", Completed / Reopen, case history,
// recycle bin, groups and the activity log. Synthetic MRNs (9990xxx) and synthetic accounts only.
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRouter, handleApi } from '../../server/api.ts';
import { makeContext } from '../../server/context.ts';
import { loadConfig } from '../../server/dictionary.ts';
import { expectedSlot, readinessOf } from '../../server/domain/cases.ts';
import type { Router } from '../../server/http.ts';
import { seedTestUsers } from '../../server/seed.ts';
import { MemoryStore } from '../../server/store/memory.ts';
import { idPrefix } from '../../shared/caseTypes.ts';
import { offeredCodes } from '../../shared/dictionary.ts';
import { naKey } from '../../shared/readiness.ts';

const PW = 'synthetic-pass-123';
const ORIGIN = 'http://app.test';
let app: Router;
let store: MemoryStore;
let clock: Date;
const { dict } = loadConfig();
const rid = (entity: string) => `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;

class Client {
  cookie = '';
  csrf = '';
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { host: 'app.test' };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      headers.origin = ORIGIN;
      if (this.csrf) headers['x-csrf-token'] = this.csrf;
    }
    const res = await handleApi(app, new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const c of res.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const data = await res.json();
    if (data?.csrf) this.csrf = data.csrf;
    return { status: res.status, data };
  }
  static async as(username: string) {
    const c = new Client();
    await c.call('POST', '/api/auth/login', { username, password: PW });
    return c;
  }
}

let groups: { group_id: string; name: string }[];

beforeEach(async () => {
  store = new MemoryStore();
  clock = new Date('2026-10-22T08:00:00Z');
  const ctx = makeContext({ sessionSecret: 'test-secret-0123456789-0123456789-abcdef', secureCookies: true }, store, () => clock);
  app = buildRouter(ctx);
  await seedTestUsers(store, PW, [
    { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
    { username: 'sara', name: 'Sara', role: 'MEMBER', groupIndex: [0] },
    { username: 'omar', name: 'Omar', role: 'MEMBER', groupIndex: [1] },
  ]);
  groups = (await store.listGroups()).sort((a, b) => a.sort_order - b.sort_order);
});

async function newCase(c: Client, mrn = '9990101', group = groups[0].group_id) {
  const r = await c.call('POST', '/api/cases', { group_id: group, mrn, episode_start_date: '2026-03-12' });
  expect(r.status).toBe(200);
  return r.data.case_id as string;
}

async function readiness(caseId: string) {
  return readinessOf(dict, (await store.getCase(caseId))!);
}

async function addProcedure(c: Client, caseId: string, components: string[]) {
  const pid = rid('EP_PROCEDURES');
  const creates = [{ entity: 'EP_PROCEDURES', id: pid }, ...components.map((t) => ({ entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: pid, values: { component_type: t } }))];
  const r = await c.call('PATCH', `/api/cases/${caseId}`, { creates });
  expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
  return pid;
}

/** A valid synthetic value for a field (first offered code; a fixed date; the minimum number). */
function sample(entity: string, field: string, row: Record<string, unknown>): unknown {
  const f = dict.entities[entity].fields.find((x) => x.name === field)!;
  if (entity === 'EXT_PROCEDURE_REVIEW' && field === 'complications_reviewed') return 'NONE_DOCUMENTED';
  if (entity === 'EP_EPISODES' && field === 'pilgrim_status') return 'NON_PILGRIM';
  if (entity === 'ECHO_STUDIES' && field === 'lvef_assessment') return 'NOT_REPORTED';
  if (f.type === 'boolean') return true;
  if (f.type === 'date') return '2026-03-12';
  if (f.type === 'datetime') return '2026-03-12T10:00';
  if (f.type === 'integer' || f.type === 'decimal') return f.min ?? 1;
  if (f.type === 'lookup_array') return [f.codes![0].code];
  if (f.codes) return offeredCodes(f, row)[0];
  return 'synthetic';
}

/** Fills every missing core field the readiness check lists, the way the forms would. */
async function fillCore(c: Client, caseId: string) {
  for (let round = 0; round < 5; round++) {
    const rec = (await store.getCase(caseId))!;
    const r = readinessOf(dict, rec);
    const missing = r.checks.filter((x) => x.state === 'missing');
    if (!missing.length) return;
    const creates: unknown[] = [];
    const changes: unknown[] = [];
    for (const m of missing) {
      const def = dict.entities[m.entity];
      let id: string;
      if (m.entity === 'PATIENTS' || m.entity === 'PATIENT_IDENTIFIERS') id = rec.meta.patient_id;
      else if (m.entity === 'EP_EPISODES') id = rec.meta.episode_id;
      else if (m.entity === 'EP_PROCEDURES') id = m.procedure_id!;
      else if (def.cardinality === 'single') id = expectedSlot(dict, m.entity, m.procedure_id ?? caseId);
      else id = (rec.rows[m.entity] ?? []).find((x) => !x._deleted && (!m.procedure_id || x.procedure_id === m.procedure_id))?._id ?? rid(m.entity);
      const exists = (rec.rows[m.entity] ?? []).some((x) => x._id === id) || creates.some((x) => (x as { id: string }).id === id);
      if (!exists) creates.push({ entity: m.entity, id, parent_id: def.scope === 'procedure' ? m.procedure_id : null });
      const row = (rec.rows[m.entity] ?? []).find((x) => x._id === id) ?? {};
      changes.push({ entity: m.entity, id, field: m.field, value: sample(m.entity, m.field, row) });
    }
    const res = await c.call('PATCH', `/api/cases/${caseId}`, { creates, changes });
    const bad = res.data.results.filter((x: { ok: boolean }) => !x.ok);
    expect(bad).toEqual([]);
  }
}

describe('readiness for each procedure', () => {
  it('case items are checked once; procedure items and component categories for each procedure', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    let r = await readiness(id);
    expect(r.checks.every((c) => c.procedure_id === null)).toBe(true);
    expect(r.checks.find((c) => c.key === 'PATIENT_IDENTIFIERS.mrn')!.state).toBe('ok');
    expect(r.checks.find((c) => c.key === 'EP_EPISODES.episode_start_date')!.state).toBe('ok');
    expect(r.checks.find((c) => c.key === 'EP_EPISODES.hajj_timing')!.state).toBe('not_applicable');

    const eps = await addProcedure(sara, id, ['DIAGNOSTIC_EPS']);
    const af = await addProcedure(sara, id, ['AF', 'FLUTTER']);
    r = await readiness(id);
    const common = dict.coreSpec.common.filter((x) => x.entity === 'EP_PROCEDURES' || dict.entities[x.entity].scope === 'procedure').length;
    const afItems = (dict.coreSpec.categories.AF_ABLATION as unknown[]).length;
    expect(r.byProcedure[eps].total).toBe(common);
    expect(r.byProcedure[af].total).toBe(common + afItems);
    expect(r.checks.filter((c) => c.entity === 'AF_ABLATIONS').every((c) => c.procedure_id === af)).toBe(true);
    expect(r.canComplete).toBe(false);
  });

  it('device procedures add the device items; the case device is checked once', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p1 = await addProcedure(sara, id, ['DEVICE_IMPLANT']);
    const p2 = await addProcedure(sara, id, ['LEAD_MANAGEMENT']);
    const r = await readiness(id);
    expect(r.checks.filter((c) => c.key === 'DEVICES.current_device_type')).toHaveLength(1);
    expect(r.checks.filter((c) => c.entity === 'DEVICE_IMPLANTS' && c.field === 'device_action').map((c) => c.procedure_id).sort()).toEqual([p1, p2].sort());
    // ICD prevention type only applies once the device is an ICD.
    expect(r.checks.find((c) => c.field === 'icd_prevention_type' && c.procedure_id === p1)!.state).toBe('not_applicable');
  });
});

describe('Not available', () => {
  it('needs a reason, only on empty applicable core fields; a value replaces it', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const af = await addProcedure(sara, id, ['AF']);
    const na = (entity: string, field: string, reason: string | null, procedure_id: string | null = af) => sara.call('PATCH', `/api/cases/${id}`, { not_available: [{ entity, field, procedure_id, reason }] });

    let res = await na('AF_ABLATIONS', 'la_laa_thrombus_status', 'Not documented in the record');
    expect(res.data.results[0].ok).toBe(true);
    expect(res.data.case.not_available[naKey('AF_ABLATIONS', 'la_laa_thrombus_status', af)].reason).toBe('Not documented in the record');
    let r = await readiness(id);
    expect(r.checks.find((c) => c.key === naKey('AF_ABLATIONS', 'la_laa_thrombus_status', af))!.state).toBe('not_available');

    expect((await na('AF_ABLATIONS', 'acute_af_endpoint', '   ')).data.results[0].ok).toBe(false); // no reason
    expect((await na('AF_ABLATIONS', 'fluoroscopy_time_min', 'Test not done')).data.results[0].ok).toBe(false); // not core
    expect((await na('EXT_PROCEDURE_REVIEW', 'complications_reviewed', 'Not documented in the record')).data.results[0].ok).toBe(false); // must be answered
    expect((await na('EP_EPISODES', 'hajj_timing', 'Not documented in the record', null)).data.results[0].ok).toBe(false); // not applicable
    expect((await na('AF_ABLATIONS', 'acute_af_endpoint', 'Test not done', null)).data.results[0].ok).toBe(false); // procedure needed

    // A field with a value cannot be "not available"; entering a value clears an earlier "not available".
    const slot = expectedSlot(dict, 'AF_ABLATIONS', af);
    const thrombus = dict.entities.AF_ABLATIONS.fields.find((f) => f.name === 'la_laa_thrombus_status')!.codes![0].code;
    res = await sara.call('PATCH', `/api/cases/${id}`, { creates: [{ entity: 'AF_ABLATIONS', id: slot, parent_id: af }], changes: [{ entity: 'AF_ABLATIONS', id: slot, field: 'la_laa_thrombus_status', value: thrombus }] });
    expect(res.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect(res.data.case.not_available[naKey('AF_ABLATIONS', 'la_laa_thrombus_status', af)]).toBeUndefined();
    expect((await na('AF_ABLATIONS', 'la_laa_thrombus_status', 'Test not done')).data.results[0].ok).toBe(false);

    // Clearing, and removing the procedure removes its "not available" entries.
    await na('AF_ABLATIONS', 'acute_af_endpoint', 'Record not accessible');
    expect((await na('AF_ABLATIONS', 'acute_af_endpoint', null)).data.case.not_available[naKey('AF_ABLATIONS', 'acute_af_endpoint', af)]).toBeUndefined();
    await na('AF_ABLATIONS', 'acute_af_endpoint', 'Record not accessible');
    res = await sara.call('PATCH', `/api/cases/${id}`, { removes: [{ entity: 'EP_PROCEDURES', id: af }] });
    expect(Object.keys(res.data.case.not_available)).toEqual([]);
    r = await readiness(id);
    expect(r.byProcedure[af]).toBeUndefined();
  });

  it('date of birth "not available" is a warning, never a blocker', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    await sara.call('PATCH', `/api/cases/${id}`, { not_available: [{ entity: 'PATIENT_IDENTIFIERS', field: 'date_of_birth', reason: 'Record not accessible' }] });
    const r = await readiness(id);
    expect(r.warnings.map((w) => w.field)).toEqual(['date_of_birth']);
    expect(r.blockers.some((b) => b.field === 'date_of_birth')).toBe(false);
  });
});

describe('Completed and Reopen', () => {
  it('completes only when every core field is done; read only until reopened with a reason', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const af = await addProcedure(sara, id, ['AF']);
    let res = await sara.call('POST', `/api/cases/${id}/complete`, {});
    expect(res.status).toBe(409);
    expect(res.data.error.code).toBe('NOT_READY');

    await fillCore(sara, id);
    expect((await readiness(id)).canComplete).toBe(true);
    const before = (await store.getCase(id))!.meta.row_version;
    expect((await sara.call('POST', `/api/cases/${id}/complete`, { row_version: before - 1 })).status).toBe(409); // stale
    res = await sara.call('POST', `/api/cases/${id}/complete`, { row_version: before });
    expect(res.status).toBe(200);
    expect(res.data.case.meta.collection_status).toBe('COMPLETED');
    expect(res.data.case.meta.completed_by_name).toBe('Sara');
    expect((await sara.call('GET', '/api/cases')).data.cases[0].collection_status).toBe('COMPLETED');

    // Read only: edits and "not available" are refused.
    res = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: af, field: 'urgency', value: 'URGENT' }] });
    expect(res.status).toBe(409);
    expect(res.data.error.code).toBe('CASE_COMPLETED');

    expect((await sara.call('POST', `/api/cases/${id}/reopen`, { reason: '  ' })).status).toBe(400);
    res = await sara.call('POST', `/api/cases/${id}/reopen`, { reason: 'Discharge date was wrong' });
    expect(res.status).toBe(200);
    expect(res.data.case.meta.collection_status).toBe('IN_PROGRESS');
    expect(res.data.case.meta.reopen_reason).toBe('Discharge date was wrong');
    res = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: af, field: 'urgency', value: 'URGENT' }] });
    expect(res.data.results[0].ok).toBe(true);
  });

  it('complications present need one complication with category, relatedness and outcome', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p = await addProcedure(sara, id, ['DIAGNOSTIC_EPS']);
    await fillCore(sara, id);
    const review = expectedSlot(dict, 'EXT_PROCEDURE_REVIEW', p);
    await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EXT_PROCEDURE_REVIEW', id: review, field: 'complications_reviewed', value: 'PRESENT' }] });
    let r = await readiness(id);
    expect(r.canComplete).toBe(false);
    expect(r.blockers[0].text).toMatch(/at least one complication/);
    const cid = rid('COMPLICATIONS');
    await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [{ entity: 'COMPLICATIONS', id: cid, parent_id: p }],
      changes: [
        { entity: 'COMPLICATIONS', id: cid, field: 'category', value: 'PERICARDIAL_EFFUSION' },
        { entity: 'COMPLICATIONS', id: cid, field: 'relatedness', value: 'PROBABLE' },
        { entity: 'COMPLICATIONS', id: cid, field: 'outcome', value: 'RESOLVED' },
      ],
    });
    r = await readiness(id);
    expect(r.canComplete).toBe(true);
  });
});

describe('case history', () => {
  it('keeps who, when and before → after; typing in one field within two minutes is one line', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p = await addProcedure(sara, id, ['AF']);
    const edit = (value: unknown) => sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'fluoroscopy_time_min', value }] });
    expect((await edit('15')).data.results[0].ok).toBe(true);
    clock = new Date(clock.getTime() + 10 * 60_000);
    await edit('1');
    clock = new Date(clock.getTime() + 20_000);
    await edit('12.5');
    await sara.call('PATCH', `/api/cases/${id}`, { not_available: [{ entity: 'AF_ABLATIONS', field: 'acute_af_endpoint', procedure_id: p, reason: 'Not documented in the record' }] });

    const res = await sara.call('GET', `/api/cases/${id}/history`);
    expect(res.status).toBe(200);
    const items = res.data.items as { kind: string; text: string; old?: string; new?: string; by: string }[];
    expect(items[0]).toMatchObject({ kind: 'na', text: 'Procedure 1 · Acute AF endpoint: Not available (Not documented in the record)', by: 'Sara' });
    const edits = items.filter((x) => x.kind === 'edit');
    expect(edits.map((x) => [x.old, x.new])).toEqual([
      ['15 min', '12.5 min'],
      ['—', '15 min'],
    ]);
    expect(items.some((x) => x.kind === 'add' && x.text === 'Component AF added to Procedure 1')).toBe(true);
    expect(items[items.length - 1]).toMatchObject({ kind: 'create', text: `Case created in ${groups[0].name} as No. 1` });
    expect((await sara.call('GET', `/api/cases/${id}`)).data.history_count).toBe(items.length);

    // Other groups cannot read it; the activity log never holds values.
    expect((await (await Client.as('omar')).call('GET', `/api/cases/${id}/history`)).status).toBe(404);
    const log = JSON.stringify(await store.listActivity());
    expect(log).not.toContain('12.5');
    expect(log).not.toContain('Not documented');
  });
});

describe('recycle bin', () => {
  it('a Member deletes; only an Admin lists and restores, with the old number', async () => {
    const sara = await Client.as('sara');
    const admin = await Client.as('admin');
    await newCase(sara, '9990101');
    const id = await newCase(sara, '9990102');
    expect((await sara.call('POST', `/api/cases/${id}/delete`, {})).status).toBe(200);
    expect((await sara.call('GET', '/api/recycle-bin')).status).toBe(403);
    expect((await sara.call('POST', `/api/cases/${id}/restore`, {})).status).toBe(403);
    const bin = (await admin.call('GET', '/api/recycle-bin')).data.cases;
    expect(bin).toEqual([expect.objectContaining({ case_id: id, mrn: '9990102', group_seq: 2, deleted_by: 'Sara' })]);
    expect((await admin.call('POST', `/api/cases/${id}/restore`, {})).status).toBe(200);
    expect((await admin.call('GET', '/api/recycle-bin')).data.cases).toEqual([]);
    const back = (await sara.call('GET', `/api/cases/${id}`)).data;
    expect(back.meta.group_seq).toBe(2);
    expect((await admin.call('POST', `/api/cases/${id}/restore`, {})).status).toBe(404);
  });
});

describe('groups', () => {
  it('Admin adds and renames groups; numbering starts at 1; names are unique', async () => {
    const admin = await Client.as('admin');
    const sara = await Client.as('sara');
    expect((await sara.call('POST', '/api/groups', { name: 'EP Fellows' })).status).toBe(403);
    const g = await admin.call('POST', '/api/groups', { name: '  EP   Fellows ' });
    expect(g.status).toBe(200);
    expect(g.data.name).toBe('EP Fellows');
    expect((await admin.call('POST', '/api/groups', { name: 'ep fellows' })).status).toBe(409);
    expect((await admin.call('POST', '/api/groups', { name: '' })).status).toBe(400);
    const id = await newCase(admin, '9990103', g.data.group_id);
    expect((await admin.call('GET', `/api/cases/${id}`)).data.meta.group_seq).toBe(1);
    expect((await admin.call('PATCH', `/api/groups/${g.data.group_id}`, { name: 'Fellows' })).status).toBe(200);
    expect((await sara.call('PATCH', `/api/groups/${g.data.group_id}`, { name: 'X' })).status).toBe(403);
    const list = (await admin.call('GET', '/api/groups')).data.groups;
    expect(list.find((x: { group_id: string }) => x.group_id === g.data.group_id)).toMatchObject({ name: 'Fellows', cases: 1, next_seq: 2 });
    // Members see only their own groups.
    expect((await sara.call('GET', '/api/groups')).data.groups.map((x: { name: string }) => x.name)).toEqual([groups[0].name]);
  });
});

describe('activity log', () => {
  it('Admin only; field names, never values; one line per person and case within two minutes', async () => {
    const sara = await Client.as('sara');
    const admin = await Client.as('admin');
    const id = await newCase(sara);
    const p = await addProcedure(sara, id, ['AF']);
    await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'urgency', value: 'URGENT' }] });
    await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'care_setting', value: 'INPATIENT' }] });
    expect((await sara.call('GET', '/api/admin/activity')).status).toBe(403);
    const items = (await admin.call('GET', '/api/admin/activity')).data.items as { kind: string; mrn: string | null; details: string; actor: string }[];
    const edit = items.find((x) => x.kind === 'EDIT')!;
    expect(edit).toMatchObject({ mrn: '9990101', actor: 'Sara' });
    expect(edit.details).toContain('Urgency');
    expect(edit.details).toContain('Care setting');
    expect(edit.details).not.toContain('URGENT');
    expect(items.filter((x) => x.kind === 'EDIT' || x.kind === 'ADD')).toHaveLength(1);
    expect(items.some((x) => x.kind === 'NEW CASE')).toBe(true);
    expect(items.some((x) => x.kind === 'SIGN IN' && x.actor === 'Test Admin')).toBe(true);
  });
});
