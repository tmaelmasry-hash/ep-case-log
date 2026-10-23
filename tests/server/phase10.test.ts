// Phase 10: Excel export (EP Workspace P4). Synthetic MRNs only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, harness, newCase, type Harness } from './harness.ts';
import { readXlsx } from './readXlsx.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('Excel export', () => {
  it('Admin exports every tab; text stays text; sign-in secrets are never in the file', async () => {
    const admin = await as(h, 'admin');
    await newCase(admin, '0990601', h.groups[0].group_id);
    const r = await admin.call('POST', '/api/exports', { scope: 'ALL' });
    expect(r.status).toBe(200);
    expect(r.data.file_name).toMatch(/^KAMC_EP_Registry_All_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
    const x = readXlsx(r.data.base64);
    expect(Object.keys(x)).toEqual(expect.arrayContaining(['Cases', 'Patient', 'Procedures', 'History', 'Users', 'Groups', 'Activity', 'Lookups']));
    const head = x.Cases[0];
    expect(x.Cases[1][head.indexOf('mrn')]).toBe('0990601');
    expect(x.Users[0]).not.toContain('password_hash');
    expect(x.Users[0]).toContain('username');
    expect(JSON.stringify(x)).not.toMatch(/pbkdf2/i);
    expect(x.Lookups.length).toBeGreaterThan(100);
  });

  it('a Member exports only their group: its cases, no people or activity; other groups refused', async () => {
    const admin = await as(h, 'admin');
    await newCase(admin, '9990611', h.groups[0].group_id);
    await newCase(admin, '9990612', h.groups[1].group_id);
    const sara = await as(h, 'sara');
    expect((await sara.call('POST', '/api/exports', { scope: 'ALL' })).status).toBe(403);
    expect((await sara.call('POST', '/api/exports', { scope: 'GROUP', group_id: h.groups[1].group_id })).status).toBe(403);
    const r = await sara.call('POST', '/api/exports', { scope: 'GROUP', group_id: h.groups[0].group_id });
    expect(r.status).toBe(200);
    const x = readXlsx(r.data.base64);
    expect(Object.keys(x)).not.toContain('Users');
    expect(Object.keys(x)).not.toContain('Activity');
    const mrns = x.Cases.slice(1).map((row) => row[x.Cases[0].indexOf('mrn')]);
    expect(mrns).toEqual(['9990611']);
    expect(JSON.stringify(x.Patient)).not.toContain('9990612');
    const log = (await admin.call('GET', '/api/admin/activity')).data.items;
    expect(log.some((i: { kind: string; details: string }) => i.kind === 'EXPORT' && i.details.includes('1 cases'))).toBe(true);
  });

  it('the filtered list exports only the listed cases, and never a case of another group (R2-6)', async () => {
    const admin = await as(h, 'admin');
    const a1 = (await newCase(admin, '9990621', h.groups[0].group_id)).case_id;
    await newCase(admin, '9990622', h.groups[0].group_id);
    const b1 = (await newCase(admin, '9990623', h.groups[1].group_id)).case_id;
    const sara = await as(h, 'sara');
    const r = await sara.call('POST', '/api/exports', { scope: 'CASES', case_ids: [a1, b1] });
    expect(r.status).toBe(200);
    expect(r.data.file_name).toMatch(/^KAMC_EP_Registry_Filtered_/);
    const x = readXlsx(r.data.base64);
    expect(Object.keys(x)).not.toContain('Users');
    expect(x.Cases.slice(1).map((row) => row[x.Cases[0].indexOf('mrn')])).toEqual(['9990621']);
    expect((await sara.call('POST', '/api/exports', { scope: 'CASES', case_ids: [b1] })).status).toBe(403);
    expect((await sara.call('POST', '/api/exports', { scope: 'CASES', case_ids: [] })).status).toBe(400);
    const all = readXlsx((await admin.call('POST', '/api/exports', { scope: 'CASES', case_ids: [a1, b1] })).data.base64);
    expect(all.Cases.length - 1).toBe(2);
  });
});
