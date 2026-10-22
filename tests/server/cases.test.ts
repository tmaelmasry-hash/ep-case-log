// Server tests for phase 2 (case = episode with several procedures, dictionary validation, scope).
// Synthetic MRNs (9990xxx, outside the KAMC range) and synthetic accounts only.
import { beforeEach, describe, expect, it } from 'vitest';
import { buildRouter, handleApi } from '../../server/api.ts';
import { makeContext } from '../../server/context.ts';
import { loadConfig } from '../../server/dictionary.ts';
import { expectedSlot } from '../../server/domain/cases.ts';
import type { Router } from '../../server/http.ts';
import { seedTestUsers } from '../../server/seed.ts';
import { MemoryStore } from '../../server/store/memory.ts';
import { idPrefix, slotId, ID_RE } from '../../shared/caseTypes.ts';
import { formFields } from '../../shared/dictionary.ts';

const PW = 'synthetic-pass-123';
const ORIGIN = 'http://app.test';
let app: Router;
let store: MemoryStore;
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
  const ctx = makeContext({ sessionSecret: 'test-secret-0123456789-0123456789-abcdef', secureCookies: true }, store, () => new Date('2026-10-22T08:00:00Z'));
  app = buildRouter(ctx);
  await seedTestUsers(store, PW, [
    { username: 'admin', name: 'Test Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
    { username: 'sara', name: 'Sara', role: 'MEMBER', groupIndex: [0] },
    { username: 'omar', name: 'Omar', role: 'MEMBER', groupIndex: [1] },
  ]);
  groups = (await store.listGroups()).sort((a, b) => a.sort_order - b.sort_order);
});

async function newCase(c: Client, mrn = '1100001', group = groups[0].group_id, date = '2026-03-12') {
  const r = await c.call('POST', '/api/cases', { group_id: group, mrn, episode_start_date: date });
  expect(r.status).toBe(200);
  return r.data.case_id as string;
}

describe('dictionary', () => {
  it('loads all 37 dictionary entities plus the review extension, arranged for case = episode', () => {
    expect(Object.keys(dict.entities)).toHaveLength(38);
    expect(dict.entities.EP_PROCEDURES.cardinality).toBe('multi');
    expect(dict.entities.AF_ABLATIONS.scope).toBe('procedure');
    expect(dict.entities.AF_ABLATIONS.module).toEqual(['AF']);
    const fieldCount = Object.values(dict.entities).reduce((n, e) => n + e.fields.length, 0);
    expect(fieldCount).toBe(546); // 545 dictionary fields + complications_reviewed (extension)
  });
  it('never shows link, polymorphic or json fields on a form', () => {
    for (const e of Object.values(dict.entities)) {
      for (const f of formFields(e)) {
        expect(f.auto).not.toBe(true);
        expect(['json_object', 'fk_polymorphic']).not.toContain(f.type);
      }
    }
  });
  it('slot ids are stable and well-formed', () => {
    const a = slotId('afablation', 'AF_ABLATIONS', 'procedure_x');
    expect(a).toBe(slotId('afablation', 'AF_ABLATIONS', 'procedure_x'));
    expect(a).not.toBe(slotId('afablation', 'AF_ABLATIONS', 'procedure_y'));
    expect(ID_RE.test(a)).toBe(true);
  });
});

describe('create case', () => {
  it('creates the identity rows and one open episode; numbers per group', async () => {
    const admin = await Client.as('admin');
    const id = await newCase(admin);
    const r = await admin.call('GET', `/api/cases/${id}`);
    expect(r.data.meta.group_seq).toBe(1);
    expect(r.data.meta.collection_status).toBe('IN_PROGRESS');
    expect(r.data.rows.PATIENT_IDENTIFIERS[0].mrn).toBe('1100001');
    expect(r.data.rows.PATIENTS[0].registry_basis).toBe('CLINICAL_QI');
    expect(r.data.rows.PATIENTS[0].enrollment_date).toBe('2026-10-22');
    expect(r.data.rows.EP_EPISODES[0]).toMatchObject({ episode_start_date: '2026-03-12', episode_status: 'OPEN' });
    await newCase(admin, '1100002');
    const third = await admin.call('POST', '/api/cases', { group_id: groups[1].group_id, mrn: '1100003', episode_start_date: '2026-03-12' });
    expect(third.data.group_seq).toBe(1);
  });

  it('validates MRN (7 digits; Arabic digits normalised; unusual prefix warns) and date', async () => {
    const admin = await Client.as('admin');
    const bad = await admin.call('POST', '/api/cases', { group_id: groups[0].group_id, mrn: '12345', episode_start_date: '2026-03-12' });
    expect(bad.status).toBe(400);
    expect(bad.data.error.message).toBe('MRN must be exactly 7 digits.');
    const ar = await admin.call('POST', '/api/cases', { group_id: groups[0].group_id, mrn: '١١٠٠٠٠٥', episode_start_date: '2026-03-12' });
    expect(ar.status).toBe(200);
    expect((await admin.call('GET', `/api/cases/${ar.data.case_id}`)).data.meta.mrn).toBe('1100005');
    const warn = await admin.call('POST', '/api/cases', { group_id: groups[0].group_id, mrn: '9990001', episode_start_date: '2026-03-12' });
    expect(warn.data.warning).toMatch(/Unusual MRN prefix/);
    const future = await admin.call('POST', '/api/cases', { group_id: groups[0].group_id, mrn: '1100006', episode_start_date: '2026-12-01' });
    expect(future.data.error.details.field).toBe('episode_start_date');
  });

  it('cases of the same MRN share one patient id', async () => {
    const admin = await Client.as('admin');
    const a = await newCase(admin, '1100007');
    const b = await newCase(admin, '1100007', groups[1].group_id);
    const ra = (await admin.call('GET', `/api/cases/${a}`)).data;
    const rb = (await admin.call('GET', `/api/cases/${b}`)).data;
    expect(ra.meta.patient_id).toBe(rb.meta.patient_id);
    expect(ra.meta.episode_id).not.toBe(rb.meta.episode_id);
  });
});

describe('group scope', () => {
  it('a Member sees and opens only cases of their groups; others look like not found', async () => {
    const admin = await Client.as('admin');
    const inG1 = await newCase(admin, '1100010', groups[0].group_id);
    const inG2 = await newCase(admin, '1100011', groups[1].group_id);
    const sara = await Client.as('sara');
    const list = (await sara.call('GET', '/api/cases')).data.cases.map((c: { case_id: string }) => c.case_id);
    expect(list).toEqual([inG1]);
    expect((await sara.call('GET', `/api/cases/${inG2}`)).status).toBe(404);
    expect((await sara.call('PATCH', `/api/cases/${inG2}`, { changes: [] })).status).toBe(404);
    expect((await sara.call('POST', '/api/cases', { group_id: groups[1].group_id, mrn: '1100012', episode_start_date: '2026-03-12' })).status).toBe(403);
  });
});

describe('editing', () => {
  it('two procedures in one episode, each with its own components and modules', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p1 = rid('EP_PROCEDURES');
    const p2 = rid('EP_PROCEDURES');
    const r = await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [
        { entity: 'EP_PROCEDURES', id: p1 },
        { entity: 'EP_PROCEDURES', id: p2 },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p1, values: { component_type: 'DIAGNOSTIC_EPS' } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p2, values: { component_type: 'AF' } },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p2, values: { component_type: 'FLUTTER' } },
        { entity: 'AF_ABLATIONS', id: expectedSlot(dict, 'AF_ABLATIONS', p2), parent_id: p2 },
      ],
      changes: [
        { entity: 'EP_PROCEDURES', id: p1, field: 'primary_procedure_type', value: 'EPS' },
        { entity: 'EP_PROCEDURES', id: p1, field: 'procedure_start_datetime', value: '2026-03-12T10:00' },
        { entity: 'EP_PROCEDURES', id: p2, field: 'primary_procedure_type', value: 'ABLATION' },
        { entity: 'EP_PROCEDURES', id: p2, field: 'procedure_start_datetime', value: '2026-03-13T09:10' },
        { entity: 'AF_ABLATIONS', id: expectedSlot(dict, 'AF_ABLATIONS', p2), field: 'af_energy_source', value: 'PFA' },
      ],
    });
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    const rows = r.data.case.rows;
    expect(rows.EP_PROCEDURES).toHaveLength(2);
    expect(rows.EP_PROCEDURES.every((p: { episode_id: string }) => p.episode_id === r.data.case.meta.episode_id)).toBe(true);
    const comps = rows.PROCEDURE_COMPONENTS.filter((c: { procedure_id: string }) => c.procedure_id === p2);
    expect(comps.map((c: { component_sequence: number }) => c.component_sequence)).toEqual([1, 2]);
    expect(rows.AF_ABLATIONS[0]).toMatchObject({ procedure_id: p2, af_energy_source: 'PFA' });
    const list = (await sara.call('GET', '/api/cases')).data.cases[0];
    expect(list.procedures.map((p: { type: string; components: string[] }) => [p.type, p.components])).toEqual([
      ['EPS', ['DIAGNOSTIC_EPS']],
      ['ABLATION', ['AF', 'FLUTTER']],
    ]);
  });

  it('refuses values that are not dictionary codes, bad dates, numbers out of range, and read-only fields', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const ep = (await sara.call('GET', `/api/cases/${id}`)).data.meta.episode_id;
    const pat = (await sara.call('GET', `/api/cases/${id}`)).data.meta.patient_id;
    const r = await sara.call('PATCH', `/api/cases/${id}`, {
      changes: [
        { entity: 'EP_EPISODES', id: ep, field: 'pilgrim_status', value: 'MAYBE' },
        { entity: 'EP_EPISODES', id: ep, field: 'episode_end_date', value: '2026-02-30' },
        { entity: 'PATIENT_IDENTIFIERS', id: pat, field: 'mrn', value: '1199999' },
        { entity: 'EP_EPISODES', id: ep, field: 'pilgrim_status', value: 'HAJJ' },
        { entity: 'EP_EPISODES', id: ep, field: 'no_such_field', value: 'x' },
      ],
    });
    const res = r.data.results;
    expect(res[0]).toMatchObject({ ok: false });
    expect(res[0].message).toMatch(/not one of the allowed values/);
    expect(res[1].message).toMatch(/valid date/);
    expect(res[2].message).toMatch(/cannot be edited/);
    expect(res[3].ok).toBe(true);
    expect(res[4].ok).toBe(false);
    expect(r.data.case.rows.EP_EPISODES[0].pilgrim_status).toBe('HAJJ');
    expect(r.data.case.rows.PATIENT_IDENTIFIERS[0].mrn).toBe('1100001');
  });

  it('one-per-case sections need their fixed id; a repeated create adds nothing', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const wrong = await sara.call('PATCH', `/api/cases/${id}`, { creates: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: rid('CLINICAL_PROFILE_SNAPSHOTS') }] });
    expect(wrong.data.results[0].ok).toBe(false);
    const slot = expectedSlot(dict, 'CLINICAL_PROFILE_SNAPSHOTS', id);
    const body = { creates: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: slot }], changes: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', id: slot, field: 'hypertension', value: 'YES' }] };
    await sara.call('PATCH', `/api/cases/${id}`, body);
    const again = await sara.call('PATCH', `/api/cases/${id}`, body);
    expect(again.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS).toHaveLength(1);
    expect(again.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS[0].patient_id).toBe(again.data.case.meta.patient_id);
  });

  it('a procedure module needs a procedure; device modules create the case device automatically', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const noParent = await sara.call('PATCH', `/api/cases/${id}`, { creates: [{ entity: 'COMPLICATIONS', id: rid('COMPLICATIONS') }] });
    expect(noParent.data.results[0].message).toMatch(/choose the procedure/);
    const p = rid('EP_PROCEDURES');
    const di = expectedSlot(dict, 'DEVICE_IMPLANTS', p);
    const r = await sara.call('PATCH', `/api/cases/${id}`, { creates: [{ entity: 'EP_PROCEDURES', id: p }, { entity: 'DEVICE_IMPLANTS', id: di, parent_id: p }] });
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    const dev = r.data.case.rows.DEVICES[0];
    expect(dev._id).toBe(expectedSlot(dict, 'DEVICES', id));
    expect(r.data.case.rows.DEVICE_IMPLANTS[0].device_id).toBe(dev._id);
  });

  it('links (fk) must point to a row of this case', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p = rid('EP_PROCEDURES');
    const echo = rid('ECHO_STUDIES');
    const af = expectedSlot(dict, 'AF_ABLATIONS', p);
    const r = await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [{ entity: 'EP_PROCEDURES', id: p }, { entity: 'ECHO_STUDIES', id: echo }, { entity: 'AF_ABLATIONS', id: af, parent_id: p }],
      changes: [
        { entity: 'AF_ABLATIONS', id: af, field: 'baseline_echo_id', value: rid('ECHO_STUDIES') },
        { entity: 'AF_ABLATIONS', id: af, field: 'baseline_echo_id', value: echo },
      ],
    });
    expect(r.data.results.filter((x: { kind: string }) => x.kind === 'change').map((x: { ok: boolean }) => x.ok)).toEqual([false, true]);
  });

  it('changing the diagnosis clears a subtype that no longer belongs', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const slot = expectedSlot(dict, 'ARRHYTHMIA_INDICATIONS', id);
    await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [{ entity: 'ARRHYTHMIA_INDICATIONS', id: slot }],
      changes: [
        { entity: 'ARRHYTHMIA_INDICATIONS', id: slot, field: 'primary_ep_diagnosis', value: 'AF' },
        { entity: 'ARRHYTHMIA_INDICATIONS', id: slot, field: 'diagnosis_subtype', value: 'PAROXYSMAL_AF' },
      ],
    });
    const wrong = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'ARRHYTHMIA_INDICATIONS', id: slot, field: 'diagnosis_subtype', value: 'TYPICAL_SLOW_FAST' }] });
    expect(wrong.data.results[0].message).toMatch(/does not belong/);
    const r = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'ARRHYTHMIA_INDICATIONS', id: slot, field: 'primary_ep_diagnosis', value: 'AVNRT' }] });
    expect(r.data.case.rows.ARRHYTHMIA_INDICATIONS[0].diagnosis_subtype).toBeNull();
  });

  it('"Other — specify" is kept only while the field is Other', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p = rid('EP_PROCEDURES');
    await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [{ entity: 'EP_PROCEDURES', id: p }],
      changes: [
        { entity: 'EP_PROCEDURES', id: p, field: 'primary_procedure_type', value: 'OTHER' },
        { entity: 'EP_PROCEDURES', id: p, field: 'other_specify_json', key: 'primary_procedure_type', value: 'Synthetic test text' },
      ],
    });
    let row = (await sara.call('GET', `/api/cases/${id}`)).data.rows.EP_PROCEDURES[0];
    expect(row.other_specify_json).toEqual({ primary_procedure_type: 'Synthetic test text' });
    const bad = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'other_specify_json', key: 'primary_procedure_type', value: '=cmd()' }] });
    expect(bad.data.results[0].ok).toBe(false);
    await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_PROCEDURES', id: p, field: 'primary_procedure_type', value: 'ABLATION' }] });
    row = (await sara.call('GET', `/api/cases/${id}`)).data.rows.EP_PROCEDURES[0];
    expect(row.other_specify_json).toBeNull();
  });

  it('removing a procedure removes its components, modules and complications; the case rows stay', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const p = rid('EP_PROCEDURES');
    const comp = rid('COMPLICATIONS');
    await sara.call('PATCH', `/api/cases/${id}`, {
      creates: [
        { entity: 'EP_PROCEDURES', id: p },
        { entity: 'PROCEDURE_COMPONENTS', id: rid('PROCEDURE_COMPONENTS'), parent_id: p, values: { component_type: 'AF' } },
        { entity: 'COMPLICATIONS', id: comp, parent_id: p },
      ],
    });
    const r = await sara.call('PATCH', `/api/cases/${id}`, {
      removes: [
        { entity: 'EP_PROCEDURES', id: p },
        { entity: 'EP_EPISODES', id: (await sara.call('GET', `/api/cases/${id}`)).data.meta.episode_id },
      ],
    });
    expect(r.data.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false]);
    expect(r.data.case.rows.EP_PROCEDURES).toHaveLength(0);
    expect(r.data.case.rows.PROCEDURE_COMPONENTS).toHaveLength(0);
    expect(r.data.case.rows.COMPLICATIONS).toHaveLength(0);
    expect(r.data.case.rows.EP_EPISODES).toHaveLength(1);
    // A removed row cannot be brought back by a late save.
    const late = await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'COMPLICATIONS', id: comp, field: 'outcome', value: null }] });
    expect(late.data.results[0].ok).toBe(false);
  });

  it('follow-up is not editable yet (phase 7)', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const r = await sara.call('PATCH', `/api/cases/${id}`, { creates: [{ entity: 'FOLLOW_UPS', id: rid('FOLLOW_UPS') }] });
    expect(r.data.results[0].message).toMatch(/phase 7/);
  });

  it('additional clinical information: add, edit, remove; activity keeps field names only', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    const info = `info_${crypto.randomUUID()}`;
    await sara.call('PATCH', `/api/cases/${id}`, { additional: [{ op: 'add', id: info, text: 'Synthetic fact', fact_date: '2026-03-10' }] });
    let r = await sara.call('PATCH', `/api/cases/${id}`, { additional: [{ op: 'set', id: info, text: 'Synthetic fact, edited' }] });
    expect(r.data.case.additional[0]).toMatchObject({ text: 'Synthetic fact, edited', fact_date: '2026-03-10' });
    r = await sara.call('PATCH', `/api/cases/${id}`, { additional: [{ op: 'remove', id: info }] });
    expect(r.data.case.additional).toHaveLength(0);
    const ep = r.data.case.meta.episode_id;
    await sara.call('PATCH', `/api/cases/${id}`, { changes: [{ entity: 'EP_EPISODES', id: ep, field: 'referring_service', value: 'CARDIOLOGY' }] });
    const log = JSON.stringify(await store.listActivity());
    expect(log).toContain('EP_EPISODES.referring_service');
    expect(log).not.toContain('CARDIOLOGY');
  });

  it('delete moves the case out of every list', async () => {
    const sara = await Client.as('sara');
    const id = await newCase(sara);
    expect((await sara.call('POST', `/api/cases/${id}/delete`, {})).status).toBe(200);
    expect((await sara.call('GET', '/api/cases')).data.cases).toHaveLength(0);
    expect((await sara.call('GET', `/api/cases/${id}`)).status).toBe(404);
    expect((await store.getCase(id))?.meta.is_deleted).toBe(true);
  });
});
